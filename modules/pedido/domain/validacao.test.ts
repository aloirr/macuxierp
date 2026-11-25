import { describe, expect, it } from 'vitest';
import { avaliarPedido, avaliarPrazo, decidirPrazoRecebimentoFdv, avaliarCredito, foraDoCredito, avaliarPedidoDetalhado, decidirRecebimentoFdv, type RetratoRecebimentoFdv, type EntradaAvaliacao, type ItemAvaliacao } from './validacao';
import { FORMAS_A_VISTA } from '@macuxierp/cadastros/contracts';

const F1 = '00000000-0000-4000-8000-000000000001'; // padrão
const F2 = '00000000-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';

/** Item-base: 2 un × R$ 10,00, sem desconto. */
function item(o: Partial<ItemAvaliacao> = {}): ItemAvaliacao {
  return { sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, ...o };
}

/** Pedido-base que passa em tudo: 2 un × R$ 10,00, limite R$ 1.000,00, saldo 100 un. */
function base(o: Partial<EntradaAvaliacao> = {}): EntradaAvaliacao {
  return {
    cliente: { inativo: false, limite_credito_centavos: 100_000 },
    filial: { emissora: true, inativo: false },
    condicao_pagamento_id: 'cond-1',
    condicao: PRAZO,
    itens: [item()],
    produtos: [{ id: P1, inativo: false }],
    precos: [{ produto_id: P1, preco_centavos: 1000, desconto_maximo_bp: 500, origem_filial_id: F2 }],
    saldos: [{ produto_id: P1, quantidade: 1_000_000 }],
    compromisso_estoque: [],
    titulos_abertos_centavos: 0,
    compromisso_credito_centavos: 0,
    ...o,
  };
}
const PRAZO = { codigo: 'B30', descricao: 'Boleto 30 dias', forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30, inativo: false };
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
      itens: [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 200 }],
    });
    expect(codigos(e)).toEqual(['desconto_acima_maximo']); // 200 de 2000 = 10% > 5%
  });

  it('RN-PED-03: desconto exatamente no máximo passa', () => {
    // 2 × 10,00 = 2000; 5% = 100
    const item = (d: number) => [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: d }];
    expect(codigos(base({ itens: item(100) }))).toEqual([]);
    expect(codigos(base({ itens: item(101) }))).toEqual(['desconto_acima_maximo']);
  });

  it('RN-PED-03: preço de venda abaixo da tabela conta como desconto; acima da tabela não gera pendência', () => {
    const item = (preco: number) => [{ sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: preco, desconto_centavos: 0 }];
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

  it('RN-PED-04: a prazo, limite 0 vira credito_sem_limite e não duplica credito_excedido', () => {
    const r = avaliarPedido(base({ cliente: { inativo: false, limite_credito_centavos: 0 } }));
    expect(r).toEqual([{ codigo: 'credito_sem_limite', bloqueante: false, sequencia: null, produto_id: null }]);
    const c = { condicao: PRAZO, titulos_abertos_centavos: 0, compromisso_credito_centavos: 0 };
    expect(avaliarCredito({ ...c, limite_credito_centavos: 0, total_centavos: 1 })?.codigo).toBe('credito_sem_limite');
    expect(avaliarCredito({ ...c, limite_credito_centavos: 0, total_centavos: 0 })).toBeNull();
    expect(avaliarCredito({ ...c, limite_credito_centavos: 1, total_centavos: 1 })).toBeNull();
  });

  it('RN-PED-04: à vista e cartão (03) com limite 0 passam, sem pendência de crédito (decisões de 22/11, 01h10 e 01h12)', () => {
    for (const forma_tpag of [...FORMAS_A_VISTA, '03']) {
      expect(codigos(base({ condicao: { ...PRAZO, forma_tpag }, cliente: { inativo: false, limite_credito_centavos: 0 } }))).toEqual([]);
    }
  });

  it('RN-PED-04: à vista e cartão (03) acima do limite passam, mas preço e estoque continuam validados', () => {
    for (const forma_tpag of [...FORMAS_A_VISTA, '03']) {
      const condicao = { ...PRAZO, forma_tpag };
      expect(codigos(base({ condicao, cliente: { inativo: false, limite_credito_centavos: 1 }, titulos_abertos_centavos: 99_999, compromisso_credito_centavos: 99_999 }))).toEqual([]);
      expect(codigos(base({ condicao, cliente: { inativo: false, limite_credito_centavos: 0 }, precos: [], saldos: [] }))).toEqual(['preco_sem_tabela', 'estoque_insuficiente']);
    }
  });

  it('RN-PED-04: sem condição segue a regra normal de crédito, com condicao_ausente', () => {
    expect(codigos(base({ condicao_pagamento_id: null, condicao: null, cliente: { inativo: false, limite_credito_centavos: 0 } }))).toEqual(['condicao_ausente', 'credito_sem_limite']);
  });

  it('RN-PED-04: foraDoCredito é verdadeira para à vista (01, 17, 04) e cartão (03); boleto, forma desconhecida e sem condição, não', () => {
    for (const forma_tpag of [...FORMAS_A_VISTA, '03']) expect(foraDoCredito({ forma_tpag }), forma_tpag).toBe(true);
    for (const forma_tpag of ['15', '02', '99']) expect(foraDoCredito({ forma_tpag }), forma_tpag).toBe(false);
    expect(foraDoCredito(null)).toBe(false);
  });

  it('RN-PED-04: boleto (15) não é fora do crédito e dá credito_sem_limite com limite 0', () => {
    const condicao = PRAZO;
    expect(foraDoCredito(condicao)).toBe(false);
    expect(codigos(base({ condicao, cliente: { inativo: false, limite_credito_centavos: 0 } }))).toEqual(['credito_sem_limite']);
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
        { sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0 },
        { sequencia: 2, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0 },
      ],
      saldos: [{ produto_id: P1, quantidade: 30_000 }], // cada item cabe, a soma (40 000) não
    });
    expect(avaliarPedido(e)).toEqual([{ codigo: 'estoque_insuficiente', bloqueante: false, sequencia: null, produto_id: P1 }]);
  });

  it('RN-CAD-07: produtos diferentes não se misturam no estoque', () => {
    const e = base({
      itens: [
        { sequencia: 1, produto_id: P1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0 },
        { sequencia: 2, produto_id: P2, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0 },
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
    expect(codigos(base({ condicao: { ...PRAZO, inativo: true } }))).toEqual(['condicao_inativa']);
  });

  it('RN-PED-03: o total do pedido para o crédito é a soma dos itens com arredondamento por item', () => {
    // 0,5 × 10,01 = 5,005 → 5,01 (501), e o limite exato de 501 passa
    const itens = [{ sequencia: 1, produto_id: P1, quantidade: 5_000, preco_unitario_centavos: 1001, desconto_centavos: 0 }];
    const precos = [{ produto_id: P1, preco_centavos: 1001, desconto_maximo_bp: 0, origem_filial_id: F1 }];
    expect(codigos(base({ itens, precos, cliente: { inativo: false, limite_credito_centavos: 501 } }))).toEqual([]);
    expect(codigos(base({ itens, precos, cliente: { inativo: false, limite_credito_centavos: 500 } }))).toEqual(['credito_excedido']);
  });

  it('RN-PED-03: desconto maior que o valor do item é entrada incoerente (lança)', () => {
    const itens = [{ sequencia: 1, produto_id: P1, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 1001 }];
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
  });
});

describe('recebimento do pedido do FDV', () => {
  const retrato = (o: Partial<RetratoRecebimentoFdv> = {}): RetratoRecebimentoFdv => ({
    cliente: { inativo: false },
    filial: { emissora: true, inativo: false },
    condicao_pagamento_id: 'c1',
    condicao: { inativo: false },
    produtos: [{ id: P1, inativo: false, unidade_comercial: 'UN' }],
    itens: [item()],
    ...o,
  });
  const codigo = (o: Partial<RetratoRecebimentoFdv>) => decidirRecebimentoFdv(retrato(o));

  it('RN-PED-01: cadastro em ordem entra aprovado, sem validar preço, crédito nem estoque', () => {
    expect(codigo({})).toEqual({ resultado: 'aprovado' });
  });
  it('RN-PED-01: cliente_inexistente', () => expect(codigo({ cliente: null })).toEqual({ resultado: 'recusado', codigo: 'cliente_inexistente' }));
  it('RN-PED-01: cliente_inativo', () => expect(codigo({ cliente: { inativo: true } })).toEqual({ resultado: 'recusado', codigo: 'cliente_inativo' }));
  it('RN-PED-01: filial_inexistente', () => expect(codigo({ filial: null })).toEqual({ resultado: 'recusado', codigo: 'filial_inexistente' }));
  it('RN-PED-01: filial_nao_emissora, inclusive filial inativa', () => {
    expect(codigo({ filial: { emissora: false, inativo: false } })).toEqual({ resultado: 'recusado', codigo: 'filial_nao_emissora' });
    expect(codigo({ filial: { emissora: true, inativo: true } })).toEqual({ resultado: 'recusado', codigo: 'filial_nao_emissora' });
  });
  it('RN-PED-01: condicao_inexistente (id informado e não achado)', () =>
    expect(codigo({ condicao_pagamento_id: 'c1', condicao: null })).toEqual({ resultado: 'recusado', codigo: 'condicao_inexistente' }));
  it('RN-PED-01: condicao_inativa', () =>
    expect(codigo({ condicao_pagamento_id: 'c1', condicao: { inativo: true } })).toEqual({ resultado: 'recusado', codigo: 'condicao_inativa' }));
  it('RN-PED-01: condicao_ausente (o FDV não informou a condição)', () => {
    expect(codigo({ condicao_pagamento_id: null, condicao: null })).toEqual({ resultado: 'recusado', codigo: 'condicao_ausente' });
  });
  it('RN-PED-01: condição ativa é aprovada', () => {
    expect(codigo({ condicao_pagamento_id: 'c1', condicao: { inativo: false } })).toEqual({ resultado: 'aprovado' });
  });
  it('RN-PED-01: produto_inexistente', () => expect(codigo({ produtos: [] })).toEqual({ resultado: 'recusado', codigo: 'produto_inexistente' }));
  it('RN-PED-01: produto_inativo', () => expect(codigo({ produtos: [{ id: P1, inativo: true, unidade_comercial: 'UN' }] })).toEqual({ resultado: 'recusado', codigo: 'produto_inativo' }));
  it('RN-PED-01: item_incoerente (desconto maior que o valor do item)', () =>
    expect(codigo({ itens: [item({ desconto_centavos: 2001 })] })).toEqual({ resultado: 'recusado', codigo: 'item_incoerente' }));
  it('RN-PED-01: item_incoerente (sequência repetida)', () =>
    expect(codigo({ itens: [item({ sequencia: 1 }), item({ sequencia: 1 })] })).toEqual({ resultado: 'recusado', codigo: 'item_incoerente' }));
  it('RN-PED-01: sequências distintas passam', () =>
    expect(codigo({ itens: [item({ sequencia: 1 }), item({ sequencia: 2 })] })).toEqual({ resultado: 'aprovado' }));
  it('RN-PED-01 e RN-CAD-17: fração em produto UN é recusada como item_incoerente com o motivo da regra', () => {
    expect(codigo({ itens: [item({ quantidade: 15_000 })] })).toEqual({ resultado: 'recusado', codigo: 'item_incoerente', motivo: 'RN-CAD-17: Fração só em KG e M: use quantidade inteira' });
  });
  it('RN-PED-01 e RN-CAD-17: fração em KG entra aprovado', () => {
    expect(codigo({ produtos: [{ id: P1, inativo: false, unidade_comercial: 'KG' }], itens: [item({ quantidade: 15_000 })] })).toEqual({ resultado: 'aprovado' });
  });
  it('RN-PED-01: a ordem dos códigos é cliente, filial, condição, produto, item', () => {
    expect(codigo({ condicao_pagamento_id: 'c1', condicao: null, produtos: [] })).toMatchObject({ codigo: 'condicao_inexistente' });
    expect(codigo({ cliente: { inativo: true }, filial: null })).toMatchObject({ codigo: 'cliente_inativo' });
    expect(codigo({ filial: null, produtos: [] })).toMatchObject({ codigo: 'filial_inexistente' });
    expect(codigo({ produtos: [{ id: P1, inativo: true, unidade_comercial: 'UN' }], itens: [item({ desconto_centavos: 2001 })] })).toMatchObject({ codigo: 'produto_inativo' });
  });
});

describe('RN-PED-07: decisão do recebimento do FDV por prazo', () => {
  it('RN-PED-07: prazo completo e permitido entra aprovado, sem pendência', () => {
    expect(decidirPrazoRecebimentoFdv(PRAZO, { prazo_medio_dias: 30 })).toEqual({ status: 'aprovado', pendencias: [] });
    expect(decidirPrazoRecebimentoFdv(null, { prazo_medio_dias: 1 })).toEqual({ status: 'aprovado', pendencias: [] });
  });
  it('RN-PED-07: prazo incompleto entra em análise com prazo_incompleto bloqueante', () => {
    expect(decidirPrazoRecebimentoFdv({ ...PRAZO, prazo_medio_dias: null }, { prazo_medio_dias: 60 })).toEqual({
      status: 'em_analise',
      pendencias: [{ codigo: 'prazo_incompleto', bloqueante: true, sequencia: null, produto_id: null, esperado: null, informado: null }],
    });
  });
  it('RN-PED-07: prazo acima do cliente entra em análise com esperado e informado', () => {
    expect(decidirPrazoRecebimentoFdv(PRAZO, { prazo_medio_dias: 20 })).toEqual({
      status: 'em_analise',
      pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: true, sequencia: null, produto_id: null, esperado: 20, informado: 30 }],
    });
  });
});

describe('RN-PED-07: prazo completo e permitido ao cliente', () => {
  const cliente = (prazo_medio_dias?: number | null) => ({ inativo: false, limite_credito_centavos: 100_000, ...(prazo_medio_dias === undefined ? {} : { prazo_medio_dias }) });
  const pendencias = (e: EntradaAvaliacao) => avaliarPedidoDetalhado(e).filter((p) => p.codigo === 'prazo_incompleto' || p.codigo === 'prazo_acima_do_cliente');

  it('RN-PED-07: gera a pendência bloqueante prazo_incompleto', () => {
    const e = base({ condicao: { ...PRAZO, prazo_medio_dias: null } });
    expect(avaliarPrazo(e.condicao, cliente(60))).toBe('prazo_incompleto');
    expect(pendencias(e)).toEqual([{ codigo: 'prazo_incompleto', bloqueante: true, sequencia: null, produto_id: null, esperado: null, informado: null }]);
  });
  it('RN-PED-07: gera prazo_acima_do_cliente, com esperado e informado', () => {
    const e = base({ cliente: cliente(20) });
    expect(avaliarPrazo(e.condicao, e.cliente)).toBe('prazo_acima_do_cliente');
    expect(pendencias(e)).toEqual([{ codigo: 'prazo_acima_do_cliente', bloqueante: true, sequencia: null, produto_id: null, esperado: 20, informado: 30 }]);
  });
  it('RN-PED-07: cliente sem prazo médio não tem limite', () => {
    expect(avaliarPrazo(PRAZO, cliente(null))).toBeNull();
    expect(avaliarPrazo(PRAZO, cliente())).toBeNull();
    expect(pendencias(base({ cliente: cliente(null) }))).toEqual([]);
  });
  it('RN-PED-07: prazo médio igual ao do cliente é aceito', () => {
    expect(avaliarPrazo(PRAZO, cliente(30))).toBeNull();
    expect(pendencias(base({ cliente: cliente(30) }))).toEqual([]);
  });
  it('RN-PED-07: cartão de crédito (03) completo com prazo médio acima do cliente é aceito', () => {
    const cartao = { ...PRAZO, forma_tpag: '03', prazo_medio_dias: 90 };
    expect(avaliarPrazo(cartao, cliente(10))).toBeNull();
    expect(pendencias(base({ condicao: cartao, cliente: cliente(10) }))).toEqual([]);
  });
  it('RN-PED-07: cartão de crédito (03) incompleto gera prazo_incompleto', () => {
    const cartao = { ...PRAZO, forma_tpag: '03', prazo_medio_dias: null };
    expect(avaliarPrazo(cartao, cliente(10))).toBe('prazo_incompleto');
    expect(pendencias(base({ condicao: cartao }))).toHaveLength(1);
  });
  it('RN-PED-07: sem condição não há pendência de prazo (a ausência é condicao_ausente)', () => {
    expect(avaliarPrazo(null, cliente(1))).toBeNull();
  });
});
