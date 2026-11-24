/**
 * T-0057 (E3/E4): o alvo único dos cenários da `/entrada/v1`. Os testes de segurança e de mão dupla falam só com
 * `alvoEntrada()`; ele devolve:
 * - **hoje** (padrão), a `/entrada/v1` falsa (`entrada-falsa.ts`), que segue as respostas P-1 a P-12 do engenheiro e do
 *   cadastros. Serve para o esqueleto ficar pronto; **não é prova de pronto** (regra R-20261123-172506, item 3);
 * - **com `MACUXI_CENARIO_B_ALVO=real`**, a API real: `appPgDeTeste` com os módulos de produção
 *   (`montarDependenciasProducao`), Postgres efêmero (`bash db/scripts/pg-local.sh` antes), log do Fastify capturado.
 *
 * Os pontos que dependem de PR que ainda não entrou ficam em `PENDENTE_API_REAL`, um por função, com o PR que libera. Ao
 * trocar o alvo, só eles mudam; os testes não.
 */
import { randomUUID } from 'node:crypto';
import { relogioDoSistema, type Perfil } from '../../../packages/platform-sdk/src/index';
import { emitirTokenAcesso } from '../../../apps/api/src/auth/jwt';
import { JWT_SEGREDO_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { CAMINHOS_ENTRADA_V1, criarConectorSimulado, type ConectorSimulado, type OpcoesConectorSimulado } from './conector-simulado';
import { criarEntradaFalsa, type RetornoVisto } from './entrada-falsa';
import type { NotaDescida, PedidoDescido } from './lado-cliente';
import { listaDePendentes } from './lado-cliente';

/** `true` quando o alvo é a API real (variável de ambiente, para o CI e a sessão escolherem). */
export const API_REAL = process.env.MACUXI_CENARIO_B_ALVO === 'real';

/** PRs que liberam os casos `it.skipIf(!API_REAL)` e os pontos de `PENDENTE_API_REAL` (plano T-0057, legenda §Casos). */
export const PR_LIBERA = Object.freeze({
  ENG_API: 'PR do plugin /entrada/v1 (engenheiro-software, ENG-API: autenticação de máquina, mapa de erros, descida, CAMINHOS_ENTRADA_V1 no SDK -3)',
  BD: 'PR da migração 0045 da entrada (banco-dados: entrada_credencial, entrada_lote, portal_entrada_*)',
  CAD: 'PR do criarExecutorEntradaLote(deps) de @macuxierp/cadastros/api (modulo-cadastros, ~11h40)',
  PED: 'PR da fila de pedidos da mão dupla (modulo-pedido, nuvem/t-0057-pedido-mao-dupla)',
  FAT: 'PR da descida de notas e do modo desligado (modulo-faturamento, agente/T-0057-faturamento-cenario-b)',
  IFDV: 'PR da publicação igual pela entrada (modulo-integracao-fdv)',
  APPS: 'PR do /config da entrada (engenheiro-apps)',
});

export type TenantAlvo = 'a' | 'b';
export type RecursoDescida = 'pedidos' | 'notas' | 'clientes';

export interface AlvoEntrada {
  readonly tipo: 'falsa' | 'real';
  /** Base sem o prefixo (`/entrada/v1`). */
  readonly url: string;
  readonly fetch: typeof fetch;
  /** Credencial do conector do tenant (fictícia, gerada na hora; nunca sai do teste). */
  credencial(t: TenantAlvo): { conectorId: string; chave: string };
  /** Conector simulado com a credencial do tenant (ou com troca de chave/conector, para as recusas). */
  conector(t: TenantAlvo, extra?: Partial<OpcoesConectorSimulado>): ConectorSimulado;
  /** JWT de usuário do BKO do tenant (o que a `/entrada/v1` tem de recusar). */
  jwtUsuario(t: TenantAlvo, perfil?: Perfil): string;
  /** Linhas de log da API (JSON do pino na real; o mesmo formato na falsa). */
  readonly log: readonly string[];
  /** Lotes gravados do tenant (para "nada gravado depois da recusa"). */
  lotesGravados(t: TenantAlvo): Promise<number>;
  /** Roda o processamento dos lotes `recebido` (P-12: `criarExecutorEntradaLote(deps)` na real). */
  processarLotes(): Promise<void>;
  /** Põe um pedido aprovado na fila de descida do tenant. */
  semearPedido(t: TenantAlvo, p: PedidoDescido): Promise<void>;
  /** Põe uma nota autorizada (XML já guardado) na fila de descida do tenant. */
  semearNota(t: TenantAlvo, n: NotaDescida): Promise<void>;
  /** Retornos que o ERP registrou (o efeito, sem as repetições). */
  retornosVistos(t: TenantAlvo, recurso: RecursoDescida): Promise<RetornoVisto[]>;
  /** As próximas `n` chamadas de retorno não chegam ao ERP (503 no caminho), nos dois alvos. */
  falharRetornos(n: number): void;
  /** Troca a chave do conector do tenant (portal) e devolve a nova; a anterior deixa de valer na hora (§4). */
  trocarChave(t: TenantAlvo): Promise<string>;
  /** O corpo guardado do lote (só na real: `cadastros.entrada_lote.corpo`, zerado ao terminar, §3 e §8). */
  corpoDoLote(loteId: string): Promise<unknown>;
  /** Quantos pendentes o conector do tenant ainda vê (lido pela própria rota, P-5 tolerante). */
  pendentesNaFila(t: TenantAlvo, recurso: RecursoDescida): Promise<number>;
  fechar(): Promise<void>;
}

export interface OpcoesAlvo {
  /** Entidades com dono `erp` (§14). */
  donoErp?: readonly string[];
  /** P-5 em aberto: força a forma da lista na falsa (a real responde a dela). */
  formaPendentes?: 'objeto' | 'array';
  /** Sobe a API sem o `MACUXIERP_PEPPER_ENTRADA` (E3-3; só na real). */
  semPepper?: boolean;
  agora?: () => Date;
}

const novaChave = () => `cb_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;

/** Os pontos da API real que esperam PR; cada um diz qual. */
const pendente = (o_que: string, pr: string) => (): never => {
  throw new Error(`alvo real: ${o_que} ainda não existe; libera com o ${pr}.`);
};
export const PENDENTE_API_REAL = Object.freeze({
  criarCredencial: pendente('a criação da credencial pelo portal (portal_entrada_credencial_definir)', `${PR_LIBERA.ENG_API} e ${PR_LIBERA.BD}`),
  processarLotes: pendente('o criarExecutorEntradaLote(deps)', PR_LIBERA.CAD),
  semearPedido: pendente('a fila de pedidos aprovados da descida', PR_LIBERA.PED),
  semearNota: pendente('a fila de notas autorizadas da descida', PR_LIBERA.FAT),
  trocarChave: pendente('a troca de chave pelo portal', `${PR_LIBERA.ENG_API} e ${PR_LIBERA.BD}`),
  semPepper: pendente('a API sem MACUXIERP_PEPPER_ENTRADA (opção do appPgDeTeste)', PR_LIBERA.ENG_API),
  rotasNoHub: pendente('o dublê do Hub ligado à Integração FDV da API real', PR_LIBERA.IFDV),
  notaAntesDoXml: pendente('a nota autorizada com o XML ainda não guardado', PR_LIBERA.FAT),
  desligarFaturamento: pendente('o /config que liga e desliga o faturamento', `${PR_LIBERA.FAT} e ${PR_LIBERA.APPS}`),
  retornosVistos: pendente('a leitura do retorno no pedido e na nota', `${PR_LIBERA.PED} e ${PR_LIBERA.FAT}`),
});

/** Embrulha o `fetch` para as falhas de retorno simuladas (a mesma regra nos dois alvos). */
function comFalhas(f: typeof fetch) {
  let falhas = 0;
  const embrulhado: typeof fetch = async (u, init) => {
    const caminho = new URL(u instanceof Request ? u.url : String(u)).pathname;
    if (falhas > 0 && (init?.method ?? 'GET') === 'POST' && caminho.endsWith('/retorno')) {
      falhas--;
      return new Response(JSON.stringify({ codigo: 'INDISPONIVEL', mensagem: 'Tente de novo.' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return f(u, init);
  };
  return { fetch: embrulhado, falhar: (n: number) => void (falhas = n) };
}

export async function alvoEntrada(o: OpcoesAlvo = {}): Promise<AlvoEntrada> {
  return API_REAL ? alvoReal(o) : alvoFalso(o);
}

function base(
  tipo: 'falsa' | 'real',
  url: string,
  f: typeof fetch,
  cred: Record<TenantAlvo, { conectorId: string; chave: string }>,
  ids: Record<TenantAlvo, { tenant: string; usuario: string }>,
  agora: () => Date,
) {
  const { fetch: fetchAlvo, falhar } = comFalhas(f);
  const jwts = new Map<string, string>();
  const conector = (t: TenantAlvo, extra: Partial<OpcoesConectorSimulado> = {}) =>
    criarConectorSimulado({ url, ...cred[t], agora, fetch: fetchAlvo, ...extra });
  return {
    tipo,
    url,
    fetch: fetchAlvo,
    credencial: (t: TenantAlvo) => ({ ...cred[t] }),
    conector,
    jwtUsuario(t: TenantAlvo, perfil: Perfil = 'administrador') {
      // um JWT por tenant e perfil, para a conferência de vazamento procurar o mesmo que foi enviado
      const k = `${t}|${perfil}`;
      let j = jwts.get(k);
      if (!j) {
        j = emitirTokenAcesso(
          { usuario_id: ids[t].usuario, tenant_id: ids[t].tenant, perfil, filial_ids: [] },
          JWT_SEGREDO_DE_TESTE,
          agora(),
          900,
        ).token;
        jwts.set(k, j);
      }
      return j;
    },
    falharRetornos: falhar,
    async pendentesNaFila(t: TenantAlvo, recurso: RecursoDescida) {
      const r = await conector(t).pendentes(recurso);
      return listaDePendentes(r.corpo, recurso).length;
    },
  };
}

function alvoFalso(o: OpcoesAlvo): Promise<AlvoEntrada> {
  const agora = o.agora ?? (() => new Date('2026-11-24T14:00:00.000Z'));
  const cred = {
    a: { conectorId: 'erp-cenario-b-a', chave: novaChave() },
    b: { conectorId: 'erp-cenario-b-b', chave: novaChave() },
  };
  const ids = { a: { tenant: randomUUID(), usuario: randomUUID() }, b: { tenant: randomUUID(), usuario: randomUUID() } };
  const falsa = criarEntradaFalsa({
    credenciais: [
      { tenant: 'a', ...cred.a },
      { tenant: 'b', ...cred.b },
    ],
    ...(o.donoErp ? { donoErp: o.donoErp } : {}),
    ...(o.formaPendentes ? { formaPendentes: o.formaPendentes } : {}),
  });
  return Promise.resolve({
    ...base('falsa', 'https://erp.exemplo.invalid', falsa.fetch, cred, ids, agora),
    log: falsa.log,
    lotesGravados: (t: TenantAlvo) => Promise.resolve([...falsa.lotes.values()].filter((l) => l.tenant === t).length),
    processarLotes: () => Promise.resolve(void falsa.processar()),
    semearPedido: (t: TenantAlvo, p: PedidoDescido) => Promise.resolve(void falsa.pendentesDe(t).pedidos.push({ ...p })),
    semearNota: (t: TenantAlvo, n: NotaDescida) => Promise.resolve(void falsa.pendentesDe(t).notas.push({ ...n })),
    retornosVistos: (t: TenantAlvo, recurso: RecursoDescida) =>
      Promise.resolve(falsa.retornos.filter((r) => r.tenant === t && r.recurso === recurso)),
    trocarChave(t: TenantAlvo) {
      const nova = novaChave();
      falsa.trocarChave(t, nova);
      cred[t].chave = nova;
      return Promise.resolve(nova);
    },
    corpoDoLote: () => Promise.reject(new Error('alvo falso: o corpo guardado só existe na API real.')),
    fechar: () => Promise.resolve(),
  });
}

function cabecalhosDe(h: HeadersInit | undefined): Record<string, string> {
  const o: Record<string, string> = {};
  new Headers(h).forEach((v, k) => (o[k] = v));
  return o;
}

/** `app.inject` como `fetch`: o Conector simulado fala com a API real em processo, sem porta aberta. */
function fetchDoInject(app: { inject: (o: object) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> }): typeof fetch {
  return async (u, init) => {
    const url = new URL(u instanceof Request ? u.url : String(u));
    const r = await app.inject({
      method: init?.method ?? 'GET',
      url: url.pathname + url.search,
      headers: cabecalhosDe(init?.headers),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
    });
    const cab = new Headers();
    for (const [k, v] of Object.entries(r.headers))
      if (v !== undefined) cab.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    const semCorpo = r.statusCode === 204 || r.statusCode === 304;
    return new Response(semCorpo ? null : r.body, { status: r.statusCode, headers: cab });
  };
}

async function alvoReal(o: OpcoesAlvo): Promise<AlvoEntrada> {
  // import tardio: o alvo falso não carrega o pg
  const { criarBancoEfemero, criarTenant } = await import('../../../packages/platform-sdk/src/pg-testes');
  const { appPgDeTeste, destinoDeLogs, inserirAdministradorDeTeste } = await import('../../../apps/api/src/apoio-teste');
  const { CNPJ_EMPRESA_PG } = await import('../../apoio/api-pg');
  const agora = o.agora ?? (() => relogioDoSistema.agora());
  if (o.semPepper) PENDENTE_API_REAL.semPepper();
  const b = await criarBancoEfemero();
  const ids = {} as Record<TenantAlvo, { tenant: string; usuario: string }>;
  for (const t of ['a', 'b'] as const) {
    const tenant = await criarTenant(b.admin, `t0057-${t}-${randomUUID().slice(0, 8)}`, ['core', 'cadastros', 'pedido', 'faturamento', 'integracao-fdv']);
    const usuario = randomUUID();
    await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [tenant, `Empresa ${t}`, CNPJ_EMPRESA_PG]);
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: `adm@t0057-${t}.teste`, nome: 'Administração', filialIds: [] });
    ids[t] = { tenant, usuario };
  }
  const linhas: string[] = [];
  const { app } = await appPgDeTeste({ b, versao: 't0057-cenario-b', modulos: 'producao', logger: { level: 'debug', stream: destinoDeLogs(linhas) } });
  // TODO(T-0057, ENG-API + BD): a credencial sai do portal (a API gera a chave e grava só o HMAC); até lá, pendente.
  let cred: Record<TenantAlvo, { conectorId: string; chave: string }>;
  try {
    cred = { a: PENDENTE_API_REAL.criarCredencial(), b: PENDENTE_API_REAL.criarCredencial() };
  } catch (e) {
    await app.close();
    await b.remover();
    throw e;
  }
  return {
    ...base('real', 'http://127.0.0.1', fetchDoInject(app), cred, ids, agora),
    log: linhas,
    async lotesGravados(t) {
      // ADR 0014 §8: tabela `cadastros.entrada_lote` (BD); lida pelo admin, fora da RLS, só para contar
      const r = await b.admin.query<{ n: string }>('SELECT count(*) AS n FROM cadastros.entrada_lote WHERE tenant_id = $1', [ids[t].tenant]);
      return Number(r.rows[0]!.n);
    },
    processarLotes: () => Promise.resolve(PENDENTE_API_REAL.processarLotes()),
    semearPedido: () => Promise.resolve(PENDENTE_API_REAL.semearPedido()),
    semearNota: () => Promise.resolve(PENDENTE_API_REAL.semearNota()),
    retornosVistos: () => Promise.resolve(PENDENTE_API_REAL.retornosVistos()),
    trocarChave: () => Promise.resolve(PENDENTE_API_REAL.trocarChave()),
    async corpoDoLote(loteId) {
      const r = await b.admin.query<{ corpo: unknown }>('SELECT corpo FROM cadastros.entrada_lote WHERE id = $1', [loteId]);
      return r.rows[0]?.corpo ?? null;
    },
    async fechar() {
      await app.close();
      await b.remover();
    },
  };
}

/** Rota da `/entrada/v1` com prefixo (para as conferências de log e de 404). */
export const rotaEntrada = (rel: string) => CAMINHOS_ENTRADA_V1.prefixo + rel;
