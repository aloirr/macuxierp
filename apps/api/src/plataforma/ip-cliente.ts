/**
 * IP do cliente para o limite de login por IP (T-0050, ADR 0012 §6). Atrás do túnel do Cloudflare (ADR 0003, itens 5 e
 * 35) e do BFF da apps/web, o `req.ip` é de um contêiner e o limite viraria global. "Confiar na rede interna" não serve:
 * o cloudflared está na rede do túnel. Ordem:
 *   1. `CABECALHO_PROVA_BFF` igual ao `MACUXIERP_SEGREDO_BFF` (tempo constante) e `CABECALHO_IP_CLIENTE` com IP válido;
 *   2. `cf-connecting-ip` com IP válido (o Cloudflare sobrescreve na borda);
 *   3. `req.ip` (comportamento anterior: sem os cabeçalhos, nada muda).
 * Segredo ausente = nunca confia no item 1. Função pura; nem o segredo nem o IP vão para log.
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { CABECALHO_IP_CLIENTE, CABECALHO_PROVA_BFF } from '@macuxierp/platform-sdk';

export interface PedidoComIp {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Um valor só (cabeçalho repetido chega como lista e é recusado). */
function unico(v: string | string[] | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

function ipValido(v: string | string[] | undefined): string | null {
  const s = unico(v)?.trim();
  return s && isIP(s) !== 0 ? s : null;
}

function provaConfere(prova: string | null, segredo: string): boolean {
  if (prova === null) return false;
  const a = Buffer.from(prova, 'utf8');
  const b = Buffer.from(segredo, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function ipDoCliente(req: PedidoComIp, segredo: string | null): string {
  if (segredo && provaConfere(unico(req.headers[CABECALHO_PROVA_BFF]), segredo)) {
    const doBff = ipValido(req.headers[CABECALHO_IP_CLIENTE]);
    if (doBff) return doBff;
  }
  return ipValido(req.headers['cf-connecting-ip']) ?? req.ip;
}
