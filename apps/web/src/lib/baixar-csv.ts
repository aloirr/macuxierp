/** Salva um CSV (texto ou o Blob devolvido pelo portal) com o nome dado. Só no navegador. */
export function salvarCsv(dados: Blob | string, nome: string): void {
  const blob = typeof dados === 'string' ? new Blob([dados], { type: 'text/csv;charset=utf-8' }) : dados;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
