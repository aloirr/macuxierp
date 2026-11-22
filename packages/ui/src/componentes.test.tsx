import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AVISO_LGPD,
  DialogoMotivo,
  FaixaPendencias,
  FormularioItens,
  TabelaDensa,
  novoItem,
  ordenarLinhas,
  ordenarPendencias,
  proximaOrdem,
  proximoFoco,
  totalItemCentavos,
  validarMotivo,
  type ColunaTabela,
} from './index.js';

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
      <TabelaDensa colunas={colunas} linhas={linhas} chaveLinha={(l) => l.id} ordem={{ colunaId: 'total', direcao: 'desc' }} aoClicarLinha={() => {}} />,
    );
    expect(h).toContain('R$ 15');
    expect(h).toContain('text-align:right');
    expect(h).toContain('aria-sort="descending"');
    expect(h).toContain('tabindex="0"');
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
  });
  it('só aceitável vira status; vazio não renderiza', () => {
    expect(renderToStaticMarkup(<FaixaPendencias itens={[itens[0]!]} />)).toContain('role="status"');
    expect(renderToStaticMarkup(<FaixaPendencias itens={[]} />)).toBe('');
  });
});

describe('DialogoMotivo', () => {
  const motivos = [{ codigo: 'erro', rotulo: 'Erro de digitação' }];
  it('valida motivo e texto obrigatórios', () => {
    expect(validarMotivo({ texto: '' }, { motivos })).toBe('Escolha um motivo.');
    expect(validarMotivo({ motivo: 'erro', texto: '  ' }, { motivos, textoObrigatorio: true })).toBe('Descreva o motivo.');
    expect(validarMotivo({ motivo: 'erro', texto: 'x' }, { motivos, textoObrigatorio: true })).toBeNull();
    expect(validarMotivo({ texto: '' }, {})).toBeNull();
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
    expect(h).toContain(AVISO_LGPD);
    expect(h).toContain('aria-required="true"');
    expect(h).toContain('Confirmar');
    expect(h).toContain('Cancelar</button>');
  });
  it('texto opcional é indicado', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="T" aoConfirmar={() => {}} aoCancelar={() => {}} />);
    expect(h).toContain('(opcional)');
    expect(h).not.toContain('<fieldset');
  });
});

describe('FormularioItens', () => {
  it('total em centavos arredondado, sem negativo', () => {
    expect(totalItemCentavos({ quantidade: 3, precoUnitarioCentavos: 1050, descontoCentavos: 150 })).toBe(3000);
    expect(totalItemCentavos({ quantidade: 1.5, precoUnitarioCentavos: 333, descontoCentavos: 0 })).toBe(500);
    expect(totalItemCentavos({ quantidade: 1, precoUnitarioCentavos: 100, descontoCentavos: 900 })).toBe(0);
    expect(novoItem('k')).toEqual({ chave: 'k', produtoId: null, quantidade: 1, precoUnitarioCentavos: 0, descontoCentavos: 0 });
  });
  it('renderiza linhas, seletor injetado, total formatado pelo chamador e ações', () => {
    const itens = [{ chave: 'item-1', produtoId: 'p1', quantidade: 2, precoUnitarioCentavos: 1000, descontoCentavos: 0 }];
    const h = renderToStaticMarkup(
      <FormularioItens
        itens={itens}
        aoMudar={() => {}}
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
  });
  it('sem itens mostra o estado vazio', () => {
    const h = renderToStaticMarkup(<FormularioItens itens={[]} aoMudar={() => {}} formatarCentavos={String} renderSeletorProduto={() => null} />);
    expect(h).toContain('Nenhum item. Adicione o primeiro.');
  });
});

describe('regra de cores', () => {
  it('nenhum componente tem cor literal (só var(--mx-...))', () => {
    const dir = new URL('./', import.meta.url);
    const arqs = readdirSync(dir).filter((f) => /^(TabelaDensa|FaixaPendencias|DialogoMotivo|FormularioItens|estilos)\.tsx?$/.test(f));
    expect(arqs.length).toBe(5);
    for (const a of arqs) expect(readFileSync(new URL(a, dir), 'utf8'), a).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
  });
});
