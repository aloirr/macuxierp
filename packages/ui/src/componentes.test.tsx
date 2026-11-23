import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { proximoFoco } from './Dialogo.js';
import { DialogoMotivo, exigeEscolha } from './DialogoMotivo.js';
import { FaixaPendencias, ordenarPendencias } from './FaixaPendencias.js';
import { FormularioItens, type ItemLinha } from './FormularioItens.js';
import { TabelaDensa, ordenarLinhas, proximaOrdem, type ColunaTabela } from './TabelaDensa.js';
import { centavosParaReais, reaisParaCentavos, textoParaQuantidade } from './entradas.js';
import * as indice from './index.js';

const novoItem = (chave: string): ItemLinha => ({ chave, produtoId: null, quantidade: 1, precoUnitarioCentavos: 0, descontoCentavos: 0 });
const total = (i: ItemLinha) => Math.max(0, Math.round(i.quantidade * i.precoUnitarioCentavos) - i.descontoCentavos);

interface L { id: string; nome: string; total: number }
const colunas: ColunaTabela<L>[] = [
  { id: 'nome', titulo: 'Nome', valorOrdem: (l) => l.nome },
  { id: 'total', titulo: 'Total', tipo: 'dinheiro', valorOrdem: (l) => l.total, celula: (l) => `R$ ${l.total / 100}` },
];
const linhas: L[] = [
  { id: '1', nome: 'b', total: 500 },
  { id: '2', nome: 'a', total: 1500 },
  { id: '3', nome: 'c', total: 100 },
];

describe('TabelaDensa', () => {
  it('ordena sem mutar, asc e desc, numérico por valor', () => {
    expect(ordenarLinhas(linhas, colunas[1], 'asc').map((l) => l.id)).toEqual(['3', '1', '2']);
    expect(ordenarLinhas(linhas, colunas[1], 'desc').map((l) => l.id)).toEqual(['2', '1', '3']);
    expect(ordenarLinhas(linhas, colunas[0], 'asc').map((l) => l.nome)).toEqual(['a', 'b', 'c']);
    expect(linhas[0]?.id).toBe('1');
    expect(ordenarLinhas(linhas, { id: 'x', titulo: 'x' }, 'asc')).toEqual(linhas);
  });
  it('alterna a ordem pelo cabeçalho', () => {
    expect(proximaOrdem(null, 'a')).toEqual({ colunaId: 'a', direcao: 'asc' });
    expect(proximaOrdem({ colunaId: 'a', direcao: 'asc' }, 'a')).toEqual({ colunaId: 'a', direcao: 'desc' });
    expect(proximaOrdem({ colunaId: 'a', direcao: 'desc' }, 'b')).toEqual({ colunaId: 'b', direcao: 'asc' });
  });
  it('renderiza valor formatado pelo chamador, alinhamento numérico e aria-sort', () => {
    const h = renderToStaticMarkup(
      <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.id} ordem={{ colunaId: 'total', direcao: 'desc' }} aoClicarLinha={() => {}} rotuloLinha={(l) => `Abrir ${l.nome}`} />,
    );
    expect(h).toContain('R$ 15');
    expect(h).toContain('text-align:right');
    expect(h).toContain('aria-sort="descending"');
    expect(h).toContain('tabindex="0"');
    expect(h).toContain('aria-label="Abrir b"');
    expect(h.indexOf('R$ 15')).toBeLessThan(h.indexOf('R$ 1<'));
  });
  it('estado vazio', () => {
    const h = renderToStaticMarkup(<TabelaDensa colunas={colunas} linhas={[]} chaveLinha={(l) => l.id} textoVazio="Sem pedidos. Crie um." />);
    expect(h).toContain('Sem pedidos. Crie um.');
    expect(h).toMatch(/colSpan="2"/i);
  });
});

describe('FaixaPendencias', () => {
  const itens = [
    { nivel: 'aceitavel' as const, codigoRn: 'RN-PED-002', texto: 'Prazo fora do padrão.' },
    { nivel: 'bloqueante' as const, codigoRn: 'RN-PED-004', texto: 'Cliente sem crédito.' },
  ];
  it('bloqueantes primeiro, com tokens de erro e aviso', () => {
    expect(ordenarPendencias(itens).map((i) => i.nivel)).toEqual(['bloqueante', 'aceitavel']);
    const h = renderToStaticMarkup(<FaixaPendencias itens={itens} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain('var(--mx-cor-erro-fundo)');
    expect(h).toContain('var(--mx-cor-aviso-fundo)');
    expect(h).toContain('RN-PED-004');
    expect(h.indexOf('RN-PED-004')).toBeLessThan(h.indexOf('RN-PED-002'));
    const erro = renderToStaticMarkup(<FaixaPendencias itens={[itens[1]!]} />);
    expect(erro).toContain('var(--mx-cor-erro-texto)');
    expect(erro).not.toContain('var(--mx-cor-aviso-texto)');
    const aviso = renderToStaticMarkup(<FaixaPendencias itens={[itens[0]!]} />);
    expect(aviso).toContain('var(--mx-cor-aviso-texto)');
    expect(aviso).not.toContain('var(--mx-cor-erro-texto)');
  });
  it('sem rótulo de severidade visível; prefixo só para leitor de tela (T-0056)', () => {
    const h = renderToStaticMarkup(<FaixaPendencias itens={itens} />);
    expect(h).not.toContain('Bloqueia');
    expect(h).not.toContain('Atenção');
    expect(h).toContain('Erro: </span>');
    expect(h).toContain('Aviso: </span>');
    expect(h).not.toContain('<strong');
  });
  it('só aceitável vira status; vazio não renderiza', () => {
    expect(renderToStaticMarkup(<FaixaPendencias itens={[itens[0]!]} />)).toContain('role="status"');
    expect(renderToStaticMarkup(<FaixaPendencias itens={[]} />)).toBe('');
  });
});

describe('DialogoMotivo', () => {
  const motivos = [{ codigo: 'erro', rotulo: 'Erro de digitação' }];
  it('valida motivo e texto obrigatórios', () => {
    expect(exigeEscolha({ texto: '' }, { motivos })).toEqual({ campo: 'motivo', mensagem: 'Nenhum motivo escolhido. Escolha um da lista.' });
    expect(exigeEscolha({ motivo: 'erro', texto: '  ' }, { motivos, textoObrigatorio: true })).toEqual({ campo: 'texto', mensagem: 'O detalhe está vazio. Descreva o motivo.' });
    expect(exigeEscolha({ motivo: 'erro', texto: 'x' }, { motivos, textoObrigatorio: true })).toBeNull();
    expect(exigeEscolha({ texto: '' }, {})).toBeNull();
  });
  it('foco circular com Tab e Shift+Tab', () => {
    expect(proximoFoco(2, 3, false)).toBe(0);
    expect(proximoFoco(0, 3, true)).toBe(2);
    expect(proximoFoco(-1, 3, true)).toBe(2);
    expect(proximoFoco(0, 0, false)).toBe(-1);
  });
  it('markup acessível com aviso de LGPD', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="Cancelar pedido" motivos={motivos} textoObrigatorio aoConfirmar={() => {}} aoCancelar={() => {}} />);
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-modal="true"');
    expect(h).toContain('aria-labelledby');
    expect(h).toContain('Cancelar pedido');
    expect(h).toContain('Erro de digitação');
    expect(h).not.toContain('aria-describedby');
    expect(h).toContain('aria-required="true"');
    expect(h).toContain('Confirmar');
    expect(h).toContain('Cancelar</button>');
  });
  it('aviso do módulo aparece e descreve o diálogo; erro liga ao campo', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="T" aviso="Sem dado pessoal." aoConfirmar={() => {}} aoCancelar={() => {}} />);
    expect(h).toContain('Sem dado pessoal.');
    expect(h).toContain('aria-describedby');
  });
  it('aviso: aria-describedby contém o id do aviso, que vem antes do corpo', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="T" aviso="Sem dado pessoal." aoConfirmar={() => {}} aoCancelar={() => {}} />);
    const id = /<div id="([^"]+)" data-aviso-dialogo=""/.exec(h)?.[1] ?? '';
    const desc = /role="dialog"[^>]*aria-describedby="([^"]*)"/.exec(h)?.[1] ?? /aria-describedby="([^"]*)"[^>]*role="dialog"/.exec(h)?.[1] ?? '';
    expect(id).not.toBe('');
    expect(desc.split(' ')).toContain(id);
    expect(h.indexOf('data-aviso-dialogo')).toBeLessThan(h.indexOf('data-corpo-dialogo'));
    expect(/data-aviso-dialogo=""[^>]*margin-bottom:8px/.test(h)).toBe(true);
  });
  it('texto opcional é indicado', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="T" aoConfirmar={() => {}} aoCancelar={() => {}} />);
    expect(h).toContain('(opcional)');
    expect(h).not.toContain('<fieldset');
  });
});

describe('FormularioItens', () => {
  it('converte reais digitados em centavos sem ponto flutuante', () => {
    expect(reaisParaCentavos('1.234,56')).toBe(123456);
    expect(reaisParaCentavos('0,1')).toBe(10);
    expect(reaisParaCentavos('19,99')).toBe(1999);
    expect(reaisParaCentavos('')).toBe(0);
    expect(reaisParaCentavos('1,234')).toBeNull();
    expect(reaisParaCentavos('abc')).toBeNull();
    expect(centavosParaReais(123456)).toBe('1.234,56');
    expect(centavosParaReais(5)).toBe('0,05');
    expect(textoParaQuantidade('1,5')).toBe(1.5);
    expect(textoParaQuantidade('2.25')).toBe(2.25);
    expect(textoParaQuantidade('1,23456')).toBeNull();
    expect(textoParaQuantidade('-1')).toBeNull();
  });
  it('index exporta só componentes', () => {
    const permitidos = ['aliasCores', 'cores', 'escala', 'fontes', 'papeis', 'pesos'];
    expect(Object.keys(indice).filter((k) => /^[a-z]/.test(k) && !permitidos.includes(k))).toEqual([]);
  });
  it('renderiza linhas, seletor injetado, total formatado pelo chamador e ações', () => {
    const itens = [{ chave: 'item-1', produtoId: 'p1', quantidade: 2, precoUnitarioCentavos: 1000, descontoCentavos: 0 }];
    const h = renderToStaticMarkup(
      <FormularioItens
        itens={itens}
        aoMudar={() => {}}
        novoItem={novoItem}
        calcularTotal={total}
        formatarCentavos={(c) => `R$ ${(c / 100).toFixed(2)}`}
        renderSeletorProduto={(s) => <span data-seletor={s.valor}>{s.rotulo}</span>}
        erros={{ 'item-1': 'Produto inativo.' }}
      />,
    );
    expect(h).toContain('data-seletor="p1"');
    expect(h).toContain('R$ 20.00');
    expect(h).toContain('Remover item 1');
    expect(h).toContain('Adicionar item');
    expect(h).toContain('Produto inativo.');
    expect(h).toContain('value="10,00"');
  });
  it('sem itens mostra o estado vazio', () => {
    const h = renderToStaticMarkup(<FormularioItens itens={[]} aoMudar={() => {}} novoItem={novoItem} calcularTotal={total} formatarCentavos={String} renderSeletorProduto={() => null} />);
    expect(h).toContain('Nenhum item. Adicione o primeiro.');
  });
});

describe('ajustes de marca (T-0015)', () => {
  it('seletor de produto recebe desabilitado do formulário', () => {
    const itens = [{ chave: 'item-1', produtoId: null, quantidade: 1, precoUnitarioCentavos: 0, descontoCentavos: 0 }];
    const h = renderToStaticMarkup(
      <FormularioItens itens={itens} desabilitado aoMudar={() => {}} novoItem={novoItem} calcularTotal={total} formatarCentavos={String} renderSeletorProduto={(s) => <span data-desab={String(s.desabilitado)} />} />,
    );
    expect(h).toContain('data-desab="true"');
    const h2 = renderToStaticMarkup(
      <FormularioItens itens={itens} aoMudar={() => {}} novoItem={novoItem} calcularTotal={total} formatarCentavos={String} renderSeletorProduto={(s) => <span data-desab={String(s.desabilitado)} />} />,
    );
    expect(h2).toContain('data-desab="undefined"');
  });
  it('código RN vai para data-regra, sem aparecer no texto', () => {
    const h = renderToStaticMarkup(<FaixaPendencias itens={[{ nivel: 'bloqueante', codigoRn: 'RN-PED-004', texto: 'Falta cliente.' }]} />);
    expect(h).toContain('data-regra="RN-PED-004"');
    expect(h).not.toContain('>RN-PED-004<');
  });
  it('remover sem vermelho, rádio sem accentColor, ordenar sem all:unset', () => {
    const itens = [{ chave: 'item-1', produtoId: null, quantidade: 1, precoUnitarioCentavos: 0, descontoCentavos: 0 }];
    const f = renderToStaticMarkup(<FormularioItens itens={itens} aoMudar={() => {}} novoItem={novoItem} calcularTotal={total} formatarCentavos={String} renderSeletorProduto={() => null} />);
    expect(f).not.toMatch(/<button[^>]*erro-texto/);
    const d = renderToStaticMarkup(<DialogoMotivo titulo="t" aviso="a" motivos={[{ codigo: 'x', rotulo: 'X' }]} aoConfirmar={() => {}} aoCancelar={() => {}} />);
    expect(d).not.toContain('accent-color');
    const t = renderToStaticMarkup(<TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.id} />);
    expect(t).not.toContain('all:unset');
  });
  it('datas em algarismos tabulares e vazio com ação', () => {
    const cols: ColunaTabela<L>[] = [{ id: 'nome', titulo: 'Emissão', tipo: 'data' }];
    const t = renderToStaticMarkup(<TabelaDensa colunas={cols} linhas={linhas} chaveLinha={(l) => l.id} />);
    expect(t).toContain('font-variant-numeric:tabular-nums');
    expect(renderToStaticMarkup(<TabelaDensa colunas={cols} linhas={[]} chaveLinha={(l) => l.id} />)).toContain('Ajuste os filtros ou crie o primeiro.');
  });
});

describe('regra de cores', () => {
  it('nenhum componente tem cor literal (só var(--mx-...))', () => {
    const dir = new URL('./', import.meta.url);
    const arqs = readdirSync(dir).filter((f) => /^(TabelaDensa|FaixaPendencias|DialogoMotivo|FormularioItens|SeloPlataforma|Chip|CaixaResumo|Dialogo|estilos)\.tsx?$/.test(f));
    expect(arqs.length).toBe(9);
    for (const a of arqs) expect(readFileSync(new URL(a, dir), 'utf8'), a).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
  });
});
