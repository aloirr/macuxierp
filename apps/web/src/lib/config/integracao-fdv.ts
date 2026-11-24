/**
 * Aba Integração do /config (T-0056, ADR 0013), parte pura: linhas dos cadastros, lista de habilitados depois de ligar ou
 * desligar e os textos de confirmação. Nada aqui toca a chave do conector (ela nem chega à tela depois de salva).
 */
import { ROTULO_AMBIENTE } from '@macuxierp/integracao-fdv/web';
import { ConfigurarIntegracaoPlataformaEntrada, ENTIDADES_ENVIO_FDV, LIMITE_REGISTROS_LOTE_FDV, MOTIVOS_PAUSA_FDV, type EntidadeEnvioFdv, type IntegracaoFdvPlataforma } from '@macuxierp/platform-sdk';
import { acaoNoPortal } from '../integracao-fdv-textos';
import { linhaBaseFdv, type LinhaBaseFdv } from '../integracao-fdv';

/** Valor inicial do campo "Registros por lote" quando a empresa ainda não tem configuração: o teto do SDK (ADR 0013, §10). */
export const LIMITE_INICIAL_FDV = LIMITE_REGISTROS_LOTE_FDV;

/** Valida o texto do campo com o mesmo schema do SDK. Pura: devolve o número ou a mensagem do campo. */
export function validarLimiteLote(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const t = texto.trim();
  const r = ConfigurarIntegracaoPlataformaEntrada.shape.limite_registros_lote.safeParse(/^\d+$/.test(t) ? Number(t) : Number.NaN);
  return r.success ? { ok: true, valor: r.data } : { ok: false, erro: `Informe um número inteiro de 1 a ${LIMITE_REGISTROS_LOTE_FDV}.` };
}

export interface LinhaCadastroFdv extends LinhaBaseFdv {
  /** O conector parou este cadastro (pausa): "Tentar de novo" faz sentido. */
  pausada: boolean;
  /** Há lote em voo: o Reprocessar fica visível e desligado com "Enviando…" (T-0086). */
  loteEmVoo: boolean;
}

export function linhasCadastros(d: IntegracaoFdvPlataforma, fuso: string): LinhaCadastroFdv[] {
  return d.cadastros.map((c) => ({
    ...linhaBaseFdv(c, fuso, acaoNoPortal),
    pausada: c.falha !== null && (MOTIVOS_PAUSA_FDV as readonly string[]).includes(c.falha.motivo),
    loteEmVoo: c.lote_em_voo,
  }));
}

/** Lista de habilitados depois de ligar ou desligar um cadastro, sempre na ordem de carga (RN-INF-02). */
export function habilitadasApos(atual: readonly string[], entidade: EntidadeEnvioFdv, ligar: boolean): EntidadeEnvioFdv[] {
  const s = new Set(atual);
  if (ligar) s.add(entidade);
  else s.delete(entidade);
  return ENTIDADES_ENVIO_FDV.filter((e) => s.has(e));
}

export const AMBIENTES_FDV = Object.entries(ROTULO_AMBIENTE) as [string, string][];

export const avisoLigar = (ligar: boolean) => (ligar ? 'O conector passa a enviar este cadastro.' : 'O conector para de enviar este cadastro.');
export const avisoCarga = 'Envia tudo de uma vez: pode demorar e inativar cadastros no FDV.';

/** Cadastro da aba Dados -> entidades do conector que a carga completa reenvia (condição de pagamento junta forma e prazo; cliente absorve o endereço). */
const ENTIDADES_DA_CARGA: Record<string, readonly EntidadeEnvioFdv[]> = {
  condicao_pagamento: ['forma_pagamento', 'prazo_pagamento'],
  cliente: ['cliente', 'cliente_endereco'],
};
export const entidadesDaCarga = (cadastro: string): EntidadeEnvioFdv[] => {
  const m = ENTIDADES_DA_CARGA[cadastro];
  if (m) return [...m];
  return (ENTIDADES_ENVIO_FDV as readonly string[]).includes(cadastro) ? [cadastro as EntidadeEnvioFdv] : [];
};

export interface EstadoCargaCompleta {
  /** Mostra o botão: há integração lida, o cadastro tem entidade e todas estão ligadas (o domain recusa o resto). */
  visivel: boolean;
  /** Há lote em voo em alguma entidade: o botão fica desligado com "Enviando…". */
  loteEmVoo: boolean;
  entidades: EntidadeEnvioFdv[];
}
export function estadoCargaCompleta(cadastro: string, d: IntegracaoFdvPlataforma | null): EstadoCargaCompleta {
  const entidades = entidadesDaCarga(cadastro);
  if (!d || !d.modulo_licenciado || entidades.length === 0) return { visivel: false, loteEmVoo: false, entidades };
  const cs = entidades.map((e) => d.cadastros.find((c) => c.entidade === e));
  const visivel = cs.every((c) => c?.ligada === true);
  return { visivel, loteEmVoo: visivel && cs.some((c) => c?.lote_em_voo === true), entidades };
}
/** Texto do botão de uma operação de envio (Reprocessar, Carga completa): "Enviando…" enquanto há lote em voo. */
export const rotuloComLote = (loteEmVoo: boolean, rotulo: string): string => (loteEmVoo ? 'Enviando…' : rotulo);
