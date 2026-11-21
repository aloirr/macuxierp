import { violacao, type Violacao } from './violacao';

/** Código IBGE das UFs (2 primeiros dígitos do código do município). */
export const CODIGO_UF: Readonly<Record<string, string>> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24',
  PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42',
  RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

/** Dígito verificador do código IBGE: pesos 1,2,1,2,1,2 sobre os 6 primeiros, somando os algarismos dos produtos. */
function dvIbge(seis: string): number {
  const soma = [...seis].reduce((acc, d, i) => {
    const p = Number(d) * (i % 2 === 0 ? 1 : 2);
    return acc + Math.floor(p / 10) + (p % 10);
  }, 0);
  return (10 - (soma % 10)) % 10;
}

/** RN-CAD-03: município sempre pelo IBGE de 7 dígitos (com dígito verificador), coerente com a UF. */
export function validarMunicipio(ibge: string, uf: string): { ok: true } | { ok: false; violacao: Violacao } {
  const erro = (m: string) => ({ ok: false as const, violacao: violacao('RN-CAD-03', 'municipio_ibge', m) });
  if (!/^\d{7}$/.test(ibge)) return erro('Município deve ser o código IBGE de 7 dígitos');
  const codigoUf = CODIGO_UF[uf];
  if (!codigoUf) return erro(`UF ${uf} desconhecida`);
  if (!ibge.startsWith(codigoUf)) return erro(`Município ${ibge} não pertence à UF ${uf}`);
  if (dvIbge(ibge.slice(0, 6)) !== Number(ibge[6])) return erro('Código IBGE com dígito verificador inválido');
  return { ok: true };
}
