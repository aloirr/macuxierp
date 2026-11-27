import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DialogoMotivo } from './DialogoMotivo.js';
import { FormularioItens, type ItemLinha } from './FormularioItens.js';
import { TabelaDensa, type ColunaTabela } from './TabelaDensa.js';
import { botaoDestrutivo, botaoPrincipal, botaoSecundario, gerarCssBotoes } from './estilos.js';
import { AssinaturaErp, SHA256_ASSINATURA_A_NEGATIVO_AZUL_NOITE, SHA256_ASSINATURA_A_NEGATIVO_GRAFITE, SHA256_ASSINATURA_C_POSITIVO, assinaturaANegativoGrafite, assinaturaCPositivo, SHA256_SIMBOLO_NEGATIVO, alturaAssinatura, assinaturaANegativoAzulNoite, faviconDataUri, faviconSvg, paraDataUri, simboloNegativo } from './marca.js';

const sha256 = (literal: string) => createHash('sha256').update(literal + '\n').digest('hex');
const novoItem = (chave: string): ItemLinha => ({ chave, produtoId: null, quantidade: 1, precoUnitarioCentavos: 0, descontoCentavos: 0 });
const total = (i: ItemLinha) => i.quantidade * i.precoUnitarioCentavos - i.descontoCentavos;
const umItem = [{ chave: 'item-1', produtoId: 'p1', quantidade: 2, precoUnitarioCentavos: 1000, descontoCentavos: 0 }];
const dialogo = (extra: Partial<Parameters<typeof DialogoMotivo>[0]> = {}) =>
  renderToStaticMarkup(<DialogoMotivo titulo="t" aoConfirmar={() => {}} aoCancelar={() => {}} {...extra} />);
const form = (extra: Partial<Parameters<typeof FormularioItens>[0]> = {}) =>
  renderToStaticMarkup(<FormularioItens itens={umItem} aoMudar={() => {}} novoItem={novoItem} calcularTotal={total} formatarCentavos={(c) => `R$ ${c}`} renderSeletorProduto={() => null} {...extra} />);

describe('bordaCampo (#232) nos componentes', () => {
  it('campo do item, texto do diálogo e botão secundário usam a borda de campo', () => {
    expect(form()).toMatch(/<input[^>]*border:1px solid var\(--mx-cor-borda-campo\)/);
    const d = dialogo();
    expect(d).toMatch(/<textarea[^>]*border:1px solid var\(--mx-cor-borda-campo\)/);
    expect(botaoSecundario().border).toBe('1px solid var(--mx-cor-borda-campo)');
  });
});

describe('botões (MC-0008): um principal e um secundário', () => {
  it('mesmo tamanho (13), altura de 34 px (decisão 45), canto e espaçamento; diferem só em cor e peso', () => {
    const p = botaoPrincipal();
    const s = botaoSecundario();
    for (const k of ['fontSize', 'borderRadius', 'padding', 'lineHeight', 'height'] as const) expect(p[k]).toBe(s[k]);
    expect(p.fontSize).toBe('var(--mx-tamanho-texto)');
    expect(p.height).toBe('var(--mx-medida-altura-campo)');
    expect(p.fontWeight).toBe('var(--mx-peso-botao-principal)');
    expect(s.fontWeight).toBe('var(--mx-peso-medio)');
    expect(p.background).toBe('var(--mx-cor-azul-noite)');
    expect(botaoPrincipal(true).cursor).toBe('not-allowed');
  });
  it('o diálogo usa os dois estilos da ui', () => {
    const d = dialogo();
    expect(d.match(/<button[^>]*font-size:var\(--mx-tamanho-texto\)[^>]*border-radius:6px/g)?.length).toBe(2);
  });
  it('botoes.css (para o shell) é exatamente o gerado dos mesmos estilos', () => {
    const css = readFileSync(new URL('./botoes.css', import.meta.url), 'utf8');
    expect(css).toBe(gerarCssBotoes());
    expect(css).toContain('.mx-botao {');
    expect(css).toContain('.mx-botao-secundario {');
  });
  it('hover de botão não vale para aria-disabled="true" (#689) e o desligado vale para ele', () => {
    const css = gerarCssBotoes();
    for (const c of ['.mx-botao', '.mx-botao-secundario', '.mx-olho']) {
      expect(css).toContain(`${c}:hover:not(:disabled):not([aria-disabled="true"]) {`);
    }
    expect(css).toContain('.mx-botao-destrutivo[aria-disabled="true"]');
  });
  it('.mx-checkbox e .mx-radio desabilitados não parecem editáveis', () => {
    expect(gerarCssBotoes()).toContain(
      '.mx-checkbox:disabled, .mx-radio:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}',
    );
  });
});

describe('botaoDestrutivo (T-0058, opção B)', () => {
  it('mesma base do principal; fundo e borda erro-texto, texto branco', () => {
    const p = botaoPrincipal();
    const d = botaoDestrutivo();
    for (const k of ['fontSize', 'fontWeight', 'borderRadius', 'padding', 'lineHeight'] as const) expect(d[k]).toBe(p[k]);
    expect(d.background).toBe('var(--mx-cor-erro-texto)');
    expect(d.border).toBe('1px solid var(--mx-cor-erro-texto)');
    expect(d.color).toBe('var(--mx-cor-branco)');
    expect(botaoDestrutivo(true).cursor).toBe('not-allowed');
  });
  it('contraste branco sobre #A8261B ≥ 4,5:1 (AA)', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const razao = (1.05) / (lum('#A8261B') + 0.05);
    expect(razao).toBeGreaterThan(7.0);
    expect(razao).toBeLessThan(7.2);
  });
  it('.mx-botao-destrutivo no botoes.css: base, foco e sem hover próprio', () => {
    const css = gerarCssBotoes();
    expect(css).toContain('.mx-botao-destrutivo {');
    expect(css).toMatch(/\.mx-botao-destrutivo \{[^}]*background: var\(--mx-cor-erro-texto\)/);
    expect(css).toContain('.mx-botao-destrutivo:focus-visible');
    expect(css).toContain('.mx-botao-destrutivo:disabled');
    expect(css).not.toContain('.mx-botao-destrutivo:hover');
  });
});

describe('DialogoMotivo: rotuloFechar e destrutivo', () => {
  it('fecha com o rótulo do chamador; padrão "Cancelar"', () => {
    const d = dialogo({ titulo: 'Cancelar nota', rotuloFechar: 'Manter a nota' });
    expect(d).toContain('>Manter a nota</button>');
    expect(d).not.toContain('>Cancelar</button>');
    expect(dialogo()).toContain('>Cancelar</button>');
  });
  it('destrutivo: confirmar em erro-texto (R-20261122-035525, opção B); sem destrutivo, azul-noite', () => {
    const d = dialogo({ destrutivo: true });
    expect(d).toMatch(/<button[^>]*data-destrutivo="true"[^>]*background:var\(--mx-cor-erro-texto\)/);
    expect(dialogo()).not.toContain('data-destrutivo');
    expect(dialogo()).not.toContain('erro-texto');
    expect(dialogo()).toMatch(/<button[^>]*background:var\(--mx-cor-azul-noite\)/);
  });
});

describe('FormularioItens: erro abaixo de cada campo', () => {
  it('cada mensagem fica abaixo do seu campo e é ligada a ele', () => {
    const h = form({ erros: { 'item-1': { produtoId: 'Produto inativo.', quantidade: 'Acima do estoque.', precoUnitarioCentavos: 'Abaixo da tabela.', descontoCentavos: 'Acima do limite.' } } });
    for (const m of ['Produto inativo.', 'Acima do estoque.', 'Abaixo da tabela.', 'Acima do limite.']) expect(h).toContain(`>${m}</span>`);
    expect(h).toMatch(/aria-label="Quantidade do item 1" aria-invalid="true" aria-describedby="[^"]+"/);
    expect(h).toMatch(/<input[^>]*aria-label="Quantidade do item 1"[^>]*border-color:var\(--mx-cor-erro-texto\)/);
    const ordem = ['Produto inativo.', 'Quantidade do item 1', 'Acima do estoque.', 'Preço unitário do item 1', 'Abaixo da tabela.', 'Desconto do item 1', 'Acima do limite.'].map((t) => h.indexOf(t));
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });
  it('mensagem só de texto continua valendo para a linha', () => {
    expect(form({ erros: { 'item-1': 'Linha com problema.' } })).toContain('>Linha com problema.</span>');
  });
});

describe('🟡 da marca nas telas do pedido', () => {
  interface L { id: string; v: number }
  const cols: ColunaTabela<L>[] = [{ id: 'v', titulo: 'Valor', tipo: 'dinheiro', celula: (l) => `R$ ${l.v}` }, { id: 'id', titulo: 'Id' }];
  it('número e dinheiro sem quebra na TabelaDensa e no total do item', () => {
    const t = renderToStaticMarkup(<TabelaDensa colunas={cols} linhas={[{ id: 'a', v: 1 }]} chaveLinha={(l) => l.id} />);
    expect(t).toMatch(/<td[^>]*white-space:nowrap[^>]*>R\$ 1</);
    expect(t).not.toMatch(/<td[^>]*white-space:nowrap[^>]*>a</);
    expect(form()).toMatch(/<td[^>]*white-space:nowrap[^>]*>R\$ 2000</);
  });
  it('colunas numéricas com largura fixa: o produto fica com o resto', () => {
    const h = form();
    expect(h).toMatch(/<th style="[^"]*width:[^"]*">Qtd\.<\/th>/);
    expect(h).not.toMatch(/<th style="[^"]*width:[^"]*">Produto<\/th>/);
  });
  it('legenda em 15 px e 600, na tabela e no formulário de itens', () => {
    const f = form({ legenda: 'Itens do pedido' });
    const t = renderToStaticMarkup(<TabelaDensa colunas={cols} linhas={[]} chaveLinha={(l) => l.id} legenda="Notas" />);
    expect(f).toMatch(/<caption[^>]*font-size:var\(--mx-tamanho-base\)[^>]*>Itens do pedido</);
    expect(t).toMatch(/<caption[^>]*font-size:var\(--mx-tamanho-base\)/);
    expect(f).toMatch(/<caption[^>]*font-weight:var\(--mx-peso-rotulo-campo\)[^>]*>Itens do pedido</);
    expect(t).toMatch(/<caption[^>]*font-weight:var\(--mx-peso-rotulo-campo\)/);
  });
});

describe('S-01: assinatura e favicon', () => {
  it('assinatura e símbolo batem com o SHA-256 dos arquivos oficiais', () => {
    expect(sha256(assinaturaANegativoAzulNoite)).toBe(SHA256_ASSINATURA_A_NEGATIVO_AZUL_NOITE);
    expect(sha256(simboloNegativo)).toBe(SHA256_SIMBOLO_NEGATIVO);
  });
  it('ativos novos (A grafite e C positivo) batem com o SHA-256 oficial', () => {
    expect(sha256(assinaturaANegativoGrafite)).toBe(SHA256_ASSINATURA_A_NEGATIVO_GRAFITE);
    expect(sha256(assinaturaCPositivo)).toBe(SHA256_ASSINATURA_C_POSITIVO);
  });
  it('favicon: o símbolo negativo inteiro sobre azul-noite', () => {
    expect(faviconSvg).toContain('fill="#1E3350"');
    expect(faviconSvg).toContain(simboloNegativo);
    expect(faviconDataUri).toBe(paraDataUri(faviconSvg));
    expect(faviconDataUri.startsWith('data:image/svg+xml,')).toBe(true);
  });
  it('altura de 20 a 32 px (§4) e texto alternativo "Macuxi ERP"', () => {
    expect(alturaAssinatura(12)).toBe(20);
    expect(alturaAssinatura(40)).toBe(32);
    expect(alturaAssinatura(24)).toBe(24);
    const h = renderToStaticMarkup(<AssinaturaErp />);
    expect(h).toContain('alt="Macuxi ERP"');
    expect(h).toContain('height="24"');
    expect(h).toContain(`src="${paraDataUri(assinaturaANegativoAzulNoite).replace(/&/g, '&amp;')}"`);
  });
});

describe('Dialogo: largura em tela estreita', () => {
  it('painel usa box-sizing border-box (não passa de 390 px)', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="t" aoConfirmar={() => {}} aoCancelar={() => {}} />);
    const painel = h.slice(h.indexOf('role="dialog"'));
    expect(painel.slice(0, painel.indexOf('>'))).toMatch(/box-sizing:border-box/);
  });
});
