/**
 * Contrato do `GET /v1/auth/eu` (regra 3: tipos só de Zod). A API valida a saída por este schema e o shell do BKO
 * (apps/web) importa o mesmo `EuResposta`: uma fonte só para os dois lados (decisão do gerente-projetos, 21/11).
 * - `usuario.perfil` define o menu e os botões (com `pode` e `PERMISSOES`, também do SDK);
 * - `filiais` são as do usuário, com nome e CNPJ para a tela de escolha da filial;
 * - `modulos` são só os licenciados para o tenant, na ordem de `MODULOS`, com os menus do manifesto;
 * - `avisos_a1` (opcional, campo compatível acrescentado na T-0035): o selo do A1 no BKO, um por filial do tenant com
 *   certificado ativo a 30 dias ou menos de vencer, ou já vencido (RF-CORE-04, RN-CORE-06). `dias` negativo = vencido;
 *   `valido_ate` em ISO 8601 UTC. Sem titular nem CNPJ do certificado.
 * - `usuario.deve_trocar_senha` (opcional, campo compatível acrescentado na T-0052; ausente = false): o usuário entrou
 *   com a senha provisória e o BKO o leva à troca (`POST /v1/auth/senha`, `TrocarSenhaEntrada`) antes de qualquer tela.
 * - `usuario.motivo_troca` (opcional, T-0076, RN-CORE-13): por que a troca é obrigatória (`MOTIVOS_TROCA_SENHA`); com
 *   `temporaria` o 1º campo da troca leva o `ROTULO_SENHA_TEMPORARIA`.
 */
import { z } from 'zod';
import { PADRAO_UUID } from './banco';
import { Cnpj } from './documentos';
import { MODULOS, PERFIS } from './modulo';
import { SenhaInformada, SenhaNova } from './senha';

const Id = z.string().regex(PADRAO_UUID);

/**
 * Motivo da troca obrigatória de senha (RN-CORE-13), fonte única do `SenhaATrocarResposta`, do `EuResposta` e do
 * `EuPlataforma`: `provisoria` (criada pelo admin ou pelo superadmin) ou `temporaria` (do "esqueci").
 */
export const MOTIVOS_TROCA_SENHA = ['provisoria', 'temporaria'] as const;
export type MotivoTrocaSenha = (typeof MOTIVOS_TROCA_SENHA)[number];

export const EuResposta = z.object({
  usuario: z.object({
    id: Id,
    nome: z.string().min(1),
    perfil: z.enum(PERFIS),
    deve_trocar_senha: z.boolean().optional(),
    motivo_troca: z.enum(MOTIVOS_TROCA_SENHA).optional(),
  }),
  empresa: z.object({ id: Id, slug: z.string().min(1), razao_social: z.string().min(1), fuso: z.string().min(1) }),
  filiais: z.array(z.object({ id: Id, nome: z.string().min(1), cnpj: Cnpj })),
  modulos: z.array(z.object({ id: z.enum(MODULOS), menus: z.array(z.string()) })),
  avisos_a1: z.array(z.object({ filial_id: Id, dias: z.number().int(), valido_ate: z.string().datetime() })).optional(),
});
export type EuResposta = z.infer<typeof EuResposta>;

/**
 * Código do 403 que a API devolve, em toda rota além de `GET /v1/auth/eu`, `POST /v1/auth/senha` e a saída, enquanto a
 * senha provisória não for trocada (T-0052). O portal `/config` usa o mesmo código para o superadmin.
 */
export const CODIGO_TROCAR_SENHA = 'TROCAR_SENHA';

/**
 * Corpo do `POST /v1/auth/senha` (resposta 204, sem corpo) e da troca do superadmin (`TrocarSenhaPlataformaEntrada`).
 * A senha nova segue `SenhaNova` (`senha.ts`); a atual só é limitada a 1–`SENHA_MAXIMA`, porque senhas já gravadas
 * continuam valendo. A senha nunca vai para log nem auditoria.
 * `senha_atual` é opcional (T-0076, RN-CORE-13): a API só aceita a falta quando a sessão foi aberta pela senha temporária
 * (motivo_troca 'temporaria', gravado no servidor); nos outros casos, 400 VALIDACAO no path senha_atual. Quando vem,
 * segue `SenhaInformada` (vazia continua recusada).
 */
export const TrocarSenhaEntrada = z.object({
  senha_atual: SenhaInformada.optional(),
  senha_nova: SenhaNova,
});
export type TrocarSenhaEntrada = z.infer<typeof TrocarSenhaEntrada>;
