/**
 * Escritor mínimo de `.zip` (deflate, nomes em UTF-8, sem zip64) para a exportação LGPD (RF-CORE-06). Só `node:zlib`:
 * nenhuma dependência nova. Limite de 4 GiB por arquivo e no total (acima disso, erro: a exportação passa a ser por partes).
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface EntradaZip {
  nome: string;
  conteudo: Uint8Array;
}

const LIMITE_32 = 0xffff_ffff;

/** Data e hora no formato do DOS (o zip não tem fuso: gravamos UTC, como todo carimbo técnico). */
function dataDos(d: Date): { hora: number; data: number } {
  return {
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    data: ((Math.max(d.getUTCFullYear(), 1980) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function criarZip(entradas: readonly EntradaZip[], instante: Date): Buffer {
  const { hora, data } = dataDos(instante);
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  const nomes = new Set<string>();
  for (const e of entradas) {
    if (!e.nome || e.nome.startsWith('/') || e.nome.includes('..') || nomes.has(e.nome)) throw new RangeError(`criarZip: nome inválido ou repetido "${e.nome}"`);
    nomes.add(e.nome);
    const nome = Buffer.from(e.nome, 'utf8');
    const comprimido = deflateRawSync(e.conteudo);
    if (e.conteudo.byteLength > LIMITE_32 || deslocamento > LIMITE_32) throw new RangeError('criarZip: acima de 4 GiB (sem zip64)');
    const crc = crc32(e.conteudo);
    const comum = (b: Buffer, o: number) => {
      b.writeUInt16LE(20, o); // versão necessária
      b.writeUInt16LE(0x0800, o + 2); // nome em UTF-8
      b.writeUInt16LE(8, o + 4); // deflate
      b.writeUInt16LE(hora, o + 6);
      b.writeUInt16LE(data, o + 8);
      b.writeUInt32LE(crc, o + 10);
      b.writeUInt32LE(comprimido.byteLength, o + 14);
      b.writeUInt32LE(e.conteudo.byteLength, o + 18);
      b.writeUInt16LE(nome.byteLength, o + 22);
    };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    comum(local, 4);
    locais.push(local, nome, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // versão de quem gerou
    comum(central, 6);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);
    deslocamento += local.byteLength + nome.byteLength + comprimido.byteLength;
  }
  const diretorio = Buffer.concat(centrais);
  if (deslocamento + diretorio.byteLength > LIMITE_32) throw new RangeError('criarZip: acima de 4 GiB (sem zip64)');
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.byteLength, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}
