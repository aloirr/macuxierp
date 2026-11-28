import { RESPOSTA_CONTA_BLOQUEADA, TEXTO_CONTA_DESBLOQUEADA } from '@macuxierp/core/web';
import { CODIGO_CONTA_BLOQUEADA, EmailUsuario, MENSAGEM_EMPRESA_SUSPENSA, MENSAGEM_LOGIN_INVALIDO, MuitasTentativasResposta } from '@macuxierp/platform-sdk';

/** Textos e validação por campo da tela única de login e do "esqueci a senha" (docs/design/login-unico). Pura: sem Node, serve ao cliente e ao servidor. */
export const TEXTOS_LOGIN = {
  titulo: 'Acesse sua conta',
  rotulos: { email: 'E-mail', senha: 'Senha' },
  obrigatorio: { email: 'Informe o e-mail.', senha: 'Informe a senha.' },
  emailInvalido: 'E-mail inválido. Confira o endereço.',
  botao: 'Entrar',
  botaoEnviando: 'Entrando…',
  /** 401 neutro (ADR 0021): nunca diz qual campo errou, nem se a conta está travada. Texto do SDK. */
  credencial: MENSAGEM_LOGIN_INVALIDO,
  /** 403 EMPRESA_SUSPENSA: só com a senha certa. Texto do SDK. */
  suspensa: MENSAGEM_EMPRESA_SUSPENSA,
  indisponivel: 'Serviço indisponível no momento. Tente de novo em instantes.',
} as const;

/** Conta bloqueada por tentativas erradas (T-0111): aviso, botão e a mensagem da tela de entrada. */
export const TEXTOS_BLOQUEIO = {
  titulo: RESPOSTA_CONTA_BLOQUEADA.titulo,
  texto: RESPOSTA_CONTA_BLOQUEADA.mensagem,
  botao: RESPOSTA_CONTA_BLOQUEADA.acao.rotulo,
} as const;

/** Entrou com a senha temporária (`motivo_troca: 'temporaria'` no `eu`): aviso e textos da tela de nova senha. */
export const TEXTOS_DESBLOQUEIO = {
  aviso: TEXTO_CONTA_DESBLOQUEADA,
  titulo: 'Crie a sua nova senha',
  rotuloNova: 'Nova senha',
  rotuloRepita: 'Repita a nova senha',
  botao: 'Salvar e entrar',
} as const;

/**
 * ÚNICO ponto que reconhece "conta bloqueada" na resposta do LOGIN (o do esqueci segue no `erroDaApi`): só o 423 ou o
 * código `CODIGO_CONTA_BLOQUEADA` do SDK (RN-CORE-15). O 429 é o limite por IP (`MUITAS_TENTATIVAS`) e NÃO é bloqueio.
 */
export function sinalDeBloqueioNaResposta(status: number, corpo: unknown): boolean {
  if (status === 423) return true;
  return typeof corpo === 'object' && corpo !== null && (corpo as { codigo?: unknown }).codigo === CODIGO_CONTA_BLOQUEADA;
}

/** Resultado do `loginUnico` que a tela trata como conta bloqueada. */
export function contaBloqueada(r: { tipo: string }): r is { tipo: 'bloqueada' } {
  return r.tipo === 'bloqueada';
}

/**
 * ÚNICO ponto que decide "Conta desbloqueada." nas telas de senha: `deve_trocar_senha` com `motivo_troca: 'temporaria'`
 * no `eu`. // T-0111: desbloqueou:true do contrato entra aqui
 */
export function entrouComTemporaria(eu: { deve_trocar_senha?: boolean | undefined; motivo_troca?: string | undefined } | null | undefined): boolean {
  return eu?.deve_trocar_senha === true && eu.motivo_troca === 'temporaria';
}

export type CampoLogin = 'email' | 'senha';
export type ErrosLogin = Partial<Record<CampoLogin, string>>;
export type DadosLogin = Partial<Record<CampoLogin, string>>;

function erroDoEmail(valor: string): string | undefined {
  if (!valor.trim()) return TEXTOS_LOGIN.obrigatorio.email;
  return EmailUsuario.safeParse(valor).success ? undefined : TEXTOS_LOGIN.emailInvalido;
}

/** Erros por campo, na ordem da tela (a API revalida). Em `campos` só entram os campos pedidos. */
export function validarCampos(campos: readonly CampoLogin[], dados: DadosLogin): ErrosLogin {
  const erros: ErrosLogin = {};
  for (const c of campos) {
    const v = dados[c] ?? '';
    const e = c === 'email' ? erroDoEmail(v) : v === '' ? TEXTOS_LOGIN.obrigatorio.senha : undefined;
    if (e) erros[c] = e;
  }
  return erros;
}

/** Primeiro campo vazio (ou o primeiro, se todos preenchidos): onde o foco abre. */
export function primeiroVazio<C extends CampoLogin>(campos: readonly C[], dados: DadosLogin): C | undefined {
  return campos.find((c) => !(dados[c] ?? '').trim()) ?? campos[0];
}

/** `campos` do 400 VALIDACAO da API, só os que a tela conhece. */
export function camposDoEnvelope(campos: unknown): ErrosLogin {
  const saida: ErrosLogin = {};
  if (campos && typeof campos === 'object') {
    for (const c of ['email', 'senha'] as const) {
      const v = (campos as Record<string, unknown>)[c];
      if (typeof v === 'string' && v.trim()) saida[c] = v.trim();
    }
  }
  return saida;
}

/** Falha da API tratada igual nos dois fluxos (login e esqueci): 429 com `retry_after_s` ou 400 VALIDACAO por campo. Outro status ou corpo estranho = `null`. */
export type ErroDaApi = { tipo: 'limite'; retry_after_s: number } | { tipo: 'campos'; erros: ErrosLogin };

export function erroDaApi(status: number, corpo: unknown): ErroDaApi | null {
  if (status === 429) {
    const p = MuitasTentativasResposta.safeParse(corpo);
    return p.success ? { tipo: 'limite', retry_after_s: p.data.detalhes.retry_after_s } : null;
  }
  if (status === 400) {
    const erros = camposDoEnvelope((corpo as { campos?: unknown } | null)?.campos);
    return Object.keys(erros).length ? { tipo: 'campos', erros } : null;
  }
  return null;
}

type SchemaSdk<T> = { safeParse(d: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } } };

/** Validação única: o parse do SDK decide; os campos que ele recusa ganham o texto da tela (a API revalida). */
export function validarComSdk<T>(schema: SchemaSdk<T>, campos: readonly CampoLogin[], dados: DadosLogin): { ok: true; dados: T } | { ok: false; erros: ErrosLogin } {
  const p = schema.safeParse(dados);
  if (p.success) return { ok: true, dados: p.data };
  const recusados = campos.filter((c) => p.error.issues.some((i) => i.path[0] === c));
  const erros = validarCampos(recusados, dados);
  const primeiro = recusados[0];
  if (!Object.keys(erros).length && primeiro) erros[primeiro] = TEXTOS_LOGIN.obrigatorio[primeiro];
  return { ok: false, erros };
}
