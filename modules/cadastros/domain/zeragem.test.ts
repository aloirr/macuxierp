import { describe, expect, it } from 'vitest';
import {
  CASCATA,
  ORDEM_DELETE,
  planoZeragem,
  type FatosZeragem,
  type PlanoZeragem,
} from './zeragem';

const F1 = 'f1';
const F2 = 'f2';

// Cenário: 2 filiais; p1 com unidade, item de preço, saldo e movimento; c1 (F1, carteira v1) e c2 (F2).
const base = (): FatosZeragem => ({
  existentes: {
    filial: [{ id: F1 }, { id: F2 }],
    vendedor: [{ id: 'v1', refs: { filial: F1 } }, { id: 'v2', refs: { filial: F2 } }],
    condicao_pagamento: [{ id: 'cp1' }],
    tabela_preco: [{ id: 'tp1' }],
    produto: [{ id: 'p1' }, { id: 'p2' }],
    produto_unidade: [{ id: 'u1', refs: { produto: 'p1' } }],
    tabela_preco_item: [
      { id: 'i1', refs: { tabela_preco: 'tp1', produto: 'p1', filial: F1 } },
      { id: 'i2', refs: { tabela_preco: 'tp1', produto: 'p2', filial: F2 } },
    ],
    estoque_saldo: [{ id: 's1', refs: { produto: 'p1', filial: F1 } }],
    estoque_movimento: [
      { id: 'm1', refs: { produto: 'p1', filial: F1 } },
      { id: 'm2', refs: { produto: 'p1', filial: F1 } },
    ],
    cliente: [
      { id: 'c1', refs: { filial: F1, vendedor: 'v1', tabela_preco: 'tp1', condicao_pagamento: 'cp1' } },
      { id: 'c2', refs: { filial: F2 } },
    ],
    cliente_endereco: [{ id: 'e1', refs: { cliente: 'c1' } }],
    cliente_contato: [{ id: 'k1', refs: { cliente: 'c1' } }],
  },
});

const ids = (p: PlanoZeragem, tabela: string) => p.apagar.find((a) => a.tabela === tabela)?.ids ?? [];

describe('zeragem: cascata', () => {
  it('RN-CAD-ZER: produto apaga unidade, item de preço, saldo e movimento antes do produto', () => {
    const p = planoZeragem('produto', base());
    expect(p.apagar.map((a) => a.tabela)).toEqual([
      'estoque_movimento',
      'estoque_saldo',
      'tabela_preco_item',
      'produto_unidade',
      'produto',
    ]);
    expect(ids(p, 'tabela_preco_item')).toEqual(['i1', 'i2']);
    expect(ids(p, 'produto')).toEqual(['p1', 'p2']);
  });

  it('RN-CAD-ZER: cliente apaga contatos e endereços; a carteira é a coluna vendedor_id, que vai junto', () => {
    const p = planoZeragem('cliente', base());
    expect(p.apagar.map((a) => a.tabela)).toEqual(['cliente_contato', 'cliente_endereco', 'cliente']);
    expect(p.anular).toEqual([]);
  });

  it('RN-CAD-ZER: tabela de preço apaga os itens e anula cliente.tabela_preco_id', () => {
    const p = planoZeragem('tabela_preco', base());
    expect(p.apagar.map((a) => a.tabela)).toEqual(['tabela_preco_item', 'tabela_preco']);
    expect(p.anular).toEqual([{ tabela: 'cliente', coluna: 'tabela_preco_id', ids: ['c1'] }]);
  });

  it('RN-CAD-ZER: vendedor e condição de pagamento anulam a referência do cliente, sem apagar o cliente', () => {
    const v = planoZeragem('vendedor', base());
    expect(v.apagar.map((a) => a.tabela)).toEqual(['vendedor']);
    expect(v.anular).toEqual([{ tabela: 'cliente', coluna: 'vendedor_id', ids: ['c1'] }]);
    const c = planoZeragem('condicao_pagamento', base());
    expect(c.anular).toEqual([{ tabela: 'cliente', coluna: 'condicao_pagamento_id', ids: ['c1'] }]);
  });

  it('RN-CAD-ZER: filial apaga tudo o que depende dela, filhos antes do pai', () => {
    const p = planoZeragem('filial', base());
    expect(p.apagar.map((a) => a.tabela)).toEqual([
      'estoque_movimento',
      'estoque_saldo',
      'tabela_preco_item',
      'cliente_contato',
      'cliente_endereco',
      'cliente',
      'vendedor',
      'filial',
    ]);
    // nenhum cliente sobra apontando para vendedor apagado
    expect(p.anular).toEqual([]);
  });

  it('RN-CAD-ZER: CASCATA lista cada tabela depois de todas as que dependem dela', () => {
    for (const [cadastro, tabelas] of Object.entries(CASCATA)) {
      const posicoes = tabelas.map((t) => ORDEM_DELETE.indexOf(t));
      expect(posicoes.every((x) => x >= 0)).toBe(true);
      expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
      expect(tabelas[tabelas.length - 1]).toBe(cadastro);
    }
  });
});

describe('zeragem: em uso e bloqueios', () => {
  it('RN-CAD-ZER: registro em uso fica mantido por motivo, com os filhos dele', () => {
    const f = base();
    f.usos = { cliente: { pedido: ['c1'], titulo: ['c2'] } };
    const p = planoZeragem('cliente', f);
    expect(p.apagar).toEqual([]);
    expect(p.mantidos).toEqual([
      { cadastro: 'cliente', motivo: 'pedido', quantidade: 1 },
      { cadastro: 'cliente', motivo: 'titulo', quantidade: 1 },
    ]);
  });

  it('RN-CAD-ZER: produto em uso por nota fica; o outro e os filhos só dele são apagados', () => {
    const f = base();
    f.usos = { produto: { nota: ['p1'] } };
    const p = planoZeragem('produto', f);
    expect(ids(p, 'produto')).toEqual(['p2']);
    expect(ids(p, 'tabela_preco_item')).toEqual(['i2']);
    expect(ids(p, 'estoque_movimento')).toEqual([]);
    expect(p.mantidos).toEqual([{ cadastro: 'produto', motivo: 'nota', quantidade: 1 }]);
  });

  it('RN-CAD-ZER: com vários motivos vale o mais forte (pedido, titulo, nota) e conta uma vez', () => {
    const f = base();
    f.usos = { produto: { nota: ['p1'], pedido: ['p1'] } };
    expect(planoZeragem('produto', f).mantidos).toEqual([
      { cadastro: 'produto', motivo: 'pedido', quantidade: 1 },
    ]);
  });

  it('RN-CAD-ZER: filial com nota bloqueia a filial inteira e o que depende dela', () => {
    const f = base();
    f.filiaisComNota = [F1];
    const p = planoZeragem('filial', f);
    expect(ids(p, 'filial')).toEqual([F2]);
    expect(ids(p, 'cliente')).toEqual(['c2']);
    expect(ids(p, 'vendedor')).toEqual(['v2']);
    expect(ids(p, 'estoque_movimento')).toEqual([]);
    expect(ids(p, 'tabela_preco_item')).toEqual(['i2']);
    expect(p.mantidos).toEqual([{ cadastro: 'filial', motivo: 'nota', quantidade: 1 }]);
  });

  it('RN-CAD-ZER: cliente ou vendedor da filial em uso mantém a filial', () => {
    const f = base();
    f.usos = { vendedor: { pedido: ['v2'] } };
    const p = planoZeragem('filial', f);
    expect(ids(p, 'filial')).toEqual([F1]);
    expect(ids(p, 'vendedor')).toEqual(['v1']);
    expect(p.mantidos).toEqual([{ cadastro: 'filial', motivo: 'pedido', quantidade: 1 }]);
  });

  it('RN-CAD-ZER: vendedor apagado por filial anula a carteira de cliente de outra filial', () => {
    const f = base();
    f.existentes.cliente = [{ id: 'c9', refs: { filial: F2, vendedor: 'v1' } }];
    f.filiaisComNota = [F2];
    const p = planoZeragem('filial', f);
    expect(p.anular).toEqual([{ tabela: 'cliente', coluna: 'vendedor_id', ids: ['c9'] }]);
  });
});

describe('zeragem: bordas', () => {
  it('RN-CAD-ZER: cadastro vazio dá plano vazio', () => {
    expect(planoZeragem('produto', { existentes: {} })).toEqual({ apagar: [], anular: [], mantidos: [] });
  });

  it('RN-CAD-ZER: ids repetidos entram uma vez só', () => {
    const f = base();
    f.existentes.produto = [{ id: 'p1' }, { id: 'p1' }];
    f.existentes.produto_unidade = [
      { id: 'u1', refs: { produto: 'p1' } },
      { id: 'u1', refs: { produto: 'p1' } },
    ];
    f.usos = { produto: { nota: ['x', 'x'] } };
    const p = planoZeragem('produto', f);
    expect(ids(p, 'produto')).toEqual(['p1']);
    expect(ids(p, 'produto_unidade')).toEqual(['u1']);
    expect(p.mantidos).toEqual([]);
  });

  it('RN-CAD-ZER: idempotente, rodar de novo depois de apagar dá plano vazio', () => {
    const f = base();
    f.usos = { produto: { pedido: ['p2'] } };
    const p = planoZeragem('produto', f);
    const apagados = new Set(p.apagar.flatMap((a) => a.ids));
    const depois: FatosZeragem = {
      ...f,
      existentes: Object.fromEntries(
        Object.entries(f.existentes).map(([t, l]) => [t, (l ?? []).filter((r) => !apagados.has(r.id))]),
      ),
    };
    const q = planoZeragem('produto', depois);
    expect(q.apagar).toEqual([]);
    expect(q.anular).toEqual([]);
    expect(q.mantidos).toEqual([{ cadastro: 'produto', motivo: 'pedido', quantidade: 1 }]);
  });
});
