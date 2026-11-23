/**
 * Status só de leitura do BKO do tenant (RF-INF-04, RN-INF-02; ADR 0013 seção 6): monta o `StatusIntegracaoFdvTenant` do
 * SDK a partir da credencial ativa e do estado de cada cadastro da F2. Pura: a precedência da falha vem do
 * SDK (`falhaEnvioFdv`), sem cópia aqui; "ligada" = credencial ativa (o resumo só existe com ela) e cadastro habilitado.
 */
import {
  ENTIDADES_ENVIO_FDV,
  falhaEnvioFdv,
  type AmbienteIntegracaoFdv,
  type CadastroIntegracaoFdv,
  type EntidadeEnvioFdv,
  type StatusIntegracaoFdvTenant,
  type UltimoSinalFdv,
} from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';

export interface CredencialStatus {
  conector_id: string;
  ambiente: AmbienteIntegracaoFdv;
  chave_prefixo: string;
  entidades_habilitadas: readonly string[];
}

export interface CursorStatus {
  entidade: EntidadeEnvioFdv;
  /** ISO UTC. */
  ultimo_envio_em: string | null;
  pausada_motivo: MotivoPausa | null;
  /** Estado do último lote do cadastro (`concluido`, `falhou`, `recusado`...), ou nulo sem lote. */
  ultimo_lote_estado: string | null;
  erros_abertos: number;
}

/** Sempre os 10 cadastros da F2 na ordem de carga; cursor ausente = cadastro sem envio. Sem credencial, tudo desligado. */
export function montarStatusTenant(
  credencial: CredencialStatus | null,
  cursores: readonly CursorStatus[],
  ultimoSinal: UltimoSinalFdv | null,
): StatusIntegracaoFdvTenant {
  const porEntidade = new Map(cursores.map((c) => [c.entidade, c]));
  const cadastros: CadastroIntegracaoFdv[] = ENTIDADES_ENVIO_FDV.map((entidade) => {
    const c = porEntidade.get(entidade);
    const ligada = credencial ? credencial.entidades_habilitadas.includes(entidade) : false;
    return {
      entidade,
      ligada,
      ultimo_envio_em: c?.ultimo_envio_em ?? null,
      falha: c ? falhaEnvioFdv({ pausada_motivo: c.pausada_motivo, ultimo_lote_estado: c.ultimo_lote_estado, erros_abertos: c.erros_abertos }) : null,
    };
  });
  return {
    conector_id: credencial?.conector_id ?? null,
    ambiente: credencial?.ambiente ?? null,
    chave_prefixo: credencial?.chave_prefixo ?? null,
    cadastros,
    ultimo_sinal: ultimoSinal,
  };
}
