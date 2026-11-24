/**
 * T-0065 (a) (testes): fumaça das telas × API real. A v0.3.5 saiu com a aba Cargas do /config chamando um GET que a API não
 * tinha (404). Aqui, TODO GET que o web chama (BKO em apps/web/src e as funções de API de modules/<m>/web, mais o portal
 * /config) vai à API de produção (`appPgDeTeste` com `modulos: 'producao'`, via `montarApiPg`) e não pode cair no 404
 * genérico do `setNotFoundHandler` (apps/api/src/app.ts: `{ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada' }`)
 * nem dar 5xx. 200 e 4xx de regra (inclusive 404 de registro inexistente, que traz outra mensagem) são aceitos.
 *
 * Parâmetros (camada a; a camada b segue o campo `origem` do JSON): empresa = o tenant de teste; filial = filial real criada pela API; cadastro e entidade = valores válidos do
 * SDK; demais `:id` = UUID fictício (404 de regra aceito). Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMINHOS_CARGAS_PLATAFORMA,
  CADASTROS_CARGA_PORTAL,
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA,
  ENTIDADES_CARGA_PORTAL,
  ENTIDADES_ENVIO_FDV,
  PREFIXO_PLATAFORMA,
} from '../../../packages/platform-sdk/src/index';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { filialValida } from '../../../modules/cadastros/api/fixtures-teste';
import { urlDoDanfe, urlDoXml } from '../../../modules/faturamento/web/index';
import { PAGINAS_REGISTRADAS } from '../../../apps/web/src/lib/paginas';
import { telaDaRota } from '../../../apps/web/src/lib/telas';
import type { ExecutorDeAcoes, TelaDescrita } from '../../../apps/web/src/lib/descritor/tipos';
import { montarApiPg } from '../../apoio/api-pg';
import { arquivosDoWeb, ehRotaInexistente, preencherCaminho, RAIZ, UUID_FICTICIO } from '../../apoio/caminhos';
import { atalhosPortal, inserirSuperadmin } from '../../apoio/portal-pg';

const ID = ':id';
/** Id passado às funções de caminho das telas (`api(id)`, `eventosApi(id)`): sem caracteres que o `encodeURIComponent` troque. */
const ID_DA_TELA = 'IDDATELAT0065';

// ---------------------------------------------------------------- 1. varredura do fonte

/**
 * Início de uma chamada GET do web. Os wrappers são os de apps/web/src/lib/api.ts, lib/listas.ts e lib/config/api.ts e o
 * `chamar` dos clientes dos módulos; a declaração da função (`function baixarCsv(`) é descartada à parte.
 */
const CHAMADA_GET = /\b(?:chamar\(\s*'GET'\s*,|getValidado\(|buscarRegistro\(|buscarPagina\(|baixarCsv\(|baixarArquivo\()\s*/g;

/** Texto bruto do primeiro argumento a partir de `i` (até a `,` ou o `)` do mesmo nível), pulando textos e templates. */
function primeiroArgumento(src: string, i: number): string {
  let nivel = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"') j = src.indexOf(c, j + 1);
    else if (c === '`') j = fimDoTemplate(src, j);
    else if ('([{'.includes(c!)) nivel++;
    else if (')]}'.includes(c!)) {
      if (nivel === 0) break;
      nivel--;
    } else if (c === ',' && nivel === 0) break;
  }
  return src.slice(i, j).trim();
}

/** Índice da crase que fecha o template aberto em `i` (templates aninhados em `${}` inclusos). */
function fimDoTemplate(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '`') return j;
    if (src[j] === '$' && src[j + 1] === '{') j = fimDaExpressao(src, j + 2);
  }
  throw new Error('template sem fim');
}
function fimDaExpressao(src: string, i: number): number {
  let nivel = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '`') j = fimDoTemplate(src, j);
    else if (c === "'" || c === '"') j = src.indexOf(c, j + 1);
    else if (c === '{') nivel++;
    else if (c === '}') {
      if (nivel === 0) return j;
      nivel--;
    }
  }
  throw new Error('expressão sem fim');
}

/** Caminho de um literal: `${}` num segmento inteiro → `:id`; colado (consulta) → some; corta no `?`. Null se não é literal de caminho. */
function caminhoDoLiteral(arg: string): string | null {
  if (arg.startsWith("'")) return arg.slice(1, -1).split('?')[0]!;
  if (!arg.startsWith('`') || arg.startsWith('`${')) return null;
  let s = '';
  for (let j = 1; j < arg.length - 1; j++) {
    if (arg[j] === '$' && arg[j + 1] === '{') {
      const fim = fimDaExpressao(arg, j + 2);
      const depois = arg[fim + 1];
      s += s.endsWith('/') && (depois === '/' || depois === '`' || depois === '?') ? ID : '';
      j = fim;
    } else s += arg[j];
  }
  return s.split('?')[0]!;
}

/** Prefixo dos caminhos do arquivo (portal ou cliente de módulo); '' quando o caminho já é completo (`/v1/...`). */
function prefixoDo(arquivo: string, src: string): string {
  if (arquivo.startsWith('apps/web/src/lib/config/')) return PREFIXO_PLATAFORMA;
  return /\$\{cfg\.baseUrl\}(\/v1\/[a-z-]+)\$\{caminho\}/.exec(src)?.[1] ?? '';
}

interface Varredura {
  literais: { origem: string; caminho: string }[];
  dinamicas: string[];
}
function varrer(): Varredura {
  const v: Varredura = { literais: [], dinamicas: [] };
  for (const abs of arquivosDoWeb()) {
    const src = readFileSync(abs, 'utf8');
    const arquivo = relative(RAIZ, abs).split('\\').join('/');
    const prefixo = prefixoDo(arquivo, src);
    for (const m of src.matchAll(CHAMADA_GET)) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
      const arg = primeiroArgumento(src, m.index + m[0].length);
      const linha = src.slice(0, m.index).split('\n').length;
      const caminho = caminhoDoLiteral(arg);
      if (caminho === null) v.dinamicas.push(`${arquivo} :: ${arg.replace(/\s+/g, ' ')}`);
      else v.literais.push({ origem: `${arquivo}:${linha}`, caminho: `${prefixo}${caminho}` });
    }
  }
  return v;
}

/**
 * Chamadas GET do web com caminho não literal, e de onde o caminho vem (coberto pelas fontes estruturadas abaixo).
 * Chamada nova com caminho não literal: classifique aqui e garanta que a fonte dela entra em `GETS_ESTRUTURADOS`.
 */
const NAO_EXTRAIVEIS: Readonly<Record<string, string>> = {
  'apps/web/src/components/descritor/lista-generica.tsx :: `${caminhoDaFonte(f.fonte)}?limite=200`': 'fonte dos filtros da lista (TelaLista.filtrosTela[].fonte)',
  'apps/web/src/components/descritor/lista-generica.tsx :: tela.pagina.api': 'lista da tela (TelaLista.pagina.api)',
  'apps/web/src/components/descritor/tela-generica.tsx :: `${caminhoDaFonte(fonte)}?limite=200`': 'fontes do formulário (campos[].fonte e itens.fonte)',
  'apps/web/src/components/descritor/tela-generica.tsx :: tela.api(id)': 'detalhe (TelaDetalhe.api)',
  'apps/web/src/components/descritor/tela-generica.tsx :: tela.motivosApi': 'catálogo de motivos (TelaDetalhe.motivosApi)',
  'apps/web/src/components/descritor/tela-generica.tsx :: tela.eventosApi(id)': 'histórico (TelaDetalhe.eventosApi)',
  'apps/web/src/app/(shell)/[modulo]/[...pagina]/acoes.ts :: caminho': 'leituras dos diálogos (ExecutorDeAcoes.leituras, via leituraDeclarada)',
  'apps/web/src/app/exportar-csv/route.ts :: `${tela.pagina.api}/exportar${paraQuery(filtros)}`': 'CSV da lista (`<TelaLista.pagina.api>/exportar`)',
  'apps/web/src/lib/proxy-download.ts :: caminho': 'XML e DANFE da nota (urlDoXml/urlDoDanfe, lista fechada de lib/arquivos.ts)',
  'apps/web/src/lib/listas.ts :: urlDaLista(caminhoApi, filtros)': 'miolo do buscarPagina (mesma lista de TelaLista.pagina.api)',
  'apps/web/src/lib/config/api.ts :: rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.ler, id)': 'aba Integração do /config (CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.ler)',
  'apps/web/src/lib/config/api.ts :: rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.monitor, id)': 'monitor do conector na aba Integração (CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.monitor)',
  'apps/web/src/lib/config/api.ts :: rotaFdv(CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.log, id, entidade)': 'log da carga por cadastro na aba Integração (CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.log)',
  "apps/web/src/lib/config/cargas-api.ts :: caminho('situacao', id)": 'aba Cargas do /config (CAMINHOS_CARGAS_PLATAFORMA.situacao)',
  "apps/web/src/lib/config/cargas-api.ts :: caminho('modelo', id, cadastro)": 'modelo da carga (CAMINHOS_CARGAS_PLATAFORMA.modelo, por cadastro)',
};

// ---------------------------------------------------------------- 2. fontes estruturadas

const FONTES_DE = (t: TelaDescrita): string[] =>
  t.tipo === 'lista'
    ? t.filtrosTela.flatMap((f) => (f.fonte ? [f.fonte] : []))
    : t.tipo === 'formulario'
      ? [...t.campos.flatMap((c) => (c.fonte ? [c.fonte] : [])), ...(t.itens ? [t.itens.fonte] : [])]
      : [];
const LEITURAS_DE = (e: ExecutorDeAcoes | undefined): string[] => (e?.leituras ?? []).map((l) => l.caminho);

function getsDasTelas(): { origem: string; caminho: string }[] {
  const r: { origem: string; caminho: string }[] = [];
  for (const p of PAGINAS_REGISTRADAS) {
    const t = telaDaRota(p.rota);
    if (!t) continue;
    const de = (caminho: string, o: string) => r.push({ origem: `tela ${p.rota} (${o})`, caminho });
    for (const f of FONTES_DE(t)) de(f, 'fonte');
    if (t.tipo === 'lista') {
      de(t.pagina.api, 'lista');
      de(`${t.pagina.api}/exportar`, 'exportar CSV');
      for (const l of [...LEITURAS_DE(t.acaoDaLinha), ...LEITURAS_DE(t.acaoDaBarra)]) de(l, 'leitura do diálogo');
    } else if (t.tipo === 'detalhe') {
      de(t.api(ID_DA_TELA), 'detalhe');
      if (t.motivosApi) de(t.motivosApi, 'motivos');
      if (t.eventosApi) de(t.eventosApi(ID_DA_TELA), 'eventos');
      for (const l of LEITURAS_DE(t)) de(l, 'leitura do diálogo');
    }
  }
  return r;
}

const GETS_ESTRUTURADOS = (): { origem: string; caminho: string }[] => [
  ...getsDasTelas(),
  { origem: 'download XML da nota (urlDoXml)', caminho: urlDoXml(ID) },
  { origem: 'download DANFE da nota (urlDoDanfe)', caminho: urlDoDanfe(ID) },
  { origem: 'aba Integração do /config', caminho: `${PREFIXO_PLATAFORMA}${CAMINHOS_INTEGRACAO_FDV_PLATAFORMA.ler}` },
  { origem: 'aba Cargas do /config', caminho: `${PREFIXO_PLATAFORMA}${CAMINHOS_CARGAS_PLATAFORMA.situacao}` },
  ...ENTIDADES_CARGA_PORTAL.map((c) => ({ origem: `modelo da carga (${c})`, caminho: `${PREFIXO_PLATAFORMA}${CAMINHOS_CARGAS_PLATAFORMA.modelo.replace(':cadastro', c)}` })),
];

// ---------------------------------------------------------------- 3. a lista

const VARREDURA = varrer();
const GETS = new Map<string, string>();
for (const g of [...VARREDURA.literais, ...GETS_ESTRUTURADOS()]) {
  const c = g.caminho.split(ID_DA_TELA).join(ID).replace(/:[a-z_]*id\b/g, ID);
  if (!GETS.has(c)) GETS.set(c, g.origem);
}
const CASOS = [...GETS].sort(([a], [b]) => a.localeCompare(b)).map(([caminho, origem]) => ({ caminho, origem }));
/** Rotas fixas medidas em 2026-11-23 (T-0065), fora os GET modelo da carga: a lista nunca encolhe calada. */
const ROTAS_FIXAS = 43;
/** Piso = 43 rotas fixas + 1 GET modelo por cadastro de CADASTROS_CARGA_PORTAL (8 na v0.3.7 = 51). */
const PISO_DE_ROTAS = ROTAS_FIXAS + CADASTROS_CARGA_PORTAL.length;

/**
 * Camada (b) do docs/testes/fumaca-publicar.md: a mesma lista, em JSON, para o passo de fumaça do producao-publicar.
 * Sem o arquivo de onde a chamada saiu (traz número de linha e mudaria a cada edição do web); o campo `origem` do JSON é
 * outra coisa: de onde vem o parâmetro. Regenerar: campo `regenerar` do JSON.
 */
const ARQUIVO_JSON = join(RAIZ, 'tests', 'integracao', 'rotas', 'fumaca-rotas.json');

/** Pendência 4: ver docs/testes/fumaca-publicar.md, seção Parâmetros. */
type Origem =
  | { tipo: 'lista'; de: string; campo: 'itens[0].id' }
  | { tipo: 'ficticio' }
  | { tipo: 'contexto'; nome: 'empresa' | 'filial' };
const PARAMETRO = /:[a-z_]+/g;
const CAMINHOS = new Set(CASOS.map((c) => c.caminho));
function origemDe(caminho: string): Origem | undefined {
  const i = caminho.search(PARAMETRO);
  if (i < 0) return undefined;
  const antes = caminho.slice(0, i);
  if (antes === `${PREFIXO_PLATAFORMA}/empresas/`) return { tipo: 'contexto', nome: 'empresa' };
  if (antes.endsWith('/filiais/')) return { tipo: 'contexto', nome: 'filial' };
  const lista = antes.slice(0, -1);
  if (CAMINHOS.has(lista)) return { tipo: 'lista', de: `GET ${lista}`, campo: 'itens[0].id' };
  return { tipo: 'ficticio' };
}
const ROTAS_DO_JSON = CASOS.map(({ caminho }) => {
  const origem = origemDe(caminho);
  return {
    metodo: 'GET',
    caminho,
    area: caminho.startsWith(`${PREFIXO_PLATAFORMA}/`) ? 'plataforma' : 'bko',
    ...(origem ? { origem } : {}),
  };
});
const JSON_DA_EXTRACAO = `${JSON.stringify(
  {
    formato: 1,
    gerado_por: 'tests/integracao/rotas/fumaca-telas.db.test.ts (T-0065)',
    regenerar: 'MACUXI_FUMACA_GERAR=1 pnpm exec vitest run --config tests/vitest.config.ts tests/integracao/rotas/fumaca-telas.db.test.ts',
    uuid_ficticio: UUID_FICTICIO,
    rotas: ROTAS_DO_JSON,
  },
  null,
  2,
)}\n`;
if (process.env.MACUXI_FUMACA_GERAR === '1') writeFileSync(ARQUIVO_JSON, JSON_DA_EXTRACAO);

describe('fumaça das telas: a lista de GETs do web (T-0065)', () => {
  it('tests/integracao/rotas/fumaca-rotas.json é igual à extração (regenerar com MACUXI_FUMACA_GERAR=1)', () => {
    expect(readFileSync(ARQUIVO_JSON, 'utf8')).toBe(JSON_DA_EXTRACAO);
  });
  it('toda chamada GET com caminho não literal está classificada em NAO_EXTRAIVEIS (e nada sobra lá)', () => {
    expect([...VARREDURA.dinamicas].sort()).toEqual(Object.keys(NAO_EXTRAIVEIS).sort());
  });
  it(`a lista tem pelo menos ${PISO_DE_ROTAS} rotas, todas /v1/...`, () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(PISO_DE_ROTAS);
    for (const { caminho } of CASOS) expect(caminho).toMatch(/^\/v1\/[a-z-]+\//);
  });
  it('formato 1: no máximo um parâmetro por rota', () => {
    for (const r of ROTAS_DO_JSON) expect(r.caminho.match(PARAMETRO)?.length ?? 0, r.caminho).toBeLessThanOrEqual(1);
  });
  it('pendência 4 (LGPD): o JSON não traz id real (UUID além do fictício), CNPJ, CPF nem e-mail', () => {
    const texto = readFileSync(ARQUIVO_JSON, 'utf8');
    const uuids = texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect(uuids.filter((u) => u !== UUID_FICTICIO)).toEqual([]);
    const semUuid = texto.split(UUID_FICTICIO).join('');
    expect(semUuid).not.toMatch(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/); // CNPJ
    expect(semUuid).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/); // CPF
    expect(semUuid).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // e-mail
  });
});

// ---------------------------------------------------------------- 4. a API real

describe.skipIf(!PG_DISPONIVEL)('fumaça das telas: todo GET do web existe na API de produção (T-0065, Postgres)', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'E'>>>;
  let portal: ReturnType<typeof atalhosPortal>;
  let token: string;
  let filial: string;

  const preencher = (modelo: string): string =>
    preencherCaminho(modelo, {
      'empresas/:id': api.t.E,
      'filiais/:id': filial,
      entidade: ENTIDADES_ENVIO_FDV[0]!,
      cadastro: ENTIDADES_CARGA_PORTAL[0]!,
    });
  const get = (url: string) =>
    url.startsWith(`${PREFIXO_PLATAFORMA}/`) ? portal.pedir('GET', url, { token }) : api.chamar('E', 'GET', url);

  beforeAll(async () => {
    api = await montarApiPg({ E: ['cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'] });
    portal = atalhosPortal(api.app);
    await inserirSuperadmin(api.b, 'sa-fumaca@exemplo.invalid');
    token = await portal.sessao('sa-fumaca@exemplo.invalid');
    const r = await api.chamar('E', 'POST', '/v1/cadastros/filiais', filialValida());
    expect(r.statusCode, r.body).toBeLessThan(300);
    filial = r.json<{ id: string }>().id;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('controle: caminho inventado dá o 404 genérico, no BKO e no portal (o teste pega o defeito)', async () => {
    const bko = await get('/v1/cadastros/rota-que-nao-existe-t0065');
    expect(ehRotaInexistente(bko.statusCode, bko.body), bko.body).toBe(true);
    const cfg = await get(`${PREFIXO_PLATAFORMA}/empresas/${api.t.E}/rota-que-nao-existe-t0065`);
    expect(ehRotaInexistente(cfg.statusCode, cfg.body), cfg.body).toBe(true);
  });

  const LISTAS_DE_ORIGEM = [...new Set(ROTAS_DO_JSON.flatMap((r) => (r.origem?.tipo === 'lista' ? [r.origem.de.slice('GET '.length)] : [])))];
  it.each(LISTAS_DE_ORIGEM)('pendência 4: a lista de origem GET %s devolve `itens[]`', async (lista) => {
    const r = await get(lista);
    expect(r.statusCode, r.body).toBe(200);
    expect(Array.isArray(r.json<{ itens: unknown }>().itens), r.body).toBe(true);
  });

  it.each(CASOS)('GET $caminho ($origem)', async ({ caminho }) => {
    const url = preencher(caminho);
    const r = await get(url);
    expect(ehRotaInexistente(r.statusCode, r.body), `GET ${url}: rota inexistente na API (${r.body})`).toBe(false);
    expect(r.statusCode, `GET ${url}: ${r.body}`).toBeLessThan(500);
  });
});
