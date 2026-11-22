/**
 * O A1 dos testes do emissor: o gerador do `@macuxierp/nfe-sefaz/teste` (RD-0295), com o CNPJ SÓ no SAN ICP-Brasil
 * (como as ACs emitem), aberto pelo `abrirA1` do emissor no instante fixo dos testes.
 */
import { INSTANTE_DE_TESTE, VALIDADE_DE_TESTE, gerarA1DeTeste, type A1DeTeste } from '@macuxierp/nfe-sefaz/teste';
import { abrirA1, type CertificadoA1EmMemoria } from '../certificado';

export function a1DeTesteAberto(o: Parameters<typeof gerarA1DeTeste>[0] = {}): { gerado: A1DeTeste; a1: CertificadoA1EmMemoria } {
  const gerado = gerarA1DeTeste({ ...VALIDADE_DE_TESTE, cnpjNoTitular: 'san', ...o });
  return { gerado, a1: abrirA1(gerado.pfx, gerado.senha, INSTANTE_DE_TESTE) };
}
