/** Apoio dos testes do DANFE em PDF (e do gerador de amostras): PNG sintético e leitura dos content streams das páginas. */
import { deflateSync } from 'node:zlib';
import { decodePDFRawStream, PDFDocument, PDFRawStream, type PDFRef } from 'pdf-lib';

/** PNG RGBA de teste sem biblioteca: IHDR + IDAT (filtro 0) + IEND (CRC não é conferido pelo leitor). */
export function pngDeTeste(l: number, a: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const cru = Buffer.alloc((l * 4 + 1) * a);
  for (let y = 0; y < a; y++) for (let x = 0; x < l; x++) cru.set(pixel(x, y), y * (l * 4 + 1) + 1 + x * 4);
  const chunk = (nome: string, dados: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(dados.length, 0);
    h.write(nome, 4, 'latin1');
    return Buffer.concat([h, dados, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(a, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(cru)), chunk('IEND', Buffer.alloc(0))]));
}

/** Logo sintético de teste (gradiente horizontal), 300x150 por padrão. */
export const logoDeTeste = (l = 300, a = 150) => pngDeTeste(l, a, (x) => [x % 255, 40, 200, 255]);

/** Content streams (descomprimidos) de cada página, em latin1. */
export async function conteudosDasPaginas(b: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(b);
  return doc.getPages().map((pg) => {
    const cs = pg.node.Contents();
    const refs = cs && 'asArray' in cs ? (cs as unknown as { asArray(): PDFRef[] }).asArray() : [];
    return refs
      .map((r) => doc.context.lookup(r))
      .filter((st): st is PDFRawStream => st instanceof PDFRawStream)
      .map((st) => Buffer.from(decodePDFRawStream(st).decode()).toString('latin1'))
      .join('');
  });
}
