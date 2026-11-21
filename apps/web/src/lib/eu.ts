import { MODULOS, PERFIS } from '@macuxierp/platform-sdk';
import { z } from 'zod';

/** Resposta de GET /v1/auth/eu (docs/desenho/T-0002.md, seção 2). A conferir com a T-0004. */
export const EuSchema = z.object({
  usuario: z.object({ id: z.string().uuid(), nome: z.string() }),
  perfil: z.enum(PERFIS),
  empresa: z.object({ id: z.string().uuid(), slug: z.string(), razao_social: z.string() }),
  filiais: z.array(z.object({ id: z.string().uuid(), nome: z.string(), cnpj: z.string() })),
  modulos: z.array(z.object({ id: z.enum(MODULOS), versao: z.string().optional() })),
});
export type Eu = z.infer<typeof EuSchema>;
