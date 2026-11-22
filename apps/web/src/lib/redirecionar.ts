import { NextResponse } from 'next/server';
import { destinoSeguro } from './sessao';

/**
 * Redirecionamento com `Location` RELATIVO (RFC 7231 §7.1.2). Atrás do túnel (cloudflared → contêiner, Next standalone) o `req.url`
 * traz o host e a porta internos; montar URL absoluta com ele manda o navegador a um endereço inexistente (ERR_FAILED, T-0021).
 * Só caminho interno: o que não for "/x" (inclusive "//" e "/\") cai em "/". Os cookies entram na resposta devolvida.
 */
export function redirecionar(caminho: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: destinoSeguro(caminho) } });
}
