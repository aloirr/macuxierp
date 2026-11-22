/** C-6: credencial do conector (RF-INF-05). A chave nunca volta em resposta, log, evento nem trabalho. */
import { z } from 'zod';
import { ENTIDADES_HUB_F2, EntidadeHub, LIMITE_REGISTROS_LOTE } from './hub';

export const AmbienteHub = z.enum(['teste', 'producao']);
export type AmbienteHub = z.infer<typeof AmbienteHub>;

export const CredencialEntrada = z.object({
  conector_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  chave: z.string().regex(/^\S+$/).min(32).max(512),
  ambiente: AmbienteHub,
});
export type CredencialEntrada = z.infer<typeof CredencialEntrada>;

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

const EntidadeHabilitavel = z.enum(ENTIDADES_HUB_F2 as unknown as [string, ...string[]]);

/** Configuração do envio na credencial ativa (RN-INF-02): entidades que o conector envia e o teto de registros por lote. */
export const ConfiguracaoEntrada = z.object({
  entidades_habilitadas: z.array(EntidadeHabilitavel).max(ENTIDADES_HUB_F2.length),
  limite_registros_lote: z.number().int().min(1).max(LIMITE_REGISTROS_LOTE),
});
export type ConfiguracaoEntrada = z.infer<typeof ConfiguracaoEntrada>;

/** Configuração como o monitor e `PUT /configuracao` devolvem: as entidades já tipadas. */
export const ConfiguracaoResumo = ConfiguracaoEntrada.extend({ entidades_habilitadas: z.array(EntidadeHub) });
export type ConfiguracaoResumo = z.infer<typeof ConfiguracaoResumo>;

/** `202` de `POST /entidades/:entidade/carga-completa`. */
export const RespostaAceito = z.object({ aceito: z.literal(true) });
export type RespostaAceito = z.infer<typeof RespostaAceito>;

/** `202` de `POST /credencial/testar`: `pedido_em` (ISO UTC) é o instante do pedido; o monitor mostra o sinal aceito a partir dele. */
export const RespostaTestar = RespostaAceito.extend({ pedido_em: z.string().datetime() });
export type RespostaTestar = z.infer<typeof RespostaTestar>;

/** `200` de `POST /entidades/:entidade/retomar`: `false` quando a entidade não estava pausada. */
export const RespostaRetomada = z.object({ retomada: z.boolean() });
export type RespostaRetomada = z.infer<typeof RespostaRetomada>;
