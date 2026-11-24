import { CodigoEmpresaLogin } from '@macuxierp/platform-sdk';

/**
 * Única memória do navegador na tela de login (docs/design/login-unico): o código da empresa, como preferência local.
 * E-mail e senha nunca são guardados; nenhum outro armazenamento nem a URL levam dado do login.
 */
export const CHAVE_CODIGO_EMPRESA = 'mx.codigo_empresa';

type Armazem = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function padrao(): Armazem | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // armazenamento bloqueado pelo navegador
  }
}

export function lerCodigoSalvo(armazem: Armazem | undefined = padrao()): string | undefined {
  try {
    const p = CodigoEmpresaLogin.safeParse(armazem?.getItem(CHAVE_CODIGO_EMPRESA) ?? '');
    return p.success ? p.data : undefined;
  } catch {
    return undefined;
  }
}

/** Grava o código já normalizado; valor inválido não grava. */
function gravarCodigoSalvo(codigo: string, armazem: Armazem | undefined = padrao()): void {
  const p = CodigoEmpresaLogin.safeParse(codigo);
  if (!p.success) return;
  try {
    armazem?.setItem(CHAVE_CODIGO_EMPRESA, p.data);
  } catch {
    /* sem armazenamento: o código só não é lembrado */
  }
}

/** Apaga o código lembrado. */
function apagarCodigoSalvo(armazem: Armazem | undefined = padrao()): void {
  try {
    armazem?.removeItem(CHAVE_CODIGO_EMPRESA);
  } catch {
    /* sem armazenamento: nada a apagar */
  }
}

/**
 * Única porta de gravação. Com destino `bko` grava o código; com destino `config` (acesso reservado da plataforma)
 * apaga o que estava salvo, para a próxima visita não sugerir empresa. O web decide só pelo `destino` da resposta
 * da API.
 */
export function gravarCodigoDoLogin(destino: 'bko' | 'config', codigo: string, armazem: Armazem | undefined = padrao()): void {
  if (destino === 'bko') gravarCodigoSalvo(codigo, armazem);
  else apagarCodigoSalvo(armazem);
}
