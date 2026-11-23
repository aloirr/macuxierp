import { violacao, type Violacao } from './violacao';

/** O que a API apurou nas tabelas oficiais (`cadastros.ncm`, `cest`, `cest_ncm`) para a data da validação. */
export interface FatosFiscaisProduto {
  ncm: string;
  cest: string | null;
  ncmVigente: boolean;
  /** O NCM está em segmento com substituição tributária (tem CEST vigente em `cest_ncm`). */
  ncmExigeCest: boolean;
  cestVigente: boolean;
  cestCombinaComNcm: boolean;
}

/** NCM no formato 0000.00.00 (só formata quando tem 8 dígitos). */
export const formatarNcm = (ncm: string): string => (/^\d{8}$/.test(ncm) ? `${ncm.slice(0, 4)}.${ncm.slice(4, 6)}.${ncm.slice(6)}` : ncm);

/** RN-CAD-04: NCM existente e vigente; CEST obrigatório quando o NCM tem ST; CEST informado vigente e do NCM. Formato A0: o código e a ação. */
export function validarFiscalProduto(f: FatosFiscaisProduto): Violacao[] {
  const v: Violacao[] = [];
  const ncm = formatarNcm(f.ncm);
  if (!f.ncmVigente) v.push(violacao('RN-CAD-04', 'ncm', `NCM ${ncm} não existe ou não está vigente: confira a coluna ncm.`));
  if (f.cest === null) {
    if (f.ncmVigente && f.ncmExigeCest) v.push(violacao('RN-CAD-04', 'cest', `O NCM ${ncm} exige CEST: preencha a coluna cest.`));
  } else if (!f.cestVigente) {
    v.push(violacao('RN-CAD-04', 'cest', `CEST ${f.cest} não existe ou não está vigente: confira a coluna cest.`));
  } else if (!f.cestCombinaComNcm) {
    v.push(violacao('RN-CAD-04', 'cest', `O CEST ${f.cest} não pertence ao NCM ${ncm}: confira as colunas ncm e cest.`));
  }
  return v;
}
