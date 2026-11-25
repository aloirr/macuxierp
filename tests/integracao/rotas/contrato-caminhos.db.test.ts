/**
 * Regra das rotas de tela, item 1 (R-20261123-172506-alexandre; T-0066), para TODOS os métodos: cada caminho de cada
 * constante `CAMINHOS_*` do SDK ou dos `contracts` de um módulo (T-0093: `CAMINHOS_ZERAR_PEDIDOS` do pedido) que o web
 * importa (apps/web/src e modules/<m>/web) tem de existir na API de produção
 * (`montarApiPg` → `appPgDeTeste` com `modulos: 'producao'`). A fumaça (`fumaca-telas.db.test.ts`) cobre os GET; aqui
 * entram também os POST, PUT, PATCH e DELETE (ex.: Reprocessar e Zerar da T-0086), sem dublê e sem lista escrita à mão:
 * a lista vem do SDK, dos contracts dos módulos e do import do web, então uma chave nova usada pela tela entra sozinha.
 *
 * Como sem efeito colateral: as chamadas vão SEM sessão e sem corpo. Rota registrada responde 401/400/403/415/422;
 * rota ausente cai no 404 genérico do `setNotFoundHandler` (`"mensagem":"Rota não encontrada"`). Os controles provam que
 * a falta de sessão não mascara o 404. Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as sdk from '../../../packages/platform-sdk/src/index';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { montarApiPg, type Metodo } from '../../apoio/api-pg';
import { arquivosDoWeb, ehRotaInexistente, modulos, preencherCaminho, RAIZ } from '../../apoio/caminhos';
import { CSRF } from '../../apoio/portal-pg';

const METODOS: readonly Metodo[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Nomes `CAMINHOS_*` citados no fonte de produção do web (BKO, portal /config e web dos módulos). */
function constantesDoWeb(): string[] {
  const nomes = new Set<string>();
  for (const f of arquivosDoWeb()) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bCAMINHOS_[A-Z0-9_]+\b/g)) nomes.add(m[0]);
  }
  return [...nomes].sort();
}

interface Caso {
  constante: string;
  chave: string;
  /** Caminhos alternativos: basta um existir (regra em `casos()`). */
  caminhos: string[];
}

/** De onde vêm as constantes: o SDK e o `contracts/index.ts` de cada módulo (módulo novo entra sozinho). */
const ORIGENS: { origem: string; exportado: Record<string, unknown> }[] = [
  { origem: 'sdk', exportado: sdk as unknown as Record<string, unknown> },
  ...(await Promise.all(
    modulos().map(async (m) => ({
      origem: m,
      exportado: (await import(pathToFileURL(join(RAIZ, 'modules', m, 'contracts', 'index.ts')).href)) as Record<string, unknown>,
    })),
  )),
];

/**
 * Caminho completo: `/v1/...` vale como está; nas constantes `*_PLATAFORMA`, relativo ao `PREFIXO_PLATAFORMA`; nas
 * `*_TENANT` (rotas do BKO do tenant, ex.: CAMINHOS_INTEGRACAO_FDV_TENANT), relativo a `/v1`, como o web as monta. Na
 * constante de módulo sem um desses sufixos (ex.: `CAMINHOS_ZERAR_PEDIDOS`), o caminho vale no portal
 * (`PREFIXO_PLATAFORMA`) ou no BKO do módulo (`/v1/<modulo>`): basta existir em um dos dois.
 */
function casos(): { casos: Caso[]; semClasse: string[] } {
  const r: Caso[] = [];
  const semClasse: string[] = [];
  for (const constante of constantesDoWeb()) {
    const achadas = ORIGENS.filter((o) => o.exportado[constante] !== undefined);
    const valor = achadas[0]?.exportado[constante];
    if (achadas.length !== 1 || !valor || typeof valor !== 'object') {
      semClasse.push(`${constante}: precisa ser objeto exportado por um só lugar (SDK ou contracts de um módulo); achado em ${achadas.map((a) => a.origem).join(', ') || 'nenhum'}`);
      continue;
    }
    const { origem } = achadas[0]!;
    for (const [chave, v] of Object.entries(valor)) {
      if (typeof v !== 'string') semClasse.push(`${constante}.${chave}: não é texto`);
      else if (v.startsWith('/v1/')) r.push({ constante, chave, caminhos: [v] });
      else if (constante.endsWith('_PLATAFORMA') && v.startsWith('/')) r.push({ constante, chave, caminhos: [`${sdk.PREFIXO_PLATAFORMA}${v}`] });
      else if (constante.endsWith('_TENANT') && v.startsWith('/')) r.push({ constante, chave, caminhos: [`/v1${v}`] });
      else if (origem !== 'sdk' && v.startsWith('/')) r.push({ constante, chave, caminhos: [`${sdk.PREFIXO_PLATAFORMA}${v}`, `/v1/${origem}${v}`] });
      else semClasse.push(`${constante}.${chave} = ${v}: prefixo desconhecido (classifique em casos())`);
    }
  }
  return { casos: r, semClasse };
}

const LISTA = casos();

describe('contrato das rotas de tela: a lista vem do SDK, dos contracts dos módulos e do import do web (T-0066)', () => {
  it('toda constante CAMINHOS_* usada pelo web é objeto de textos com prefixo conhecido', () => {
    expect(LISTA.semClasse).toEqual([]);
  });
  // até o web importar a constante do pedido (#626), prova só que os contracts dos módulos entram na busca
  it('T-0093: os contracts dos módulos entram na busca (CAMINHOS_ZERAR_PEDIDOS do pedido)', () => {
    expect(ORIGENS.find((o) => o.origem === 'pedido')?.exportado.CAMINHOS_ZERAR_PEDIDOS).toBeDefined();
  });
  it('o web usa pelo menos as constantes do /config e do esqueci a senha (a varredura não ficou vazia)', () => {
    expect(constantesDoWeb()).toEqual(
      expect.arrayContaining(['CAMINHOS_CARGAS_PLATAFORMA', 'CAMINHOS_ESQUECI_SENHA', 'CAMINHOS_INTEGRACAO_FDV_PLATAFORMA', 'CAMINHOS_INTEGRACAO_FDV_TENANT']),
    );
  });
});

describe.skipIf(!PG_DISPONIVEL)('contrato das rotas de tela: todo caminho do SDK ou dos contracts usado pelo web existe na API de produção, em algum método', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'E'>>>;

  /** Sem sessão e sem corpo; o CSRF do portal vai para a recusa ser de sessão, não de CSRF. */
  const pedir = (metodo: Metodo, url: string) => api.app.inject({ method: metodo, url, headers: CSRF });
  const preencher = (modelo: string): string =>
    preencherCaminho(modelo, {
      'empresas/:id': api.t.E,
      entidade: sdk.ENTIDADES_ENVIO_FDV[0]!,
      cadastro: sdk.ENTIDADES_CARGA_PORTAL[0]!,
    });

  beforeAll(async () => {
    api = await montarApiPg({ E: ['cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'] });
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it.each(METODOS)('controle: caminho inventado sem sessão dá o 404 genérico em %s (a falta de sessão não mascara)', async (m) => {
    for (const url of ['/v1/cadastros/rota-que-nao-existe-t0066', `${sdk.PREFIXO_PLATAFORMA}/empresas/${api.t.E}/rota-que-nao-existe-t0066`]) {
      const r = await pedir(m, url);
      expect(ehRotaInexistente(r.statusCode, r.body), `${m} ${url}: ${r.body}`).toBe(true);
    }
  });

  it('controle: rota registrada sem sessão não dá o 404 genérico (GET da aba Integração do /config)', async () => {
    const r = await pedir('GET', preencher(`${sdk.PREFIXO_PLATAFORMA}${sdk.CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.ler}`));
    expect(ehRotaInexistente(r.statusCode, r.body), r.body).toBe(false);
    expect(r.statusCode, r.body).toBeLessThan(500);
  });

  it.each(LISTA.casos)('$constante · $chave', async ({ caminhos }) => {
    const respostas: string[] = [];
    for (const caminho of caminhos) {
      const url = preencher(caminho);
      for (const m of METODOS) {
        const r = await pedir(m, url);
        expect(r.statusCode, `${m} ${url}: ${r.body}`).toBeLessThan(500);
        if (!ehRotaInexistente(r.statusCode, r.body)) return;
        respostas.push(`${m} ${url} ${r.statusCode}`);
      }
    }
    expect.fail(`nenhum método registrado na API (${respostas.join(', ')})`);
  });
});
