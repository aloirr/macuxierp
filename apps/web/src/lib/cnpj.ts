/** 14 dígitos (formato do contrato) -> 00.000.000/0000-00, só para exibir. */
export function formatarCnpj(c: string): string {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
