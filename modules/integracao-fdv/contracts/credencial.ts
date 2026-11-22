/** C-6: credencial do conector (RF-INF-05). A chave nunca volta em resposta, log, evento nem trabalho. */
import { z } from 'zod';

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
