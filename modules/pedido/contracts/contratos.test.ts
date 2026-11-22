import { describe, expect, it } from 'vitest';
import { AprovarEntrada, CancelarEntrada, PedidoCanceladoV1, PedidoManualEntrada, PedidoRecusadoV1, RecusarEntrada, ResultadoRecebimentoFdv, CodigoRecusaRecebimento, StatusPedido } from './index';

const U = '00000000-0000-4000-8000-000000000001';

describe('contratos do pedido', () => {
  it('RN-PED-05: motivo outro exige motivo_texto na recusa e no cancelamento', () => {
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'outro' }).success).toBe(false);
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'outro', motivo_texto: 'x' }).success).toBe(true);
    expect(CancelarEntrada.safeParse({ motivo_codigo: 'outro' }).success).toBe(false);
    expect(CancelarEntrada.safeParse({ motivo_codigo: 'sem_estoque' }).success).toBe(true);
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'outro', motivo_texto: 'x'.repeat(301) }).success).toBe(false);
  });
  it('RN-PED-05: motivo de cancelamento não vale na recusa e vice-versa', () => {
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'sem_estoque' }).success).toBe(false);
    expect(CancelarEntrada.safeParse({ motivo_codigo: 'credito_insuficiente' }).success).toBe(false);
  });
  it('RN-PED-03: justificativa até 500', () => {
    expect(AprovarEntrada.safeParse({ justificativa: 'x'.repeat(501) }).success).toBe(false);
    expect(AprovarEntrada.safeParse({}).success).toBe(true);
  });
  it('RF-PED-02: pedido manual exige itens e quantidade positiva', () => {
    const item = { produto_id: U, quantidade: 10_000, preco_unitario_centavos: 100 };
    expect(PedidoManualEntrada.safeParse({ filial_id: U, cliente_id: U, itens: [item] }).success).toBe(true);
    expect(PedidoManualEntrada.safeParse({ filial_id: U, cliente_id: U, itens: [] }).success).toBe(false);
    expect(PedidoManualEntrada.safeParse({ filial_id: U, cliente_id: U, itens: [{ ...item, quantidade: 0 }] }).success).toBe(false);
  });
  it('P9: motivo_texto no evento só é não nulo quando o motivo é outro', () => {
    const base = { pedido_id: U, numero: 1, origem: 'bko', pedido_uuid: null, status: 'recusado', status_anterior: 'em_analise', filial_id: U, cliente_id: U, vendedor_id: null, total_centavos: 100 };
    expect(PedidoRecusadoV1.safeParse({ ...base, motivo_codigo: 'outro', motivo_texto: 'x' }).success).toBe(true);
    expect(PedidoRecusadoV1.safeParse({ ...base, motivo_codigo: 'preco_divergente', motivo_texto: null }).success).toBe(true);
    expect(PedidoRecusadoV1.safeParse({ ...base, motivo_codigo: 'preco_divergente', motivo_texto: 'dado pessoal' }).success).toBe(false);
    expect(PedidoCanceladoV1.safeParse({ ...base, status: 'cancelado', motivo_codigo: 'sem_estoque', motivo_texto: 'x' }).success).toBe(false);
    expect(PedidoCanceladoV1.safeParse({ ...base, status: 'cancelado', motivo_codigo: 'outro', motivo_texto: 'x' }).success).toBe(true);
  });
});

describe('ResultadoRecebimentoFdv', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('rejeita criado com status em_analise', () => {
    expect(ResultadoRecebimentoFdv.safeParse({ resultado: 'criado', pedido_id: id, numero: 1, status: 'em_analise' }).success).toBe(false);
  });
  it('aceita repetido com qualquer StatusPedido', () => {
    for (const status of StatusPedido.options) expect(ResultadoRecebimentoFdv.safeParse({ resultado: 'repetido', pedido_id: id, numero: 1, status }).success).toBe(true);
  });
  it('os códigos de recusa são exatamente os 10 esperados', () => {
    expect([...CodigoRecusaRecebimento.options].sort()).toEqual(
      ['cliente_inativo', 'cliente_inexistente', 'condicao_inativa', 'condicao_inexistente', 'filial_inexistente', 'filial_nao_emissora', 'item_incoerente', 'modulo_pedido_inativo', 'produto_inativo', 'produto_inexistente'],
    );
  });
});
