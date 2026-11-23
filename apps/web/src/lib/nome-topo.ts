/** Normaliza para comparar nomes: espaços aparados e colapsados, sem diferença de caixa (acento conta). */
const normalizar = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/** Nome do topo do BKO: um só quando empresa e filial têm o mesmo nome (MEI), senão "empresa · filial". */
export function nomeDoTopo(empresa: string, filial: string): string {
  return normalizar(empresa) === normalizar(filial) ? empresa.trim().replace(/\s+/g, ' ') : `${empresa} · ${filial}`;
}
