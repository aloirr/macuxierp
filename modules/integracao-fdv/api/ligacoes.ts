/**
 * Leitura da ligação ERP → Macuxi FDV (T-0131, RN-INF-13): contadores Enviados/Aceitos, histórico de envios e cabeçalho do Contato.
 * Só o schema `integracao_fdv`, sempre com `tenant_id`, colunas nomeadas. Sem migração: usa `lote_envio`, `sinal` e `credencial`.
 * A regra de quais lotes contam é do domain (`ESTADOS_ENVIADOS_AO_HUB`, `contarLigacao`); o SQL só agrupa.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { LIMITE_ENVIOS_LIGACAO, type EnvioLigacao, type LigacoesResposta } from '../contracts';
import { ESTADOS_ENVIADOS_AO_HUB, contarLigacao, montarContatoSaida } from '../domain';
import { lerCredencialResumo, lerSinalPublico, loteResumo, type LinhaLote } from './monitor';

/** `contagens` é jsonb livre: só número finito entra na soma. */
const SOMA_REGISTROS = `coalesce(sum(CASE WHEN jsonb_typeof(contagens->'registros') = 'number' THEN (contagens->>'registros')::numeric END), 0)::float8`;
const SOMA_ACEITOS = `coalesce(sum(CASE WHEN jsonb_typeof(contagens->'hub'->'recebidas') = 'number'
    THEN greatest(0, (contagens->'hub'->>'recebidas')::numeric - CASE WHEN jsonb_typeof(contagens->'hub'->'com_erro') = 'number' THEN (contagens->'hub'->>'com_erro')::numeric ELSE 0 END) END), 0)::float8`;

export async function lerLigacoes(tx: Transacao, tenantId: string, agora: Date): Promise<LigacoesResposta> {
  const grupos = await tx.consultar<{ estado: string; repetido: boolean; registros: number; aceitos: number }>(
    `SELECT estado, repetido, ${SOMA_REGISTROS} AS registros, ${SOMA_ACEITOS} AS aceitos
       FROM integracao_fdv.lote_envio
      WHERE tenant_id = $1 AND deleted_at IS NULL AND estado = ANY($2::text[])
      GROUP BY estado, repetido`,
    [tenantId, [...ESTADOS_ENVIADOS_AO_HUB]],
  );
  const linhas = await tx.consultar<LinhaLote>(
    `SELECT id, entidade::text AS entidade, modo, geracao, estado, repetido, tentativas, ultimo_erro_codigo::text AS ultimo_erro_codigo, enviado_em, concluido_em, contagens
       FROM integracao_fdv.lote_envio
      WHERE tenant_id = $1 AND deleted_at IS NULL AND NOT repetido AND estado = ANY($2::text[])
      ORDER BY created_at DESC, id DESC LIMIT $3`,
    [tenantId, [...ESTADOS_ENVIADOS_AO_HUB], LIMITE_ENVIOS_LIGACAO + 1],
  );
  const credencial = await lerCredencialResumo(tx, tenantId);
  const sinal = await lerSinalPublico(tx, tenantId);
  const envios: EnvioLigacao[] = linhas.slice(0, LIMITE_ENVIOS_LIGACAO).map(loteResumo).map((l) => ({
    id: l.id, entidade: l.entidade, estado: l.estado, registros: l.registros, aceitos: l.aceitos, com_erro: l.com_erro, enviado_em: l.enviado_em, concluido_em: l.concluido_em,
  }));
  return {
    saida: {
      contato: montarContatoSaida({
        credencial: credencial && { conector_id: credencial.conector_id, ambiente: credencial.ambiente, chave_prefixo: credencial.chave_prefixo, habilitadas: credencial.entidades_habilitadas.length },
        ultimo_aceito_em: sinal?.ultimo_aceito_em ?? null,
        agora,
      }),
      contadores: contarLigacao(grupos),
      envios,
      envios_cortados: linhas.length > LIMITE_ENVIOS_LIGACAO,
    },
  };
}
