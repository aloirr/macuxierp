import { ieComDvValido } from '@macuxierp/platform-sdk';
import { violacao, type Violacao } from './violacao';

const so = (s: string) => s.replace(/[.\-/\s]/g, '').toUpperCase();

export type ResultadoIe = { ok: true; ie: string } | { ok: false; violacao: Violacao };

/** RN-CAD-02: IE validada pela regra da UF. "ISENTO" é aceito como texto fixo (quem o aceita é `validarIndIeDest`). */
export function validarIe(uf: string, valor: string): ResultadoIe {
  const ie = so(valor);
  if (ie === 'ISENTO') return { ok: true, ie };
  const dv = ieComDvValido(uf, ie);
  const ok = dv ?? /^\d{2,14}$/.test(ie);
  return ok ? { ok: true, ie } : { ok: false, violacao: violacao('RN-CAD-02', 'ie', `IE inválida para a UF ${uf}`) };
}

export type IndIeDest = '1' | '2' | '9';

/** RN-CAD-02: 1 = contribuinte com IE válida; 2 = isento ("ISENTO" ou sem IE); 9 = não contribuinte, sem IE. */
export function validarIndIeDest(p: { ind_ie_dest: IndIeDest; ie: string | null; uf: string }): { ok: true } | { ok: false; violacao: Violacao } {
  const erro = (m: string) => ({ ok: false as const, violacao: violacao('RN-CAD-02', 'ie', m) });
  const ie = p.ie === null || p.ie.trim() === '' ? null : so(p.ie);
  if (p.ind_ie_dest === '1') {
    if (ie === null || ie === 'ISENTO') return erro('Contribuinte precisa de IE com número válido');
    const r = validarIe(p.uf, ie);
    return r.ok ? { ok: true } : { ok: false, violacao: r.violacao };
  }
  if (p.ind_ie_dest === '2') return ie === null || ie === 'ISENTO' ? { ok: true } : erro('Isento não leva número de IE');
  return ie === null ? { ok: true } : erro('Não contribuinte não leva IE (indIEDest 9)');
}

/** RN-CAD-02: o indicador que a tela sugere a partir da IE digitada. */
export function sugerirIndIeDest(ie: string | null): IndIeDest {
  if (ie === null || ie.trim() === '') return '9';
  return so(ie) === 'ISENTO' ? '2' : '1';
}
