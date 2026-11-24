/**
 * Leituras e escrita da operação da Integração FDV (T-0086): Monitor, Log por cadastro e Reprocessar, sempre com `tenant_id`
 * explícito e só colunas nomeadas. Rodam com o tenant da sessão (RLS):
 * - o BKO usa `lerLog` direto (`GET /entidades/:entidade/log` e `.csv`);
 * - o `/config` chama as funções `integracao_fdv.portal_monitor`, `portal_log` e `portal_reprocessar` (banco-dados), que fazem
 *   a MESMA consulta e a MESMA escrita destas, e devolvem só os insumos que o domain transforma (ADR 0013: o superadmin não
 *   lê tabela do módulo). Os testes de banco rodam estas versões e validam as regras; a regra do Reprocessar é a do domain
 *   (`planejarReprocessar`), nunca decidida em SQL.
 * - Reprocessar não faz carga completa, não reenvia o integrado e não gera inativação nova.
 */
import { EntidadeEnvioFdv, erros as errosApi, falhaEnvioFdv, type OrigemEnvioFdv, type Transacao } from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';
import { ESTADOS_EM_VOO, MARCA_REENVIO, planejarReprocessar, type EntradaMonitor, type EnvioBruto, type ErroBruto, type PlanoReprocessar } from '../domain';

/** `:entidade` da rota (BKO e `/config`): o mesmo parse e a mesma mensagem. */
export function entidadeDaRota(valor: string | undefined): EntidadeEnvioFdv {
  const e = EntidadeEnvioFdv.safeParse(valor);
  if (!e.success) throw errosApi.validacao({ entidade: 'Cadastro desconhecido' });
  return e.data;
}

// ---- Monitor ----

export type InsumosMonitor = Omit<EntradaMonitor, 'agora'>;

/** Credencial ativa, sinal aceito e fila (lotes em voo e registros pendentes), como o `CorpoSinal.fila`, somados. */
export async function lerInsumosMonitor(tx: Transacao, tenant: string): Promise<InsumosMonitor> {
  const [c] = await tx.consultar<{ conector_id: string; habilitadas: number }>(
    `SELECT conector_id, coalesce(cardinality(entidades_habilitadas), 0)::int AS habilitadas
       FROM integracao_fdv.credencial WHERE tenant_id = $1 AND substituida_em IS NULL AND deleted_at IS NULL`,
    [tenant],
  );
  const [s] = await tx.consultar<{ ultimo_aceito_em: Date | null }>(
    `SELECT ultimo_aceito_em FROM integracao_fdv.sinal WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenant],
  );
  const [fila] = await tx.consultar<{ lotes: number; linhas: number }>(
    `SELECT (SELECT count(*)::int FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND estado = ANY($2::text[]) AND deleted_at IS NULL) AS lotes,
            (SELECT count(*)::int FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND pendente AND deleted_at IS NULL) AS linhas`,
    [tenant, [...ESTADOS_EM_VOO]],
  );
  return {
    credencial_ativa: c !== undefined,
    conector_id: c?.conector_id ?? null,
    habilitadas: c?.habilitadas ?? 0,
    ultimo_sinal_aceito_em: s?.ultimo_aceito_em ?? null,
    fila: { lotes: fila?.lotes ?? 0, linhas: fila?.linhas ?? 0 },
  };
}

// ---- Log ----

export interface InsumosLog {
  envios: EnvioBruto[];
  erros: ErroBruto[];
  total_erros: number;
  motivo: ReturnType<typeof falhaEnvioFdv>;
}

/**
 * Envios recentes (20 lotes do cadastro) e erros por linha abertos, um por (registro, código, campo), do mais novo ao mais
 * antigo. `limiteErros` nulo traz todos. Do espelho entram só o nome curto (nome, razão social ou descrição, cortado em 120, lido
 * no banco: o payload inteiro não sai de lá) e as marcas do `corrigir_href`; o domain os descarta no Log do `/config`.
 */
export async function lerInsumosLog(tx: Transacao, tenant: string, entidade: EntidadeEnvioFdv, limiteErros: number | null): Promise<InsumosLog> {
  const lotes = await tx.consultar<{ em: Date; estado: string; registros: number; com_erro: number; origem: OrigemEnvioFdv }>(
    `SELECT coalesce(l.enviado_em, l.created_at) AS em, l.estado,
            (coalesce((l.contagens ->> 'registros')::int, 0) + coalesce((l.contagens ->> 'invalidas')::int, 0)) AS registros,
            (SELECT count(*)::int FROM integracao_fdv.lote_erro e WHERE e.tenant_id = l.tenant_id AND e.lote_envio_id = l.id AND e.deleted_at IS NULL) AS com_erro,
            coalesce(l.contagens ->> 'origem', 'ciclo') AS origem
       FROM integracao_fdv.lote_envio l
      WHERE l.tenant_id = $1 AND l.entidade = $2::integracao_fdv.entidade_hub AND l.deleted_at IS NULL
      ORDER BY l.created_at DESC, l.id DESC LIMIT 20`,
    [tenant, entidade],
  );
  const erros = await tx.consultar<{ registro_external_id: string; codigo: string; campo: string | null; nome: string | null; fonte_refs: Record<string, string> | null }>(
    `SELECT a.registro_external_id, a.codigo, a.campo, r.fonte_refs,
            left(coalesce(nullif(btrim(r.payload ->> 'nome'), ''), nullif(btrim(r.payload ->> 'razao_social'), ''), nullif(btrim(r.payload ->> 'descricao'), '')), 120) AS nome
       FROM (SELECT DISTINCT ON (registro_external_id, codigo, campo) registro_external_id, codigo::text AS codigo, campo, created_at, id
               FROM integracao_fdv.lote_erro
              WHERE tenant_id = $1 AND entidade = $2::integracao_fdv.entidade_hub AND resolvido_em IS NULL AND deleted_at IS NULL AND registro_external_id IS NOT NULL
              ORDER BY registro_external_id, codigo, campo, created_at DESC, id DESC) a
       LEFT JOIN integracao_fdv.registro_publicado r
         ON r.tenant_id = $1 AND r.entidade = $2::integracao_fdv.entidade_hub AND r.registro_external_id = a.registro_external_id AND r.deleted_at IS NULL
      ORDER BY a.created_at DESC, a.id DESC${limiteErros === null ? '' : ' LIMIT $3'}`,
    limiteErros === null ? [tenant, entidade] : [tenant, entidade, limiteErros],
  );
  const [total] = await tx.consultar<{ n: number }>(
    `SELECT count(*)::int AS n FROM (SELECT DISTINCT registro_external_id, codigo, campo FROM integracao_fdv.lote_erro
        WHERE tenant_id = $1 AND entidade = $2::integracao_fdv.entidade_hub AND resolvido_em IS NULL AND deleted_at IS NULL AND registro_external_id IS NOT NULL) x`,
    [tenant, entidade],
  );
  const [cursor] = await tx.consultar<{ pausada_motivo: MotivoPausa | null }>(
    `SELECT pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2::integracao_fdv.entidade_hub AND deleted_at IS NULL`,
    [tenant, entidade],
  );
  const total_erros = total?.n ?? 0;
  return {
    envios: lotes.map((l) => ({ em: l.em, estado: l.estado, registros: l.registros, com_erro: l.com_erro, origem: l.origem })),
    erros: erros.map(({ nome, ...e }) => ({ ...e, entidade, payload: nome === null ? null : { nome }, fonte_refs: e.fonte_refs ?? {} })),
    total_erros,
    motivo: falhaEnvioFdv({ pausada_motivo: cursor?.pausada_motivo ?? null, ultimo_lote_estado: lotes[0]?.estado ?? null, erros_abertos: total_erros }),
  };
}

// ---- Reprocessar ----

export type ResultadoReprocessar = ({ conflito: false } & PlanoReprocessar) | { conflito: true };

/**
 * Marca para o próximo ciclo delta só os registros em `falha` ou `pendente` (decisão do domain: `planejarReprocessar`):
 * `pendente = true` e a marca `reenvio = reprocessar` em `fonte_refs`, que o lote lê para a origem. O integrado não é tocado.
 * Com lote em voo no cadastro, não faz nada e devolve `conflito` (a API responde 409; o banco recusa dois envios do mesmo cadastro).
 * Antecipa a agenda do cadastro para o ciclo pegar agora.
 */
export async function reprocessarCadastro(tx: Transacao, tenant: string, entidade: EntidadeEnvioFdv): Promise<ResultadoReprocessar> {
  const [trava] = await tx.consultar<{ id: string }>(
    `SELECT id FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2::integracao_fdv.entidade_hub AND deleted_at IS NULL FOR UPDATE`,
    [tenant, entidade],
  );
  const emVoo = await tx.consultar(
    `SELECT 1 FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND entidade = $2::integracao_fdv.entidade_hub AND estado = ANY($3::text[]) AND deleted_at IS NULL`,
    [tenant, entidade, [...ESTADOS_EM_VOO]],
  );
  if (emVoo.length > 0) return { conflito: true };
  const registros = await tx.consultar<{ id: string; pendente: boolean; hash: string; hash_confirmado: string | null; erro_aberto: boolean }>(
    `SELECT r.id, r.pendente, r.hash, r.hash_confirmado,
            EXISTS (SELECT 1 FROM integracao_fdv.lote_erro e WHERE e.tenant_id = r.tenant_id AND e.entidade = r.entidade
                     AND e.registro_external_id = r.registro_external_id AND e.resolvido_em IS NULL AND e.deleted_at IS NULL) AS erro_aberto
       FROM integracao_fdv.registro_publicado r
      WHERE r.tenant_id = $1 AND r.entidade = $2::integracao_fdv.entidade_hub AND r.deleted_at IS NULL AND r.payload IS NOT NULL`,
    [tenant, entidade],
  );
  const plano = planejarReprocessar(registros);
  if (plano.ids.length > 0) {
    await tx.consultar(
      `UPDATE integracao_fdv.registro_publicado SET pendente = true, fonte_refs = fonte_refs || $3::jsonb
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenant, plano.ids, JSON.stringify({ [MARCA_REENVIO.reprocessar.chave]: MARCA_REENVIO.reprocessar.valor })],
    );
    if (trava) await tx.consultar(`UPDATE integracao_fdv.cursor_entidade SET proximo_em = least(proximo_em, now()) WHERE id = $1`, [trava.id]);
  }
  return { conflito: false, ...plano };
}
