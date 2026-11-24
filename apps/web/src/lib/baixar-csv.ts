/** Marca de ordem de bytes UTF-8: o Excel só abre CSV com acento certo com ela. */
const BOM = String.fromCharCode(0xfeff);

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

/** Baixa um texto como CSV (UTF-8 com BOM, para o Excel). Só no navegador. */
export function baixarCsv(nome: string, texto: string): void {
  salvarCsv(BOM + texto, nome);
}
