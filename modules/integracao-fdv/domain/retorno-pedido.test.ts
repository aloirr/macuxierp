import { describe, expect, it } from 'vitest';
import { RetornoErp } from '../contracts';
import { corpoCanonicoDoRetorno, PayloadPedidoLido, retornoDoPedido, retornoRejeitadoErp, type EventoPedido } from './retorno-pedido';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (nome: string, extra: Record<string, unknown> = {}): EventoPedido => ({
  nome,
  ocorrido_em: '2026-11-21T18:00:00.000Z',
  payload: PayloadPedidoLido.parse({ pedido_id: U(1), numero: 42, origem: 'fdv', pedido_uuid: U(2), status: 'aprovado', ...extra }),
});
const nota = { numero: 10, serie: 1, chave: '1'.repeat(44), emitida_em: '2026-11-21T18:00:00.000Z', total_centavos: 5000 };
const itens = [{ sequencia: 1, produto_id: U(3), quantidade: 25_000, valor_centavos: 5000 }];

describe('retornoDoPedido (RN-PED-05, T-0013 §6.2)', () => {
  it('RN-PED-05: recebido (aprovado ou em análise) vira integrado com numero_erp', () => {
    for (const status of ['aprovado', 'em_analise']) {
      const d = retornoDoPedido(ev('pedido.pedido.recebido@1', { status }), null);
      expect(d).toMatchObject({ acao: 'enviar', corpo: { status: 'integrado', numero_erp: '42', pedido_uuid: U(2) } });
    }
  });
  it('RN-PED-05: recusa depois do integrado vira cancelado com o texto do catálogo', () => {
    const d = retornoDoPedido(ev('pedido.pedido.recusado@1', { status: 'recusado', motivo_codigo: 'credito_insuficiente' }), 'integrado');
    expect(d).toMatchObject({ acao: 'enviar', corpo: { status: 'cancelado', numero_erp: '42', motivo: 'Crédito insuficiente' } });
  });
  it('RN-PED-05: motivo outro leva o texto livre; cancelado@1 também vira cancelado', () => {
    const d = retornoDoPedido(ev('pedido.pedido.cancelado@1', { status: 'cancelado', motivo_codigo: 'outro', motivo_texto: 'combinado' }), 'integrado');
    expect(d).toMatchObject({ acao: 'enviar', corpo: { status: 'cancelado', motivo: 'combinado' } });
  });
  it('RN-PED-05: motivo outro com 400 caracteres é cortado em 300 (o corpo continua válido para o Hub)', () => {
    const d = retornoDoPedido(ev('pedido.pedido.cancelado@1', { status: 'cancelado', motivo_codigo: 'outro', motivo_texto: 'x'.repeat(400) }), 'integrado');
    expect(d).toMatchObject({ acao: 'enviar' });
    if (d.acao === 'enviar') {
      expect(d.corpo.motivo).toHaveLength(300);
      expect(RetornoErp.safeParse(d.corpo).success).toBe(true);
    }
  });
  it('RN-PED-05: faturado parcial e total trazem nota e itens desta nota, com a quantidade na unidade base', () => {
    const p = retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado_parcial', ambiente: 'producao', nota, itens_faturados: itens }), 'integrado');
    expect(p).toMatchObject({ acao: 'enviar', corpo: { status: 'faturado_parcial', nota: { numero: 10, total_cents: 5000 }, itens_faturados: [{ sequencia: 1, produto_external_id: U(3), quantidade: 2.5, valor_cents: 5000 }] } });
    const t = retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'producao', nota, itens_faturados: itens }), 'faturado_parcial');
    expect(t).toMatchObject({ acao: 'enviar', corpo: { status: 'faturado_total' } });
  });
  it('RN-PED-05: pedido do BKO não gera retorno', () => {
    expect(retornoDoPedido(ev('pedido.pedido.recebido@1', { origem: 'bko', pedido_uuid: null }), null)).toEqual({ acao: 'ignorar', motivo: 'origem_nao_fdv' });
  });
  it('RN-PED-05: faturado de homologação não gera retorno', () => {
    expect(retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'homologacao', nota, itens_faturados: itens }), 'integrado')).toEqual({ acao: 'ignorar', motivo: 'homologacao' });
  });
  it('RN-PED-05: depois de status terminal no Hub, nada mais é enviado; integrado repetido é ignorado', () => {
    expect(retornoDoPedido(ev('pedido.pedido.cancelado@1', { status: 'cancelado' }), 'cancelado')).toMatchObject({ acao: 'ignorar', motivo: 'hub_ja_terminal' });
    expect(retornoDoPedido(ev('pedido.pedido.recebido@1'), 'integrado')).toMatchObject({ acao: 'ignorar', motivo: 'hub_ja_adiante' });
  });
  it('RN-PED-05: rejeitado_erp do recebimento recusado leva o motivo do catálogo e nenhum numero_erp', () => {
    const c = retornoRejeitadoErp(U(2), 'cliente_desconhecido', new Date('2026-11-21T18:00:00Z'));
    expect(c).toMatchObject({ status: 'rejeitado_erp', motivo: 'Cliente não cadastrado no ERP' });
    expect(c.numero_erp).toBeUndefined();
  });
  it.each([
    ['modulo_pedido_inativo', 'Módulo de pedidos inativo no ERP'],
    ['cliente_inexistente', 'Cliente não cadastrado no ERP'],
    ['produto_inexistente', 'Produto não cadastrado no ERP'],
    ['filial_inexistente', 'Filial não cadastrada no ERP'],
    ['cliente_inativo', 'Cliente inativo no ERP'],
    ['produto_inativo', 'Produto inativo no ERP'],
    ['filial_nao_emissora', 'Filial não emissora no ERP'],
    ['condicao_inexistente', 'Condição de pagamento não cadastrada no ERP'],
    ['condicao_inativa', 'Condição de pagamento inativa no ERP'],
    ['item_incoerente', 'Item com desconto maior que o valor do item'],
  ])('RN-PED-05: recusa %s vira rejeitado_erp com o motivo certo, sem numero_erp', (codigo, motivo) => {
    const c = retornoRejeitadoErp(U(2), codigo, new Date('2026-11-21T18:00:00Z'));
    expect(c).toMatchObject({ status: 'rejeitado_erp', motivo });
    expect(c.numero_erp).toBeUndefined();
  });
  it('RN-PED-05: o JSON do hash ignora ocorrido_em e a ordem das chaves', () => {
    const a = retornoDoPedido(ev('pedido.pedido.recebido@1'), null);
    const b = retornoDoPedido({ ...ev('pedido.pedido.recebido@1'), ocorrido_em: '2026-11-22T00:00:00.000Z' }, null);
    if (a.acao !== 'enviar' || b.acao !== 'enviar') throw new Error('esperava enviar');
    expect(corpoCanonicoDoRetorno(a.corpo)).toBe(corpoCanonicoDoRetorno(b.corpo));
    expect(corpoCanonicoDoRetorno(a.corpo)).not.toContain('ocorrido_em');
  });
});
