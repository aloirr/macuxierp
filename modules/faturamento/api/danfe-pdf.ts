/**
 * DANFE em PDF (RF-FAT-03): desenha o `ModeloDanfe` com o pdf-lib, A4 retrato, Helvetica regular e negrito embutidas, só preto #000000
 * (cinza #D9D9D9 apenas nas marcas d'água), sem dado pessoal em log. Regras de marca: docs/marca/danfe-e-pdfs-fiscais.md.
 * Leiaute do MOC, Anexo II. Tamanhos: rótulo 6 pt, conteúdo 7 pt, destaque 8 pt negrito. Nunca há reticências nem texto cortado: o que
 * não cabe em uma linha quebra em outra (campo, rótulo, descrição do item, cabeçalho da tabela) e a altura da linha acompanha; coluna
 * numérica estreita é alargada à custa da descrição. A tabela pagina por altura. "Dados adicionais" fica logo abaixo da tabela (na 1ª folha
 * quando ela basta) e continua na folha seguinte se não couber. A marca d'água é desenhada ANTES do conteúdo, em todas as folhas.
 */
import {
  concatTransformationMatrix, degrees, drawObject, PDFDocument, popGraphicsState, pushGraphicsState, rgb, StandardFonts, type PDFFont, type PDFPage,
} from 'pdf-lib';
import { caixaDoLogo, FONTE_CONTEUDO_PT, MARCA_DAGUA, RODAPE_DANFE, type LinhaProduto, type ModeloDanfe } from '../domain/danfe';
import { codigoBarras128C } from '../domain/codigo-barras';
import { ErroLogo, logoEmCinza } from './logo-cinza';

export interface OpcoesPdfDanfe {
  /** PNG do logo do EMITENTE (nunca o da Macuxi). Inválido ou ausente: o quadro sai sem logo, com os dados centralizados. */
  logoEmitente?: Uint8Array | null;
  /** PNG da assinatura "Emitido pelo ..." (ativo da marca). Obrigatória: DANFE sem rodapé nunca é gerado. */
  assinaturaMarca: Uint8Array;
  /** Instante gravado nos metadados (padrão: agora). */
  agora?: Date;
}

export const A4 = { l: 595.28, a: 841.89 };
export const MARGEM = 28.35; // ≈ 10 mm; valor aprovado pela marca (borda 566,93), não trocar por 10*MM
const LARG = A4.l - 2 * MARGEM;
const PRETO = rgb(0, 0, 0);
const CINZA_MARCA = rgb(MARCA_DAGUA.cinza, MARCA_DAGUA.cinza, MARCA_DAGUA.cinza);
const ROTULO = 6;
const CONTEUDO = FONTE_CONTEUDO_PT;
const DESTAQUE = 8;
export const BASE_UTIL = 2 * RODAPE_DANFE.protecaoPt + RODAPE_DANFE.alturaAssinaturaPt; // 14,9 + 24 (logo) + 14,9: nada de quadro abaixo disso
const LIMITE = A4.a - BASE_UTIL; // topo (de cima para baixo) a partir do qual nada é desenhado
const ENTRELINHA = 8.5; // linha de 7 pt da tabela e dos blocos de texto
const H_CAMPO = 22;
// Respiro de 1,5 pt medido pela FontBBox (Helvetica +0,931/-0,225 do corpo; negrito +0,962/-0,228), com acento e cedilha:
const BASE_ROTULO = 7.1; // base do rótulo a 6 pt: 0,931 x 6 + 1,5 = 7,09 abaixo da linha de cima
const BASE_TITULO = 6.85; // base do título a 7 pt negrito: 10 (linha de baixo) - 0,228 x 7 - 1,5 = 6,90 -> 3,15 acima da linha
const COLUNAS: { rotulo: string; chave: keyof LinhaProduto; largura: number; dir?: boolean }[] = [
  { rotulo: 'CÓDIGO', chave: 'codigo', largura: 36 },
  { rotulo: 'DESCRIÇÃO DO PROD./SERV.', chave: 'descricao', largura: 112 },
  { rotulo: 'NCM/SH', chave: 'ncm', largura: 36 },
  { rotulo: 'O/CST', chave: 'cst', largura: 24 },
  { rotulo: 'CFOP', chave: 'cfop', largura: 24 },
  { rotulo: 'UN', chave: 'unidade', largura: 18 },
  { rotulo: 'QUANT.', chave: 'quantidade', largura: 44, dir: true },
  { rotulo: 'V. UNIT.', chave: 'valorUnitario', largura: 40, dir: true },
  { rotulo: 'V. DESC.', chave: 'valorDesconto', largura: 32, dir: true },
  { rotulo: 'V. TOTAL', chave: 'valorTotal', largura: 40, dir: true },
  { rotulo: 'BC ICMS', chave: 'baseIcms', largura: 38, dir: true },
  { rotulo: 'V. ICMS', chave: 'valorIcms', largura: 32, dir: true },
  { rotulo: 'V. IPI', chave: 'valorIpi', largura: 26, dir: true },
  { rotulo: 'A.ICMS', chave: 'aliquotaIcms', largura: 20, dir: true },
  { rotulo: 'A.IPI', chave: 'aliquotaIpi', largura: 16, dir: true },
];

interface Ctx {
  pagina: PDFPage;
  reg: PDFFont;
  neg: PDFFont;
  /** y do topo medido do topo da folha (cresce para baixo). */
  y: (topo: number) => number;
}

/**
 * Largura do texto como o pdf-lib DESENHA: soma dos avanços de cada caractere, sem kerning. `widthOfTextAtSize` aplica os pares de kerning
 * do AFM ("V.", "TO"...), mas `drawText` não os aplica, então o texto sai mais largo que o medido (até 2,6 pt em "V. TOTAL") e o alinhamento
 * à direita invade a linha. Toda medida de largura do DANFE usa esta função.
 */
export const larg = (f: PDFFont, t: string, pt: number): number => [...t].reduce((a, ch) => a + f.widthOfTextAtSize(ch, pt), 0);

/** A Helvetica do pdf-lib só tem WinAnsi: o que não existe vira "-" (U+2212) ou "?", nunca outra fonte. */
const seguro = (f: PDFFont, t: string): string => {
  const ok = new Set(f.getCharacterSet());
  return [...t.replace(/\r?\n/g, ' ')].map((c) => (ok.has(c.codePointAt(0)!) ? c : c === '−' ? '-' : '?')).join('');
};
function quebrar(f: PDFFont, t: string, pt: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const par of t.split(/\r?\n/)) {
    let atual = '';
    for (const palavra of par.split(/[ \t]+/).filter(Boolean)) {
      const tent = atual ? `${atual} ${palavra}` : palavra;
      if (larg(f, tent, pt) <= largura) atual = tent;
      else {
        if (atual) linhas.push(atual);
        atual = palavra;
        while (larg(f, atual, pt) > largura && atual.length > 1) {
          let k = atual.length - 1;
          while (k > 1 && larg(f, atual.slice(0, k), pt) > largura) k--;
          linhas.push(atual.slice(0, k));
          atual = atual.slice(k);
        }
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

function texto(c: Ctx, t: string, x: number, topoBase: number, pt: number, negrito = false, alinhar: 'e' | 'c' | 'd' = 'e', largura = 0): void {
  const f = negrito ? c.neg : c.reg;
  const s = seguro(f, t);
  const w = larg(f, s, pt);
  const px = alinhar === 'e' ? x : alinhar === 'c' ? x + (largura - w) / 2 : x + largura - w;
  c.pagina.drawText(s, { x: px, y: c.y(topoBase), size: pt, font: f, color: PRETO });
}

function moldura(c: Ctx, x: number, topo: number, w: number, h: number): void {
  c.pagina.drawRectangle({ x, y: c.y(topo + h), width: w, height: h, borderColor: PRETO, borderWidth: 0.5 });
}

interface DefCampo {
  x: number;
  w: number;
  rotulo: string;
  valor: string;
  negrito?: boolean;
  alinhar?: 'e' | 'c' | 'd';
}
interface MedidaCampo {
  rotulo: string[];
  valor: string[];
  h: number;
}
/** Rótulo (6 pt, caixa alta) e valor (7 pt, ou 8 pt negrito) quebrados na largura do campo; `h` é a altura que os acomoda (mín. H_CAMPO). */
function medirCampo(c: Ctx, d: DefCampo): MedidaCampo {
  const f = d.negrito ? c.neg : c.reg;
  const rotulo = quebrar(c.reg, seguro(c.reg, d.rotulo.toUpperCase()), ROTULO, d.w - 3);
  const valor = quebrar(f, seguro(f, d.valor), d.negrito ? DESTAQUE : CONTEUDO, d.w - 4);
  return { rotulo, valor, h: Math.max(H_CAMPO, 19.5 + (rotulo.length - 1) * 6.5 + (valor.length - 1) * (d.negrito ? 9 : 7.5)) };
}
function campo(c: Ctx, d: DefCampo, topo: number, h: number, med: MedidaCampo): void {
  moldura(c, d.x, topo, d.w, h);
  med.rotulo.forEach((l, i) => texto(c, l, d.x + 2, topo + BASE_ROTULO + i * 6.5, ROTULO));
  const pt = d.negrito ? DESTAQUE : CONTEUDO;
  const passo = d.negrito ? 9 : 7.5;
  med.valor.forEach((l, i) => texto(c, l, d.x + 2, topo + h - 4.5 - (med.valor.length - 1 - i) * passo, pt, d.negrito, d.alinhar ?? 'e', d.w - 4));
}
/** Fileira de campos lado a lado: todos com a altura do mais alto. Devolve a altura. */
function fileira(c: Ctx, topo: number, defs: DefCampo[]): number {
  const meds = defs.map((d) => medirCampo(c, d));
  const h = Math.max(...meds.map((m) => m.h));
  defs.forEach((d, i) => campo(c, d, topo, h, meds[i]!));
  return h;
}
const tituloQuadro = (c: Ctx, titulo: string, x: number, topo: number): void => texto(c, titulo.toUpperCase(), x, topo + BASE_TITULO, CONTEUDO, true);

/** Marca d'água de texto: Helvetica negrito 60 pt, a ±45° no centro da folha, em #D9D9D9, desenhada por baixo (antes) do conteúdo. */
function marcaDagua(c: Ctx, t: string, sentido: 1 | -1): void {
  const graus = sentido * MARCA_DAGUA.anguloGraus, fontePt = MARCA_DAGUA.fontePt;
  const s = seguro(c.neg, t);
  const w = larg(c.neg, s, fontePt);
  const h = c.neg.heightAtSize(fontePt, { descender: false });
  const r = (graus * Math.PI) / 180;
  const cx = A4.l / 2, cy = A4.a / 2;
  c.pagina.drawText(s, {
    x: cx - ((w / 2) * Math.cos(r) - (h / 2) * Math.sin(r)),
    y: cy - ((w / 2) * Math.sin(r) + (h / 2) * Math.cos(r)),
    size: fontePt, font: c.neg, color: CINZA_MARCA, rotate: degrees(graus),
  });
}

function barras(c: Ctx, chave: string, x: number, topo: number, w: number, h: number): void {
  const { larguras, modulos } = codigoBarras128C(chave);
  const m = w / modulos;
  let px = x;
  larguras.forEach((l, i) => {
    if (i % 2 === 0) c.pagina.drawRectangle({ x: px, y: c.y(topo + h), width: l * m, height: h, color: PRETO });
    px += l * m;
  });
}

async function embutirCinza(doc: PDFDocument, png: Uint8Array) {
  const g = logoEmCinza(png);
  const ref = doc.context.register(
    doc.context.flateStream(g.pixels, { Type: 'XObject', Subtype: 'Image', Width: g.largura, Height: g.altura, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never),
  );
  return { ref, largura: g.largura, altura: g.altura };
}

function desenharImagem(c: Ctx, nome: ReturnType<PDFPage['node']['newXObject']>, x: number, yBase: number, w: number, h: number): void {
  c.pagina.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, yBase), drawObject(nome), popGraphicsState());
}

function rodape(c: Ctx, assinatura: PDFImageLike): void {
  const r = RODAPE_DANFE;
  const xDir = A4.l - MARGEM;
  const xImg = xDir - r.larguraAssinaturaPt;
  const yBase = r.protecaoPt;
  c.pagina.drawImage(assinatura.imagem, { x: xImg, y: yBase, width: r.larguraAssinaturaPt, height: r.alturaAssinaturaPt });
  const t = r.texto;
  const w = larg(c.reg, t, r.fontePt);
  c.pagina.drawText(t, { x: xImg - r.protecaoPt - w, y: yBase + r.baseTextoPt, size: r.fontePt, font: c.reg, color: PRETO });
}
interface PDFImageLike {
  imagem: Awaited<ReturnType<PDFDocument['embedPng']>>;
}

type LogoEmbutido = { ref: unknown; largura: number; altura: number } | null;
/** Onde cada folha escreve "Folha x/y" (só se sabe o total depois de paginar). */
interface PosFolha {
  x: number;
  w: number;
  topo: number;
}

/**
 * Cabeçalho de TODA folha (premissa do modulo-fiscal sobre o MOC, Anexo II): emitente, quadro DANFE (tipo, nº, série, folha), chave com código de
 * barras, natureza, protocolo, IE e CNPJ. O canhoto e, depois do cabeçalho, destinatário, fatura, imposto e transportador só saem na 1ª folha.
 * Devolve o topo (de cima para baixo) onde termina.
 */
function cabecalhoCompleto(c: Ctx, m: ModeloDanfe, logo: LogoEmbutido, primeira: boolean): { fim: number; folha: PosFolha } {
  const x0 = MARGEM;
  let t = 28;
  if (primeira) {
    // canhoto
    const wCanhoto = 400;
    moldura(c, x0, t, wCanhoto, 32);
    quebrar(c.reg, seguro(c.reg, m.canhoto.texto), ROTULO, wCanhoto - 4).slice(0, 3).forEach((l, i) => texto(c, l, x0 + 2, t + 8 + i * 7.5, ROTULO));
    fileira(c, t + 32, [
      { x: x0, w: 100, rotulo: 'Data de recebimento', valor: '' },
      { x: x0 + 100, w: wCanhoto - 100, rotulo: 'Identificação e assinatura do recebedor', valor: '' },
    ]);
    moldura(c, x0 + wCanhoto, t, LARG - wCanhoto, 54);
    texto(c, 'NF-e', x0 + wCanhoto, t + 14, DESTAQUE, true, 'c', LARG - wCanhoto);
    texto(c, `Nº ${m.cabecalho.numero}`, x0 + wCanhoto, t + 28, DESTAQUE, true, 'c', LARG - wCanhoto);
    texto(c, `Série ${m.cabecalho.serie}`, x0 + wCanhoto, t + 42, DESTAQUE, true, 'c', LARG - wCanhoto);
    t += 54 + 4;
    c.pagina.drawLine({ start: { x: x0, y: c.y(t) }, end: { x: A4.l - MARGEM, y: c.y(t) }, thickness: 0.4, color: PRETO, dashArray: [3, 2] });
    t += 4;

  }

  // cabeçalho: emitente | DANFE | chave
  const hCab = 100;
  const wEm = 200, wDa = 110, wCh = LARG - wEm - wDa;
  moldura(c, x0, t, wEm, hCab);
  let xDados = x0, wDados = wEm;
  if (logo) {
    const cx = caixaDoLogo({ largura: wEm, altura: hCab }, logo);
    desenharImagem(c, c.pagina.node.newXObject('LogoEmitente', logo.ref as never), x0 + cx.x, c.y(t + hCab) + cx.y, cx.largura, cx.altura);
    xDados = x0 + wEm / 3;
    wDados = wEm - wEm / 3;
  }
  const linhasEm = [
    ...quebrar(c.neg, seguro(c.neg, m.cabecalho.emitente.nome), DESTAQUE, wDados - 6).map((l) => ({ l, neg: true })),
    ...m.cabecalho.emitente.linhasEndereco.flatMap((l) => quebrar(c.reg, seguro(c.reg, l), CONTEUDO, wDados - 6).map((x) => ({ l: x, neg: false }))),
    ...(m.cabecalho.emitente.fone ? [{ l: `Fone: ${m.cabecalho.emitente.fone}`, neg: false }] : []),
  ];
  const alturaTexto = linhasEm.length * 9.5;
  linhasEm.forEach((l, i) => texto(c, l.l, xDados, t + Math.max(0, hCab - alturaTexto) / 2 + 8 + i * 9.5, l.neg ? DESTAQUE : CONTEUDO, l.neg, 'c', wDados));

  const xd = x0 + wEm;
  moldura(c, xd, t, wDa, hCab);
  texto(c, 'DANFE', xd, t + 17, 14, true, 'c', wDa);
  m.cabecalho.subtituloLinhas.forEach((l, i) => texto(c, l, xd, t + 28 + i * 8, CONTEUDO, false, 'c', wDa)); // 7 pt, 2 linhas (marca §3)
  texto(c, m.cabecalho.tipoOperacao.legendas[0], xd + 6, t + 52, CONTEUDO);
  texto(c, m.cabecalho.tipoOperacao.legendas[1], xd + 6, t + 61, CONTEUDO);
  c.pagina.drawRectangle({ x: xd + wDa - 24, y: c.y(t + 68), width: 16, height: 16, borderColor: PRETO, borderWidth: 0.7 });
  texto(c, m.cabecalho.tipoOperacao.codigo, xd + wDa - 24, t + 64, DESTAQUE, true, 'c', 16);
  texto(c, `Nº ${m.cabecalho.numero}`, xd, t + 80.5, DESTAQUE, true, 'c', wDa);
  texto(c, `Série ${m.cabecalho.serie}`, xd, t + 89, DESTAQUE, true, 'c', wDa);
  const folha: PosFolha = { x: xd, w: wDa, topo: t + 96.5 }; // linha de base a 3,5 pt acima do eixo da linha do quadro (t + 100): a caixa com descendentes de 7 pt fica a >= 1,5 pt do eixo

  const xc = xd + wDa;
  moldura(c, xc, t, wCh, 38);
  barras(c, m.cabecalho.chave, xc + 6, t + 4, wCh - 12, 30);
  fileira(c, t + 38, [{ x: xc, w: wCh, rotulo: 'Chave de acesso', valor: m.cabecalho.chaveFormatada, negrito: true }]);
  moldura(c, xc, t + 62, wCh, 38);
  quebrar(c.reg, m.cabecalho.consultaTexto, CONTEUDO, wCh - 6).slice(0, 3).forEach((l, i) => texto(c, l, xc + 3, t + 72 + i * 8.5, CONTEUDO, false, 'c', wCh - 6));
  t += hCab;

  // natureza, protocolo, inscrições
  t += fileira(c, t, [
    { x: x0, w: 330, rotulo: 'Natureza da operação', valor: m.operacao.naturezaOperacao },
    { x: x0 + 330, w: LARG - 330, rotulo: 'Protocolo de autorização de uso', valor: m.operacao.protocolo },
  ]);
  t += fileira(c, t, [
    { x: x0, w: 190, rotulo: 'Inscrição estadual', valor: m.operacao.ie },
    { x: x0 + 190, w: 190, rotulo: 'Inscr. estadual do subst. trib.', valor: m.operacao.ieSubstituicao },
    { x: x0 + 380, w: LARG - 380, rotulo: 'CNPJ / CPF', valor: m.operacao.cnpj },
  ]) + 4;

  if (!primeira) return { fim: t + 4, folha };

  // destinatário
  const d = m.destinatario;
  tituloQuadro(c, 'Destinatário / remetente', x0, t);
  t += 10;
  t += fileira(c, t, [
    { x: x0, w: 300, rotulo: 'Nome / razão social', valor: d.nome },
    { x: x0 + 300, w: 130, rotulo: 'CNPJ / CPF', valor: d.documento },
    { x: x0 + 430, w: LARG - 430, rotulo: 'Data da emissão', valor: d.emissao },
  ]);
  t += fileira(c, t, [
    { x: x0, w: 230, rotulo: 'Endereço', valor: d.endereco },
    { x: x0 + 230, w: 130, rotulo: 'Bairro / distrito', valor: d.bairro },
    { x: x0 + 360, w: 80, rotulo: 'CEP', valor: d.cep },
    { x: x0 + 440, w: LARG - 440, rotulo: 'Data de saída / entrada', valor: d.saida },
  ]);
  t += fileira(c, t, [
    { x: x0, w: 230, rotulo: 'Município', valor: d.municipio },
    { x: x0 + 230, w: 130, rotulo: 'Fone / fax', valor: d.fone },
    { x: x0 + 360, w: 40, rotulo: 'UF', valor: d.uf },
    { x: x0 + 400, w: LARG - 400, rotulo: 'Inscrição estadual', valor: d.ie },
  ]) + 4;

  // fatura (só quando houver): todas as duplicatas, 5 por linha, nunca "ver XML"
  if (m.duplicatas.length) {
    tituloQuadro(c, 'Fatura / duplicata', x0, t);
    t += 10;
    const por = 5;
    const w = LARG / por;
    for (let ini = 0; ini < m.duplicatas.length; ini += por) {
      const celulas = m.duplicatas.slice(ini, ini + por).map((dp) => quebrar(c.reg, seguro(c.reg, `${dp.numero} ${dp.vencimento} ${dp.valor}`), CONTEUDO, w - 4));
      const h = Math.max(16, Math.max(...celulas.map((l) => l.length)) * ENTRELINHA + 7);
      moldura(c, x0, t, LARG, h);
      celulas.forEach((ls, i) => ls.forEach((l, k) => texto(c, l, x0 + i * w + 2, t + 11 + k * ENTRELINHA, CONTEUDO)));
      t += h;
    }
    t += 4;
  }

  // cálculo do imposto
  tituloQuadro(c, 'Cálculo do imposto', x0, t);
  t += 10;
  const imp = m.imposto;
  t += fileira(c, t, imp.slice(0, 5).map((f, i) => ({ x: x0 + (i * LARG) / 5, w: LARG / 5, rotulo: f.rotulo, valor: f.valor, alinhar: 'd' as const })));
  t += fileira(c, t, imp.slice(5).map((f, i) => ({ x: x0 + (i * LARG) / 6, w: LARG / 6, rotulo: f.rotulo, valor: f.valor, alinhar: 'd' as const, negrito: i === 5 }))) + 4;

  // transportador
  tituloQuadro(c, 'Transportador / volumes transportados', x0, t);
  t += 10;
  const tr = m.transportador;
  const linhasTr: [number, number][][] = [
    [[0, 130], [1, 190], [2, 80], [3, 55], [4, LARG - 455]],
    [[5, 220], [6, 150], [7, 30], [8, LARG - 400]],
    [[9, 70], [10, 100], [11, 100], [12, 100], [13, 84], [14, LARG - 454]],
  ];
  for (const ln of linhasTr) {
    let xx = x0;
    const defs: DefCampo[] = [];
    for (const [i, w] of ln) {
      defs.push({ x: xx, w, rotulo: tr[i]!.rotulo, valor: tr[i]!.valor });
      xx += w;
    }
    t += fileira(c, t, defs);
  }
  return { fim: t + 4, folha };
}

/**
 * Larguras das colunas da tabela de produtos (marca §3: conteúdo nunca abaixo de 7 pt, rótulo nunca abaixo de 6 pt). Duas garantias, ambas
 * à custa da descrição (que quebra em mais linhas): coluna numérica que não cabe a 7 pt é alargada; e toda coluna tem pelo menos a largura da
 * maior palavra do cabeçalho (6 pt) mais 1,5 pt de respiro de cada lado, para o cabeçalho nunca cruzar a linha da coluna.
 */
export function largurasColunas(reg: PDFFont, itens: LinhaProduto[]): number[] {
  const escala = LARG / COLUNAS.reduce((a, k) => a + k.largura, 0);
  const ws = COLUNAS.map((k) => k.largura * escala);
  const iDesc = COLUNAS.findIndex((k) => k.chave === 'descricao');
  const minDesc = Math.max(larg(reg, 'DESCRIÇÃO DO', ROTULO), larg(reg, 'PROD./SERV.', ROTULO)) + 3; // o rótulo da descrição fica em 2 linhas, nunca 3
  const alargar = (i: number, precisa: number) => {
    if (i === iDesc || precisa <= ws[i]!) return;
    ws[iDesc] = Math.max(minDesc, ws[iDesc]! - (precisa - ws[i]!));
    ws[i] = precisa;
  };
  const minimo = COLUNAS.map((col) => {
    const maiorPalavra = Math.max(...seguro(reg, col.rotulo).split(/\s+/).map((p) => larg(reg, p, ROTULO)));
    if (col.chave === 'descricao') return maiorPalavra + 3;
    return Math.max(maiorPalavra + 3, ...itens.map((it) => larg(reg, seguro(reg, it[col.chave]), CONTEUDO) + 3)); // as demais: o valor nunca é quebrado ao meio, nem na devolução da folga
  });
  COLUNAS.forEach((_, i) => alargar(i, minimo[i]!));
  // Com vários valores de 13 inteiros a descrição já está no mínimo e a soma passa da folha: as demais colunas devolvem a folga que têm
  // além do mínimo do seu conteúdo (proporcional à folga), para a tabela nunca passar da largura útil.
  const excesso = ws.reduce((a, b) => a + b, 0) - LARG;
  if (excesso > 1e-9) {
    const folgas = ws.map((w, i) => (i === iDesc ? 0 : Math.max(0, w - minimo[i]!)));
    const totalFolga = folgas.reduce((a, b) => a + b, 0);
    if (totalFolga > 0) {
      const f = Math.min(1, excesso / totalFolga);
      ws.forEach((w, i) => (ws[i] = w - folgas[i]! * f));
    }
  }
  return ws;
}

/** Cabeçalho da tabela: cada rótulo quebrado (6 pt) na largura da coluna menos 3 pt; nunca reticências. */
export function linhasCabecalhoTabela(reg: PDFFont, ws: number[]): { linhas: string[]; pt: number }[] {
  return COLUNAS.map((col, i) => ({ linhas: quebrar(reg, seguro(reg, col.rotulo), ROTULO, ws[i]! - 3), pt: ROTULO }));
}

interface ItemMedido {
  celulas: string[][];
  h: number;
}
/** Altura variável da linha do item: a célula com mais linhas manda (7 pt, entrelinha 8,5 pt, 5,5 pt de folga). */
function medirItem(reg: PDFFont, it: LinhaProduto, ws: number[]): ItemMedido {
  const celulas = COLUNAS.map((col, i) => {
    const v = seguro(reg, it[col.chave]);
    return col.dir ? [v] : quebrar(reg, v, CONTEUDO, ws[i]! - 3);
  });
  return { celulas, h: Math.max(...celulas.map((l) => l.length)) * ENTRELINHA + 5.5 };
}

function tabelaProdutos(c: Ctx, topo: number, ws: number[], cab: { linhas: string[]; pt: number }[], hCab: number, itens: ItemMedido[]): void {
  const x0 = MARGEM;
  tituloQuadro(c, 'Dados dos produtos / serviços', x0, topo);
  let t = topo + 10;
  let xx = x0;
  const xs: number[] = [];
  COLUNAS.forEach((col, i) => {
    const w = ws[i]!;
    xs.push(xx);
    moldura(c, xx, t, w, hCab);
    cab[i]!.linhas.forEach((l, k) => texto(c, l, xx + 1.5, t + 9.5 + k * 6.5, ROTULO, false, col.dir ? 'd' : 'e', w - 3));
    xx += w;
  });
  t += hCab;
  const altura = itens.reduce((a, it) => a + it.h, 0);
  COLUNAS.forEach((_, i) => moldura(c, xs[i]!, t, ws[i]!, altura));
  let y = t;
  for (const it of itens) {
    COLUNAS.forEach((col, i) => {
      it.celulas[i]!.forEach((l, k) => {
        if (col.dir) texto(c, l, xs[i]!, y + 10 + k * ENTRELINHA, CONTEUDO, false, 'd', ws[i]! - 1.5); // largura já garantida para 7 pt
        else texto(c, l, xs[i]! + 1.5, y + 10 + k * ENTRELINHA, CONTEUDO);
      });
    });
    y += it.h;
  }
}

/** RF-FAT-03: renderiza o DANFE. Folha A4 retrato, Helvetica embutida; devolve os bytes do PDF. */
export async function renderizarDanfe(m: ModeloDanfe, opcoes: OpcoesPdfDanfe): Promise<Uint8Array> {
  if (!opcoes?.assinaturaMarca || opcoes.assinaturaMarca.length === 0) throw new Error('assinaturaMarca obrigatória: DANFE nunca sai sem o rodapé');
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const neg = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`DANFE NF-e ${m.cabecalho.chaveFormatada}`);
  doc.setCreator('Macuxi ERP');
  doc.setProducer('Macuxi ERP');
  doc.setCreationDate(opcoes.agora ?? new Date());
  doc.setModificationDate(opcoes.agora ?? new Date());

  let logo: Awaited<ReturnType<typeof embutirCinza>> | null = null;
  if (opcoes.logoEmitente) {
    try {
      logo = await embutirCinza(doc, opcoes.logoEmitente);
    } catch (e) {
      if (!(e instanceof ErroLogo)) throw e; // logo ruim não derruba o DANFE: sai sem logo (o aviso é de quem chama)
    }
  }
  const assinatura: PDFImageLike = { imagem: await doc.embedPng(opcoes.assinaturaMarca) };

  const folhas: { c: Ctx; folha: PosFolha }[] = [];
  /** Abre uma folha: marcas d'água por baixo, aviso de homologação e o cabeçalho (completo em todas; canhoto, destinatário, imposto e transportador só na 1ª). */
  const novaFolha = (): { c: Ctx; topo: number } => {
    const primeira = folhas.length === 0;
    const c: Ctx = { pagina: doc.addPage([A4.l, A4.a]), reg, neg, y: (topo) => A4.a - topo };
    if (m.marcaDagua) marcaDagua(c, m.marcaDagua, 1);
    if (m.tarjaCancelada) marcaDagua(c, m.tarjaCancelada, -1);
    if (m.avisoHomologacao) texto(c, m.avisoHomologacao, MARGEM, 18, DESTAQUE, true, 'c', LARG);
    if (m.contingencia) texto(c, m.contingencia.titulo, MARGEM, m.avisoHomologacao ? 9 : 18, DESTAQUE, true, 'c', LARG); // RN-FAT-08: em todas as folhas; os detalhes abrem os dados adicionais
    const r = cabecalhoCompleto(c, m, logo, primeira);
    folhas.push({ c, folha: r.folha });
    return { c, topo: r.fim };
  };

  // tabela de produtos: paginada por altura (linha variável)
  const itens = m.itens;
  const ws = largurasColunas(reg, itens);
  const cab = linhasCabecalhoTabela(reg, ws);
  const hCab = 6 + Math.max(...cab.map((k) => k.linhas.length)) * 6.5;
  const medidos = itens.map((it) => medirItem(reg, it, ws));
  let cur = novaFolha();
  if (cur.topo + 10 + hCab + (medidos[0]?.h ?? 0) > LIMITE) cur = novaFolha(); // nem o cabeçalho e a 1ª linha cabem: a tabela começa na folha seguinte
  let i = 0;
  for (;;) {
    const ini = i;
    let fim = cur.topo + 10 + hCab;
    while (i < medidos.length && fim + medidos[i]!.h <= LIMITE) fim += medidos[i++]!.h;
    if (i === ini && i < medidos.length) fim += medidos[i++]!.h; // linha mais alta que a folha: desenha mesmo assim, nunca trava
    tabelaProdutos(cur.c, cur.topo, ws, cab, hCab, medidos.slice(ini, i));
    cur.topo = fim;
    if (i >= medidos.length) break;
    cur = novaFolha();
  }

  // Dados adicionais: na última folha, logo abaixo da tabela (MOC); sem espaço, segue para a folha seguinte. Nada é cortado.
  const wInf = LARG * 0.65, wFisco = LARG - wInf;
  const infL = quebrar(reg, seguro(reg, m.dadosAdicionais.informacoesComplementares), CONTEUDO, wInf - 4);
  const fiscoL = quebrar(reg, seguro(reg, m.dadosAdicionais.fisco), CONTEUDO, wFisco - 4);
  let a = 0, b = 0, primeiroBloco = true;
  do {
    let topo = cur.topo + 4;
    if (LIMITE - (topo + 10) < 40) {
      cur = novaFolha();
      topo = cur.topo;
    }
    const topoBox = topo + 10;
    const cabem = Math.floor((LIMITE - topoBox - 15.5) / ENTRELINHA);
    const la = infL.slice(a, a + cabem), lb = fiscoL.slice(b, b + cabem);
    a += la.length;
    b += lb.length;
    const h = Math.max(40, 15.5 + Math.max(la.length, lb.length) * ENTRELINHA);
    tituloQuadro(cur.c, primeiroBloco ? 'Dados adicionais' : 'Dados adicionais (continuação)', MARGEM, topo);
    moldura(cur.c, MARGEM, topoBox, wInf, h);
    moldura(cur.c, MARGEM + wInf, topoBox, wFisco, h);
    texto(cur.c, 'INFORMAÇÕES COMPLEMENTARES', MARGEM + 2, topoBox + BASE_ROTULO, ROTULO);
    texto(cur.c, 'RESERVADO AO FISCO', MARGEM + wInf + 2, topoBox + BASE_ROTULO, ROTULO);
    la.forEach((l, k) => texto(cur.c, l, MARGEM + 2, topoBox + 17 + k * ENTRELINHA, CONTEUDO));
    lb.forEach((l, k) => texto(cur.c, l, MARGEM + wInf + 2, topoBox + 17 + k * ENTRELINHA, CONTEUDO));
    cur.topo = topoBox + h;
    primeiroBloco = false;
  } while (a < infL.length || b < fiscoL.length);

  // "Folha x/y" e rodapé, agora que o total é conhecido
  folhas.forEach(({ c, folha }, k) => {
    texto(c, `Folha ${k + 1}/${folhas.length}`, folha.x, folha.topo, CONTEUDO, false, 'c', folha.w);
    rodape(c, assinatura);
  });
  return doc.save();
}
