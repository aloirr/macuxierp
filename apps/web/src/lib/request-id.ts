/**
 * Código do pedido (`request_id`) do 5xx para a tela de "indisponível": o suporte acha o pedido no log pelo código.
 * Todo 5xx do ErroApi traz `{ codigo, mensagem, request_id }`; sem corpo usa o cabeçalho `x-request-id`; sem nenhum, não há código.
 * Só um identificador curto passa (nada de texto livre da API na tela, LGPD).
 */
const FORMATO = /^[A-Za-z0-9._:-]{1,64}$/;

const valido = (v: unknown): string | undefined => (typeof v === 'string' && FORMATO.test(v) ? v : undefined);

export async function idDaRequisicao(r: Response): Promise<string | undefined> {
  if (r.status < 500) return undefined;
  let doCorpo: unknown;
  try {
    doCorpo = ((await r.clone().json()) as { request_id?: unknown } | null)?.request_id;
  } catch {
    /* sem corpo JSON: segue para o cabeçalho */
  }
  return valido(doCorpo) ?? valido(r.headers.get('x-request-id'));
}

/** Rótulo validado pela marca; o id vem depois, em `<code>`. */
export const ROTULO_CODIGO_SUPORTE = 'Código para o suporte:';
