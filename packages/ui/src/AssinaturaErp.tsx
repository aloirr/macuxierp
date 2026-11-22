import { paraDataUri, assinaturaANegativoAzulNoite } from './marca.js';

export interface AssinaturaErpProps {
  /** Altura em px; fica entre 20 e 32 (assinatura-erp §4). Padrão: 24. */
  altura?: number;
}

/** Altura válida da assinatura: de 20 a 32 px. */
export const alturaAssinatura = (h: number): number => Math.min(32, Math.max(20, h));

/** Assinatura "Macuxi ERP" (versão A, negativa) para o topo azul-noite do shell. */
export function AssinaturaErp({ altura = 24 }: AssinaturaErpProps) {
  const h = alturaAssinatura(altura);
  return <img src={paraDataUri(assinaturaANegativoAzulNoite)} alt="Macuxi ERP" height={h} style={{ display: 'block', height: h, width: 'auto' }} />;
}
