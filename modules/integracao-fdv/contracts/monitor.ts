/** C-6: leituras do monitor do BKO (RF-INF-04). Sem mensagem livre nem valor de campo: a mensagem sai do catálogo pelo código. */
import { z } from 'zod';
import { CampoErro, CodigoErro, EntidadeHub, ModoLote, SituacaoEntidade, VERSAO_CONTRATO_HUB } from './hub';

export const MotivoPausa = z.enum(['credencial', 'licenca_fdv', 'licenca_erp', 'versao', 'envelope', 'idempotencia', 'topologia']);
export type MotivoPausa = z.infer<typeof MotivoPausa>;

const Instante = z.string().datetime().nullable();

export const MonitorEntidade = z.object({
  entidade: EntidadeHub,
  ultimo_envio_em: Instante,
  ultimo_sucesso_em: Instante,
  pendentes: z.number().int().min(0),
  situacao: SituacaoEntidade,
  pausada_motivo: MotivoPausa.nullable(),
  erros_abertos: z.number().int().min(0),
});
export type MonitorEntidade = z.infer<typeof MonitorEntidade>;

export const EstadoLote = z.enum(['montado', 'enviando', 'aceito', 'concluido', 'concluido_com_erros', 'falhou', 'recusado']);
export type EstadoLote = z.infer<typeof EstadoLote>;

export const LoteEnvioResumo = z.object({
  id: z.string().uuid(),
  entidade: EntidadeHub,
  modo: ModoLote,
  geracao: z.number().int().min(1),
  estado: EstadoLote,
  repetido: z.boolean(),
  registros: z.number().int().min(0),
  aceitos: z.number().int().min(0).nullable(),
  com_erro: z.number().int().min(0).nullable(),
  tentativas: z.number().int().min(0),
  ultimo_erro_codigo: CodigoErro.nullable(),
  enviado_em: Instante,
  concluido_em: Instante,
});
export type LoteEnvioResumo = z.infer<typeof LoteEnvioResumo>;

/** Erro por linha (RN-INF-04): código, campo e o `external_id` do ERP; nunca mensagem livre nem valor. */
export const LoteErroItem = z.object({
  indice: z.number().int().min(0),
  origem: z.enum(['erp', 'hub']),
  entidade: EntidadeHub,
  registro_external_id: z.string().max(200),
  codigo: CodigoErro,
  campo: CampoErro,
  reprocessavel: z.boolean(),
  resolvido_em: Instante,
});
export type LoteErroItem = z.infer<typeof LoteErroItem>;

export const SinalResumo = z.object({
  ultimo_envio_em: Instante,
  ultimo_aceito_em: Instante,
  ultimo_http: z.number().int().nullable(),
  parado_por_versao: z.boolean(),
  politica_versao: z.record(z.unknown()).nullable(),
});
export type SinalResumo = z.infer<typeof SinalResumo>;

/** Corpo de `POST /integracao/v1/sinal` (seção 6): sem dado pessoal. */
export const CorpoSinal = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  conector_id: z.string(),
  versao_conector: z.string(),
  em: z.string().datetime(),
  fila: z.array(z.object({ entidade: EntidadeHub, pendentes: z.number().int().min(0) })),
  entidades: z.array(z.object({ entidade: EntidadeHub, ultimo_envio_em: Instante, situacao: SituacaoEntidade })),
  parado_por_versao: z.boolean().optional(),
});
export type CorpoSinal = z.infer<typeof CorpoSinal>;
