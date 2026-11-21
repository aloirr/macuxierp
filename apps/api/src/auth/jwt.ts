/**
 * JWT de acesso (HS256, 15 min; doc 04 e desenho T-0002, seção 2) com `node:crypto`, sem dependência. Só o essencial:
 * cabeçalho fixo, assinatura em tempo constante e `exp`. O segredo vem do `.env` do servidor (MACUXIERP_JWT_SEGREDO).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PERFIS, type Sessao } from '@macuxierp/platform-sdk';
import { z } from 'zod';

const CABECALHO = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const Claims = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  perfil: z.enum(PERFIS),
  fil: z.array(z.string().uuid()),
  iat: z.number().int(),
  exp: z.number().int(),
});

const assinar = (dados: string, segredo: string) => createHmac('sha256', segredo).update(dados).digest('base64url');

export function emitirTokenAcesso(sessao: Sessao, segredo: string, agora: Date, segundos: number): { token: string; expira_em: Date } {
  const iat = Math.floor(agora.getTime() / 1000);
  const claims = { sub: sessao.usuario_id, tid: sessao.tenant_id, perfil: sessao.perfil, fil: [...sessao.filial_ids], iat, exp: iat + segundos };
  const corpo = `${CABECALHO}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return { token: `${corpo}.${assinar(corpo, segredo)}`, expira_em: new Date(claims.exp * 1000) };
}

/** Sessão do token, ou `null` se ausente, malformado, adulterado ou vencido. */
export function lerTokenAcesso(token: string, segredo: string, agora: Date): Sessao | null {
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== CABECALHO) return null;
  const esperada = Buffer.from(assinar(`${partes[0]}.${partes[1]}`, segredo));
  const recebida = Buffer.from(partes[2] ?? '');
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(Buffer.from(partes[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const c = Claims.safeParse(bruto);
  if (!c.success || c.data.exp * 1000 <= agora.getTime()) return null;
  return { usuario_id: c.data.sub, tenant_id: c.data.tid, perfil: c.data.perfil, filial_ids: c.data.fil };
}
