import { describe, expect, it } from 'vitest';
import { RetornoErp } from '../contracts';
import { corpoCanonicoDoRetorno, PayloadPedidoLido, PRAZO_AGUARDAR_CHAVE_MS, retornoDoPedido, retornoRejeitadoErp, type EventoPedido } from './retorno-pedido';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (nome: string, extra: Record<string, unknown> = {}): EventoPedido => ({
  nome,
  ocorrido_em: '2026-11-21T18:00:00.000Z',
  payload: PayloadPedidoLido.parse({ pedido_id: U(1), numero: 42, origem: 'fdv', pedido_uuid: U(2), status: 'aprovado', ...extra }),
});
const nota = { numero: 10, serie: 1, chave: '1'.repeat(44), emitida_em: '2026-11-21T18:00:00.000Z', total_centavos: 5000 };
const CHAVES = new Map([[U(3), 'P001']]);
const itens = [{ sequencia: 1, produto_id: U(3), quantidade: 25_000, valor_centavos: 5000 }];

describe('retornoDoPedido (RN-PED-05, T-0013 §6.2)', () => {
  it('RN-PED-05: recebido (aprovado ou em análise) vira integrado com numero_erp', () => {
    for (const status of ['aprovado', 'em_analise']) {
      const d = retornoDoPedido(ev('pedido.pedido.recebido@1', { status }), null);
      expect(d).toMatchObject({ acao: 'enviar', corpo: { status: 'integrado', numero_erp: '42', pedido_uuid: U(2) } });
    }
  });
  it('RN-PED-01: recusado@1 não é consumido e não gera retorno (a recusa só existe no pedido bko)', () => {
    expect(retornoDoPedido(ev('pedido.pedido.recusado@1', { status: 'recusado', motivo_codigo: 'credito_insuficiente' }), 'integrado')).toEqual({ acao: 'ignorar', motivo: 'evento_sem_retorno' });
  });
  it('RN-PED-05: cancelado@1 vira cancelado; motivo outro leva o texto livre', () => {
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
    const p = retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado_parcial', ambiente: 'producao', nota, itens_faturados: itens }), 'integrado', CHAVES);
    expect(p).toMatchObject({ acao: 'enviar', corpo: { status: 'faturado_parcial', nota: { numero: 10, total_cents: 5000 }, itens_faturados: [{ sequencia: 1, produto_external_id: 'P001', quantidade: 2.5, valor_cents: 5000 }] } });
    const t = retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'producao', nota, itens_faturados: itens }), 'faturado_parcial', CHAVES);
    expect(t).toMatchObject({ acao: 'enviar', corpo: { status: 'faturado_total' } });
    expect(JSON.stringify([p, t])).not.toContain(U(3)); // ADR 0010 item 1: a chave do Hub, nunca o UUID do ERP
  });
  it('ADR 0010 item 1: produto faturado sem chave do Hub no espelho não segue com o UUID cru: devolve aguardar_chave com os produtos', () => {
    const d = retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'producao', nota, itens_faturados: itens }), 'integrado', new Map());
    expect(d).toEqual({ acao: 'aguardar_chave', produtos: [U(3)] });
  });
  it('RN-PED-05 / A-02: sem a chave, o retorno faturado aguarda só nas primeiras 24 h do evento; depois descarta os itens sem chave, sem UUID cru no corpo', () => {
    const faturado = ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'producao', nota, itens_faturados: itens });
    const ocorrido = Date.parse(faturado.ocorrido_em);
    const em = (ms: number) => new Date(ocorrido + ms);
    expect(retornoDoPedido(faturado, 'integrado', new Map(), em(0))).toEqual({ acao: 'aguardar_chave', produtos: [U(3)] });
    expect(retornoDoPedido(faturado, 'integrado', new Map(), em(PRAZO_AGUARDAR_CHAVE_MS - 1))).toMatchObject({ acao: 'aguardar_chave' });
    const d = retornoDoPedido(faturado, 'integrado', new Map(), em(PRAZO_AGUARDAR_CHAVE_MS));
    expect(d).toMatchObject({ acao: 'descartar_sem_chave', produtos: [U(3)], corpo: { status: 'faturado_total', itens_faturados: [] } });
    if (d.acao === 'descartar_sem_chave') expect(RetornoErp.safeParse(d.corpo).success).toBe(true);
    expect(JSON.stringify(d.acao === 'descartar_sem_chave' ? d.corpo : null)).not.toContain(U(3));
    // com a chave, o prazo não importa: envia
    expect(retornoDoPedido(faturado, 'integrado', CHAVES, em(PRAZO_AGUARDAR_CHAVE_MS * 3))).toMatchObject({ acao: 'enviar' });
  });
  it('RN-PED-05: pedido do BKO não gera retorno', () => {
    expect(retornoDoPedido(ev('pedido.pedido.recebido@1', { origem: 'bko', pedido_uuid: null }), null)).toEqual({ acao: 'ignorar', motivo: 'origem_nao_fdv' });
  });
  it('RN-PED-05 / RN-FAT-04/M7: faturado de homologação sem conta_como_real true não gera retorno', () => {
    for (const extra of [{}, { conta_como_real: false }]) {
      expect(retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'homologacao', ...extra, nota, itens_faturados: itens }), 'integrado', CHAVES)).toEqual({ acao: 'ignorar', motivo: 'homologacao' });
    }
  });
  it('RN-FAT-04/M7: nota de homologação com conta_como_real true vai ao FDV com número e série', () => {
    const d = retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'homologacao', conta_como_real: true, nota, itens_faturados: itens }), 'integrado', CHAVES);
    expect(d).toMatchObject({ acao: 'enviar', corpo: { status: 'faturado_total', nota: { numero: nota.numero, serie: nota.serie } } });
  });
  it('RN-FAT-04/M7: faturado de produção vai ao FDV mesmo com conta_como_real false', () => {
    expect(retornoDoPedido(ev('pedido.pedido.faturado@1', { status: 'faturado', ambiente: 'producao', conta_como_real: false, nota, itens_faturados: itens }), 'integrado', CHAVES).acao).toBe('enviar');
  });
  it('RN-PED-05: depois de status terminal no Hub, nada mais é enviado; integrado repetido é ignorado', () => {
    expect(retornoDoPedido(ev('pedido.pedido.cancelado@1', { status: 'cancelado' }), 'cancelado')).toMatchObject({ acao: 'ignorar', motivo: 'hub_ja_terminal' });
    expect(retornoDoPedido(ev('pedido.pedido.recebido@1'), 'integrado')).toMatchObject({ acao: 'ignorar', motivo: 'hub_ja_adiante' });
  });
  it('RN-PED-05: rejeitado_erp do recebimento recusado leva o motivo do catálogo e nenhum numero_erp', () => {
    const c = retornoRejeitadoErp(U(2), 'cliente_inexistente', new Date('2026-11-21T18:00:00Z'));
    expect(c.numero_erp).toBeUndefined();
  });
  it.each([
    ['modulo_pedido_inativo', 'Módulo de pedidos inativo no ERP'],
    ['cliente_inexistente', 'Cliente não cadastrado no ERP'],
    ['vendedor_inexistente', 'Vendedor não cadastrado no ERP'],
    ['produto_inexistente', 'Produto não cadastrado no ERP'],
    ['filial_inexistente', 'Filial não cadastrada no ERP'],
    ['cliente_inativo', 'Cliente inativo no ERP'],
    ['produto_inativo', 'Produto inativo no ERP'],
    ['filial_nao_emissora', 'Filial inativa ou não emissora no ERP'],
    ['condicao_ausente', 'Pedido sem condição de pagamento'],
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
