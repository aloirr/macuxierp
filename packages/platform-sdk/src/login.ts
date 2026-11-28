/**
 * Contrato do login único (RN-CORE-12, T-0076, ADR 0018; e-mail único no sistema desde a T-0133, ADR 0021): uma tela só,
 * com E-mail e Senha, para o usuário do tenant e o superadmin. A apps/api, o modulo-core e a apps/web importam a mesma
 * fonte (regra 3).
 * - `POST /v1/auth/login` (`CAMINHO_LOGIN`, `LoginEntrada`): a API acha a conta pelo e-mail
 *   (`plataforma.conta_por_email`, 0079). Usuário de empresa = sessão do BKO (cookie `macuxierp_refresh` e
 *   `token_acesso` no corpo); só superadmin com o e-mail = sessão do `/config` (cookie `COOKIE_CONFIG`, token fora do
 *   corpo). O mesmo e-mail nos dois leva sempre ao BKO (ADR 0021 §7, opção A).
 * - Sem código da empresa: o campo `empresa` fica opcional e IGNORADO na v0.3.30 (ADR 0021 §6) e sai na versão seguinte.
 * 401 neutro (`MENSAGEM_LOGIN_INVALIDO`), 403 `EMPRESA_SUSPENSA`, 429 e a saída do `/config/entrar`: ADR 0018 e 0021.
 * Sem Node: serve à apps/web.
 */
import { z } from 'zod';
import {
  EmailUsuario,
  Instante,
  PADRAO_SLUG_EMPRESA,
  SessaoPlataformaResposta,
} from './portal-config';
import { SenhaInformada } from './senha';

/** Rota do login único (tenant e superadmin). */
export const CAMINHO_LOGIN = '/v1/auth/login';

/**
 * @deprecated Transição da v0.3.30 (ADR 0021 §6): o login e o "esqueci" não pedem mais a empresa, e a API ignora o
 * campo. Fica só porque a apps/web ainda tem o campo (RD-2408, RD-2410, RD-2415); sai com ele. Formato do slug da 0002
 * (`PADRAO_SLUG_EMPRESA`), aparado e em maiúsculas.
 */
export const CodigoEmpresaLogin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => PADRAO_SLUG_EMPRESA.test(c.toLowerCase()), 'Código da empresa inválido, ex.: AM2808');
/** @deprecated Ver `CodigoEmpresaLogin`. */
export type CodigoEmpresaLogin = z.infer<typeof CodigoEmpresaLogin>;

/** Para onde a sessão aberta leva: o BKO da empresa ou o portal `/config` do superadmin. */
export const DESTINOS_LOGIN = ['bko', 'config'] as const;
export type DestinoLogin = (typeof DESTINOS_LOGIN)[number];
export const DestinoLogin = z.enum(DESTINOS_LOGIN);

/**
 * Corpo do `POST /v1/auth/login`. A senha nunca vai para log nem auditoria. `empresa`: opcional e ignorado (ADR 0021 §6;
 * qualquer valor passa e não muda nada); a API só conta, em log, quantos pedidos ainda o mandam.
 */
export const LoginEntrada = z.object({
  empresa: z.unknown().optional(),
  email: EmailUsuario,
  senha: SenhaInformada,
});
export type LoginEntrada = z.infer<typeof LoginEntrada>;

/**
 * 200 do login do tenant: o corpo de antes (`token_acesso`, `expira_em`) mais o `destino`. Sem `destino` (resposta de
 * antes do login único) vale `bko`.
 */
const LoginRespostaBko = z.object({
  destino: z.literal('bko').default('bko'),
  token_acesso: z.string().min(1),
  expira_em: Instante,
  /** RN-CORE-15 (T-0111): entrou com a temporária numa conta travada, que ficou desbloqueada (a tela mostra `TEXTO_CONTA_DESBLOQUEADA`). */
  desbloqueou: z.literal(true).optional(),
});

/** 200 do login do superadmin: o `SessaoPlataformaResposta` mais o `destino`; o token vai só no `COOKIE_CONFIG`. */
const LoginRespostaConfig = SessaoPlataformaResposta.extend({ destino: z.literal('config'), desbloqueou: z.literal(true).optional() }).strict();

export const LoginResposta = z.union([LoginRespostaBko, LoginRespostaConfig]);
export type LoginResposta = z.infer<typeof LoginResposta>;
