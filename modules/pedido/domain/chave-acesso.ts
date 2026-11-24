/**
 * DV da chave de acesso da NF-e (44 dígitos, módulo 11 com pesos 2 a 9 da direita para a esquerda; resto 0 ou 1 dá DV 0).
 * Mesma conta de `chaveNFeComDvValido` (`packages/nfe-sefaz/src/chave.ts`): cópia mínima só dos dígitos numéricos, porque o pedido
 * não depende do pacote da SEFAZ (puxa XML e certificado) e o lockfile é do engenheiro-software. Pendente: reaproveitar
 * quando o pacote expuser uma entrada pura (ver recado ao engenheiro-software).
 */
export function chaveAcessoValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(chave[43]);
}
