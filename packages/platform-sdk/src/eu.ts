/**
 * Contrato do `GET /v1/auth/eu` (regra 3: tipos só de Zod). A API valida a saída por este schema e o shell do BKO
 * (apps/web) importa o mesmo `EuResposta`: uma fonte só para os dois lados (decisão do gerente-projetos, 21/11).
 * - `usuario.perfil` define o menu e os botões (com `pode` e `PERMISSOES`, também do SDK);
 * - `filiais` são as do usuário, com nome e CNPJ para a tela de escolha da filial;
 * - `modulos` são só os licenciados para o tenant, na ordem de `MODULOS`, com os menus do manifesto.
 */
import { z } from 'zod';
import { PADRAO_UUID } from './banco';
import { Cnpj } from './documentos';
import { MODULOS, PERFIS } from './modulo';

const Id = z.string().regex(PADRAO_UUID);

export const EuResposta = z.object({
  usuario: z.object({ id: Id, nome: z.string().min(1), perfil: z.enum(PERFIS) }),
  empresa: z.object({ id: Id, slug: z.string().min(1), razao_social: z.string().min(1), fuso: z.string().min(1) }),
  filiais: z.array(z.object({ id: Id, nome: z.string().min(1), cnpj: Cnpj })),
  modulos: z.array(z.object({ id: z.enum(MODULOS), menus: z.array(z.string()) })),
});
export type EuResposta = z.infer<typeof EuResposta>;
