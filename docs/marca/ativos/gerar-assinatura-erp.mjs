// Ativos finais da assinatura "Macuxi ERP", v1 (T-0049, 22/11/2026).
// Base: ativos oficiais do Macuxi FDV (macuxifdv@b75ab88, docs/marca/ativos/2026-11-12-v1/), copiados sem
// alteração para docs/marca/ativos/fdv-2026-11-12-v1/. O símbolo e o "Macuxi" em curvas saem LITERALMENTE
// desses arquivos; só o descritor muda: "ERP" no lugar de "FORÇA DE VENDAS", na mesma fonte (IBM Plex Sans
// SemiBold, corpo 28), na mesma linha de base e de ponta a ponta da tinta de "Macuxi" (regra 3 do FDV;
// decisão do Alexandre de 22/11/2026, assinatura-erp.md).
//
// Autoconferência: o script remonta as versões do FDV com "FORÇA DE VENDAS" e exige que saiam idênticas,
// byte a byte, aos arquivos oficiais. Se a fonte ou a geometria divergir, ele para.
//
// Uso (na raiz do repositório; nada é instalado no projeto):
//   npm i --prefix /tmp/macuxi-ot opentype.js@1.3.4 @expo-google-fonts/ibm-plex-sans
//   OPENTYPE_DIR=/tmp/macuxi-ot node docs/marca/ativos/gerar-assinatura-erp.mjs
// Saída: docs/marca/ativos/2026-11-22-v1/ (SVG e contraste.json).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FDV = join(AQUI, 'fdv-2026-11-12-v1');
const SAIDA = join(AQUI, '2026-11-22-v1');
const OT = process.env.OPENTYPE_DIR ?? '/tmp/macuxi-ot';
const opentype = createRequire(join(OT, 'resolver.js'))('opentype.js');
const plex = opentype.loadSync(
  process.env.PLEX_TTF ?? join(OT, 'node_modules/@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf'),
);
mkdirSync(SAIDA, { recursive: true });

// ---------- paleta aprovada (igual ao contraste.json do FDV) ----------
const M = JSON.parse(readFileSync(join(FDV, 'contraste.json'), 'utf8')).paleta;
const DESC_GRAFITE = '#C9D0D8'; // descritor do negativo grafite: existe só dentro do SVG oficial do FDV (assinatura-erp.md §3)

// ---------- geometria do FDV (gerar-ativos.mjs, macuxifdv@b75ab88) ----------
const SIMB = { x0: 2, y0: 13, w: 60, h: 46.5 };
const D = { corpo: 28, folga: 13 };
const CAP_PLEX = 0.698;
const G = {};
G.baseM = 68.7; // altura do "M" de "Macuxi" (Archivo ExtraBold, corpo 100) = área de proteção
G.capD = G.baseM + D.folga;
G.baseD = G.capD + CAP_PLEX * D.corpo;
G.altura = G.baseD;
G.escala = G.altura / SIMB.h;
G.larguraS = SIMB.w * G.escala;
G.espaco = 0.3 * G.altura;
G.xTinta = G.larguraS + G.espaco;
G.larguraTinta = 353.4;
G.largura = G.xTinta + G.larguraTinta;
G.topoVisivel = -3.7;
G.baixo = G.baseD + 0.211 * D.corpo;

// ---------- peças literais dos arquivos oficiais ----------
const ler = (n) => readFileSync(join(FDV, n), 'utf8');
const caminhos = (svg) => [...svg.matchAll(/<path fill="[^"]+" d="([^"]+)"\/>/g)].map((m) => m[1]);
const PALAVRA_H = caminhos(ler('macuxi-logo-positivo.svg'))[0]; // "Macuxi" do logo horizontal
const PALAVRA_E = caminhos(ler('macuxi-logo-empilhado-positivo.svg'))[0]; // "Macuxi" do empilhado
function simbolo(cor, sol, id) {
  // idêntico ao simbolo() do FDV (conferido pela autoconferência abaixo)
  return `<clipPath id="${id}"><rect width="64" height="22.8"/></clipPath><circle cx="40" cy="24" r="11" fill="${sol}" clip-path="url(#${id})"/><path d="M2 50 L10 42 L12.8 28 Q13.3 25.5 16 25.5 L48 25.5 Q50.7 25.5 51.2 28 L54 42 L62 50Z" fill="${cor}"/><rect x="2" y="55" width="60" height="4.5" rx="2.25" fill="${cor}"/>`;
}

// ---------- descritor de ponta a ponta da tinta de "Macuxi" ----------
function descritor(texto, xTinta, baseline, largura) {
  const glifos = plex.stringToGlyphs(texto);
  const k = D.corpo / plex.unitsPerEm;
  const montar = (track) => {
    let x = 0; const partes = [];
    glifos.forEach((g, i) => { partes.push({ g, x }); x += g.advanceWidth * k + (i < glifos.length - 1 ? track : 0); });
    const bbs = partes.map(({ g, x: gx }) => g.getPath(gx, 0, D.corpo).getBoundingBox()).filter((b) => b.x2 > b.x1);
    return { partes, x1: Math.min(...bbs.map((b) => b.x1)), x2: Math.max(...bbs.map((b) => b.x2)) };
  };
  const base = montar(0);
  const final = montar((largura - (base.x2 - base.x1)) / (glifos.length - 1));
  const dx = xTinta - final.x1;
  return final.partes.map(({ g, x }) => g.getPath(x + dx, baseline, D.corpo).toPathData(2)).join('');
}

// A — horizontal (mesma caixa do logo horizontal do FDV)
function versaoA({ cor, sol, texto, desc }, palavra, rotulo) {
  const vb = [0, G.topoVisivel, G.largura, G.baixo - G.topoVisivel].map((n) => n.toFixed(2)).join(' ');
  const t = `translate(${(-SIMB.x0 * G.escala).toFixed(3)} ${(-SIMB.y0 * G.escala).toFixed(3)}) scale(${G.escala.toFixed(5)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${rotulo}"><defs/><g transform="${t}">${simbolo(cor, sol, 'sol-h')}</g><path fill="${texto}" d="${PALAVRA_H}"/><path fill="${desc}" d="${descritor(palavra, G.xTinta, G.baseD, G.larguraTinta)}"/></svg>`;
}
// C — vertical de apoio (mesma caixa do empilhado do FDV)
function versaoC({ cor, sol, texto, desc }, palavra, rotulo) {
  const ls = 0.62 * G.larguraTinta; const es = ls / SIMB.w; const hs = SIMB.h * es; const y0 = hs + 0.3 * hs;
  const W = G.larguraTinta; const xS = (W - ls) / 2;
  const t = `translate(${(xS - SIMB.x0 * es).toFixed(3)} ${(-SIMB.y0 * es).toFixed(3)}) scale(${es.toFixed(5)})`;
  const baixo = y0 + G.baseD + 0.211 * D.corpo;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${baixo.toFixed(2)}" role="img" aria-label="${rotulo}"><g transform="${t}">${simbolo(cor, sol, 'sol-e')}</g><path fill="${texto}" d="${PALAVRA_E}"/><path fill="${desc}" d="${descritor(palavra, 0, y0 + G.baseD, G.larguraTinta)}"/></svg>`;
}

// ---------- versões (cores do §3 da assinatura-erp.md = as do FDV) ----------
const VERSOES = {
  positivo: { cor: M.azulNoite, sol: M.sol, texto: M.grafite, desc: M.ink2, fundos: { branco: M.branco, perola: M.perola } },
  'negativo-azul-noite': { cor: M.branco, sol: M.solClaro, texto: M.branco, desc: M.claroNoAzul, fundos: { azulNoite: M.azulNoite } },
  'negativo-grafite': { cor: M.azulClaro, sol: M.solClaro, texto: M.branco, desc: DESC_GRAFITE, fundos: { grafite: M.grafite } },
  'mono-preto': { cor: M.preto, sol: M.preto, texto: M.preto, desc: M.preto, fundos: { branco: M.branco, perola: M.perola } },
  'mono-branco': { cor: M.branco, sol: M.branco, texto: M.branco, desc: M.branco, fundos: { azulNoite: M.azulNoite, grafite: M.grafite } },
};

// ---------- autoconferência contra os arquivos oficiais do FDV ----------
const OFICIAIS = [
  ['macuxi-logo-positivo.svg', versaoA, 'positivo'], ['macuxi-logo-negativo-azul-noite.svg', versaoA, 'negativo-azul-noite'],
  ['macuxi-logo-negativo-grafite.svg', versaoA, 'negativo-grafite'], ['macuxi-logo-mono-preto.svg', versaoA, 'mono-preto'],
  ['macuxi-logo-mono-branco.svg', versaoA, 'mono-branco'], ['macuxi-logo-empilhado-positivo.svg', versaoC, 'positivo'],
  ['macuxi-logo-empilhado-negativo.svg', versaoC, 'negativo-azul-noite'],
];
for (const [arq, f, v] of OFICIAIS) {
  if (`${f(VERSOES[v], 'FORÇA DE VENDAS', 'Macuxi Força de Vendas')}\n` !== ler(arq)) throw new Error(`autoconferência: ${arq} não bate com o oficial do FDV`);
}

// ---------- arquivos finais ----------
for (const [v, c] of Object.entries(VERSOES)) {
  writeFileSync(join(SAIDA, `macuxi-erp-a-${v}.svg`), `${versaoA(c, 'ERP', 'Macuxi ERP')}\n`);
  writeFileSync(join(SAIDA, `macuxi-erp-c-${v}.svg`), `${versaoC(c, 'ERP', 'Macuxi ERP')}\n`);
}
// Guias de área de proteção (altura do "M" em volta da tinta), só para consulta: não é ativo de aplicação.
function guia(nome, svg) {
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
  const p = G.baseM;
  const nvb = [vb[0] - p, vb[1] - p, vb[2] + 2 * p, vb[3] + 2 * p].map((n) => n.toFixed(2)).join(' ');
  const corpo = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const ret = (x, y, w, h, extra) => `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="none" stroke="${M.ink3}" stroke-width="1.2" ${extra}/>`;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${nvb}" role="img" aria-label="Macuxi ERP: área de proteção"><rect x="${(vb[0] - p).toFixed(2)}" y="${(vb[1] - p).toFixed(2)}" width="${(vb[2] + 2 * p).toFixed(2)}" height="${(vb[3] + 2 * p).toFixed(2)}" fill="${M.branco}"/>${ret(vb[0] - p + 0.6, vb[1] - p + 0.6, vb[2] + 2 * p - 1.2, vb[3] + 2 * p - 1.2, 'stroke-dasharray="6 4"')}${ret(vb[0], vb[1], vb[2], vb[3], 'stroke-dasharray="2 3"')}${corpo}</svg>`;
  writeFileSync(join(SAIDA, nome), `${out}\n`);
}
guia('guia-area-de-protecao-a.svg', versaoA(VERSOES.positivo, 'ERP', 'Macuxi ERP'));
guia('guia-area-de-protecao-c.svg', versaoC(VERSOES.positivo, 'ERP', 'Macuxi ERP'));

// ---------- contraste (WCAG 2.x, a mesma conta do FDV) ----------
const canal = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const pares = [];
for (const [v, c] of Object.entries(VERSOES)) {
  for (const [nomeFundo, bg] of Object.entries(c.fundos)) {
    for (const [peca, fg, min] of [['escrita "Macuxi"', c.texto, 4.5], ['descritor "ERP"', c.desc, 4.5], ['símbolo (serra e lavrado)', c.cor, 3], ['sol', c.sol, 3]]) {
      const r = contraste(fg, bg);
      pares.push({ versao: v, fundo: nomeFundo, peca, fg, bg, razao: Number(r.toFixed(2)), minimo: min, passa: r >= min });
    }
  }
}
const geometria = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, Number(v.toFixed(2))]));
writeFileSync(join(SAIDA, 'contraste.json'), `${JSON.stringify({ origem: 'macuxifdv@b75ab88 docs/marca/ativos/2026-11-12-v1 (cópia em ../fdv-2026-11-12-v1)', paleta: { ...M, descritorNegativoGrafite: DESC_GRAFITE }, geometria, pares }, null, 2)}\n`);
const falhas = pares.filter((p) => !p.passa);
if (falhas.length) throw new Error(`par abaixo do mínimo: ${JSON.stringify(falhas)}`);
console.log(`autoconferência ok (${OFICIAIS.length} oficiais do FDV); 10 SVG + 2 guias; ${pares.length} pares de contraste, todos passam`);
