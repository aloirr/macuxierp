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

/** RN-CAD-04: NCM existente e vigente; CEST obrigatório quando o NCM tem ST; CEST informado vigente e do NCM. */
export function validarFiscalProduto(f: FatosFiscaisProduto): Violacao[] {
  const v: Violacao[] = [];
  if (!f.ncmVigente) v.push(violacao('RN-CAD-04', 'ncm', `NCM ${f.ncm} não existe ou não está vigente na tabela carregada`));
  if (f.cest === null) {
    if (f.ncmVigente && f.ncmExigeCest) v.push(violacao('RN-CAD-04', 'cest', 'CEST obrigatório: o NCM está em segmento com substituição tributária'));
  } else if (!f.cestVigente) {
    v.push(violacao('RN-CAD-04', 'cest', `CEST ${f.cest} não existe ou não está vigente`));
  } else if (!f.cestCombinaComNcm) {
    v.push(violacao('RN-CAD-04', 'cest', `CEST ${f.cest} não pertence ao NCM ${f.ncm}`));
  }
  return v;
}
