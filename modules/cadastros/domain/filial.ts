import type { FilialDados, RegimePisCofins } from '../contracts';
import { validarIe } from './ie';
import { validarMunicipio } from './municipio';
import { violacao, type Violacao } from './violacao';

export interface FatosFilial {
  uf: string;
  municipio_ibge: string;
  ie: string | null;
  emissora: boolean;
  nfe_serie: number | null;
  nfe_numero_inicial: number | null;
  /** Ausente = não avaliar (chamadores que não têm o dado). */
  crt?: FilialDados['crt'];
  regime_pis_cofins?: RegimePisCofins | null;
}

/**
 * RF-CAD-08: município e UF coerentes (RN-CAD-03), IE pela UF (RN-CAD-02; a filial é contribuinte, então "ISENTO" não vale)
 * e a configuração inicial da NF-e (D8): série e número inicial juntos, obrigatórios na filial emissora. A numeração
 * corrente é do faturamento (RN-FAT-01), não daqui.
 */
export function validarFilial(f: FatosFilial): Violacao[] {
  const v: Violacao[] = [];
  const m = validarMunicipio(f.municipio_ibge, f.uf);
  if (!m.ok) v.push(m.violacao);
  if (f.ie !== null && f.ie.trim() !== '') {
    const r = validarIe(f.uf, f.ie);
    if (!r.ok) v.push(r.violacao);
    else if (r.ie === 'ISENTO') v.push(violacao('RN-CAD-02', 'ie', 'Filial emissora de NF-e não pode ser isenta de IE'));
  }
  if (f.nfe_serie === null && f.nfe_numero_inicial !== null) v.push(violacao('D8', 'nfe_serie', 'Informe a série junto do número inicial'));
  if (f.nfe_serie !== null && f.nfe_numero_inicial === null) v.push(violacao('D8', 'nfe_numero_inicial', 'Informe o número inicial junto da série'));
  if (f.emissora && f.nfe_serie === null && f.nfe_numero_inicial === null) v.push(violacao('D8', 'nfe_serie', 'Filial emissora precisa de série e número inicial da NF-e'));
  // RN-FIS-02: o regime de PIS/COFINS só existe no regime normal (CRT 3); nos demais, o cálculo não o usa e o dado ficaria enganoso.
  // Violação (não normalização silenciosa), como as demais regras da filial: quem digitou vê o motivo. Exigir no CRT 3 é do fiscal.
  if (f.regime_pis_cofins != null && f.crt !== undefined && f.crt !== '3') {
    v.push(violacao('RN-FIS-02', 'regime_pis_cofins', 'Regime de PIS/COFINS só vale para filial de CRT 3 (regime normal)'));
  }
  return v;
}

/** RN-CAD-08: cadastro é inativado (`deleted_at`), nunca apagado; a padrão precisa ser trocada antes. */
export function bloqueiosDeInativacao(entidade: 'filial' | 'tabela_preco' | 'cliente' | 'produto' | 'condicao_pagamento' | 'vendedor', f: { padrao: boolean }): Violacao[] {
  if ((entidade === 'filial' || entidade === 'tabela_preco') && f.padrao) {
    return [violacao('RN-CAD-08', 'padrao', 'A padrão não pode ser inativada: defina outra como padrão antes')];
  }
  return [];
}
