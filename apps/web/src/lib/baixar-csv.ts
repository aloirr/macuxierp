/** Baixa um texto como CSV (UTF-8 com BOM, para o Excel). Só no navegador. */
export function baixarCsv(nome: string, texto: string): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
