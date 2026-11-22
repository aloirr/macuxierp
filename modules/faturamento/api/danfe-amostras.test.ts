/**
 * Gerador permanente das amostras do DANFE para a revisão do design-de-marca. Só roda com `DANFE_AMOSTRAS_DIR=<pasta>` (grava lá os 11 PDFs).
 * Base de TODAS as amostras: a fixture completa (fatura com 2 duplicatas, transportador com volumes); cada caso muda só o que varia.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { montarDanfe } from '../domain/danfe';
import { nfeProcDeTeste, type OpcoesNfeProc } from '../domain/fixtures-danfe';
import { lerAssinaturaDaMarca } from './ativos-marca';
import { renderizarDanfe } from './danfe-pdf';

type Pixel = [number, number, number, number];
function png(l: number, a: number, pixel: (x: number, y: number) => Pixel): Uint8Array {
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
const gradiente = (l: number, a: number) => png(l, a, (x) => [x % 255, 40, 200, 255]);
const DESC120 = 'Cabo de força tripolar flexível 750V isolação dupla antichama, bobina 100 metros, cor preta, norma NBR 13249, lote 26-11';
const BASE: OpcoesNfeProc = { duplicatas: true, transportador: true };
/** Item extremo: descrição de 120 caracteres e ICMS de 18% (valores realistas que cabem na tabela). */
const EXTREMO: OpcoesNfeProc = { ...BASE, item1: { qCom: '123456.0000', vProd: '987654.32', aliqIcms: '18', descricao: DESC120 } };
/** Totais de 13 inteiros, ICMS 0% por ora (quebra de valor em decisão). */
const EXTREMO13: OpcoesNfeProc = { ...BASE, item1: { qCom: '12345678901.0000', vProd: '1234567890123.00', descricao: DESC120 } };
const dir = process.env.DANFE_AMOSTRAS_DIR;

const casos: { nome: string; nota: OpcoesNfeProc; logo?: Uint8Array }[] = [
  { nome: '1folha', nota: BASE },
  { nome: '2folhas', nota: { ...BASE, itens: 30 } },
  { nome: '2folhas-logo-em-todas-as-folhas', nota: { ...BASE, itens: 30 }, logo: gradiente(600, 300) },
  { nome: 'dados-adicionais-3000-caracteres', nota: { ...BASE, itens: 8, infCpl: Array.from({ length: 300 }, (_, i) => `inf${String(i).padStart(3, '0')}`).join(' ').slice(0, 3000) } },
  { nome: 'item-extremo', nota: EXTREMO },
  { nome: 'item-extremo-totais-13-inteiros', nota: EXTREMO13 },
  { nome: 'logo-120px', nota: BASE, logo: gradiente(120, 60) },
  { nome: 'logo-1x2', nota: BASE, logo: gradiente(300, 600) },
  { nome: 'logo-5x1', nota: BASE, logo: gradiente(1000, 200) },
  { nome: 'logo-colorido-transparencia', nota: BASE, logo: png(400, 200, (x, y) => [x % 255, (y * 2) % 255, 120, x < 100 || y < 40 ? 0 : x < 200 ? 128 : 255]) },
  { nome: 'logo-cores-puras', nota: BASE, logo: png(300, 150, (x) => [x < 100 ? 255 : 0, x >= 100 && x < 200 ? 255 : 0, x >= 200 ? 255 : 0, 255]) },
];

describe.skipIf(!dir)('amostras do DANFE (DANFE_AMOSTRAS_DIR)', { timeout: 60_000 }, () => {
  it('grava os 11 PDFs de homologação', async () => {
    const assinatura = await lerAssinaturaDaMarca();
    expect(assinatura).not.toBeNull();
    await mkdir(dir!, { recursive: true });
    for (const c of casos) {
      const pdf = await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ tpAmb: '2', ...c.nota }) }), { assinaturaMarca: assinatura!, logoEmitente: c.logo });
      await writeFile(path.join(dir!, `danfe-homologacao-${c.nome}.pdf`), pdf);
    }
    expect(casos).toHaveLength(11);
  });
});
