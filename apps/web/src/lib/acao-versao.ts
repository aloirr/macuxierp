import { ehAcaoAusente } from './sistema-atualizado';

/**
 * Chamada única de Server Action no cliente (v0.3.26, R-20261127-172927). Uma aba aberta de um build anterior chama uma action
 * que o servidor novo não conhece: o Next responde com o cabeçalho `x-nextjs-action-not-found: 1` e o cliente lança
 * `UnrecognizedActionError` (ver `ehAcaoAusente`). Aqui isso NÃO é "Serviço indisponível" (erro de rede/API segue como estava):
 *  1. primeira vez: guarda só empresa e e-mail (a SENHA NUNCA), põe a trava e recarrega a página sozinho;
 *  2. de novo com a trava posta (laço evitado): mostra o aviso "Há uma versão nova do Macuxi ERP" com o botão Recarregar.
 * A trava vale poucos minutos e some na primeira action que dá certo.
 */
export const BUILD_CLIENTE = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
export const CHAVE_TRAVA_VERSAO = 'mx.versao_nova';
export const CHAVE_RASCUNHO_LOGIN = 'mx.login_rascunho';
export const EVENTO_VERSAO_NOVA = 'mx:versao-nova';
export const VALIDADE_TRAVA_MS = 2 * 60_000;

export interface Rascunho { empresa: string; email: string }
type Armazem = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Ambiente {
  armazem: Armazem | undefined;
  recarregar: () => void;
  avisar: () => void;
  agora: () => number;
  build: string;
}

function armazemPadrao(): Armazem | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function ambientePadrao(): Ambiente {
  return {
    armazem: armazemPadrao(),
    recarregar: () => window.location.reload(),
    avisar: () => window.dispatchEvent(new CustomEvent(EVENTO_VERSAO_NOVA)),
    agora: () => Date.now(),
    build: BUILD_CLIENTE,
  };
}

/** Guarda só empresa e e-mail (qualquer outro campo, como a senha, é descartado aqui) para depois da recarga. */
export function guardarRascunho(r: Rascunho, armazem: Armazem | undefined = armazemPadrao()): void {
  try {
    armazem?.setItem(CHAVE_RASCUNHO_LOGIN, JSON.stringify({ empresa: String(r.empresa ?? ''), email: String(r.email ?? '') }));
  } catch {
    /* armazenamento bloqueado: segue sem rascunho */
  }
}

/** Lê e APAGA o rascunho (uma leitura só). */
export function lerRascunho(armazem: Armazem | undefined = armazemPadrao()): Rascunho | undefined {
  try {
    const bruto = armazem?.getItem(CHAVE_RASCUNHO_LOGIN);
    armazem?.removeItem(CHAVE_RASCUNHO_LOGIN);
    if (!bruto) return undefined;
    const o = JSON.parse(bruto) as { empresa?: unknown; email?: unknown };
    return { empresa: typeof o.empresa === 'string' ? o.empresa : '', email: typeof o.email === 'string' ? o.email : '' };
  } catch {
    return undefined;
  }
}

function travaPosta(a: Ambiente): boolean {
  try {
    const t = JSON.parse(a.armazem?.getItem(CHAVE_TRAVA_VERSAO) ?? 'null') as { em?: unknown } | null;
    return typeof t?.em === 'number' && a.agora() - t.em < VALIDADE_TRAVA_MS;
  } catch {
    return false;
  }
}

/** Versão nova detectada: recarrega uma vez (`'recarregando'`) ou, com a trava posta, pede o aviso (`'aviso'`). */
export function tratarVersaoNova(rascunho: Rascunho | undefined, a: Ambiente = ambientePadrao()): 'recarregando' | 'aviso' {
  if (travaPosta(a)) {
    a.avisar();
    return 'aviso';
  }
  try {
    a.armazem?.setItem(CHAVE_TRAVA_VERSAO, JSON.stringify({ de: a.build, em: a.agora() }));
  } catch {
    a.avisar(); // sem como travar, recarregar poderia dar laço: avisa
    return 'aviso';
  }
  if (rascunho) guardarRascunho(rascunho, a.armazem);
  a.recarregar();
  return 'recarregando';
}

/** Erro lançado (só com `lancar`) depois que o aviso já foi pedido; quem chama usa para soltar o estado "enviando". */
export class ErroVersaoNova extends Error {
  constructor() {
    super('Server action not found: há uma versão nova do Macuxi ERP.');
    this.name = 'ErroVersaoNova';
  }
}

export interface OpcoesAcao {
  /** Empresa e e-mail a guardar antes da recarga (só o login). */
  rascunho?: () => Rascunho;
  /** Depois do aviso, lança `ErroVersaoNova` em vez de ficar pendente (o login usa para soltar o botão). */
  lancar?: boolean;
}

/** Chama a action; versão nova vira recarga única ou aviso, outro erro segue igual. Em recarga/aviso sem `lancar` a promessa fica pendente (a página vai recarregar ou o aviso cobre a tela). */
export async function chamarAcao<A extends unknown[], R>(acao: (...args: A) => Promise<R>, args: A, opcoes: OpcoesAcao = {}, a: Ambiente = ambientePadrao()): Promise<R> {
  try {
    const r = await acao(...args);
    try { a.armazem?.removeItem(CHAVE_TRAVA_VERSAO); } catch { /* ignora */ }
    return r;
  } catch (e) {
    if (!ehAcaoAusente(e)) throw e;
    const destino = tratarVersaoNova(opcoes.rascunho?.(), a);
    if (destino === 'aviso' && opcoes.lancar) throw new ErroVersaoNova();
    return new Promise<R>(() => undefined);
  }
}

/** A mesma action, com o tratamento de versão nova. Mantém a assinatura (serve também ao `useActionState`). Recebe a action por função: a importação só é lida na chamada. */
export function comVersao<A extends unknown[], R>(obter: () => (...args: A) => Promise<R>, opcoes?: OpcoesAcao): (...args: A) => Promise<R> {
  return (...args: A) => chamarAcao(obter(), args, opcoes);
}
