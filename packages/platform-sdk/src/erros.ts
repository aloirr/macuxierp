/**
 * Erros da API (desenho T-0002, seção 2). A API traduz cada um no status e no corpo `{ codigo, mensagem, campos? }`.
 * Regra de negócio: 422 com `codigo` = a RN (`RN-CAD-01`). A mensagem nunca leva dado pessoal nem segredo.
 */

export type CamposErro = Record<string, string>;

export class ErroApi extends Error {
  override readonly name = 'ErroApi';
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    readonly codigo: string,
    mensagem: string,
    readonly campos?: CamposErro,
  ) {
    super(mensagem);
  }
}

const PADRAO_RN = /^RN-[A-Z]+-\d{2}$/;

export const erros = {
  naoAutenticado: (mensagem = 'Sessão ausente ou vencida') => new ErroApi(401, 'NAO_AUTENTICADO', mensagem),
  perfilSemPermissao: () => new ErroApi(403, 'PERFIL_SEM_PERMISSAO', 'Seu perfil não permite esta ação'),
  moduloInativo: (modulo: string) => new ErroApi(403, 'MODULO_INATIVO', `O módulo ${modulo} não está licenciado para a empresa`),
  validacao: (campos: CamposErro) => new ErroApi(400, 'VALIDACAO', 'Dados inválidos', campos),
  naoEncontrado: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Registro não encontrado'),
  conflito: (mensagem: string) => new ErroApi(409, 'CONFLITO', mensagem),
  muitasTentativas: (mensagem: string) => new ErroApi(429, 'MUITAS_TENTATIVAS', mensagem),
  /** Regra de negócio violada: 422 com o código da RN (ex.: `RN-CAD-01`). */
  regra: (codigoRn: string, mensagem: string, campos?: CamposErro) => {
    if (!PADRAO_RN.test(codigoRn)) throw new RangeError(`erros.regra: "${codigoRn}" não é código de RN`);
    return new ErroApi(422, codigoRn, mensagem, campos);
  },
};
