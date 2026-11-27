/** C-6: leituras do monitor do BKO (RF-INF-04). Sem mensagem livre nem valor de campo: a mensagem sai do catálogo pelo código. */
import { z } from 'zod';
import { MOTIVOS_PAUSA_FDV, VersaoConectorFdv } from '@macuxierp/platform-sdk';
import { EXTERNAL_ID_MAX } from '@macuxierp/platform-sdk/hub-v1';
import { ConfiguracaoResumo, CredencialResumo } from './credencial';
import { CampoErro, CodigoErro, EntidadeHub, ModoLote, SituacaoEntidade, VERSAO_CONTRATO_HUB } from './hub';

export const MotivoPausa = z.enum(MOTIVOS_PAUSA_FDV);
export type MotivoPausa = z.infer<typeof MotivoPausa>;

const Instante = z.string().datetime().nullable();

export const MonitorEntidade = z.object({
  entidade: EntidadeHub,
  ultimo_envio_em: Instante,
  ultimo_sucesso_em: Instante,
  pendentes: z.number().int().min(0),
  situacao: SituacaoEntidade,
  pausada_motivo: MotivoPausa.nullable(),
  /** Texto do catálogo para o motivo da pausa (nunca a mensagem crua do Hub). */
  pausada_mensagem: z.string().nullable(),
  /** A entidade está em `entidades_habilitadas` da credencial ativa. */
  habilitada: z.boolean(),
  /** Quando o sinal tenta de novo sozinho: `pausada_em` + 30 min, só para as pausas 'credencial' e 'licenca_fdv'; senão `null` (retomada manual). */
  proxima_tentativa_em: Instante,
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
  /** Mensagem do catálogo para `ultimo_erro_codigo`. */
  ultimo_erro_mensagem: z.string().nullable(),
  enviado_em: Instante,
  concluido_em: Instante,
});
export type LoteEnvioResumo = z.infer<typeof LoteEnvioResumo>;

/** Erro por linha (RN-INF-04): código, campo e o `external_id` do ERP; nunca mensagem livre nem valor. */
export const LoteErroItem = z.object({
  indice: z.number().int().min(0),
  origem: z.enum(['erp', 'hub']),
  entidade: EntidadeHub,
  registro_external_id: z.string().max(EXTERNAL_ID_MAX),
  codigo: CodigoErro,
  campo: CampoErro,
  reprocessavel: z.boolean(),
  resolvido_em: Instante,
});
export type LoteErroItem = z.infer<typeof LoteErroItem>;

/** Erro por linha com a mensagem do catálogo (RN-INF-04). */
export const LoteErroLinha = LoteErroItem.extend({
  id: z.string().uuid(),
  lote_envio_id: z.string().uuid(),
  mensagem: z.string(),
});
export type LoteErroLinha = z.infer<typeof LoteErroLinha>;

export const CodigoConflitoChave = z.enum(['chave_alterada', 'chave_duplicada', 'vinculo_divergente']);
export type CodigoConflitoChave = z.infer<typeof CodigoConflitoChave>;
/** Conflito de chave aberto (ADR 0010, item 3): o registro não foi ao FDV até alguém resolver. */
export const ConflitoChaveItem = z.object({
  id: z.string().uuid(),
  entidade: EntidadeHub,
  erp_id: z.string().uuid(),
  chave: z.string().max(EXTERNAL_ID_MAX),
  codigo: CodigoConflitoChave,
  mensagem: z.string(),
  detectado_em: z.string().datetime(),
});
export type ConflitoChaveItem = z.infer<typeof ConflitoChaveItem>;

export const SinalResumo = z.object({
  ultimo_envio_em: Instante,
  ultimo_aceito_em: Instante,
  ultimo_http: z.number().int().nullable(),
  parado_por_versao: z.boolean(),
  /** Código do Hub (ou `http_<status>`) da última recusa do sinal; `null` com o sinal aceito. */
  ultimo_codigo: CodigoErro.nullable(),
  politica_versao: z.record(z.unknown()).nullable(),
});
export type SinalResumo = z.infer<typeof SinalResumo>;

/**
 * Corpo de `POST /integracao/v1/sinal` (`SinalConector` do FDV, conferido na L2a): sem dado pessoal. `fila` é a fila do
 * conector por estado (registros do ERP ainda por enviar e lotes em voo); `entidades` o estado de cada entidade.
 */
export const CorpoSinal = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  conector_id: z.string().min(1).max(100),
  versao_conector: VersaoConectorFdv,
  em: z.string().datetime(),
  fila: z.array(z.object({ estado: z.string(), lotes: z.number().int().min(0), linhas: z.number().int().min(0), maisAntigo: Instante })),
  entidades: z.array(
    z.object({
      entidade: EntidadeHub,
      fase: z.enum(['completo', 'delta']),
      ultimo_sucesso: Instante,
      bloqueada: z.boolean(),
      lotes_na_fila: z.number().int().min(0),
    }),
  ),
  parado_por_versao: z.boolean().optional(),
});
export type CorpoSinal = z.infer<typeof CorpoSinal>;

/** Corpo de `POST /integracao/v1/reconciliacoes`: uma chamada por entidade e dia (`ReconciliacaoEnvio` do FDV). `soma` nula na v1. */
export const CorpoReconciliacao = z.object({
  versao_contrato: z.literal(VERSAO_CONTRATO_HUB),
  entidade: EntidadeHub,
  data_referencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contagem: z.number().int().min(0),
  soma: z.number().nullable(),
});
export type CorpoReconciliacao = z.infer<typeof CorpoReconciliacao>;

/** `GET /monitor` (RF-INF-04). `erros` são os abertos mais recentes (até 20 por entidade); a lista completa por lote sai em `GET /lotes/:id/erros`. */
export const MonitorResposta = z.object({
  credencial: CredencialResumo.nullable(),
  configuracao: ConfiguracaoResumo.nullable(),
  sinal: SinalResumo.nullable(),
  entidades: z.array(MonitorEntidade),
  erros: z.array(LoteErroLinha),
  conflitos: z.array(ConflitoChaveItem),
});
export type MonitorResposta = z.infer<typeof MonitorResposta>;
