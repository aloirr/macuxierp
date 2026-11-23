/**
 * Rotas de plataforma do portal `/config` (ADR 0012): só as portas e tipos, sem SQL e sem Fastify. Ficam em
 * `/v1/plataforma/*`, FORA do `/v1/<modulo>`, e trocam a checagem do tenant (perfil → tenant → licença, RN-CORE-02) por
 * "sessão de superadmin válida". Não há `tenant_id` na sessão nem `comTenant`: o acesso entre tenants é só pelas funções
 * SECURITY DEFINER de lista fechada do banco (migração 0033), que revalidam a sessão. Nunca BYPASSRLS.
 *
 * O `ContextoRota` dos módulos não muda: uma rota de plataforma não é rota de módulo e não entra em `definirPlugin`.
 * O login, a saída e a troca de senha do superadmin são da apps/api (como o `/v1/auth/*`), não de plugin.
 */
import type { z } from 'zod';
import type { DadosAuditoria } from './auditoria';
import type { Transacao } from './banco';
import { erros } from './erros';
import { PluginInvalido, type EntradaChamada, type MetodoHttp, type RespostaRota } from './rotas';

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

export interface ContextoPlataforma {
  sessao: SessaoPlataforma;
  tx: Transacao;
  request_id: string;
  agora: Date;
  auditar(dados: DadosAuditoriaPlataforma): Promise<void>;
}

export interface RotaPlataforma<TC = unknown, TQ = unknown> {
  metodo: MetodoHttp;
  /** Relativo a `/v1/plataforma`, começando com `/` (ex.: `/empresas/:id/modulos`). Nunca `/auth/*` (da apps/api). */
  caminho: string;
  acao: AcaoPlataforma;
  corpo?: z.ZodType<TC, z.ZodTypeDef, unknown>;
  consulta?: z.ZodType<TQ, z.ZodTypeDef, unknown>;
  /** Mesmo sentido do `RotaModulo.idempotencia` (só POST, PUT e PATCH), guardada no tenant de referência. */
  idempotencia?: 'opcional' | 'obrigatoria';
  executar(c: ContextoPlataforma, e: EntradaChamada<TC, TQ>): Promise<RespostaRota>;
}

/** Ajuda de tipo, como o `definirRota`: infere corpo e consulta e devolve a rota "apagada" para o plugin. */
export function definirRotaPlataforma<TC = undefined, TQ = undefined>(r: RotaPlataforma<TC, TQ>): RotaPlataforma {
  return r as unknown as RotaPlataforma;
}

export interface PluginPlataforma {
  rotas: readonly RotaPlataforma[];
}

/** Valida no carregamento: caminho com `/`, fora de `/auth`, sem repetição e idempotência só em escrita. */
export function definirPluginPlataforma(rotas: readonly RotaPlataforma[]): PluginPlataforma {
  const vistas = new Set<string>();
  for (const r of rotas) {
    const id = `${r.metodo} ${r.caminho}`;
    if (!r.caminho.startsWith('/')) throw new PluginInvalido(`plataforma: caminho "${r.caminho}" sem "/" inicial`);
    if (r.caminho === '/auth' || r.caminho.startsWith('/auth/')) throw new PluginInvalido(`plataforma: ${id} é da apps/api (login do superadmin)`);
    if (r.idempotencia && r.metodo !== 'POST' && r.metodo !== 'PUT' && r.metodo !== 'PATCH') {
      throw new PluginInvalido(`plataforma: Idempotency-Key só em POST, PUT ou PATCH (${id})`);
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
