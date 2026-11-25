/**
 * Regra das rotas de tela, item 1 (R-20261123-172506-alexandre; T-0066), para TODOS os métodos: cada caminho de cada
 * constante `CAMINHOS_*` do SDK que o web importa (apps/web/src e modules/<m>/web) tem de existir na API de produção
 * (`montarApiPg` → `appPgDeTeste` com `modulos: 'producao'`). A fumaça (`fumaca-telas.db.test.ts`) cobre os GET; aqui
 * entram também os POST, PUT, PATCH e DELETE (ex.: Reprocessar e Zerar da T-0086), sem dublê e sem lista escrita à mão:
 * a lista vem do próprio SDK e do import do web, então uma chave nova no SDK usada pela tela entra sozinha.
 *
 * Como sem efeito colateral: as chamadas vão SEM sessão e sem corpo. Rota registrada responde 401/400/403/415/422;
 * rota ausente cai no 404 genérico do `setNotFoundHandler` (`"mensagem":"Rota não encontrada"`). Os controles provam que
 * a falta de sessão não mascara o 404. Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as sdk from '../../../packages/platform-sdk/src/index';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { montarApiPg, type Metodo } from '../../apoio/api-pg';
import { arquivosDoWeb, ehRotaInexistente, preencherCaminho } from '../../apoio/caminhos';
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
  caminho: string;
}

/**
 * Caminho completo: `/v1/...` vale como está; nas constantes `*_PLATAFORMA`, relativo ao `PREFIXO_PLATAFORMA`; nas
 * `*_TENANT` (rotas do BKO do tenant, ex.: CAMINHOS_INTEGRACAO_FDV_TENANT), relativo a `/v1`, como o web as monta.
 */
function casos(): { casos: Caso[]; semClasse: string[] } {
  const r: Caso[] = [];
  const semClasse: string[] = [];
  const exportado = sdk as unknown as Record<string, unknown>;
  for (const constante of constantesDoWeb()) {
    const valor = exportado[constante];
    if (!valor || typeof valor !== 'object') {
      semClasse.push(`${constante}: não é objeto exportado pelo SDK`);
      continue;
    }
    for (const [chave, v] of Object.entries(valor)) {
      if (typeof v !== 'string') semClasse.push(`${constante}.${chave}: não é texto`);
      else if (v.startsWith('/v1/')) r.push({ constante, chave, caminho: v });
      else if (constante.endsWith('_PLATAFORMA') && v.startsWith('/')) r.push({ constante, chave, caminho: `${sdk.PREFIXO_PLATAFORMA}${v}` });
      else if (constante.endsWith('_TENANT') && v.startsWith('/')) r.push({ constante, chave, caminho: `/v1${v}` });
      else semClasse.push(`${constante}.${chave} = ${v}: prefixo desconhecido (classifique em casos())`);
    }
  }
  return { casos: r, semClasse };
}

const LISTA = casos();

describe('contrato das rotas de tela: a lista vem do SDK e do import do web (T-0066)', () => {
  it('toda constante CAMINHOS_* usada pelo web é objeto de textos com prefixo conhecido', () => {
    expect(LISTA.semClasse).toEqual([]);
  });
  it('o web usa pelo menos as constantes do /config e do esqueci a senha (a varredura não ficou vazia)', () => {
    expect(constantesDoWeb()).toEqual(
      expect.arrayContaining(['CAMINHOS_CARGAS_PLATAFORMA', 'CAMINHOS_ESQUECI_SENHA', 'CAMINHOS_INTEGRACAO_FDV_PLATAFORMA']),
    );
  });
});

describe.skipIf(!PG_DISPONIVEL)('contrato das rotas de tela: todo caminho do SDK usado pelo web existe na API de produção, em algum método', () => {
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

  it.each(LISTA.casos)('$constante.$chave ($caminho)', async ({ caminho }) => {
    const url = preencher(caminho);
    const respostas: string[] = [];
    for (const m of METODOS) {
      const r = await pedir(m, url);
      expect(r.statusCode, `${m} ${url}: ${r.body}`).toBeLessThan(500);
      if (!ehRotaInexistente(r.statusCode, r.body)) return;
      respostas.push(`${m} ${r.statusCode}`);
    }
    expect.fail(`${url}: nenhum método registrado na API (${respostas.join(', ')})`);
  });
});
