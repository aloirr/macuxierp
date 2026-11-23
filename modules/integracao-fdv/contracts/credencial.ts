/** C-6: credencial do conector (RF-INF-05). A chave nunca volta em resposta, log, evento nem trabalho. */
import { z } from 'zod';
import {
  AmbienteIntegracaoFdv,
  ConfigurarIntegracaoPlataformaEntrada,
  DefinirCredencialPlataformaEntrada,
  LIMITE_REGISTROS_LOTE_FDV,
  RespostaAceitoFdv,
  RespostaRetomadaFdv,
  RespostaTestarPlataforma,
} from '@macuxierp/platform-sdk';
import { EntidadeHub } from './hub';

/** Formatos da credencial e da operação vêm do SDK (ADR 0013, `portal-integracao.ts`): a mesma validação no portal e no módulo. */
export const AmbienteHub = AmbienteIntegracaoFdv;
export type AmbienteHub = AmbienteIntegracaoFdv;

export const CredencialEntrada = DefinirCredencialPlataformaEntrada;
export type CredencialEntrada = DefinirCredencialPlataformaEntrada;

/** Só o prefixo (até 8 caracteres) fica visível. */
export const CredencialResumo = z.object({
  id: z.string().uuid(),
  conector_id: z.string(),
  ambiente: AmbienteHub,
  chave_prefixo: z.string().min(1).max(8),
  criada_em: z.string().datetime(),
  ultimo_uso_em: z.string().datetime().nullable(),
});
export type CredencialResumo = z.infer<typeof CredencialResumo>;

/** Configuração do envio na credencial ativa (RN-INF-02): entidades que o conector envia e o teto por lote. Igual ao do SDK (recusa cadastro repetido). */
export const ConfiguracaoEntrada = ConfigurarIntegracaoPlataformaEntrada;
export type ConfiguracaoEntrada = ConfigurarIntegracaoPlataformaEntrada;

/** Configuração como o monitor e `PUT /configuracao` devolvem: as entidades já tipadas. */
export const ConfiguracaoResumo = z.object({ entidades_habilitadas: z.array(EntidadeHub), limite_registros_lote: z.number().int().min(1).max(LIMITE_REGISTROS_LOTE_FDV) });
export type ConfiguracaoResumo = z.infer<typeof ConfiguracaoResumo>;

/** `202` de `POST /entidades/:entidade/carga-completa`. */
export const RespostaAceito = RespostaAceitoFdv;
export type RespostaAceito = RespostaAceitoFdv;

/** `202` de `POST /credencial/testar`: `pedido_em` (ISO UTC) é o instante do pedido; o monitor mostra o sinal aceito a partir dele. */
export const RespostaTestar = RespostaTestarPlataforma;
export type RespostaTestar = RespostaTestarPlataforma;

/** `200` de `POST /entidades/:entidade/retomar`: `false` quando a entidade não estava pausada. */
export const RespostaRetomada = RespostaRetomadaFdv;
export type RespostaRetomada = RespostaRetomadaFdv;
