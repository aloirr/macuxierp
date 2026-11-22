import { criarEvento } from '@macuxierp/platform-sdk';
import { OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { PedidoFaturadoV1 } from '../contracts';
import { consumidoresDoPedido, idFaturadoDaNota } from './consumidor-nota';
import { dependenciasEmMemoria, TENANT_MEMORIA } from './memoria';
import type { PedidoGravado } from './portas';

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const AGORA = new Date('2026-11-22T14:00:00Z');

function preparar(status: PedidoGravado['status'] = 'aprovado') {
  const m = dependenciasEmMemoria();
  const outbox = new OutboxMemoria();
  const alertas: { codigo: string; contexto: Record<string, string> | undefined }[] = [];
  const alertar = (_tenant: string, codigo: string, contexto?: Record<string, string>) => void alertas.push({ codigo, contexto });
  const [consumidor, ...resto] = consumidoresDoPedido({ outbox, relogio: new RelogioFixo(AGORA), log: m.log, alertar, repositorios: m.deps.repositorios });
  expect(resto).toEqual([]);
  const pedido = {
    id: U(1), numero: 7, origem: 'fdv', external_id: U(9), status, filial_id: U(3), cliente_id: U(4), vendedor_id: null, total_centavos: 5000,
    valor_faturado_centavos: 0, a_vista: false, pendencias: [], updated_at: AGORA.toISOString(),
    itens: [
      { id: U(5), sequencia: 1, produto_id: U(5), quantidade: 30_000, quantidade_faturada: 0 },
      { id: U(6), sequencia: 2, produto_id: U(6), quantidade: 10_000, quantidade_faturada: 0 },
    ],
  } as unknown as PedidoGravado;
  m.armazem.pedidos.push(pedido);
  const envio = (notaId: number, itens: { sequencia: number; quantidade: number; valor_centavos: number }[], extra: Record<string, unknown> = {}, pedidoId: string | null = U(1)) =>
    consumidor!.tratar(
      criarEvento({
        nome: 'faturamento.nota.autorizada@1', tenant_id: TENANT_MEMORIA, agregado_id: U(notaId), ator: 'sistema', request_id: 'r-1',
        payload: {
          pedido_id: pedidoId, ambiente: 'producao', conta_como_real: true,
          nota: { id: U(notaId), numero: 10, serie: 1, chave_acesso: '1'.repeat(44), emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 0 },
          itens, ...extra,
        },
      }, AGORA),
      { consultar: async () => [] },
    );
  return { m, outbox, consumidor: consumidor!, pedido, envio, alertas };
}

describe('consumidor de faturamento.nota.autorizada@1 (T-0015)', () => {
  it('RN-PED-02: registra o consumidor da nota autorizada, e só ele nesta fase', () => {
    const { consumidor } = preparar();
    expect(consumidor.id).toBe('pedido.nota-autorizada');
    expect(consumidor.eventos).toEqual(['faturamento.nota.autorizada@1']);
  });

  it('RN-PED-02: nota parcial e depois total leva aprovado a faturado_parcial e a faturado, com histórico e evento', async () => {
    const { m, outbox, pedido, envio } = preparar();
    await envio(2, [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1000 }]);
    expect(pedido.status).toBe('faturado_parcial');
    expect(pedido.valor_faturado_centavos).toBe(1000);
    await envio(3, [{ sequencia: 1, quantidade: 20_000, valor_centavos: 2000 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 2000 }]);
    expect(pedido.status).toBe('faturado');
    expect(pedido.itens.map((i) => i.quantidade_faturada)).toEqual([30_000, 10_000]);
    expect(pedido.valor_faturado_centavos).toBe(5000);
    expect(m.armazem.eventos.map((e) => [e.de, e.para, e.ator_tipo, e.ator_id])).toEqual([['aprovado', 'faturado_parcial', 'sistema', null], ['faturado_parcial', 'faturado', 'sistema', null]]);
    const eventos = (outbox as unknown as { eventos: { nome: string; payload: unknown; id: string; agregado_id: string }[] }).eventos;
    expect(eventos.map((e) => e.nome)).toEqual(['pedido.pedido.faturado@1', 'pedido.pedido.faturado@1']);
    expect(eventos[0]!.id).toBe(idFaturadoDaNota(U(2)));
    expect(eventos[0]!.agregado_id).toBe(U(1));
    expect(PedidoFaturadoV1.parse(eventos[1]!.payload)).toMatchObject({ status: 'faturado', status_anterior: 'faturado_parcial', conta_como_real: true, ambiente: 'producao' });
  });

  it('RN-PED-02: a mesma nota de novo não soma nem publica de novo', async () => {
    const { outbox, pedido, envio } = preparar();
    await envio(2, [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1000 }]);
    await envio(2, [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1000 }]);
    expect(pedido.itens[0]!.quantidade_faturada).toBe(10_000);
    expect(pedido.valor_faturado_centavos).toBe(1000);
    expect((outbox as unknown as { eventos: unknown[] }).eventos).toHaveLength(1);
  });

  it('T-0015: nota sem pedido_id e nota de pedido inexistente são ignoradas, sem dado pessoal no log', async () => {
    const { m, outbox, envio } = preparar();
    await envio(2, [{ sequencia: 1, quantidade: 1, valor_centavos: 1 }], {}, null);
    await envio(3, [{ sequencia: 1, quantidade: 1, valor_centavos: 1 }], {}, U(8));
    expect((outbox as unknown as { eventos: unknown[] }).eventos).toHaveLength(0);
    expect(m.armazem.eventos).toHaveLength(0);
    expect(m.log.linhas.join('\n')).toContain('nota_de_pedido_inexistente');
    expect(m.log.linhas.join('\n')).not.toMatch(/cliente|razao|documento|chave/i);
  });

  it('RN-PED-02: recusa determinística (saldo, sequência, status) alerta e não grava nem lança, para não envenenar a fila', async () => {
    const { m, outbox, pedido, envio, alertas } = preparar();
    await envio(2, [{ sequencia: 2, quantidade: 10_001, valor_centavos: 1 }]);
    await envio(3, [{ sequencia: 9, quantidade: 1, valor_centavos: 1 }]);
    pedido.status = 'cancelado';
    await envio(4, [{ sequencia: 1, quantidade: 1, valor_centavos: 1 }]);
    expect(alertas.map((a) => a.codigo)).toEqual(['quantidade_acima_do_saldo', 'sequencia_inexistente', 'status_invalido']);
    expect(alertas[2]!.contexto).toEqual({ pedido_id: U(1), nota_id: U(4), evento_id: expect.any(String) });
    expect(pedido.itens.every((i) => i.quantidade_faturada === 0)).toBe(true);
    expect((outbox as unknown as { eventos: unknown[] }).eventos).toHaveLength(0);
    expect(m.armazem.eventos).toHaveLength(0);
    expect(m.log.linhas.filter((l) => l.includes('"nivel":"error"'))).toHaveLength(3);
    expect(m.log.linhas.join('\n')).toContain('evento_id');
  });

  it('T-0015: payload fora do contrato alerta nota_fora_do_contrato, loga error com evento_id e não lança', async () => {
    const { m, envio, alertas } = preparar();
    await envio(2, [], { ambiente: 'xpto' });
    expect(alertas).toEqual([{ codigo: 'nota_fora_do_contrato', contexto: { evento_id: expect.any(String) } }]);
    expect(m.log.linhas.join('\n')).toContain('"nivel":"error"');
    expect(m.log.linhas.join('\n')).toContain('nota_fora_do_contrato');
  });
});
