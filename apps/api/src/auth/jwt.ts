/**
 * JWT de acesso (HS256, 15 min; doc 04 e desenho T-0002, seção 2) com `node:crypto`, sem dependência. Só o essencial:
 * cabeçalho fixo, assinatura em tempo constante e `exp`. O segredo vem do `.env` do servidor (MACUXIERP_JWT_SEGREDO).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PERFIS, type Sessao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import type { TrocaPendente } from './troca-senha';

const CABECALHO = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const Claims = z.object({
  sub: z.string().uuid(),
  tid: z.string().uuid(),
  perfil: z.enum(PERFIS),
  fil: z.array(z.string().uuid()),
  iat: z.number().int(),
  exp: z.number().int(),
  /** Senha provisória (T-0052): só presente quando ligada; o guard da troca de senha lê daqui. */
  dts: z.literal(true).optional(),
  /** Motivo da troca (T-0076): 'temporaria' = sessão aberta pela senha temporária; a troca dispensa a senha atual. */
  mtv: z.literal('temporaria').optional(),
  /** Fim das 72 h da temporária consumida (T-0076, segundos UTC): o `expira_em` do 403 `TROCAR_SENHA`. Só com `mtv`. */
  tex: z.number().int().optional(),
});

/** Sessão do JWT de acesso do tenant: a `Sessao` do SDK e, só quando ligada, a troca obrigatória da senha (T-0052, T-0076). */
export type SessaoAcesso = Sessao & { deve_trocar_senha?: true } & TrocaPendente;

const assinar = (dados: string, segredo: string) => createHmac('sha256', segredo).update(dados).digest('base64url');

export function emitirTokenAcesso(sessao: SessaoAcesso, segredo: string, agora: Date, segundos: number): { token: string; expira_em: Date } {
  const iat = Math.floor(agora.getTime() / 1000);
  const temporaria =
    sessao.deve_trocar_senha && sessao.motivo_troca
      ? { mtv: sessao.motivo_troca, ...(sessao.temporaria_expira_em ? { tex: Math.floor(sessao.temporaria_expira_em.getTime() / 1000) } : {}) }
      : {};
  const claims = { sub: sessao.usuario_id, tid: sessao.tenant_id, perfil: sessao.perfil, fil: [...sessao.filial_ids], iat, exp: iat + segundos, ...(sessao.deve_trocar_senha ? { dts: true } : {}), ...temporaria };
  const corpo = `${CABECALHO}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return { token: `${corpo}.${assinar(corpo, segredo)}`, expira_em: new Date(claims.exp * 1000) };
}

/** Sessão do token, ou `null` se ausente, malformado, adulterado ou vencido. */
export function lerTokenAcesso(token: string, segredo: string, agora: Date): SessaoAcesso | null {
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
  const sessao: Sessao = { usuario_id: c.data.sub, tenant_id: c.data.tid, perfil: c.data.perfil, filial_ids: c.data.fil };
  if (!c.data.dts) return sessao;
  if (!c.data.mtv) return { ...sessao, deve_trocar_senha: true };
  return { ...sessao, deve_trocar_senha: true, motivo_troca: c.data.mtv, ...(c.data.tex !== undefined ? { temporaria_expira_em: new Date(c.data.tex * 1000) } : {}) };
}
