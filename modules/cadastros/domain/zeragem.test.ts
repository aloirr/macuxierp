import { describe, expect, it } from 'vitest';
import {
  CADASTROS_ZERAR,
  contagens,
  planoZeragem,
  type FatosZeragem,
  type PlanoZeragem,
} from './zeragem';
import type { CadastroZerarPortal } from '@macuxierp/platform-sdk';

const F1 = 'f1';
const F2 = 'f2';

// 2 filiais; p1 com unidade, item de preço, saldo e movimento; c1 (F1, carteira v1) e c2 (F2).
const base = (): FatosZeragem => ({
  existentes: {
    filial: [{ id: F1, com_chave: true }, { id: F2, com_chave: true }],
    vendedor: [
      { id: 'v1', refs: { filial: F1 }, com_chave: true },
      { id: 'v2', refs: { filial: F2 }, com_chave: true },
    ],
    condicao_pagamento: [{ id: 'cp1', com_chave: true }],
    tabela_preco: [{ id: 'tp1', com_chave: true }],
    produto: [{ id: 'p1', com_chave: true }, { id: 'p2', com_chave: true }],
    produto_unidade: [{ id: 'u1', refs: { produto: 'p1' }, com_chave: true }],
    tabela_preco_item: [
      { id: 'i1', refs: { tabela_preco: 'tp1', produto: 'p1', filial: F1 }, com_chave: true },
      { id: 'i2', refs: { tabela_preco: 'tp1', produto: 'p2', filial: F2 }, com_chave: true },
    ],
    estoque_saldo: [{ id: 's1', refs: { produto: 'p1', filial: F1 }, com_chave: true }],
    estoque_movimento: [
      { id: 'm1', refs: { produto: 'p1', filial: F1 }, com_chave: true },
      { id: 'm2', refs: { produto: 'p1', filial: F1 }, com_chave: true },
    ],
    cliente: [
      { id: 'c1', refs: { filial: F1, vendedor: 'v1', tabela_preco: 'tp1', condicao_pagamento: 'cp1' }, com_chave: true },
      { id: 'c2', refs: { filial: F2 }, com_chave: true },
    ],
    cliente_endereco: [{ id: 'e1', refs: { cliente: 'c1' }, com_chave: true }],
    cliente_contato: [{ id: 'k1', refs: { cliente: 'c1' }, com_chave: true }],
  },
  integracao: CADASTROS_ZERAR.map((cadastro) => ({ cadastro, ligada: false, lote_em_voo: false })),
});

const tabelas = (p: PlanoZeragem) => p.apagar.map((a) => a.tabela);
const ids = (p: PlanoZeragem, t: string) => p.apagar.find((a) => a.tabela === t)?.ids ?? [];
const com = (f: FatosZeragem, c: CadastroZerarPortal, o: { ligada?: boolean; lote_em_voo?: boolean }): FatosZeragem => ({
  ...f,
  integracao: f.integracao.map((i) => (i.cadastro === c ? { ...i, ...o } : i)),
});

describe('zeragem: cada cadastro sozinho', () => {
  it('RN-CAD-10: filial sozinha leva cliente, vendedor, estoque e itens de preço, e fica com a tabela de preço', () => {
    const p = planoZeragem(['filial'], base());
    expect(tabelas(p)).toEqual([
      'estoque_movimento', 'estoque_saldo', 'tabela_preco_item', 'cliente_contato', 'cliente_endereco', 'cliente', 'vendedor', 'filial',
    ]);
    expect(p.efetivos).toEqual(['filial', 'vendedor', 'preco', 'estoque', 'cliente', 'cliente_endereco']);
  });

  it('RN-CAD-10: vendedor sozinho apaga só vendedor e anula a carteira (cliente.vendedor_id)', () => {
    const p = planoZeragem(['vendedor'], base());
    expect(tabelas(p)).toEqual(['vendedor']);
    expect(p.anular).toEqual([{ tabela: 'cliente', coluna: 'vendedor_id', ids: ['c1'] }]);
    expect(p.efetivos).toEqual(['vendedor']);
  });

  it('RN-CAD-10: forma_prazo apaga condicao_pagamento e anula cliente.condicao_pagamento_id', () => {
    const p = planoZeragem(['forma_prazo'], base());
    expect(tabelas(p)).toEqual(['condicao_pagamento']);
    expect(p.anular).toEqual([{ tabela: 'cliente', coluna: 'condicao_pagamento_id', ids: ['c1'] }]);
  });

  it('RN-CAD-10: produto leva unidade, estoque e os itens de preço dele', () => {
    const p = planoZeragem(['produto'], base());
    expect(tabelas(p)).toEqual([
      'estoque_movimento', 'estoque_saldo', 'tabela_preco_item', 'produto_unidade', 'produto',
    ]);
    expect(ids(p, 'tabela_preco_item')).toEqual(['i1', 'i2']);
  });

  it('RN-CAD-10: zerar produto mantém a tabela de preço e o vínculo do cliente', () => {
    const p = planoZeragem(['produto'], base());
    expect(tabelas(p)).not.toContain('tabela_preco');
    expect(p.anular).toEqual([]);
  });

  it('RN-CAD-10: produto_unidade sozinha não toca o produto', () => {
    const p = planoZeragem(['produto_unidade'], base());
    expect(tabelas(p)).toEqual(['produto_unidade']);
    expect(p.efetivos).toEqual(['produto_unidade']);
  });

  it('RN-CAD-10: preco apaga item e tabela de preço e anula cliente.tabela_preco_id', () => {
    const p = planoZeragem(['preco'], base());
    expect(tabelas(p)).toEqual(['tabela_preco_item', 'tabela_preco']);
    expect(p.anular).toEqual([{ tabela: 'cliente', coluna: 'tabela_preco_id', ids: ['c1'] }]);
  });

  it('RN-CAD-10: estoque apaga movimento e saldo, sem tocar o produto', () => {
    const p = planoZeragem(['estoque'], base());
    expect(tabelas(p)).toEqual(['estoque_movimento', 'estoque_saldo']);
    expect(ids(p, 'estoque_movimento')).toEqual(['m1', 'm2']);
  });

  it('RN-CAD-10: cliente_endereco sozinho não apaga o cliente nem o contato', () => {
    const p = planoZeragem(['cliente_endereco'], base());
    expect(tabelas(p)).toEqual(['cliente_endereco']);
  });
});

describe('zeragem: dependências automáticas', () => {
  it('RN-CAD-10: efetivos = escolhidos + dependências, na ordem da carga', () => {
    expect(planoZeragem(['cliente', 'produto'], base()).efetivos).toEqual([
      'produto', 'produto_unidade', 'estoque', 'cliente', 'cliente_endereco',
    ]);
  });

  it('RN-CAD-10: cliente leva endereço e contato; a carteira é a coluna e nada é anulado', () => {
    const p = planoZeragem(['cliente'], base());
    expect(tabelas(p)).toEqual(['cliente_contato', 'cliente_endereco', 'cliente']);
    expect(p.anular).toEqual([]);
    expect(p.efetivos).toEqual(['cliente', 'cliente_endereco']);
  });
});

describe('zeragem: filial com nota e em uso', () => {
  it('RN-CAD-10: filial com nota fica, com tudo que depende dela; a outra é apagada', () => {
    const f = { ...base(), filiaisComNota: [F1] };
    const p = planoZeragem(['filial'], f);
    expect(ids(p, 'filial')).toEqual([F2]);
    expect(ids(p, 'cliente')).toEqual(['c2']);
    expect(ids(p, 'vendedor')).toEqual(['v2']);
    expect(p.mantidos).toEqual([{ cadastro: 'filial', motivo: 'nota', quantidade: 1 }]);
    expect(p.emUso.find((e) => e.tabela === 'filial')?.ids).toEqual([F1]);
  });

  it('RN-CAD-10: registro em uso fica com os filhos; o motivo contado é o mais forte (pedido > titulo > nota)', () => {
    const f = { ...base(), usos: { produto: { nota: ['p1'], pedido: ['p1'], titulo: ['p1'] } } };
    const p = planoZeragem(['produto'], f);
    expect(ids(p, 'produto')).toEqual(['p2']);
    expect(ids(p, 'produto_unidade')).toEqual([]);
    expect(ids(p, 'estoque_saldo')).toEqual([]);
    expect(p.mantidos).toEqual([{ cadastro: 'produto', motivo: 'pedido', quantidade: 1 }]);
    expect(p.emUso.find((e) => e.tabela === 'produto')?.ids).toEqual(['p1']);
    expect(p.emUso.find((e) => e.tabela === 'estoque_saldo')?.ids).toEqual(['s1']);
  });

  it('RN-CAD-10: cliente em uso mantém a filial dele quando a filial é zerada', () => {
    const f = { ...base(), usos: { cliente: { titulo: ['c2'] } } };
    const p = planoZeragem(['filial'], f);
    expect(ids(p, 'filial')).toEqual([F1]);
    expect(ids(p, 'cliente')).toEqual(['c1']);
    expect(p.mantidos).toEqual([
      { cadastro: 'filial', motivo: 'titulo', quantidade: 1 },
      { cadastro: 'cliente', motivo: 'titulo', quantidade: 1 },
    ]);
  });
});

describe('zeragem: anulados', () => {
  it('RN-CAD-10: anulação vale também quando o pai some pela cascata da filial', () => {
    const p = planoZeragem(['filial', 'preco'], base());
    // cliente c1 é apagado junto com F1, então não há o que anular nele
    expect(p.anular).toEqual([]);
  });

  it('RN-CAD-10: cliente em uso fica e tem as referências anuladas', () => {
    const f = { ...base(), usos: { cliente: { pedido: ['c1'] } } };
    const p = planoZeragem(['vendedor', 'preco', 'forma_prazo'], f);
    expect(p.anular.map((a) => a.coluna)).toEqual(['vendedor_id', 'tabela_preco_id', 'condicao_pagamento_id']);
  });
});

describe('zeragem: bloqueios', () => {
  it('RN-CAD-10: cadastro efetivo com integração ligada bloqueia e esvazia o plano', () => {
    const p = planoZeragem(['produto'], com(base(), 'estoque', { ligada: true }));
    expect(p.bloqueios).toEqual([{ cadastro: 'estoque', motivo: 'integracao_ligada' }]);
    expect(p.apagar).toEqual([]);
    expect(p.anular).toEqual([]);
    expect(p.efetivos).toContain('estoque');
  });

  it('RN-CAD-10: preço ligado na integração bloqueia o zerar do produto', () => {
    const p = planoZeragem(['produto'], com(base(), 'preco', { ligada: true }));
    expect(p.bloqueios).toEqual([{ cadastro: 'preco', motivo: 'integracao_ligada' }]);
    expect(p.apagar).toEqual([]);
    expect(p.efetivos).not.toContain('preco');
  });

  it('RN-CAD-10: lote em voo bloqueia com lote_em_andamento, e cadastro fora dos efetivos não bloqueia', () => {
    const f = com(com(base(), 'cliente', { lote_em_voo: true }), 'vendedor', { ligada: true });
    const p = planoZeragem(['cliente'], f);
    expect(p.bloqueios).toEqual([{ cadastro: 'cliente', motivo: 'lote_em_andamento' }]);
    expect(p.apagar).toEqual([]);
    expect(planoZeragem(['preco'], f).bloqueios).toEqual([]);
  });

  it('RN-CAD-10: ligada e lote em voo no mesmo cadastro listam os dois motivos', () => {
    const p = planoZeragem(['preco'], com(base(), 'preco', { ligada: true, lote_em_voo: true }));
    expect(p.bloqueios.map((b) => b.motivo)).toEqual(['integracao_ligada', 'lote_em_andamento']);
  });
});

describe('zeragem: sem_chave, contagens, repetidos e idempotência', () => {
  it('RN-CAD-10: sem_chave conta só as linhas apagadas sem external_id', () => {
    const f = base();
    f.existentes.produto = [{ id: 'p1', com_chave: false }, { id: 'p2', com_chave: true }];
    f.existentes.estoque_saldo = [{ id: 's1', refs: { produto: 'p1', filial: F1 }, com_chave: false }];
    const p = planoZeragem(['produto'], { ...f, usos: { produto: { nota: ['p2'] } } });
    expect(p.sem_chave).toBe(2);
    const q = planoZeragem(['produto'], { ...f, usos: { produto: { nota: ['p1'] } } });
    expect(q.sem_chave).toBe(0);
  });

  it('RN-CAD-10: contagens dá apagados por tabela e anulados por coluna', () => {
    const c = contagens(planoZeragem(['vendedor'], base()));
    expect(c).toEqual({
      apagados: [{ tabela: 'vendedor', quantidade: 2 }],
      anulados: [{ tabela: 'cliente', coluna: 'vendedor_id', quantidade: 1 }],
    });
  });

  it('RN-CAD-10: lista com cadastros repetidos dá o mesmo plano', () => {
    expect(planoZeragem(['produto', 'produto', 'estoque'], base())).toEqual(planoZeragem(['produto'], base()));
  });

  it('RN-CAD-10: idempotente: com os apagados fora dos fatos, o plano seguinte vem vazio', () => {
    const f = base();
    const p = planoZeragem(['produto'], f);
    const restante: FatosZeragem['existentes'] = {};
    for (const [t, l] of Object.entries(f.existentes)) {
      const apagados = new Set(p.apagar.find((a) => a.tabela === t)?.ids ?? []);
      restante[t as keyof typeof restante] = (l ?? []).filter((r) => !apagados.has(r.id));
    }
    const q = planoZeragem(['produto'], { ...f, existentes: restante });
    expect(q.apagar).toEqual([]);
    expect(planoZeragem([], f).efetivos).toEqual([]);
  });
});

describe('zeragem: filial fiscal (A1 ou ambiente fiscal)', () => {
  it('RN-CAD-10: filial com A1 ou ambiente fiscal fica mantida, com o motivo fiscal', () => {
    const p = planoZeragem(['filial'], { ...base(), usos: { filial: { fiscal: [F1] } } });
    expect(ids(p, 'filial')).toEqual([F2]);
    expect(p.mantidos).toEqual([{ cadastro: 'filial', motivo: 'fiscal', quantidade: 1 }]);
    expect(p.emUso.find((e) => e.tabela === 'filial')?.ids).toEqual([F1]);
  });

  it('RN-CAD-10: filial com nota e com A1 conta como nota', () => {
    const p = planoZeragem(['filial'], { ...base(), filiaisComNota: [F1], usos: { filial: { fiscal: [F1] } } });
    expect(p.mantidos).toEqual([{ cadastro: 'filial', motivo: 'nota', quantidade: 1 }]);
  });

  it('RN-CAD-10: os dependentes da filial fiscal ficam', () => {
    const p = planoZeragem(['filial'], { ...base(), usos: { filial: { fiscal: [F1] } } });
    expect(ids(p, 'vendedor')).toEqual(['v2']);
    expect(ids(p, 'cliente')).toEqual(['c2']);
    expect(ids(p, 'estoque_saldo')).toEqual([]);
    expect(ids(p, 'tabela_preco_item')).toEqual(['i2']);
  });
});
