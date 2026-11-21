import { violacao, type Violacao } from './violacao';

const so = (s: string) => s.replace(/[.\-/\s]/g, '').toUpperCase();

function dvAm(base: string): number {
  const soma = [...base].reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  if (soma < 11) return 11 - soma;
  const r = soma % 11;
  return r <= 1 ? 0 : 11 - r;
}

function dvSp(digs: string, pesos: readonly number[]): number {
  return ([...digs].reduce((acc, d, i) => acc + Number(d) * (pesos[i] ?? 0), 0) % 11) % 10;
}

/** Algoritmos por UF implementados aqui; as demais passam pela checagem de formato e pela SEFAZ (RF-CAD-03). */
const ALGORITMOS: Record<string, (ie: string) => boolean> = {
  AM: (ie) => /^\d{9}$/.test(ie) && dvAm(ie.slice(0, 8)) === Number(ie[8]),
  SP: (ie) =>
    /^\d{12}$/.test(ie) &&
    dvSp(ie.slice(0, 8), [1, 3, 4, 5, 6, 7, 8, 10]) === Number(ie[8]) &&
    dvSp(ie.slice(0, 11), [3, 2, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[11]),
};

export type ResultadoIe = { ok: true; ie: string } | { ok: false; violacao: Violacao };

/** RN-CAD-02: IE validada pela regra da UF. "ISENTO" é aceito como texto fixo (quem o aceita é `validarIndIeDest`). */
export function validarIe(uf: string, valor: string): ResultadoIe {
  const ie = so(valor);
  if (ie === 'ISENTO') return { ok: true, ie };
  const algoritmo = ALGORITMOS[uf];
  const ok = algoritmo ? algoritmo(ie) : /^\d{2,14}$/.test(ie);
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
