/**
 * Logo do emitente em tons de cinza (marca §1; RF-FAT-03): decodifica o PNG (8 bits, sem entrelaçamento; tipos cinza, RGB, paleta, cinza+alfa
 * e RGBA), compõe a transparência sobre branco e converte para luminância (0,2126 R + 0,7152 G + 0,0722 B). Devolve os pixels em cinza 8 bits.
 * Outro formato (JPEG, PNG entrelaçado ou de 16 bits) lança `ErroLogo`; o DANFE sai sem logo, nunca com a imagem em cores.
 */
import { inflateSync } from 'node:zlib';

export class ErroLogo extends Error {}

export interface LogoCinza {
  largura: number;
  altura: number;
  /** `largura * altura` bytes, linha a linha. */
  pixels: Uint8Array;
}

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CANAIS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function logoEmCinza(png: Uint8Array): LogoCinza {
  const b = Buffer.from(png);
  if (b.length < 33 || ASSINATURA_PNG.some((v, i) => b[i] !== v)) throw new ErroLogo('o logo precisa ser PNG');
  let largura = 0, altura = 0, profundidade = 0, tipo = 0, entrelacado = 0;
  let paleta: Buffer | null = null;
  let transparenciaPaleta: Buffer | null = null;
  const dados: Buffer[] = [];
  for (let p = 8; p + 12 <= b.length; ) {
    const tam = b.readUInt32BE(p);
    const nome = b.toString('latin1', p + 4, p + 8);
    const corpo = b.subarray(p + 8, p + 8 + tam);
    if (nome === 'IHDR') {
      largura = corpo.readUInt32BE(0);
      altura = corpo.readUInt32BE(4);
      profundidade = corpo[8]!;
      tipo = corpo[9]!;
      entrelacado = corpo[12]!;
    } else if (nome === 'PLTE') paleta = corpo;
    else if (nome === 'tRNS') transparenciaPaleta = corpo;
    else if (nome === 'IDAT') dados.push(corpo);
    else if (nome === 'IEND') break;
    p += 12 + tam;
  }
  const canais = CANAIS[tipo];
  if (!canais || profundidade !== 8 || entrelacado !== 0 || largura < 1 || altura < 1 || largura * altura > 16_000_000) throw new ErroLogo('PNG não suportado (use 8 bits, sem entrelaçamento)');
  if (tipo === 3 && !paleta) throw new ErroLogo('PNG sem paleta');
  const cru = inflateSync(Buffer.concat(dados));
  const linha = largura * canais;
  if (cru.length < (linha + 1) * altura) throw new ErroLogo('PNG truncado');
  const px = Buffer.alloc(linha * altura);
  for (let y = 0; y < altura; y++) {
    const f = cru[y * (linha + 1)]!;
    for (let x = 0; x < linha; x++) {
      const v = cru[y * (linha + 1) + 1 + x]!;
      const a = x >= canais ? px[y * linha + x - canais]! : 0;
      const c = y > 0 ? px[(y - 1) * linha + x]! : 0;
      const d = x >= canais && y > 0 ? px[(y - 1) * linha + x - canais]! : 0;
      let r: number;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + c;
      else if (f === 3) r = v + ((a + c) >> 1);
      else if (f === 4) {
        const pp = a + c - d;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - c), pc = Math.abs(pp - d);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d);
      } else throw new ErroLogo('PNG com filtro inválido');
      px[y * linha + x] = r & 0xff;
    }
  }
  const saida = new Uint8Array(largura * altura);
  for (let i = 0; i < largura * altura; i++) {
    let r: number, g: number, bl: number, alfa = 255;
    const o = i * canais;
    if (tipo === 0) r = g = bl = px[o]!;
    else if (tipo === 4) {
      r = g = bl = px[o]!;
      alfa = px[o + 1]!;
    }
    else if (tipo === 3) {
      const k = px[o]!;
      [r, g, bl] = [paleta![k * 3]!, paleta![k * 3 + 1]!, paleta![k * 3 + 2]!];
      alfa = transparenciaPaleta?.[k] ?? 255;
    } else {
      [r, g, bl] = [px[o]!, px[o + 1]!, px[o + 2]!];
      if (tipo === 6) alfa = px[o + 3]!;
    }
    const mistura = (cor: number) => (cor * alfa + 255 * (255 - alfa)) / 255; // transparência compõe sobre branco
    saida[i] = Math.round(0.2126 * mistura(r) + 0.7152 * mistura(g) + 0.0722 * mistura(bl));
  }
  return { largura, altura, pixels: saida };
}
