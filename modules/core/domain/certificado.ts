/**
 * Certificado A1 (RN-CORE-06, RF-CORE-04, ADR 0005): regras puras. A abertura do `.pfx` (que devolve CNPJ, validade e
 * titular) fica na API; aqui só se decide o que fazer com esses dados.
 */
import { cnpjRaiz } from '@macuxierp/platform-sdk';
import { DIAS_ALERTA_A1, type A1ValidoDaFilial } from '../contracts';

const MS_DIA = 86_400_000;

export type AvaliacaoCertificado =
  | { ok: true }
  | { ok: false; motivo: 'vencido' | 'ainda_nao_vale' | 'outra_raiz'; mensagem: string };

export interface DadosCertificado {
  cnpjEmpresa: string;
  cnpjCertificado: string;
  validoDe: Date;
  validoAte: Date;
  agora: Date;
  /** Fuso do tenant: a data da mensagem sai nele (RN-CORE-04). */
  fuso: string;
}

/** DD/MM/AAAA no fuso do tenant. */
function dataNoFuso(instante: Date, fuso: string): string {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(instante);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')}`;
}

export type AvaliacaoValidade =
  | { ok: true }
  | { ok: false; motivo: 'vencido' | 'ainda_nao_vale'; mensagem: string };

/** RN-CORE-06: a janela de validade do A1 (única fonte da condição e das mensagens de vencido e "ainda não vale"). */
export function avaliarValidadeA1(validoDe: Date, validoAte: Date, agora: Date, fuso: string): AvaliacaoValidade {
  if (validoAte.getTime() <= agora.getTime()) {
    return { ok: false, motivo: 'vencido', mensagem: `Certificado vencido em ${dataNoFuso(validoAte, fuso)}: envie o novo` };
  }
  if (validoDe.getTime() > agora.getTime()) {
    return { ok: false, motivo: 'ainda_nao_vale', mensagem: `Certificado só vale a partir de ${dataNoFuso(validoDe, fuso)}` };
  }
  return { ok: true };
}

/** RN-CORE-06 + D4: o A1 precisa ser da mesma raiz de CNPJ da empresa e estar na validade. */
export function avaliarCertificado(d: DadosCertificado): AvaliacaoCertificado {
  if (cnpjRaiz(d.cnpjCertificado) !== cnpjRaiz(d.cnpjEmpresa)) {
    return { ok: false, motivo: 'outra_raiz', mensagem: 'O CNPJ do certificado não é da mesma raiz do CNPJ da empresa' };
  }
  return avaliarValidadeA1(d.validoDe, d.validoAte, d.agora, d.fuso);
}

/** Dias inteiros que faltam para o vencimento (negativo = já venceu). */
export function diasParaVencer(validoAte: Date, agora: Date): number {
  return Math.floor((validoAte.getTime() - agora.getTime()) / MS_DIA);
}

/** RF-CORE-04: aviso a 30 dias ou menos de vencer, inclusive vencido. */
export function alertaVencimento(validoAte: Date, agora: Date): boolean {
  return diasParaVencer(validoAte, agora) <= DIAS_ALERTA_A1;
}

/** RN-CORE-06: veredito "a filial tem A1 válido" a partir do certificado ativo (ou `null`). Não expõe dado do certificado. */
export function avaliarA1Valido(cert: { validoDe: Date; validoAte: Date } | null, agora: Date, fuso: string): A1ValidoDaFilial {
  if (!cert) return { valido: false, motivo: 'sem_certificado', mensagem: 'A filial não tem certificado A1 ativo: envie o certificado' };
  const v = avaliarValidadeA1(cert.validoDe, cert.validoAte, agora, fuso);
  if (!v.ok) return { valido: false, motivo: v.motivo, mensagem: v.mensagem };
  return { valido: true, valido_ate: cert.validoAte.toISOString(), dias_para_vencer: diasParaVencer(cert.validoAte, agora) };
}
