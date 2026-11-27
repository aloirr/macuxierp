/**
 * Leituras do monitor do BKO (RF-INF-04; C-7): só o schema `integracao_fdv`, sempre com `tenant_id` (a RLS vale também), só
 * colunas nomeadas (sem `SELECT *`; a `credencial` nunca lê `chave_cifrada`). As mensagens saem do catálogo pelo código
 * (RN-INF-04); a mensagem crua do Hub nem é guardada.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import {
  ENTIDADES_HUB_F2,
  type ConflitoChaveItem,
  type CredencialResumo,
  type EntidadeHub,
  type EstadoLote,
  type LoteEnvioResumo,
  type LoteErroLinha,
  type ModoLote,
  type MonitorEntidade,
  type MonitorResposta,
  type MotivoPausa,
  type SinalResumo,
  mensagemDaPausa,
} from '../contracts';
import { mensagemDoErro, proximaTentativaEm } from '../domain';

const ERROS_POR_ENTIDADE_NO_MONITOR = 20;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export interface CredencialAtivaLida extends CredencialResumo {
  entidades_habilitadas: EntidadeHub[];
  limite_registros_lote: number;
}

/**
 * Credencial ativa sem a chave: só o prefixo e a configuração do envio. `bloquear` lê com `FOR UPDATE`: as rotas de escrita
 * (e a troca da credencial) serializam aqui, e a decisão vale até o fim da transação.
 */
export async function lerCredencialResumo(tx: Transacao, tenantId: string, o: { bloquear?: boolean } = {}): Promise<CredencialAtivaLida | null> {
  const [c] = await tx.consultar<{
    id: string; conector_id: string; ambiente: 'teste' | 'producao'; chave_prefixo: string; created_at: Date; ultimo_uso_em: Date | null;
    entidades_habilitadas: EntidadeHub[]; limite_registros_lote: number;
  }>(
    `SELECT id, conector_id, ambiente, chave_prefixo, created_at, ultimo_uso_em, entidades_habilitadas::text[] AS entidades_habilitadas, limite_registros_lote
       FROM integracao_fdv.credencial
      WHERE tenant_id = $1 AND substituida_em IS NULL AND deleted_at IS NULL${o.bloquear ? ' FOR UPDATE' : ''}`,
    [tenantId],
  );
  if (!c) return null;
  return {
    id: c.id, conector_id: c.conector_id, ambiente: c.ambiente, chave_prefixo: c.chave_prefixo, criada_em: c.created_at.toISOString(), ultimo_uso_em: iso(c.ultimo_uso_em),
    entidades_habilitadas: c.entidades_habilitadas, limite_registros_lote: c.limite_registros_lote,
  };
}

export function resumoDaCredencial(c: CredencialAtivaLida): CredencialResumo {
  return { id: c.id, conector_id: c.conector_id, ambiente: c.ambiente, chave_prefixo: c.chave_prefixo, criada_em: c.criada_em, ultimo_uso_em: c.ultimo_uso_em };
}

/** O último sinal como o status do BKO mostra: sem `politica_versao` (ADR 0013). */
export async function lerSinalPublico(tx: Transacao, tenantId: string): Promise<{ ultimo_envio_em: string | null; ultimo_aceito_em: string | null; ultimo_http: number | null; parado_por_versao: boolean } | null> {
  const s = await lerSinal(tx, tenantId);
  return s && { ultimo_envio_em: s.ultimo_envio_em, ultimo_aceito_em: s.ultimo_aceito_em, ultimo_http: s.ultimo_http, parado_por_versao: s.parado_por_versao };
}

async function lerSinal(tx: Transacao, tenantId: string): Promise<SinalResumo | null> {
  const [s] = await tx.consultar<{ ultimo_envio_em: Date | null; ultimo_aceito_em: Date | null; ultimo_http: number | null; parado_por_versao: boolean; ultimo_codigo: string | null; politica_versao: Record<string, unknown> | null }>(
    `SELECT ultimo_envio_em, ultimo_aceito_em, ultimo_http, parado_por_versao, ultimo_codigo, politica_versao
       FROM integracao_fdv.sinal WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  return s ? { ultimo_envio_em: iso(s.ultimo_envio_em), ultimo_aceito_em: iso(s.ultimo_aceito_em), ultimo_http: s.ultimo_http, parado_por_versao: s.parado_por_versao, ultimo_codigo: s.ultimo_codigo, politica_versao: s.politica_versao } : null;
}

type LinhaErro = {
  id: string; lote_envio_id: string; indice: number; origem: 'erp' | 'hub'; entidade: EntidadeHub; registro_external_id: string | null;
  codigo: string; campo: string | null; reprocessavel: boolean; resolvido_em: Date | null;
};

function erroDaLinha(l: LinhaErro): LoteErroLinha {
  return {
    id: l.id, lote_envio_id: l.lote_envio_id, indice: l.indice, origem: l.origem, entidade: l.entidade, registro_external_id: l.registro_external_id ?? '',
    codigo: l.codigo, campo: l.campo, reprocessavel: l.reprocessavel, resolvido_em: iso(l.resolvido_em), mensagem: mensagemDoErro(l.codigo, l.campo),
  };
}

const COLUNAS_ERRO = 'id, lote_envio_id, indice, origem, entidade::text AS entidade, registro_external_id, codigo, campo, reprocessavel, resolvido_em';

export async function lerMonitor(tx: Transacao, tenantId: string): Promise<MonitorResposta> {
  const credencial = await lerCredencialResumo(tx, tenantId);
  const habilitadas = new Set<string>(credencial?.entidades_habilitadas ?? []);
  const cursores = await tx.consultar<{ entidade: EntidadeHub; ultimo_envio_em: Date | null; ultimo_sucesso_em: Date | null; pausada_motivo: MotivoPausa | null; pausada_em: Date | null }>(
    `SELECT entidade::text AS entidade, ultimo_envio_em, ultimo_sucesso_em, pausada_motivo, pausada_em
       FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId],
  );
  const pendentes = await tx.consultar<{ entidade: EntidadeHub; n: number }>(
    `SELECT entidade::text AS entidade, count(*)::int AS n FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND pendente AND deleted_at IS NULL GROUP BY entidade`,
    [tenantId],
  );
  const abertos = await tx.consultar<{ entidade: EntidadeHub; n: number }>(
    `SELECT entidade::text AS entidade, count(*)::int AS n FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND resolvido_em IS NULL AND deleted_at IS NULL GROUP BY entidade`,
    [tenantId],
  );
  const erros = await tx.consultar<LinhaErro>(
    `SELECT ${COLUNAS_ERRO} FROM (
       SELECT ${COLUNAS_ERRO}, created_at, row_number() OVER (PARTITION BY entidade ORDER BY created_at DESC, id DESC) AS pos
         FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND resolvido_em IS NULL AND deleted_at IS NULL) e
      WHERE pos <= $2 ORDER BY entidade, created_at DESC, id DESC`,
    [tenantId, ERROS_POR_ENTIDADE_NO_MONITOR],
  );
  const conflitos = await tx.consultar<{ id: string; entidade: EntidadeHub; erp_id: string; chave: string; codigo: ConflitoChaveItem['codigo']; detectado_em: Date }>(
    `SELECT id, entidade::text AS entidade, erp_id, chave, codigo, detectado_em
       FROM integracao_fdv.conflito_chave WHERE tenant_id = $1 AND resolvido_em IS NULL AND deleted_at IS NULL ORDER BY detectado_em DESC, id LIMIT 200`,
    [tenantId],
  );
  const porEntidade = <T extends { entidade: EntidadeHub }>(l: T[]) => new Map(l.map((x) => [x.entidade, x]));
  const cur = porEntidade(cursores);
  const pen = porEntidade(pendentes);
  const abe = porEntidade(abertos);
  const entidades: MonitorEntidade[] = ENTIDADES_HUB_F2.map((entidade) => {
    const c = cur.get(entidade);
    const motivo = c?.pausada_motivo ?? null;
    return {
      entidade,
      ultimo_envio_em: iso(c?.ultimo_envio_em ?? null),
      ultimo_sucesso_em: iso(c?.ultimo_sucesso_em ?? null),
      pendentes: pen.get(entidade)?.n ?? 0,
      situacao: motivo ? 'pausada' : 'ok',
      pausada_motivo: motivo,
      pausada_mensagem: motivo ? mensagemDaPausa(motivo) : null,
      habilitada: habilitadas.has(entidade),
      proxima_tentativa_em: iso(proximaTentativaEm(motivo, c?.pausada_em)),
      erros_abertos: abe.get(entidade)?.n ?? 0,
    };
  });
  return {
    credencial: credencial ? resumoDaCredencial(credencial) : null,
    configuracao: credencial ? { entidades_habilitadas: credencial.entidades_habilitadas, limite_registros_lote: credencial.limite_registros_lote } : null,
    sinal: await lerSinal(tx, tenantId),
    entidades,
    erros: erros.map(erroDaLinha),
    conflitos: conflitos.map((x) => ({ id: x.id, entidade: x.entidade, erp_id: x.erp_id, chave: x.chave, codigo: x.codigo, mensagem: mensagemDoErro(x.codigo), detectado_em: x.detectado_em.toISOString() })),
  };
}

// ---- lotes ----

type LinhaLote = {
  id: string; entidade: EntidadeHub; modo: ModoLote; geracao: number; estado: EstadoLote; repetido: boolean; tentativas: number;
  ultimo_erro_codigo: string | null; enviado_em: Date | null; concluido_em: Date | null; contagens: Record<string, unknown>;
};

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function loteResumo(l: LinhaLote): LoteEnvioResumo {
  const hub = (l.contagens.hub ?? {}) as Record<string, unknown>;
  const recebidas = numero(hub.recebidas);
  const comErro = numero(hub.com_erro);
  return {
    id: l.id, entidade: l.entidade, modo: l.modo, geracao: l.geracao, estado: l.estado, repetido: l.repetido,
    registros: numero(l.contagens.registros) ?? 0,
    aceitos: recebidas === null ? null : Math.max(0, recebidas - (comErro ?? 0)),
    com_erro: comErro,
    tentativas: l.tentativas,
    ultimo_erro_codigo: l.ultimo_erro_codigo,
    ultimo_erro_mensagem: l.ultimo_erro_codigo ? mensagemDoErro(l.ultimo_erro_codigo) : null,
    enviado_em: iso(l.enviado_em),
    concluido_em: iso(l.concluido_em),
  };
}

export interface FiltroLotes {
  entidade?: string;
  estado?: string;
  cursor?: string;
  limite: number;
}

/** Lotes do mais novo ao mais antigo; o cursor é o `id` do último, resolvido por `(created_at, id)` (a ordem do uuid não é cronológica). */
export async function listarLotes(tx: Transacao, tenantId: string, f: FiltroLotes): Promise<{ itens: LoteEnvioResumo[]; proximo_cursor: string | null }> {
  const linhas = await tx.consultar<LinhaLote>(
    `SELECT id, entidade::text AS entidade, modo, geracao, estado, repetido, tentativas, ultimo_erro_codigo::text AS ultimo_erro_codigo, enviado_em, concluido_em, contagens
       FROM integracao_fdv.lote_envio l
      WHERE l.tenant_id = $1 AND l.deleted_at IS NULL
        AND ($2::text IS NULL OR l.entidade::text = $2) AND ($3::text IS NULL OR l.estado = $3)
        AND ($4::uuid IS NULL OR (l.created_at, l.id) < (SELECT c.created_at, c.id FROM integracao_fdv.lote_envio c WHERE c.tenant_id = $1 AND c.id = $4))
      ORDER BY l.created_at DESC, l.id DESC LIMIT $5`,
    [tenantId, f.entidade ?? null, f.estado ?? null, f.cursor ?? null, f.limite + 1],
  );
  const itens = linhas.slice(0, f.limite).map(loteResumo);
  return { itens, proximo_cursor: linhas.length > f.limite ? (itens.at(-1)?.id ?? null) : null };
}

export async function loteExiste(tx: Transacao, tenantId: string, id: string): Promise<boolean> {
  const l = await tx.consultar(`SELECT 1 FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [tenantId, id]);
  return l.length > 0;
}

/** Erros por linha de um lote, na ordem `(indice, origem)`; o cursor é o `id` do último erro. */
export async function listarErrosDoLote(tx: Transacao, tenantId: string, loteId: string, f: { cursor?: string; limite: number }): Promise<{ itens: LoteErroLinha[]; proximo_cursor: string | null }> {
  const linhas = await tx.consultar<LinhaErro>(
    `SELECT ${COLUNAS_ERRO} FROM integracao_fdv.lote_erro e
      WHERE e.tenant_id = $1 AND e.lote_envio_id = $2 AND e.deleted_at IS NULL
        AND ($3::uuid IS NULL OR (e.indice, e.origem, e.id) > (SELECT c.indice, c.origem, c.id FROM integracao_fdv.lote_erro c WHERE c.tenant_id = $1 AND c.id = $3))
      ORDER BY e.indice, e.origem, e.id LIMIT $4`,
    [tenantId, loteId, f.cursor ?? null, f.limite + 1],
  );
  const itens = linhas.slice(0, f.limite).map(erroDaLinha);
  return { itens, proximo_cursor: linhas.length > f.limite ? (itens.at(-1)?.id ?? null) : null };
}
