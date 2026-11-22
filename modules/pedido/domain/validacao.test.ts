import { describe, expect, it } from 'vitest';
import { avaliarPedido, avaliarPedidoDetalhado, creditoSemLimite, type EntradaAvaliacao, type ItemAvaliacao } from './validacao';

const F1 = '00000000-0000-4000-8000-000000000001'; // padrão
const F2 = '00000000-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';

/** Item-base: 2 un × R$ 10,00, sem desconto. */
function item(o: Partial<ItemAvaliacao> = {}): ItemAvaliacao {
  return { sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: null, ...o };
}

/** Pedido-base que passa em tudo: 2 un × R$ 10,00, limite R$ 1.000,00, saldo 100 un. */
function base(o: Partial<EntradaAvaliacao> = {}): EntradaAvaliacao {
  return {
    cliente: { inativo: false, limite_credito_centavos: 100_000 },
    filial: { emissora: true, inativo: false },
    condicao_pagamento_id: 'cond-1',
    condicao: { inativa: false },
    itens: [item()],
    produtos: [{ id: P1, inativo: false }],
    precos: [{ produto_id: P1, preco_centavos: 1000, desconto_maximo_bp: 500, origem_filial_id: F2 }],
    saldos: [{ produto_id: P1, quantidade: 1_000_000 }],
    compromisso_estoque: [],
    titulos_abertos_centavos: 0,
    compromisso_credito_centavos: 0,
    total_informado_centavos: null,
    ...o,
  };
}
const codigos = (e: EntradaAvaliacao) => avaliarPedido(e).map((p) => p.codigo);

describe('avaliação do pedido', () => {
  it('RN-PED-03: pedido que passa em tudo não tem pendência', () => {
    expect(avaliarPedido(base())).toEqual([]);
  });

  it('RN-CAD-08: cliente inativo é pendência bloqueante', () => {
    expect(avaliarPedido(base({ cliente: { inativo: true, limite_credito_centavos: 100_000 } }))).toEqual([
      { codigo: 'cliente_inativo', bloqueante: true, sequencia: null, produto_id: null },
    ]);
  });

  it('RN-CAD-08: produto inativo é pendência bloqueante, com sequência e produto', () => {
    expect(avaliarPedido(base({ produtos: [{ id: P1, inativo: true }] }))).toEqual([
      { codigo: 'produto_inativo', bloqueante: true, sequencia: 1, produto_id: P1 },
    ]);
  });

  it('RN-PED-03: filial não emissora ou inativa é bloqueante', () => {
    expect(codigos(base({ filial: { emissora: false, inativo: false } }))).toEqual(['filial_nao_emissora']);
    expect(codigos(base({ filial: { emissora: true, inativo: true } }))).toEqual(['filial_nao_emissora']);
    expect(avaliarPedido(base({ filial: { emissora: false, inativo: false } }))[0]?.bloqueante).toBe(true);
  });

  it('RN-CAD-06: produto sem preço na tabela dá preco_sem_tabela (não bloqueante) e não avalia desconto', () => {
    const r = avaliarPedido(base({ precos: [] }));
    expect(r).toEqual([{ codigo: 'preco_sem_tabela', bloqueante: false, sequencia: 1, produto_id: P1 }]);
  });

  it('RN-CAD-06: preço vindo da filial padrão (recuo) vale como preço da tabela', () => {
    // pedido na F2; o preço veio da F1 (padrão): origem_filial_id = F1 e o desconto é medido contra ele
    const e = base({
      precos: [{ produto_id: P1, preco_centavos: 1000, desconto_maximo_bp: 500, origem_filial_id: F1 }],
      itens: [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 200, total_informado_centavos: null }],
    });
    expect(codigos(e)).toEqual(['desconto_acima_maximo']); // 200 de 2000 = 10% > 5%
  });

  it('RN-PED-03: desconto exatamente no máximo passa', () => {
    // 2 × 10,00 = 2000; 5% = 100
    const item = (d: number) => [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: d, total_informado_centavos: null }];
    expect(codigos(base({ itens: item(100) }))).toEqual([]);
    expect(codigos(base({ itens: item(101) }))).toEqual(['desconto_acima_maximo']);
  });

  it('RN-PED-03: preço de venda abaixo da tabela conta como desconto; acima da tabela não gera pendência', () => {
    const item = (preco: number) => [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: preco, desconto_centavos: 0, total_informado_centavos: null }];
    expect(codigos(base({ itens: item(900) }))).toEqual(['desconto_acima_maximo']); // 10%
    expect(codigos(base({ itens: item(950) }))).toEqual([]); // 5% exato
    expect(codigos(base({ itens: item(1200) }))).toEqual([]);
  });

  it('RN-PED-04: crédito exatamente igual ao limite passa e 1 centavo acima cai', () => {
    // total do pedido = 2000; limite 5000; títulos 1000 + compromisso 2000 = 5000 exato
    const e = (limite: number) => base({ cliente: { inativo: false, limite_credito_centavos: limite }, titulos_abertos_centavos: 1000, compromisso_credito_centavos: 2000 });
    expect(codigos(e(5000))).toEqual([]);
    expect(avaliarPedido(e(4999))).toEqual([{ codigo: 'credito_excedido', bloqueante: false, sequencia: null, produto_id: null }]);
  });

  it('RN-PED-04: o compromisso do cliente não inclui o próprio pedido (soma só uma vez)', () => {
    // compromisso 3000 (outros pedidos) + total 2000 = 5000 = limite
    expect(codigos(base({ cliente: { inativo: false, limite_credito_centavos: 5000 }, compromisso_credito_centavos: 3000 }))).toEqual([]);
  });

  it('RN-PED-04: limite 0 vira credito_sem_limite (PR-1) e não duplica credito_excedido', () => {
    const r = avaliarPedido(base({ cliente: { inativo: false, limite_credito_centavos: 0 } }));
    expect(r).toEqual([{ codigo: 'credito_sem_limite', bloqueante: false, sequencia: null, produto_id: null }]);
    expect(creditoSemLimite(0, 1)).toBe(true);
    expect(creditoSemLimite(0, 0)).toBe(false);
    expect(creditoSemLimite(1, 1)).toBe(false);
  });

  it('RN-CAD-07: saldo exatamente igual passa e 1 unidade acima cai', () => {
    const e = (saldo: number) => base({ saldos: [{ produto_id: P1, quantidade: saldo }] });
    expect(codigos(e(20_000))).toEqual([]);
    expect(avaliarPedido(e(19_999))).toEqual([{ codigo: 'estoque_insuficiente', bloqueante: false, sequencia: null, produto_id: P1 }]);
  });

  it('RN-CAD-07: o estoque considera o compromisso dos outros pedidos e produto sem saldo vale 0', () => {
    expect(codigos(base({ saldos: [{ produto_id: P1, quantidade: 30_000 }], compromisso_estoque: [{ produto_id: P1, quantidade: 10_001 }] }))).toEqual(['estoque_insuficiente']);
    expect(codigos(base({ saldos: [] }))).toEqual(['estoque_insuficiente']);
  });

  it('RN-CAD-07: o estoque é somado por produto quando o produto repete em itens', () => {
    const e = base({
      itens: [
        { sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: null },
        { sequencia: 2, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: null },
      ],
      saldos: [{ produto_id: P1, quantidade: 30_000 }], // cada item cabe, a soma (40 000) não
    });
    expect(avaliarPedido(e)).toEqual([{ codigo: 'estoque_insuficiente', bloqueante: false, sequencia: null, produto_id: P1 }]);
  });

  it('RN-CAD-07: produtos diferentes não se misturam no estoque', () => {
    const e = base({
      itens: [
        { sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: null },
        { sequencia: 2, produto_id: P2, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: null },
      ],
      produtos: [{ id: P1, inativo: false }, { id: P2, inativo: false }],
      precos: [
        { produto_id: P1, preco_centavos: 1000, desconto_maximo_bp: 500, origem_filial_id: F1 },
        { produto_id: P2, preco_centavos: 1000, desconto_maximo_bp: 500, origem_filial_id: F1 },
      ],
      saldos: [{ produto_id: P1, quantidade: 20_000 }, { produto_id: P2, quantidade: 19_999 }],
    });
    expect(avaliarPedido(e)).toEqual([{ codigo: 'estoque_insuficiente', bloqueante: false, sequencia: null, produto_id: P2 }]);
  });

  it('RF-PED-03: sem condição ou condição inativa são pendências', () => {
    expect(codigos(base({ condicao_pagamento_id: null, condicao: null }))).toEqual(['condicao_ausente']);
    expect(codigos(base({ condicao: null }))).toEqual(['condicao_ausente']);
    expect(codigos(base({ condicao: { inativa: true } }))).toEqual(['condicao_inativa']);
  });

  it('RN-PED-03: total_divergente quando o total do FDV difere do recalculado, no pedido e no item', () => {
    expect(codigos(base({ total_informado_centavos: 2000 }))).toEqual([]);
    expect(avaliarPedido(base({ total_informado_centavos: 2001 }))).toEqual([{ codigo: 'total_divergente', bloqueante: false, sequencia: null, produto_id: null }]);
    const item = [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: 1999 }];
    expect(avaliarPedido(base({ itens: item }))).toEqual([{ codigo: 'total_divergente', bloqueante: false, sequencia: 1, produto_id: P1 }]);
  });

  it('RN-PED-03: o total do pedido para o crédito é a soma dos itens com arredondamento por item', () => {
    // 0,5 × 10,01 = 5,005 → 5,01 (501), e o limite exato de 501 passa
    const itens = [{ sequencia: 1, produto_id: P1, quantidade: 5_000, preco_unitario_centavos: 1001, desconto_centavos: 0, total_informado_centavos: null }];
    const precos = [{ produto_id: P1, preco_centavos: 1001, desconto_maximo_bp: 0, origem_filial_id: F1 }];
    expect(codigos(base({ itens, precos, cliente: { inativo: false, limite_credito_centavos: 501 } }))).toEqual([]);
    expect(codigos(base({ itens, precos, cliente: { inativo: false, limite_credito_centavos: 500 } }))).toEqual(['credito_excedido']);
  });

  it('RN-PED-03: desconto maior que o valor do item é entrada incoerente (lança)', () => {
    const itens = [{ sequencia: 1, produto_id: P1, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 1001, total_informado_centavos: null }];
    expect(() => avaliarPedido(base({ itens }))).toThrow();
  });

  it('RN-PED-03: várias pendências saem juntas, em ordem estável', () => {
    const r = codigos(base({ cliente: { inativo: true, limite_credito_centavos: 1 }, condicao: null, saldos: [] }));
    expect(r).toEqual(['cliente_inativo', 'condicao_ausente', 'credito_excedido', 'estoque_insuficiente']);
  });

  it('RN-PED-04: o detalhe traz esperado e informado em centavos, Qtd4 e pontos-base', () => {
    const det = (e: EntradaAvaliacao) => avaliarPedidoDetalhado(e)[0];
    // crédito: limite 1000, títulos 500 + este pedido 2000 = 2500
    expect(det(base({ cliente: { inativo: false, limite_credito_centavos: 1000 }, titulos_abertos_centavos: 500 }))).toMatchObject({ codigo: 'credito_excedido', esperado: 1000, informado: 2500 });
    expect(det(base({ cliente: { inativo: false, limite_credito_centavos: 0 } }))).toMatchObject({ codigo: 'credito_sem_limite', esperado: 0, informado: 2000 });
    // desconto 200 de 2000 = 1000 bp contra máximo 500 bp
    expect(det(base({ itens: [item({ desconto_centavos: 200 })] }))).toMatchObject({ codigo: 'desconto_acima_maximo', esperado: 500, informado: 1000 });
    // estoque: saldo 30 000 − compromisso 10 001 = livre 19 999 contra 20 000 pedidos
    expect(det(base({ saldos: [{ produto_id: P1, quantidade: 30_000 }], compromisso_estoque: [{ produto_id: P1, quantidade: 10_001 }] }))).toMatchObject({ codigo: 'estoque_insuficiente', esperado: 19_999, informado: 20_000 });
    expect(det(base({ saldos: [] }))).toMatchObject({ esperado: 0, informado: 20_000 });
    expect(det(base({ total_informado_centavos: 2001 }))).toMatchObject({ codigo: 'total_divergente', esperado: 2000, informado: 2001 });
    expect(det(base({ itens: [item({ total_informado_centavos: 1999 })] }))).toMatchObject({ codigo: 'total_divergente', esperado: 2000, informado: 1999 });
  });
});
