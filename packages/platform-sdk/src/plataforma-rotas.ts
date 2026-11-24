/**
 * Rotas de plataforma do portal `/config` (ADR 0012): só as portas e tipos, sem SQL e sem Fastify. Ficam em
 * `/v1/plataforma/*`, FORA do `/v1/<modulo>`, e trocam a checagem do tenant (perfil → tenant → licença, RN-CORE-02) por
 * "sessão de superadmin válida". Não há `tenant_id` na sessão: o acesso entre tenants é pelas funções SECURITY DEFINER de
 * lista fechada do banco (migração 0033), que revalidam a sessão. Nunca BYPASSRLS.
 *
 * Exceção única, a carga do portal (T-0058, ADR 0013, adendo de 23/11/2026): a rota `transacoes: 'por_etapa'` não roda
 * dentro de uma transação de plataforma; ela abre as próprias, uma de cada vez (`ContextoPlataformaPorEtapa`):
 * `comPlataforma` (papel `macuxierp_config`, sessão posta) e `comTenant` (papel `macuxierp_app`, `app.tenant_id` posto,
 * a RLS valendo como no BKO). O tenant do `comTenant` é o `:id` da rota, já conferido pela função de plataforma da
 * etapa anterior (empresa ativa e licença).
 *
 * O `ContextoRota` dos módulos não muda: uma rota de plataforma não é rota de módulo e não entra em `definirPlugin`.
 * O login, a saída e a troca de senha do superadmin são da apps/api (como o `/v1/auth/*`), não de plugin.
 */
import type { z } from 'zod';
import type { DadosAuditoria } from './auditoria';
import { PADRAO_UUID, type Banco, type Transacao } from './banco';
import { erros } from './erros';
import {
  PluginInvalido,
  validarMultipartDaRota,
  validarTempoMaximoDaRota,
  type EntradaChamada,
  type MetodoHttp,
  type MultipartRota,
  type RespostaRota,
} from './rotas';

/**
 * Ações das rotas do portal e fonte dos nomes gravados na auditoria pelo portal e pelo operador (ADR 0012 §4): toda ação
 * que muda estado é gravada com este nome, e também a que expõe dado pessoal (`plataforma.admin.revelar_email`, T-0050).
 * `plataforma.empresa.ver` é permissão de rota, sem auditoria;
 * `plataforma.superadmin.*` são só de auditoria, sem rota, e ficam fora daqui. Ação nova = linha aqui + ADR (0012 ou nova, como a 0013) + função
 * SQL na lista fechada.
 * Integração FDV: `.ver`, `.configurar` e `.operar` são só permissão de rota (ADR 0013 §2 e §4).
 * Cargas e zerar (T-0058; o zerar é v0.3.5b): `plataforma.cadastros.carga` (situação, modelo, validar, erros e
 * gravar) e `plataforma.cadastros.zerar` são só permissão de rota; a auditoria usa os nomes do módulo.
 */
export const ACOES_PLATAFORMA = [
  'plataforma.empresa.ver',
  'plataforma.empresa.criar',
  'plataforma.empresa.situacao',
  'plataforma.modulos.alterar',
  'plataforma.admin.criar',
  'plataforma.admin.redefinir_senha',
  'plataforma.admin.revelar_email',
  'plataforma.integracao_fdv.ver',
  'plataforma.integracao_fdv.configurar',
  'plataforma.integracao_fdv.operar',
  'plataforma.cadastros.carga',
  'plataforma.cadastros.zerar',
] as const;
export type AcaoPlataforma = (typeof ACOES_PLATAFORMA)[number];

/** Sessão do superadmin, lida do cookie `COOKIE_CONFIG` pela apps/api. Sem tenant e sem perfil. */
export interface SessaoPlataforma {
  superadmin_id: string;
  sessao_id: string;
}

/** Auditoria de plataforma: `tenant_id` é a empresa ALVO; o autor é o `superadmin_id` da sessão (nunca e-mail nem nome). */
export interface DadosAuditoriaPlataforma extends DadosAuditoria {
  tenant_id: string;
}

/**
 * Porta do banco de plataforma (adaptador na apps/api): abre a transação com o papel de plataforma e a sessão posta só
 * nela (`SET LOCAL ROLE` + `set_config(..., true)`), para as funções SECURITY DEFINER conferirem a sessão no banco.
 */
export interface BancoPlataforma {
  comPlataforma<R>(sessao: SessaoPlataforma, fn: (tx: Transacao) => Promise<R>): Promise<R>;
}

/**
 * Porta do login do superadmin (só a apps/api): além da transação com sessão, uma transação no papel de plataforma SEM
 * sessão, para as funções "não" e "troca" da lista fechada (login, falha, abrir sessão, sessão pelo hash do token).
 */
export interface BancoPlataformaComLogin extends BancoPlataforma {
  antesDaSessao<R>(fn: (tx: Transacao) => Promise<R>): Promise<R>;
}

/**
 * Porta da transação de tenant das rotas por etapa (só a apps/api injeta): o `comTenant` do `Banco` da API (`BancoPg` no
 * papel `macuxierp_app`, `app.tenant_id` com `set_config(..., true)`), numa conexão e numa transação NOVAS.
 */
export type BancoTenantPlataforma = Pick<Banco, 'comTenant'>;

interface ContextoPlataformaBase {
  sessao: SessaoPlataforma;
  request_id: string;
  agora: Date;
}

/** Contexto da rota de plataforma comum: tudo numa transação só, no papel de plataforma. */
export interface ContextoPlataforma extends ContextoPlataformaBase {
  tx: Transacao;
  auditar(dados: DadosAuditoriaPlataforma): Promise<void>;
}

/**
 * Contexto da rota `transacoes: 'por_etapa'` (só a carga do portal, T-0058; ADR 0013, adendo de 23/11/2026). Não há `tx`:
 * cada etapa abre e fecha (COMMIT) a própria transação, uma de cada vez, nunca uma dentro da outra.
 * - `comPlataforma`: transação NOVA no papel `macuxierp_config`, com a sessão do superadmin (as funções SECURITY DEFINER
 *   revalidam). Em deadlock (`40P01`) é refeita uma vez, como nas rotas comuns.
 * - `comTenant`: transação NOVA no papel `macuxierp_app`, com `app.tenant_id` = `tenantId`, FORA de qualquer transação
 *   de plataforma (aberta junto, a escrita do tenant poderia esperar um bloqueio da transação de plataforma ociosa, que
 *   espera a de tenant: impasse que o banco não vê). A RLS vale igual ao BKO. Só aceita o `:id` da rota e só depois de
 *   uma `comPlataforma` concluída (a etapa que confere empresa ativa e licença); fora disso é erro de programação. Sem
 *   retentativa. Com `tempoMaximoMs` na rota, a transação tem o prazo da rota (503 ao passar, contado desde o pedido).
 */
export interface ContextoPlataformaPorEtapa extends ContextoPlataformaBase {
  comPlataforma<R>(fn: (tx: Transacao) => Promise<R>): Promise<R>;
  comTenant<R>(tenantId: string, fn: (tx: Transacao) => Promise<R>): Promise<R>;
}

interface RotaPlataformaBase<TC, TQ> {
  metodo: MetodoHttp;
  /** Relativo a `/v1/plataforma`, começando com `/` (ex.: `/empresas/:id/modulos`). Nunca `/auth/*` (da apps/api). */
  caminho: string;
  acao: AcaoPlataforma;
  corpo?: z.ZodType<TC, z.ZodTypeDef, unknown>;
  consulta?: z.ZodType<TQ, z.ZodTypeDef, unknown>;
  /**
   * `multipart/form-data` (POST, PUT ou PATCH), com as mesmas regras e limites do `RotaModulo.multipart` (a carga do BKO,
   * T-0026): lido depois da sessão e antes de qualquer transação; os arquivos chegam em `e.arquivos`/`e.todosArquivos`.
   */
  multipart?: MultipartRota;
}

/** Rota comum: o `executar` roda dentro de UMA transação de plataforma (`executarPlataforma`). */
export interface RotaPlataformaUnica<TC = unknown, TQ = unknown> extends RotaPlataformaBase<TC, TQ> {
  transacoes?: 'unica';
  /** Mesmo sentido do `RotaModulo.idempotencia` (só POST, PUT e PATCH), guardada no tenant de referência. */
  idempotencia?: 'opcional' | 'obrigatoria';
  tempoMaximoMs?: undefined;
  executar(c: ContextoPlataforma, e: EntradaChamada<TC, TQ>): Promise<RespostaRota>;
}

/**
 * Rota por etapa (só a carga do portal): sem transação em volta e caminho sempre em `/empresas/:id/...` (o tenant do
 * `comTenant`). Sem `Idempotency-Key` (não há uma transação só para a reserva); a carga é tudo ou nada na transação de
 * tenant e a concorrência é o `MXC01`. `tempoMaximoMs` como no `RotaModulo` (até `TEMPO_MAXIMO_ROTA_MS`).
 */
export interface RotaPlataformaPorEtapa<TC = unknown, TQ = unknown> extends RotaPlataformaBase<TC, TQ> {
  transacoes: 'por_etapa';
  idempotencia?: undefined;
  tempoMaximoMs?: number;
  executar(c: ContextoPlataformaPorEtapa, e: EntradaChamada<TC, TQ>): Promise<RespostaRota>;
}

/** A rota como o plugin a declara: o `transacoes` escolhe o contexto do `executar`. */
export type DefinicaoRotaPlataforma<TC = unknown, TQ = unknown> = RotaPlataformaUnica<TC, TQ> | RotaPlataformaPorEtapa<TC, TQ>;

/**
 * A rota "apagada" do plugin, como a apps/api e os testes a recebem: o `executar` aceita o contexto do próprio
 * `transacoes` (a apps/api passa o `ContextoPlataforma` só à rota comum e o `ContextoPlataformaPorEtapa` só à por etapa).
 */
export interface RotaPlataforma<TC = unknown, TQ = unknown> extends RotaPlataformaBase<TC, TQ> {
  transacoes?: 'unica' | 'por_etapa';
  idempotencia?: 'opcional' | 'obrigatoria';
  tempoMaximoMs?: number;
  executar(c: ContextoPlataforma | ContextoPlataformaPorEtapa, e: EntradaChamada<TC, TQ>): Promise<RespostaRota>;
}

/** Ajuda de tipo, como o `definirRota`: infere corpo e consulta e devolve a rota "apagada" para o plugin. */
export function definirRotaPlataforma<TC = undefined, TQ = undefined>(r: DefinicaoRotaPlataforma<TC, TQ>): RotaPlataforma {
  return r as unknown as RotaPlataforma;
}

export interface PluginPlataforma {
  rotas: readonly RotaPlataforma[];
}

/** Prefixo obrigatório da rota por etapa: o `:id` é o tenant do `comTenant`. */
const PREFIXO_POR_ETAPA = '/empresas/:id/';

/**
 * Valida no carregamento: caminho com `/`, fora de `/auth`, sem repetição, idempotência só em escrita, multipart como no
 * `definirPlugin` e, na rota por etapa, caminho em `/empresas/:id/`, sem idempotência e `tempoMaximoMs` no limite.
 */
export function definirPluginPlataforma(rotas: readonly RotaPlataforma[]): PluginPlataforma {
  const vistas = new Set<string>();
  for (const r of rotas) {
    const id = `${r.metodo} ${r.caminho}`;
    if (!r.caminho.startsWith('/')) throw new PluginInvalido(`plataforma: caminho "${r.caminho}" sem "/" inicial`);
    if (r.caminho === '/auth' || r.caminho.startsWith('/auth/')) throw new PluginInvalido(`plataforma: ${id} é da apps/api (login do superadmin)`);
    if (r.idempotencia && r.metodo !== 'POST' && r.metodo !== 'PUT' && r.metodo !== 'PATCH') {
      throw new PluginInvalido(`plataforma: Idempotency-Key só em POST, PUT ou PATCH (${id})`);
    }
    validarMultipartDaRota('plataforma', id, r);
    if (r.transacoes === 'por_etapa') {
      if (!r.caminho.startsWith(PREFIXO_POR_ETAPA)) throw new PluginInvalido(`plataforma: rota por etapa fora de ${PREFIXO_POR_ETAPA} (${id})`);
      if (r.idempotencia) throw new PluginInvalido(`plataforma: rota por etapa sem Idempotency-Key (${id})`);
      validarTempoMaximoDaRota('plataforma', id, r);
    } else if (r.tempoMaximoMs !== undefined) {
      throw new PluginInvalido(`plataforma: tempoMaximoMs só na rota por etapa (${id})`);
    }
    if (vistas.has(id)) throw new PluginInvalido(`plataforma: rota repetida ${id}`);
    vistas.add(id);
  }
  return Object.freeze({ rotas });
}

export interface PedidoPlataforma<R> {
  sessao: SessaoPlataforma | null;
  banco: BancoPlataforma;
  executar: (tx: Transacao, sessao: SessaoPlataforma) => Promise<R>;
}

/**
 * Ordem de checagem da rota de plataforma: sessão de superadmin (401) → transação de plataforma. Sem perfil e sem licença
 * de tenant: o superadmin não tem perfil de empresa. Separação das credenciais de tenant e de plataforma: ver
 * apps/api/src/plataforma/rotas.ts.
 */
export async function executarPlataforma<R>(p: PedidoPlataforma<R>): Promise<R> {
  const { sessao } = p;
  if (!sessao) throw erros.naoAutenticado();
  return p.banco.comPlataforma(sessao, (tx) => p.executar(tx, sessao));
}

export interface PedidoPlataformaPorEtapa<R> {
  sessao: SessaoPlataforma | null;
  banco: BancoPlataforma;
  bancoTenant: BancoTenantPlataforma;
  /** O `:id` da rota: o único tenant que o `comTenant` aceita. */
  tenantDaRota: string;
  request_id: string;
  agora: Date;
  /** Prazo da transação de tenant (o `transacaoComPrazo` da rota com `tempoMaximoMs`); ausente = sem prazo. */
  prazoTenant?: (tx: Transacao) => Transacao;
  executar: (c: ContextoPlataformaPorEtapa) => Promise<R>;
}

/**
 * Ordem da rota por etapa: sessão de superadmin (401) → `executar` com as transações abertas pela própria rota, uma de
 * cada vez (ver `ContextoPlataformaPorEtapa`). Uso fora da regra (aninhada, em paralelo, tenant que não é o da rota ou
 * `comTenant` antes da 1ª `comPlataforma` concluída) é `Error` de programação (500), nunca `ErroApi`.
 */
export async function executarPlataformaPorEtapa<R>(p: PedidoPlataformaPorEtapa<R>): Promise<R> {
  const { sessao } = p;
  if (!sessao) throw erros.naoAutenticado();
  let aberta = false;
  let conferida = false;
  const uma = async <T>(abrir: () => Promise<T>): Promise<T> => {
    if (aberta) throw new Error('plataforma: transação por etapa aberta dentro de outra (uma de cada vez)');
    aberta = true;
    try {
      return await abrir();
    } finally {
      aberta = false;
    }
  };
  return p.executar({
    sessao,
    request_id: p.request_id,
    agora: p.agora,
    comPlataforma: (fn) =>
      uma(async () => {
        const r = await p.banco.comPlataforma(sessao, fn);
        conferida = true;
        return r;
      }),
    comTenant: (tenantId, fn) => {
      if (!PADRAO_UUID.test(tenantId) || tenantId.toLowerCase() !== p.tenantDaRota.toLowerCase()) {
        return Promise.reject(new Error('plataforma: comTenant só com o tenant do :id da rota'));
      }
      if (!conferida) return Promise.reject(new Error('plataforma: comTenant antes da etapa de plataforma que confere a empresa'));
      const prazo = p.prazoTenant;
      return uma(() => p.bancoTenant.comTenant(tenantId, (tx) => fn(prazo ? prazo(tx) : tx)));
    },
  });
}
