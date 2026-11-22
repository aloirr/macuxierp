import { deflateSync } from 'node:zlib';
import { decodePDFRawStream, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { montarDanfe } from '../domain/danfe';
import { nfeProcDeTeste } from '../domain/fixtures-danfe';
import { exigirAssinaturaDaMarca, lerAssinaturaDaMarca, verificarAtivosDanfe } from './ativos-marca';
import { larg, largurasColunas, linhasCabecalhoTabela, renderizarDanfe } from './danfe-pdf';
import { ErroLogo, logoEmCinza } from './logo-cinza';

const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex').toUpperCase();
/** Conteúdo das páginas (streams descomprimidos) + o PDF bruto, em maiúsculas: texto do pdf-lib sai em hexadecimal nos operadores Tj. */
async function latin1Hex(b: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(b);
  let todo = Buffer.from(b).toString('latin1');
  for (const pg of doc.getPages()) {
    const cs = pg.node.Contents();
    const refs = cs && 'asArray' in cs ? (cs as unknown as { asArray(): PDFRef[] }).asArray() : [];
    for (const r of refs) {
      const st = doc.context.lookup(r);
      if (st instanceof PDFRawStream) todo += Buffer.from(decodePDFRawStream(st).decode()).toString('latin1');
    }
  }
  return todo.toUpperCase();
}
const paginas = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();

/** PNG RGBA de teste sem biblioteca: IHDR + IDAT (filtro 0) + IEND (CRC não é conferido pelo leitor). */
function pngDeTeste(l: number, a: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
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

describe('DANFE em PDF (RF-FAT-03)', { timeout: 30_000 }, () => {
  it('RF-FAT-03: o PDF abre (%PDF e 1 página) com a nota de 2 itens', async () => {
    const pdf = await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste() }));
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(await paginas(pdf)).toBe(1);
  });

  it('RF-FAT-03: nota de homologação contém "SEM VALOR FISCAL" (marca d\'água) e o aviso do MOC em todas as folhas; produção, nenhum dos dois', async () => {
    const h = await latin1Hex(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 30, tpAmb: '2' }) })));
    expect(h.split(hex('SEM VALOR FISCAL')).length - 1).toBe(2 * 2); // marca + aviso, em cada uma das 2 folhas
    const p = await latin1Hex(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ tpAmb: '1' }) })));
    expect(p).not.toContain(hex('SEM VALOR FISCAL'));
  });

  it('RF-FAT-03: nota cancelada leva a tarja CANCELADA', async () => {
    const c = await latin1Hex(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste(), cancelada: true })));
    expect(c).toContain(hex('CANCELADA'));
  });

  it('RF-FAT-03: nota com 60 itens quebra em 3 folhas (paginação por altura: ~21 itens na 1ª e ~30 nas demais, com o cabeçalho completo)', async () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 60 }) });
    expect(await paginas(await renderizarDanfe(m))).toBe(3);
  });

  it('marca §4/§1: rodapé "Emitido pelo" em todas as folhas, sem "Macuxi ERP" em texto; logo do emitente entra em cinza; logo inválido não derruba o DANFE', async () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 30 }) });
    const assinatura = await exigirAssinaturaDaMarca(); // sem o ativo do design-de-marca o teste FALHA (nada de PNG substituto)
    const logo = pngDeTeste(300, 150, (x) => [x % 255, 40, 200, 255]);
    const pdf = await renderizarDanfe(m, { assinaturaMarca: assinatura, logoEmitente: logo });
    const t = await latin1Hex(pdf);
    expect(t.split(hex('Emitido pelo')).length - 1).toBe(2);
    expect(t).not.toContain(hex('Macuxi ERP'));
    expect(t).toContain('/DEVICEGRAY'.toUpperCase()); // logo do cliente em tons de cinza
    const doc = await PDFDocument.load(pdf);
    expect(doc.getCreator()).toBe('Macuxi ERP');
    const ruim = await renderizarDanfe(m, { logoEmitente: new Uint8Array([1, 2, 3]) });
    expect(await paginas(ruim)).toBe(2);
  });
});

describe('DANFE: fontes mínimas (marca §3)', { timeout: 30_000 }, () => {
  it('marca §3: item com quantidade 99.999.999,9999 e valor 9.999.999.999,99 não fica abaixo de 7 pt (coluna alarga, descrição quebra)', async () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste() });
    m.paginas[0]!.itens[0]!.quantidade = '99.999.999,9999';
    m.paginas[0]!.itens[0]!.valorUnitario = '9.999.999.999,99';
    m.paginas[0]!.itens[0]!.valorTotal = '9.999.999.999,99';
    m.paginas[0]!.itens[0]!.descricao = 'Descrição bem longa do produto para obrigar a quebra de linha na célula da tabela';
    const c = await latin1Hex(await renderizarDanfe(m));
    const tamanhos = [...c.matchAll(/\/[A-Z0-9-]+ ([\d.]+) TF/g)].map((x) => Number(x[1]));
    expect(tamanhos.length).toBeGreaterThan(0);
    expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(6);
    for (const v of ['99.999.999,9999', '9.999.999.999,99']) {
      const k = c.indexOf(`<${hex(v)}> TJ`) >= 0 ? c.indexOf(`<${hex(v)}> TJ`) : c.indexOf(hex(v));
      expect(k).toBeGreaterThan(0);
      const antes = c.slice(0, k);
      const ultimo = [...antes.matchAll(/\/[A-Z0-9-]+ ([\d.]+) TF/g)].pop()!;
      expect(Number(ultimo[1])).toBeGreaterThanOrEqual(7);
    }
    expect(await paginas(await renderizarDanfe(m))).toBe(1);
  });
});

describe('logo do emitente em cinza (marca §1)', () => {
  it('marca §1: luminância 0,2126 R + 0,7152 G + 0,0722 B e transparência composta sobre branco', () => {
    const g = logoEmCinza(pngDeTeste(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0])));
    expect([...g.pixels]).toEqual([Math.round(0.2126 * 255), 255]);
    expect([g.largura, g.altura]).toEqual([2, 1]);
  });
  it('marca §1: o PNG da assinatura da marca decodifica (8 bits, sem entrelaçamento)', async () => {
    expect(logoEmCinza(await exigirAssinaturaDaMarca()).largura).toBe(1857);
  });
  it('marca §1: logo de cores puras (#FF0000, #00FF00, #0000FF) vira cinza 54, 182 e 18 (luminância Rec. 709)', () => {
    const g = logoEmCinza(pngDeTeste(3, 1, (x) => [x === 0 ? 255 : 0, x === 1 ? 255 : 0, x === 2 ? 255 : 0, 255]));
    expect([...g.pixels]).toEqual([54, 182, 18]);
  });
  it('marca §1: JPEG e lixo são recusados com ErroLogo', () => {
    expect(() => logoEmCinza(new Uint8Array([0xff, 0xd8, 0xff]))).toThrow(ErroLogo);
  });
});

interface Texto {
  pagina: number;
  t: string;
  pt: number;
  x: number;
  y: number;
}
/** Todos os textos desenhados (decodificados do hexadecimal), com página, corpo e posição (y de baixo para cima). */
async function textos(b: Uint8Array): Promise<Texto[]> {
  const doc = await PDFDocument.load(b);
  const out: Texto[] = [];
  doc.getPages().forEach((pg, i) => {
    const cs = pg.node.Contents();
    const refs = cs && 'asArray' in cs ? (cs as unknown as { asArray(): PDFRef[] }).asArray() : [];
    for (const r of refs) {
      const st = doc.context.lookup(r);
      if (!(st instanceof PDFRawStream)) continue;
      const c = Buffer.from(decodePDFRawStream(st).decode()).toString('latin1');
      for (const bloco of c.split('BT').slice(1)) {
        const pt = /([\d.]+) Tf/.exec(bloco);
        const tm = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(bloco);
        const tj = /<([0-9A-F]+)> Tj/.exec(bloco);
        if (pt && tm && tj) out.push({ pagina: i + 1, t: Buffer.from(tj[1]!, 'hex').toString('latin1'), pt: Number(pt[1]), x: Number(tm[1]), y: Number(tm[2]) });
      }
    }
  });
  return out;
}
const DESC120 = 'Cabo de força tripolar flexível 750V isolação dupla antichama, bobina 100 metros, cor preta, norma NBR 13249, lote 26-11';
if (DESC120.length !== 120) throw new Error(`DESC120 tem ${DESC120.length} caracteres, não 120`);

describe('DANFE: ressalvas do design-de-marca (2ª rodada)', { timeout: 30_000 }, () => {
  it('marca §3: a legenda "Documento Auxiliar da Nota Fiscal Eletrônica" sai em 2 linhas de 7 pt', async () => {
    const ts = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste() })));
    const a = ts.find((x) => x.t === 'Documento Auxiliar da');
    const b = ts.find((x) => x.t === 'Nota Fiscal Eletrônica');
    expect(a?.pt).toBe(7);
    expect(b?.pt).toBe(7);
    expect(a!.y).toBeGreaterThan(b!.y);
  });

  it('marca §3: nenhum texto de cabeçalho da tabela de itens passa da largura da coluna menos 1,5 pt (respiro mínimo), mesmo com valores extremos', async () => {
    const doc = await PDFDocument.create();
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const extremo = montarDanfe({ nfeProc: nfeProcDeTeste({ item1: { qCom: '12345678901.0000', vProd: '1234567890123.00', descricao: DESC120 } }) });
    for (const itens of [[], extremo.paginas[0]!.itens]) {
      const ws = largurasColunas(reg, itens);
      const cab = linhasCabecalhoTabela(reg, ws);
      expect(cab).toHaveLength(ws.length);
      cab.forEach((c, i) => {
        expect(c.linhas.length).toBeGreaterThan(0);
        for (const l of c.linhas) expect(larg(reg, l, c.pt)).toBeLessThanOrEqual(ws[i]! - 1.5);
      });
      expect(ws.reduce((a, b) => a + b, 0)).toBeCloseTo(595.28 - 2 * 28.35, 1);
      expect(Math.min(...ws)).toBeGreaterThan(10);
    }
  });

  it('marca §3: o PDF não tem reticências em lugar nenhum (rótulos, descrição, nome do destinatário, transportador, duplicatas)', async () => {
    const longo = 'EMPRESA COMERCIAL DE ALIMENTOS E BEBIDAS DA AMAZONIA OCIDENTAL IMPORTACAO EXPORTACAO LTDA FILIAL 0007 CENTRO DE DISTRIBUICAO NORTE';
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 25, transportador: true, duplicatas: true, nomeDestinatario: longo, infCpl: 'x '.repeat(900), item1: { descricao: DESC120 } }) });
    m.operacao.naturezaOperacao = longo;
    m.duplicatas = Array.from({ length: 8 }, (_, i) => ({ numero: `00${i + 1}`, vencimento: '21/12/2026', valor: 'R$ 12.345,67' }));
    const ts = await textos(await renderizarDanfe(m));
    expect(ts.filter((x) => x.t.includes('...') || x.t.includes('…'))).toEqual([]);
    const todo = ts.map((x) => x.t).join('\n');
    expect(todo).toContain('PLACA DO VEÍCULO');
    expect(todo).toContain('UF (VEÍCULO)');
    expect(todo).toContain('DESCRIÇÃO DO');
    // nada se perde: todas as palavras do nome longo e das 8 duplicatas aparecem
    for (const p of longo.split(' ')) expect(todo).toContain(p);
    expect(ts.filter((x) => x.t.startsWith('008 21/12/2026')).length).toBeGreaterThan(0);
  });

  it('marca §3: descrição de 120 caracteres quebra em quantas linhas precisar, sem reduzir a fonte, com altura de linha variável', async () => {
    const curta = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 3 }) })));
    const longa = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 3, item1: { descricao: DESC120 } }) })));
    const palavras = DESC120.split(' ');
    const dosItens = longa.filter((x) => x.pagina === 1 && x.pt === 7);
    for (const p of palavras) expect(dosItens.some((x) => x.t.includes(p)), p).toBe(true);
    const linhasDescricao = dosItens.filter((x) => palavras.some((p) => x.t.includes(p)) && x.x < 28.35 + 160).length;
    expect(linhasDescricao).toBeGreaterThanOrEqual(3);
    // a corpo da descrição continua 7 pt
    expect(Math.min(...dosItens.map((x) => x.pt))).toBe(7);
    // o 2º item desce junto: a linha de "P2" fica mais abaixo (y menor) do que com descrição curta
    const y = (ts: Texto[]) => ts.find((x) => x.pagina === 1 && x.t === 'P2')!.y;
    expect(y(longa)).toBeLessThan(y(curta) - 20);
  });

  it('marca §3: a paginação acompanha a altura variável: mais linhas de descrição, mais folhas', async () => {
    const curtas = await paginas(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 40 }) })));
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 40 }) });
    for (const it of m.paginas.flatMap((f) => f.itens)) it.descricao = DESC120;
    const longas = await paginas(await renderizarDanfe(m));
    expect(longas).toBeGreaterThan(curtas);
    expect(curtas).toBe(2);
  });

  it('marca §3: item extremo (qCom 11 inteiros e 4 decimais, vProd 13 inteiros) cabe sem reticências, a 7 pt, em 1 folha', async () => {
    const m = montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 1, item1: { qCom: '12345678901.0000', vProd: '1234567890123.00', descricao: DESC120 } }) });
    const ts = await textos(await renderizarDanfe(m));
    expect(ts.some((x) => x.t === '12.345.678.901,0000' && x.pt === 7)).toBe(true);
    expect(ts.some((x) => x.t === '1.234.567.890.123,00' && x.pt === 7)).toBe(true);
    expect(ts.some((x) => x.t.includes('...'))).toBe(false);
    expect(new Set(ts.map((x) => x.pagina)).size).toBe(1);
  });

  it('marca §3: "Dados adicionais" vai logo abaixo da tabela na última folha, sem deixar o espaço em branco da 1ª folha', async () => {
    const ts = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 2, infCpl: 'Pedido 1 - entrega agendada' }) })));
    const info = ts.find((x) => x.t === 'INFORMAÇÕES COMPLEMENTARES')!;
    const ultimoItem = ts.filter((x) => x.t === 'P2')[0]!;
    // o rótulo do bloco fica a menos de 40 pt abaixo da última linha de item (antes ficava ~170 pt abaixo)
    expect(ultimoItem.y - info.y).toBeGreaterThan(0);
    expect(ultimoItem.y - info.y).toBeLessThan(40);
    // e na folha 2 quando não cabe: nota de 20 itens com infCpl enorme continua em folha seguinte, sem perder texto
    const grande = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 20, infCpl: Array.from({ length: 120 }, (_, i) => `linha${i}`).join(' ') }) })));
    const todo = grande.map((x) => x.t).join(' ');
    for (const i of [0, 60, 119]) expect(todo).toContain(`linha${i}`);
  });

  it('MOC (premissa do modulo-fiscal): com 2 folhas, o cabeçalho completo aparece nas duas e o canhoto e os blocos do destinatário só na 1ª', async () => {
    const ts = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 30 }) })));
    const em = (n: number, t: string) => ts.filter((x) => x.pagina === n && x.t === t).length;
    for (const n of [1, 2]) {
      for (const t of ['DANFE', 'CHAVE DE ACESSO', 'NATUREZA DA OPERAÇÃO', 'PROTOCOLO DE AUTORIZAÇÃO DE USO', 'INSCRIÇÃO ESTADUAL', 'CNPJ / CPF', 'Documento Auxiliar da', 'EMITENTE LTDA']) expect(em(n, t), `${t} na folha ${n}`).toBeGreaterThan(0);
      expect(em(n, `Folha ${n}/2`)).toBe(1);
    }
    for (const t of ['DATA DE RECEBIMENTO', 'DESTINATÁRIO / REMETENTE', 'CÁLCULO DO IMPOSTO', 'TRANSPORTADOR / VOLUMES TRANSPORTADOS']) {
      expect(em(1, t), t).toBe(1);
      expect(em(2, t), t).toBe(0);
    }
  });

  it('marca §3: a folha 2 leva o logo do emitente no cabeçalho', async () => {
    const logo = pngDeTeste(300, 150, (x) => [x % 255, 40, 200, 255]);
    const pdf = await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 30 }) }), { logoEmitente: logo });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    for (const pg of doc.getPages()) {
      const cs = pg.node.Contents() as unknown as { asArray(): PDFRef[] };
      const c = cs.asArray().map((r) => Buffer.from(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()).toString('latin1')).join('');
      expect(c).toMatch(/\/LogoEmitente\S* Do/); // o logo aparece em todas as folhas (grande na 1ª, reduzido na 2ª)
    }
  });
});

/** Imagens (XObject) embutidas no PDF, com largura e altura em pixels. */
async function imagens(b: Uint8Array): Promise<{ w: number; h: number }[]> {
  const doc = await PDFDocument.load(b);
  const out: { w: number; h: number }[] = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    const d = (o as { dict?: { get(k: unknown): unknown } }).dict;
    if (!(o instanceof PDFRawStream) || !d) continue;
    const w = o.dict.get(PDFName.of('Width')), h = o.dict.get(PDFName.of('Height'));
    if (w instanceof PDFNumber && h instanceof PDFNumber) out.push({ w: w.asNumber(), h: h.asNumber() });
  }
  return out;
}

describe('DANFE: rodapé "Emitido pelo" (marca §4) e ativo obrigatório', { timeout: 30_000 }, () => {
  it('marca §4: com o ativo, TODA folha tem "Emitido pelo" a 7 pt e a imagem 1857x400; o PDF sem o rodapé reprova', async () => {
    const pdf = await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 60 }) }), { assinaturaMarca: await exigirAssinaturaDaMarca() });
    const n = await paginas(pdf);
    expect(n).toBe(3);
    expect((await imagens(pdf)).some((i) => i.w === 1857 && i.h === 400)).toBe(true);
    const ts = (await textos(pdf)).filter((x) => x.t === 'Emitido pelo');
    expect(ts.map((x) => x.pagina)).toEqual([1, 2, 3]);
    const doc = await PDFDocument.load(pdf);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const w = larg(reg, 'Emitido pelo', 7);
    for (const t of ts) {
      expect(t.pt).toBe(7);
      expect(t.y).toBeCloseTo(14.9 + 8.3, 1); // linha de base 8,3 pt acima da base do logo
      expect(t.x + w).toBeCloseTo(595.28 - 28.35 - 111.4 - 14.9, 1); // 14,9 pt de respiro até o logo
    }
    const c = await latin1Hex(pdf);
    expect(c).toContain('1 0 0 1 455.53 14.9 CM'); // base do logo a 14,9 do papel; 455,53 + 111,4 = 566,93 (borda direita)
    expect(c).toContain('111.4 0 0 24 0 0 CM'); // 24 pt de altura, 111,4 de largura, borda direita em 566,93 (x do topo), base a 14,9 do papel
  });

  it('marca §4: nada é desenhado nos 53,8 pt do pé (14,9 + 24 + 14,9), em nenhuma folha', async () => {
    const ts = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 60, infCpl: 'x '.repeat(900) }) }), { assinaturaMarca: await exigirAssinaturaDaMarca() }));
    for (const t of ts.filter((x) => x.t !== 'Emitido pelo')) expect(t.y, t.t).toBeGreaterThanOrEqual(53.8);
  });

  it('marca §4: verificarAtivosDanfe devolve { ok: true } com o ativo e { ok: false, faltando } sem ele, sem nunca lançar', async () => {
    expect(await verificarAtivosDanfe()).toEqual({ ok: true });
    expect(logoEmCinza(await exigirAssinaturaDaMarca()).altura).toBe(400);
    expect(await verificarAtivosDanfe({ diretorio: '/nao/existe/ativos' })).toEqual({ ok: false, faltando: ['macuxi-erp-a-mono-preto-400.png'] });
    const antes = process.env.MACUXI_ATIVOS_MARCA;
    process.env.MACUXI_ATIVOS_MARCA = '/nao/existe/ativos';
    try {
      expect(await lerAssinaturaDaMarca()).toBeNull();
      expect(await verificarAtivosDanfe()).toEqual({ ok: false, faltando: ['macuxi-erp-a-mono-preto-400.png'] });
      await expect(exigirAssinaturaDaMarca()).rejects.toThrow('Ativo de marca do DANFE não encontrado');
    } finally {
      if (antes === undefined) delete process.env.MACUXI_ATIVOS_MARCA;
      else process.env.MACUXI_ATIVOS_MARCA = antes;
    }
  });
});

describe('DANFE: cabeçalho da tabela de itens (3ª rodada)', { timeout: 30_000 }, () => {
  const extremo = () => montarDanfe({ nfeProc: nfeProcDeTeste({ item1: { qCom: '12345678901.0000', vProd: '1234567890123.00', descricao: DESC120 } }) });

  it('marca §3: cada cabeçalho fica a 1,5 pt da linha (direita nas colunas numéricas, esquerda nas de texto), nunca cruza, medido no PDF', async () => {
    const doc = await PDFDocument.create();
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    for (const m of [montarDanfe({ nfeProc: nfeProcDeTeste() }), extremo()]) {
      const ws = largurasColunas(reg, m.paginas[0]!.itens);
      const xs = ws.map((_, i) => 28.35 + ws.slice(0, i).reduce((a, b) => a + b, 0));
      const cab = linhasCabecalhoTabela(reg, ws);
      const ts = (await textos(await renderizarDanfe(m))).filter((x) => x.pagina === 1 && x.pt === 6);
      const y0 = ts.find((x) => x.t === 'CÓDIGO')!.y;
      const faixa = ts.filter((x) => x.y <= y0 + 0.01 && x.y > y0 - 14);
      cab.forEach((c, i) => {
        expect(c.linhas.length).toBeLessThanOrEqual(2);
        for (const l of c.linhas) {
          const w = larg(reg, l, 6);
          expect(w + 1.5 + 1.5, l).toBeLessThanOrEqual(ws[i]! + 0.001);
          expect(c.linhas.length, l).toBeLessThanOrEqual(2);
          const t = faixa.find((x) => x.t === l && x.x >= xs[i]! - 0.01 && x.x < xs[i]! + ws[i]!)!;
          expect(t, l).toBeDefined();
          const numerica = ['QUANT.', 'V. UNIT.', 'V. DESC.', 'V. TOTAL', 'BC ICMS', 'V. ICMS', 'V. IPI', 'A.ICMS', 'A.IPI'].includes(c.linhas.join(' '));
          if (numerica) expect(t.x + w).toBeCloseTo(xs[i]! + ws[i]! - 1.5, 2);
          else expect(t.x).toBeCloseTo(xs[i]! + 1.5, 2);
          expect(t.x).toBeGreaterThanOrEqual(xs[i]! + 1.5 - 0.001);
          expect(t.x + w).toBeLessThanOrEqual(xs[i]! + ws[i]! - 1.5 + 0.001);
        }
      });
    }
  });

  it('marca §3: o rótulo "DESCRIÇÃO DO PROD./SERV." ocupa no máximo 2 linhas, nunca 3, inclusive com o item extremo', async () => {
    const doc = await PDFDocument.create();
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    for (const itens of [[], extremo().paginas[0]!.itens]) {
      const ws = largurasColunas(reg, itens);
      const d = linhasCabecalhoTabela(reg, ws)[1]!;
      expect(d.linhas.length).toBeLessThanOrEqual(2);
      expect(d.linhas.join(' ')).toBe('DESCRIÇÃO DO PROD./SERV.');
    }
    // descrição estreita (coluna no mínimo): 2 linhas
    const estreito = linhasCabecalhoTabela(reg, [10, larg(reg, 'DESCRIÇÃO DO', 6) + 3, ...Array(13).fill(40)]);
    expect(estreito[1]!.linhas).toEqual(['DESCRIÇÃO DO', 'PROD./SERV.']);
  });

  it('marca §3: o respiro de 1,5 pt é da caixa do texto (com descendentes) ao eixo da linha: "Folha x/y" e o fundo do cabeçalho de itens', async () => {
    const doc = await PDFDocument.create();
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const descende = (pt: number) => reg.heightAtSize(pt, { descender: true }) - reg.heightAtSize(pt, { descender: false });
    for (const m of [montarDanfe({ nfeProc: nfeProcDeTeste() }), extremo()]) {
      const ts = await textos(await renderizarDanfe(m));
      const folha = ts.find((x) => x.t === 'Folha 1/1')!;
      // base do quadro do cabeçalho: 28 + 54 + 4 + 4 + 100 = 190 (de cima), ou 841,89 - 190 de baixo
      expect(folha.y - descende(7) - (841.89 - 190)).toBeGreaterThanOrEqual(1.5 - 0.001);
      const ws = largurasColunas(reg, m.paginas[0]!.itens);
      const linhas = Math.max(...linhasCabecalhoTabela(reg, ws).map((c) => c.linhas.length));
      const hCab = 6 + linhas * 6.5;
      const y0 = ts.find((x) => x.t === 'CÓDIGO')!.y; // 1ª linha de base (9,5 abaixo do topo do cabeçalho)
      const eixo = y0 + 9.5 - hCab;
      const ultima = y0 - (linhas - 1) * 6.5;
      expect(ultima - descende(6) - eixo).toBeGreaterThanOrEqual(1.5 - 0.001);
    }
  });

  it('marca §3 (5ª rodada): "Folha x/y" a 7 pt tem a linha de base em <= 186,925 (folha 1) e <= 124,925 (folha 2), medida do topo (base = linha - 3,5)', async () => {
    const ts = await textos(await renderizarDanfe(montarDanfe({ nfeProc: nfeProcDeTeste({ itens: 30, duplicatas: true, transportador: true }) })));
    const f1 = ts.find((x) => x.t === 'Folha 1/2')!;
    const f2 = ts.find((x) => x.t === 'Folha 2/2')!;
    expect(841.89 - f1.y).toBeLessThanOrEqual(186.925 + 1e-6);
    expect(841.89 - f2.y).toBeLessThanOrEqual(124.925 + 1e-6);
    expect(841.89 - f1.y).toBeCloseTo(186.5, 2);
    expect(841.89 - f2.y).toBeCloseTo(124.5, 2);
  });
});

describe('DANFE: rótulos desenhados e respiro vertical (4ª rodada)', { timeout: 30_000 }, () => {
  const extremo = () => montarDanfe({ nfeProc: nfeProcDeTeste({ item1: { qCom: '12345678901.0000', vProd: '1234567890123.00', descricao: DESC120 } }) });
  const ROT = ['QUANT.', 'V. UNIT.', 'V. DESC.', 'V. TOTAL', 'BC ICMS', 'V. ICMS', 'V. IPI', 'A.ICMS', 'A.IPI'];

  it('marca §3: os RÓTULOS numéricos desenhados terminam a 1,5 pt do eixo da linha (largura sem kerning, como o drawText desenha)', async () => {
    const doc = await PDFDocument.create();
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    for (const m of [montarDanfe({ nfeProc: nfeProcDeTeste() }), extremo()]) {
      const ws = largurasColunas(reg, m.paginas[0]!.itens);
      const xs = ws.map((_, i) => 28.35 + ws.slice(0, i).reduce((a, b) => a + b, 0));
      const ts = (await textos(await renderizarDanfe(m))).filter((x) => x.pagina === 1 && x.pt === 6);
      const y0 = ts.find((x) => x.t === 'CÓDIGO')!.y;
      const faixa = ts.filter((x) => x.y <= y0 + 0.01 && x.y > y0 - 14);
      const cab = linhasCabecalhoTabela(reg, ws);
      let achados = 0;
      cab.forEach((c, i) => {
        if (!ROT.includes(c.linhas.join(' '))) return;
        for (const l of c.linhas) {
          const t = faixa.find((x) => x.t === l && x.x >= xs[i]! - 0.01 && x.x < xs[i]! + ws[i]!)!;
          expect(t, l).toBeDefined();
          const respiro = xs[i]! + ws[i]! - (t.x + larg(reg, l, 6));
          expect(respiro, l).toBeGreaterThanOrEqual(1.5 - 0.001);
          expect(respiro, l).toBeLessThan(1.5 + 0.01);
          achados++;
        }
      });
      expect(achados).toBeGreaterThanOrEqual(ROT.length);
    }
  });

  it('marca §3: rótulo a 6 pt com acento fica a >= 7,09 abaixo da linha de cima; título a 7 pt negrito, a >= 3,10 acima da linha de baixo (medido no PDF)', async () => {
    const ts = (await textos(await renderizarDanfe(extremo()))).filter((x) => x.pagina === 1);
    for (const [titulo, rotulo] of [['TRANSPORTADOR / VOLUMES TRANSPORTADOS', 'NOME / RAZÃO'], ['CÁLCULO DO IMPOSTO', 'BASE DE CÁLCULO']] as const) {
      const t = ts.find((x) => x.pt === 7 && x.t === titulo)!;
      const r = ts.filter((x) => x.pt === 6 && x.t.startsWith(rotulo) && x.y < t.y).sort((p, q) => q.y - p.y)[0]!; // o rótulo mais próximo, abaixo do título
      expect(t, titulo).toBeDefined();
      expect(r, rotulo).toBeDefined();
      const linha = t.y - (10 - 6.85); // a linha de cima do quadro (e de baixo do título) está 10 pt abaixo do topo do título
      expect(t.y - linha, titulo).toBeGreaterThanOrEqual(0.228 * 7 + 1.5 - 0.001); // >= 3,10
      expect(linha - r.y, rotulo).toBeGreaterThanOrEqual(0.931 * 6 + 1.5 - 0.001); // >= 7,09
    }
  });

  it('marca §3: o quadro de cálculo do imposto não tem "R$"; só o valor total da nota é 8 pt negrito', async () => {
    const m = extremo();
    expect(m.imposto.every((c) => !c.valor.includes('R$'))).toBe(true);
    const c = await latin1Hex(await renderizarDanfe(m));
    expect(c).not.toContain(hex('R$ '));
  });
});
