import { ehRespostaDefinitiva } from '../descritor/idempotencia';
import { SESSAO_EXPIRADA } from '../textos';

/** Erros do portal /config. Mensagens fixas: nada de corpo de erro cru, e-mail, nome de empresa ou senha (LGPD, ADR 0012). */
export class ConfigNaoAutenticado extends Error {
  override readonly name = 'ConfigNaoAutenticado' as const;
}
export class ConfigSemPermissao extends Error {
  override readonly name = 'ConfigSemPermissao' as const;
}
export class ConfigIndisponivel extends Error {
  override readonly name = 'ConfigIndisponivel' as const;
}
export class ConfigMuitasTentativas extends Error {
  override readonly name = 'ConfigMuitasTentativas' as const;
}
/** `detalhes` do corpo de erro da API, só o que a tela usa: o código e, no 422 do zerar, os bloqueios (`cadastro:motivo`). */
export interface DetalhesErro {
  codigo?: string;
  bloqueios?: string[];
}
/** 400, 403 `TROCAR_SENHA`, 404, 409 e 422 da API, com o código e os campos (a mensagem da API não vai à tela, salvo o 409/422/503 da integracao_fdv, o 409/422 da receita e a carga, já filtrados). */
export class ErroPlataforma extends Error {
  override readonly name = 'ErroPlataforma' as const;
  constructor(readonly status: number, readonly codigo: string, readonly campos: Record<string, string> = {}, readonly mensagem = '', readonly detalhes: DetalhesErro = {}) {
    super(`plataforma: HTTP ${status} ${codigo}`);
  }
}

export type ContextoErro = 'entrar' | 'criar_empresa' | 'modulos' | 'criar_admin' | 'redefinir' | 'situacao' | 'senha' | 'carregar' | 'email' | 'integracao_fdv' | 'carga' | 'receita';

/**
 * Ficha pela Receita (T-0101): as falhas da fonte (200 `estado: 'erro'`), o 409 e o 422 trazem a `mensagem` do core, que a
 * tela exibe como vem. Aqui só os textos de quando a API não responde (503 enquanto a porta de CNPJ não entra) ou a mensagem
 * do 422 não vem; o mesmo texto do core para `fonte_indisponivel`.
 */
export const RECEITA_INDISPONIVEL = 'Não foi possível consultar a Receita agora. Tente de novo em alguns minutos.';
const RECEITA_DADO_RECUSADO = 'A Receita enviou um dado que o cadastro não aceita. Tente de novo mais tarde.';
export const EMPRESA_NAO_ENCONTRADA = 'Empresa não encontrada. Volte à lista.';

/** Credencial errada e conta travada dão a MESMA mensagem (ADR 0012, seção 6). */
export const CREDENCIAL_INVALIDA = 'E-mail ou senha inválidos.';
export const FALHA_REDE = 'Não foi possível concluir. Tente de novo.';
export const SEM_PERMISSAO = 'Você não tem permissão para esta ação.';
export const ADMIN_JA_EXISTE = 'Esta empresa já tem administrador. Redefina a senha dele.';
export const SENHA_ATUAL_INCORRETA = 'Senha provisória atual incorreta. Confira e tente de novo.';
export const SENHA_JA_EXIBIDA = 'A senha já foi exibida. Redefina para gerar outra.';

export interface MensagemErro {
  texto: string;
  /** Texto por campo, junto do campo (MC-0015). */
  campos: Record<string, string>;
  /** A sessão acabou: a tela volta ao login. */
  expirou: boolean;
  /** A chave de idempotência já foi usada e a API guardou a resposta: a próxima tentativa pede chave nova. */
  chaveNova: boolean;
}

/** Traduz o erro da API na mensagem da tela (o problema e a ação). Pura: testada sem rede. */
export function mensagemDoErro(e: unknown, ctx: ContextoErro): MensagemErro {
  const base = { campos: {}, expirou: false, chaveNova: false };
  if (e instanceof ConfigNaoAutenticado) return { ...base, texto: SESSAO_EXPIRADA, expirou: true };
  if (e instanceof ConfigMuitasTentativas) return { ...base, texto: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' };
  if (e instanceof ConfigSemPermissao) return { ...base, texto: SEM_PERMISSAO };
  if (e instanceof ErroPlataforma) {
    if (ctx === 'receita') {
      const definitiva = ehRespostaDefinitiva(e.status);
      if (e.status === 503) return { ...base, texto: RECEITA_INDISPONIVEL };
      if (e.status === 409) return { ...base, texto: e.mensagem || FALHA_REDE, chaveNova: definitiva };
      if (e.status === 422 || e.status === 400) return { ...base, texto: e.mensagem || RECEITA_DADO_RECUSADO, chaveNova: definitiva };
    }
    if (e.status === 409) {
      if (ctx === 'criar_empresa') return { ...base, texto: '', campos: { codigo: 'Já existe uma empresa com esse código. Escolha outro.' }, chaveNova: ehRespostaDefinitiva(e.status) };
      if (ctx === 'criar_admin') return { ...base, texto: ADMIN_JA_EXISTE, chaveNova: ehRespostaDefinitiva(e.status) };
      if (ctx === 'redefinir') return { ...base, texto: SENHA_JA_EXIBIDA, chaveNova: ehRespostaDefinitiva(e.status) };
    }
    if (ctx === 'integracao_fdv' && (e.status === 409 || e.status === 422 || e.status === 503) && e.mensagem) return { ...base, texto: e.mensagem, campos: e.campos, chaveNova: ehRespostaDefinitiva(e.status) };
    // Carga (T-0058): a mensagem curta da API (arquivo recusado, código de confirmação errado) é o texto da tela.
    if (ctx === 'carga' && (e.status === 400 || e.status === 409 || e.status === 422 || e.status === 503) && e.mensagem) return { ...base, texto: e.mensagem, chaveNova: ehRespostaDefinitiva(e.status) };
    if (e.status === 422 && ctx === 'modulos') {
      const faltas = Object.entries(e.campos).map(([campo, t]) => ({ campo, t }));
      return { ...base, texto: 'Os módulos escolhidos não são permitidos. Revise as dependências.', campos: Object.fromEntries(faltas.map((f) => [f.campo, f.t])), chaveNova: ehRespostaDefinitiva(e.status) };
    }
    if (ctx === 'senha' && (e.status === 400 || e.status === 422)) return { ...base, texto: e.campos.senha_atual ?? e.campos.senha_nova ?? SENHA_ATUAL_INCORRETA, chaveNova: ehRespostaDefinitiva(e.status) };
    if (e.status === 400 || e.status === 422) return { ...base, texto: 'Confira os dados e tente de novo.', campos: e.campos, chaveNova: ehRespostaDefinitiva(e.status) };
    if (e.status === 404 && ctx === 'email') return { ...base, texto: 'A empresa ainda não tem 1º administrador.' };
    if (e.status === 404) return { ...base, texto: EMPRESA_NAO_ENCONTRADA };
  }
  // 5xx sem código (porta de CNPJ ainda sem ligar): a fonte está indisponível, não a rede do usuário.
  if (ctx === 'receita' && e instanceof ConfigIndisponivel) return { ...base, texto: RECEITA_INDISPONIVEL };
  return { ...base, texto: FALHA_REDE };
}
