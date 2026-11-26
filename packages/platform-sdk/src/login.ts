/**
 * Contrato do login único (RN-CORE-12, T-0076, ADR 0018): uma tela só, com Empresa, E-mail e Senha, para o usuário do
 * tenant e o superadmin. A apps/api, o modulo-core (`resolverDestinoLogin`) e a apps/web importam a mesma fonte (regra 3).
 * - `POST /v1/auth/login` (`CAMINHO_LOGIN`, `LoginEntrada`): com `empresa` = `CODIGO_SUPERADMIN_LOGIN` a API autentica o
 *   superadmin e abre a sessão do `/config` (cookie `COOKIE_CONFIG`, token fora do corpo); com outro código, o usuário do
 *   tenant (cookie `macuxierp_refresh` e `token_acesso` no corpo, como antes). `destinoDoCodigo` decide.
 * 401 neutro, 429 e a saída do `/config/entrar`: ADR 0018. Sem Node: serve à apps/web.
 */
import { z } from 'zod';
import {
  CODIGO_SUPERADMIN_LOGIN,
  EmailUsuario,
  Instante,
  PADRAO_SLUG_EMPRESA,
  SessaoPlataformaResposta,
} from './portal-config';
import { SenhaInformada } from './senha';

/** Rota do login único (tenant e superadmin). */
export const CAMINHO_LOGIN = '/v1/auth/login';

/**
 * Código digitado no campo "empresa" do login e do "esqueci": qualquer slug no formato do CHECK de
 * `plataforma.tenant.slug` (0002, `PADRAO_SLUG_EMPRESA`), sem diferenciar maiúsculas. Cobre o código da empresa
 * (RN-CORE-11: UF + 4 dígitos), o slug antigo das empresas criadas antes da T-0053 e `CODIGO_SUPERADMIN_LOGIN`.
 * Aparado e em maiúsculas; a API compara com o slug em minúsculas.
 */
export const CodigoEmpresaLogin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => PADRAO_SLUG_EMPRESA.test(c.toLowerCase()), 'Código da empresa inválido, ex.: AM2808');
export type CodigoEmpresaLogin = z.infer<typeof CodigoEmpresaLogin>;

/** Para onde a sessão aberta leva: o BKO da empresa ou o portal `/config` do superadmin. */
export const DESTINOS_LOGIN = ['bko', 'config'] as const;
export type DestinoLogin = (typeof DESTINOS_LOGIN)[number];
export const DestinoLogin = z.enum(DESTINOS_LOGIN);

/** Destino do código já normalizado por `CodigoEmpresaLogin` (RN-CORE-12). Função pura: o core e a API usam a mesma. */
export function destinoDoCodigo(codigo: CodigoEmpresaLogin): DestinoLogin {
  return codigo === CODIGO_SUPERADMIN_LOGIN ? 'config' : 'bko';
}

/** Corpo do `POST /v1/auth/login`. A senha nunca vai para log nem auditoria. */
export const LoginEntrada = z.object({
  empresa: CodigoEmpresaLogin,
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
