/**
 * Contrato do "Esqueci a senha" (RN-CORE-13, T-0076): a apps/api, o modulo-core e a apps/web importam a mesma fonte
 * (regra 3: tipos só de Zod). Rotas em `CAMINHOS_ESQUECI_SENHA`:
 * - `POST /v1/auth/esqueci` (usuário do tenant, `PedirSenhaTemporariaEntrada`) e `POST /v1/plataforma/auth/esqueci`
 *   (superadmin do `/config`, `PedirSenhaTemporariaPlataformaEntrada`): sempre 202 `PedidoSenhaTemporariaResposta`,
 *   tenha ou não a conta; 429 `MuitasTentativasResposta` acima de `LIMITES_ESQUECI_SENHA`;
 * - `GET /v1/auth/esqueci/situacao` (`SituacaoEsqueciResposta`): sem os PROD_SMTP_* o "esqueci" fica indisponível e o
 *   web oculta o link.
 * A senha temporária vai só por e-mail (`emailSenhaTemporaria`), sem link nem token; vale `VALIDADE_SENHA_TEMPORARIA_HORAS`
 * em paralelo à senha atual, com uso único; cai no primeiro uso ou ao vencer e leva à troca obrigatória
 * (`SenhaATrocarResposta`, `POST /v1/auth/senha`). Nunca vai para log, recado nem auditoria. Sem Node: serve à apps/web.
 */
import { z } from 'zod';
import { CODIGO_TROCAR_SENHA } from './eu';
import { EmailUsuario, Instante } from './portal-config';

/** Código da empresa digitado no login e no "esqueci" (o `empresa` do `Login` da apps/api): texto livre de 1 a 60. */
export const CodigoEmpresaLogin = z.string().trim().min(1).max(60);

export const PedirSenhaTemporariaEntrada = z.object({ empresa: CodigoEmpresaLogin, email: EmailUsuario });
export type PedirSenhaTemporariaEntrada = z.infer<typeof PedirSenhaTemporariaEntrada>;

export const PedirSenhaTemporariaPlataformaEntrada = z.object({ email: EmailUsuario });
export type PedirSenhaTemporariaPlataformaEntrada = z.infer<typeof PedirSenhaTemporariaPlataformaEntrada>;

/** Texto provisório; será trocado pelo literal do FDV. */
export const MENSAGEM_ESQUECI_NEUTRA = 'Se os dados estiverem certos, você vai receber uma senha temporária por e-mail em alguns minutos.';

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

export const VALIDADE_SENHA_TEMPORARIA_HORAS = 72;

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
