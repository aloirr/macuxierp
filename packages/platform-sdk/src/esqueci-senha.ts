/**
 * Contrato do "Esqueci a senha" (RN-CORE-13, T-0076): a apps/api, o modulo-core e a apps/web importam a mesma fonte
 * (regra 3: tipos só de Zod). Rotas em `CAMINHOS_ESQUECI_SENHA`:
 * - `POST /v1/auth/esqueci` (usuário do tenant, `PedirSenhaTemporariaEntrada`) e `POST /v1/plataforma/auth/esqueci`
 *   (superadmin do `/config`, `PedirSenhaTemporariaPlataformaEntrada`): sempre 202 `PedidoSenhaTemporariaResposta`,
 *   tenha ou não a conta; 429 `MuitasTentativasResposta` acima de `LIMITES_ESQUECI_SENHA`;
 * - `GET /v1/auth/esqueci/situacao` (`SituacaoEsqueciResposta`): sem os PROD_SMTP_* o "esqueci" fica indisponível e o
 *   web oculta o link.
 * A senha temporária vai só por e-mail (`emailSenhaTemporaria`), sem link nem token, e segue a regra de
 * `VALIDADE_SENHA_TEMPORARIA_HORAS`; o primeiro uso leva à troca obrigatória (`SenhaATrocarResposta`, `POST /v1/auth/senha`).
 * A 0048 grava em `plataforma.usuario` e `plataforma.superadmin`, nas colunas `senha_temporaria_hash` e
 * `senha_temporaria_expira_em`. Nunca vai para log, recado nem auditoria. Sem Node: serve à apps/web.
 */
import { z } from 'zod';
import { CODIGO_TROCAR_SENHA } from './eu';
import { CODIGO_SUPERADMIN_LOGIN, CodigoEmpresa, EmailUsuario, Instante } from './portal-config';
import { plural } from './texto';

/**
 * Código digitado no campo "empresa" do login e do "esqueci" (o `empresa` do `Login` da apps/api): o código da empresa
 * (RN-CORE-11, `CodigoEmpresa`: UF + 4 dígitos) ou `CODIGO_SUPERADMIN_LOGIN`. Aparado e em maiúsculas (não diferencia).
 */
export const CodigoEmpresaLogin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => c === CODIGO_SUPERADMIN_LOGIN || CodigoEmpresa.safeParse(c).success, 'Código da empresa: UF + 4 dígitos, ex.: AM2808');
export type CodigoEmpresaLogin = z.infer<typeof CodigoEmpresaLogin>;

/** Pedido da senha temporária do usuário do tenant (RN-CORE-13): um pedido novo substitui a temporária anterior. */
export const PedirSenhaTemporariaEntrada = z.object({ empresa: CodigoEmpresaLogin, email: EmailUsuario });
export type PedirSenhaTemporariaEntrada = z.infer<typeof PedirSenhaTemporariaEntrada>;

/** Pedido da senha temporária do superadmin (RN-CORE-13): um pedido novo substitui a temporária anterior. */
export const PedirSenhaTemporariaPlataformaEntrada = z.object({ email: EmailUsuario });
export type PedirSenhaTemporariaPlataformaEntrada = z.infer<typeof PedirSenhaTemporariaPlataformaEntrada>;

/** Confirmação neutra do BKO e do `/config` (literal aprovado no #466, docs/design/login-unico/README.md). */
export const MENSAGEM_ESQUECI_NEUTRA =
  'Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72 horas.';

/** Corpo do 202 das duas rotas do "esqueci" (RN-CORE-13): igual exista ou não a conta. */
export const PedidoSenhaTemporariaResposta = z.object({ mensagem: z.literal(MENSAGEM_ESQUECI_NEUTRA) });
export type PedidoSenhaTemporariaResposta = z.infer<typeof PedidoSenhaTemporariaResposta>;

/** `GET /v1/auth/esqueci/situacao`: `false` sem os PROD_SMTP_* (o web oculta o link). */
export const SituacaoEsqueciResposta = z.object({ esqueci_disponivel: z.boolean() });
export type SituacaoEsqueciResposta = z.infer<typeof SituacaoEsqueciResposta>;

export const CAMINHOS_ESQUECI_SENHA = Object.freeze({
  tenant: '/v1/auth/esqueci',
  plataforma: '/v1/plataforma/auth/esqueci',
  situacao: '/v1/auth/esqueci/situacao',
} as const);

/**
 * Validade da senha temporária (RN-CORE-13), em `senha_temporaria_expira_em`: vale em paralelo à senha atual, com uso
 * único, e cai ao vencer. Um pedido novo SUBSTITUI a temporária anterior (há uma coluna só) e recomeça o prazo.
 */
export const VALIDADE_SENHA_TEMPORARIA_HORAS = 72;

/** Rótulo do 1º campo da troca obrigatória quando o motivo é `temporaria` (o `rotuloAtual` do formulário). */
export const ROTULO_SENHA_TEMPORARIA = 'Senha temporária';

/** Limites do FDV (RN-CORE-13): 5 pedidos por IP a cada 15 min e 3 por (empresa + e-mail) por hora. */
export const LIMITES_ESQUECI_SENHA = Object.freeze({
  por_ip: Object.freeze({ maximo: 5, janela_s: 900 } as const),
  por_conta: Object.freeze({ maximo: 3, janela_s: 3600 } as const),
} as const);

/** Corpo do 429 (`erros.muitasTentativas(mensagem, retry_after_s)`): o envelope de `corpoErroApi`, com o prazo em `detalhes`. */
export const MuitasTentativasResposta = z.object({
  codigo: z.literal('MUITAS_TENTATIVAS'),
  mensagem: z.string().min(1),
  detalhes: z.object({ retry_after_s: z.number().int().min(1) }),
});
export type MuitasTentativasResposta = z.infer<typeof MuitasTentativasResposta>;

/** Texto do 429 na tela (docs/design/login-unico): `retry_after_s` em minutos, arredondado para cima. */
export function textoMuitasTentativas(retryAfterS: number): string {
  if (!Number.isInteger(retryAfterS) || retryAfterS < 1) throw new RangeError('textoMuitasTentativas: retry_after_s precisa ser inteiro ≥ 1');
  return `Muitas tentativas. Tente de novo em ${plural(Math.ceil(retryAfterS / 60), 'minuto', 'minutos')}.`;
}

/**
 * 403 da troca obrigatória (`CODIGO_TROCAR_SENHA`, T-0052), com o motivo (RN-CORE-13): `provisoria` (criada pelo admin)
 * ou `temporaria` (do "esqueci"; `expira_em` = fim das 72 h).
 */
export const SenhaATrocarResposta = z.object({
  codigo: z.literal(CODIGO_TROCAR_SENHA),
  mensagem: z.string().min(1),
  motivo: z.enum(['provisoria', 'temporaria']),
  expira_em: Instante.optional(),
});
export type SenhaATrocarResposta = z.infer<typeof SenhaATrocarResposta>;

export interface EmailSenhaTemporaria {
  assunto: string;
  texto: string;
}

/** E-mail da senha temporária (RN-CORE-13): texto simples, sem nome nem e-mail do destinatário. Função pura. */
export function emailSenhaTemporaria(e: { senha: string; validade_horas: number }): EmailSenhaTemporaria {
  if (e.senha.trim() === '') throw new RangeError('emailSenhaTemporaria: senha vazia');
  if (!Number.isInteger(e.validade_horas) || e.validade_horas < 1) throw new RangeError('emailSenhaTemporaria: validade_horas precisa ser inteiro ≥ 1');
  return {
    assunto: 'Macuxi ERP: sua senha temporária',
    texto: [
      'Olá,',
      '',
      'Recebemos um pedido de senha temporária para entrar no Macuxi ERP.',
      '',
      `Senha temporária: ${e.senha}`,
      '',
      `Ela vale por ${e.validade_horas} horas e funciona uma vez só. No primeiro acesso, o sistema vai pedir para você trocar a senha.`,
      'Sua senha atual continua valendo. Se você não fez o pedido, ignore este e-mail.',
    ].join('\n'),
  };
}
