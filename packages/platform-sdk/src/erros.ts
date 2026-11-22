/**
 * Erros da API (desenho T-0002, seção 2). A API traduz cada um no status e no corpo `{ codigo, mensagem, campos? }`.
 * Regra de negócio: 422 com `codigo` = a RN (`RN-CAD-01`). A mensagem nunca leva dado pessoal nem segredo.
 */

export type CamposErro = Record<string, string>;

export type StatusErroApi = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503;

export class ErroApi extends Error {
  override readonly name = 'ErroApi';
  constructor(
    readonly status: StatusErroApi,
    readonly codigo: string,
    mensagem: string,
    readonly campos?: CamposErro,
  ) {
    super(mensagem);
  }
}

/** Código de regra de negócio (`RN-CORE-06`, `RN-CAD-01`): o `codigo` dos 422 e a citação nos testes (RD-0001). */
export const PADRAO_RN = /^RN-[A-Z]+-\d{2}$/;

export const erros = {
  naoAutenticado: (mensagem = 'Sessão ausente ou vencida') => new ErroApi(401, 'NAO_AUTENTICADO', mensagem),
  perfilSemPermissao: () => new ErroApi(403, 'PERFIL_SEM_PERMISSAO', 'Seu perfil não permite esta ação'),
  moduloInativo: (modulo: string) => new ErroApi(403, 'MODULO_INATIVO', `O módulo ${modulo} não está licenciado para a empresa`),
  /** 404 do recurso do tenant (`erros.naoEncontrado('Cliente')`). O objeto é o nome da entidade, nunca o valor buscado. */
  naoEncontrado: (objeto: string) => new ErroApi(404, 'NAO_ENCONTRADO', `${objeto} não encontrado`),
  validacao: (campos: CamposErro) => new ErroApi(400, 'VALIDACAO', 'Dados inválidos', campos),
  conflito: (mensagem: string) => new ErroApi(409, 'CONFLITO', mensagem),
  /** Corpo ou arquivo acima do limite declarado pela rota (multipart). */
  arquivoGrande: (campo: string, limiteBytes: number) =>
    new ErroApi(413, 'ARQUIVO_GRANDE', 'Arquivo acima do limite', { [campo]: `até ${Math.floor(limiteBytes / 1024)} KB` }),
  /** A rota passou do `tempoMaximoMs`: a transação foi desfeita (nada gravado). */
  tempoEsgotado: (segundos: number) =>
    new ErroApi(503, 'TEMPO_ESGOTADO', `A operação passou de ${segundos} s e foi desfeita: divida o envio ou tente de novo`),
  muitasTentativas: (mensagem: string) => new ErroApi(429, 'MUITAS_TENTATIVAS', mensagem),
  /** Dependência externa fora do ar (SEFAZ, BrasilAPI, Hub do FDV): 503, o cliente tenta de novo mais tarde. */
  indisponivel: (servico: string) => new ErroApi(503, 'INDISPONIVEL', `${servico} indisponível no momento: tente de novo em instantes`),
  /** Regra de negócio violada: 422 com o código da RN (ex.: `RN-CAD-01`). */
  regra: (codigoRn: string, mensagem: string, campos?: CamposErro) => {
    if (!PADRAO_RN.test(codigoRn)) throw new RangeError(`erros.regra: "${codigoRn}" não é código de RN`);
    return new ErroApi(422, codigoRn, mensagem, campos);
  },
};

/**
 * Violação de regra apontada pelo `domain` (RD-0235): `rn` é a RN (`RN-PED-03`) ou a decisão do desenho (`D7`, `REF`);
 * `campo` é o caminho no corpo (`itens[0].desconto_centavos`). A API decide o erro: RN vira 422 (`erros.regra`), o resto 400.
 * Sem dado pessoal na mensagem. Sem Node: serve ao `domain` e ao `web` (`@macuxierp/platform-sdk/erros`).
 */
export interface Violacao {
  rn: string;
  campo: string;
  mensagem: string;
}

export const violacao = (rn: string, campo: string, mensagem: string): Violacao => ({ rn, campo, mensagem });
