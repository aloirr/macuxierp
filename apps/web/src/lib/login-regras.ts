import { CodigoEmpresaLogin, EmailUsuario, MuitasTentativasResposta } from '@macuxierp/platform-sdk';

/** Textos e validação por campo da tela única de login e do "esqueci a senha" (docs/design/login-unico). Pura: sem Node, serve ao cliente e ao servidor. */
export const TEXTOS_LOGIN = {
  titulo: 'Acesse sua conta',
  rotulos: { empresa: 'Código da empresa', email: 'E-mail', senha: 'Senha' },
  obrigatorio: { empresa: 'Informe o código da empresa.', email: 'Informe o e-mail.', senha: 'Informe a senha.' },
  emailInvalido: 'E-mail inválido. Confira o endereço.',
  botao: 'Entrar',
  botaoEnviando: 'Entrando…',
  /** 401 neutro: nunca diz qual campo errou, nem se a conta está travada ou a empresa suspensa. */
  credencial: 'Empresa, e-mail ou senha incorretos.',
  indisponivel: 'Serviço indisponível no momento. Tente de novo em instantes.',
} as const;

export type CampoLogin = 'empresa' | 'email' | 'senha';
export type ErrosLogin = Partial<Record<CampoLogin, string>>;
export type DadosLogin = Partial<Record<CampoLogin, string>>;

/** Código aparado e em maiúsculas (RN-CORE-11); `undefined` se não passa no `CodigoEmpresaLogin` do SDK. */
export function normalizarCodigo(valor: string): string | undefined {
  const p = CodigoEmpresaLogin.safeParse(valor);
  return p.success ? p.data : undefined;
}

function erroDoCodigo(valor: string): string | undefined {
  if (!valor.trim()) return TEXTOS_LOGIN.obrigatorio.empresa;
  const p = CodigoEmpresaLogin.safeParse(valor);
  return p.success ? undefined : (p.error.issues[0]?.message ?? TEXTOS_LOGIN.obrigatorio.empresa);
}

function erroDoEmail(valor: string): string | undefined {
  if (!valor.trim()) return TEXTOS_LOGIN.obrigatorio.email;
  return EmailUsuario.safeParse(valor).success ? undefined : TEXTOS_LOGIN.emailInvalido;
}

/** Erros por campo, na ordem da tela (a API revalida). Em `campos` só entram os campos pedidos. */
export function validarCampos(campos: readonly CampoLogin[], dados: DadosLogin): ErrosLogin {
  const erros: ErrosLogin = {};
  for (const c of campos) {
    const v = dados[c] ?? '';
    const e = c === 'empresa' ? erroDoCodigo(v) : c === 'email' ? erroDoEmail(v) : v === '' ? TEXTOS_LOGIN.obrigatorio.senha : undefined;
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
    for (const c of ['empresa', 'email', 'senha'] as const) {
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
