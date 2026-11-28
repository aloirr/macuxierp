/**
 * ADR 0021: o login não pede mais o código da empresa. Versões antigas guardaram o código em `localStorage` (`mx.codigo_empresa`);
 * a chave é lida uma vez, removida e nunca mais usada. Devolve o que havia (ou null) só para o teste; nada é gravado nem enviado.
 */
export const CHAVE_CODIGO_ANTIGA = 'mx.codigo_empresa';

export function limparCodigoAntigo(armazenamento: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string | null {
  try {
    if (!armazenamento) return null;
    const antigo = armazenamento.getItem(CHAVE_CODIGO_ANTIGA);
    if (antigo !== null) armazenamento.removeItem(CHAVE_CODIGO_ANTIGA);
    return antigo;
  } catch {
    return null; // armazenamento bloqueado pelo navegador: nada a limpar
  }
}
