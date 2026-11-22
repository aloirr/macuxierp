import { criarEvento } from '@macuxierp/platform-sdk';
import { OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { PedidoFaturadoV1 } from '../contracts';
import { consumidoresDoPedido } from './consumidor-nota';
import { idFaturadoDaNota, idRecuoDaNota } from './eventos';
import { dependenciasEmMemoria, TENANT_MEMORIA } from './memoria';
import type { PedidoGravado } from './portas';
import { RecuoRecusadoPeloBanco } from './util';

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const AGORA = new Date('2026-11-22T14:00:00Z');

function preparar(status: PedidoGravado['status'] = 'aprovado') {
  const m = dependenciasEmMemoria();
  const outbox = new OutboxMemoria();
  const alertas: { codigo: string; contexto: Record<string, string> | undefined }[] = [];
  const alertar = (_tenant: string, codigo: string, contexto?: Record<string, string>) => void alertas.push({ codigo, contexto });
  const [consumidor, cancelada, ...resto] = consumidoresDoPedido({ outbox, relogio: new RelogioFixo(AGORA), log: m.log, alertar, repositorios: m.deps.repositorios });
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
  const cancelar = (notaId: number, itens: { sequencia: number; quantidade: number; valor_centavos: number }[], pedidoId: string | null = U(1), eventoId = notaId + 50) =>
    cancelada!.tratar(
      criarEvento({
        nome: 'faturamento.nota.cancelada@1', tenant_id: TENANT_MEMORIA, agregado_id: U(notaId), ator: 'sistema', request_id: 'r-2',
        payload: { pedido_id: pedidoId, nota: { id: U(notaId), numero: 10, serie: 1 }, itens, motivo: 'cancelamento por erro de digitação' },
      }, AGORA, `00000000-0000-4000-8000-0000000000${eventoId}`),
      { consultar: async () => [] },
    );
  return { m, outbox, consumidor: consumidor!, cancelada: cancelada!, pedido, envio, cancelar, alertas };
}

describe('consumidor de faturamento.nota.autorizada@1 (T-0015)', () => {
  it('RN-PED-02: registra os dois consumidores, da nota autorizada e da nota cancelada, cada um com o seu evento', () => {
    const { consumidor, cancelada } = preparar();
    expect(consumidor.id).toBe('pedido.nota-autorizada');
    expect(consumidor.eventos).toEqual(['faturamento.nota.autorizada@1']);
    expect(cancelada.id).toBe('pedido.nota-cancelada');
    expect(cancelada.eventos).toEqual(['faturamento.nota.cancelada@1']);
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

describe('consumidor de faturamento.nota.cancelada@1 (T-0015, lote 4b)', () => {
  const eventosDe = (o: unknown) => (o as { eventos: { nome: string }[] }).eventos;
  const faturar = async (p: ReturnType<typeof preparar>) => {
    await p.envio(2, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 }]);
    await p.envio(3, [{ sequencia: 2, quantidade: 10_000, valor_centavos: 2000 }]);
    expect(p.pedido.status).toBe('faturado');
  };

  it('RN-PED-02: faturado recua a faturado_parcial e depois a aprovado, sem publicar evento', async () => {
    const p = preparar();
    await faturar(p);
    const antes = eventosDe(p.outbox).length;
    await p.cancelar(2, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 }]);
    expect(p.pedido.status).toBe('faturado_parcial');
    expect(p.pedido.valor_faturado_centavos).toBe(2000);
    expect(p.pedido.itens.map((i) => i.quantidade_faturada)).toEqual([0, 10_000]);
    await p.cancelar(3, [{ sequencia: 2, quantidade: 10_000, valor_centavos: 2000 }]);
    expect(p.pedido.status).toBe('aprovado');
    expect(p.pedido.valor_faturado_centavos).toBe(0);
    expect(eventosDe(p.outbox)).toHaveLength(antes);
    expect(p.m.armazem.eventos.slice(2).map((e) => [e.de, e.para, e.ator_tipo, e.ator_id, e.motivo_codigo, e.evento_id])).toEqual([
      ['faturado', 'faturado_parcial', 'sistema', null, 'nota_cancelada', idRecuoDaNota(U(2))],
      ['faturado_parcial', 'aprovado', 'sistema', null, 'nota_cancelada', idRecuoDaNota(U(3))],
    ]);
    expect(p.alertas).toEqual([]);
  });

  it('RN-PED-02: a mesma nota cancelada de novo não subtrai duas vezes', async () => {
    const p = preparar();
    await faturar(p);
    await p.cancelar(2, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 }]);
    await p.cancelar(2, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 }], U(1), 99);
    expect(p.pedido.valor_faturado_centavos).toBe(2000);
    expect(p.pedido.status).toBe('faturado_parcial');
    expect(p.m.armazem.eventos.filter((e) => e.evento_id === idRecuoDaNota(U(2)))).toHaveLength(1);
  });

  it('RN-PED-02: cancelada sem a autorizada aplicada alerta nota_cancelada_sem_aplicacao e não mexe', async () => {
    const p = preparar();
    await p.cancelar(2, [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1000 }]);
    expect(p.alertas.map((a) => a.codigo)).toEqual(['nota_cancelada_sem_aplicacao']);
    expect(p.alertas[0]!.contexto).toEqual({ pedido_id: U(1), nota_id: U(2), evento_id: expect.any(String) });
    expect(p.pedido.status).toBe('aprovado');
    expect(p.m.armazem.eventos).toHaveLength(0);
  });

  it('RN-PED-02: nota sem pedido, pedido inexistente e payload fora do contrato não lançam', async () => {
    const p = preparar();
    await faturar(p);
    await p.cancelar(2, [{ sequencia: 1, quantidade: 1, valor_centavos: 1 }], null);
    await p.cancelar(2, [{ sequencia: 1, quantidade: 1, valor_centavos: 1 }], U(8));
    await expect(p.cancelada.tratar(criarEvento({ nome: 'faturamento.nota.cancelada@1', tenant_id: TENANT_MEMORIA, agregado_id: U(2), ator: 'sistema', request_id: 'r', payload: { itens: 'x' } }, AGORA), { consultar: async () => [] })).resolves.toBeUndefined();
    expect(p.alertas.map((a) => a.codigo)).toEqual(['nota_fora_do_contrato']);
    expect(p.pedido.status).toBe('faturado');
  });

  it('RN-PED-02: recusa do domain é definitiva: alerta e não lança', async () => {
    const p = preparar();
    await faturar(p);
    await p.cancelar(2, [{ sequencia: 2, quantidade: 10_001, valor_centavos: 1 }]);
    expect(p.alertas.map((a) => a.codigo)).toEqual(['quantidade_acima_do_faturado']);
    expect(p.pedido.status).toBe('faturado');
  });

  it('RN-PED-02: recuo a aprovado com valor faturado incoerente é recusado pelo domain antes do banco', async () => {
    const p = preparar();
    await faturar(p);
    p.pedido.valor_faturado_centavos = 5100;
    await p.cancelar(2, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 2000 }]);
    expect(p.alertas.map((a) => a.codigo)).toEqual(['valor_faturado_incoerente']);
    expect(p.pedido.status).toBe('faturado');
  });

  it('RN-PED-02: MXP02 do banco é definitivo (recuo_recusado_pelo_banco, só ids); erro transitório sobe para o despachante repetir', async () => {
    const p = preparar();
    await faturar(p);
    const original = p.m.deps.repositorios;
    const falha = (erro: Error) => consumidoresDoPedido({
      outbox: p.outbox, relogio: new RelogioFixo(AGORA), log: p.m.log, alertar: (_t, c, x) => void p.alertas.push({ codigo: c, contexto: x }),
      repositorios: (tx) => Object.assign(Object.create(original(tx)) as ReturnType<typeof original>, { aplicarRecuo: async () => { throw erro; } }),
    })[1]!;
    const evento = criarEvento({ nome: 'faturamento.nota.cancelada@1', tenant_id: TENANT_MEMORIA, agregado_id: U(2), ator: 'sistema', request_id: 'r', payload: { pedido_id: U(1), nota: { id: U(2) }, itens: [{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 }] } }, AGORA);
    await expect(falha(new RecuoRecusadoPeloBanco()).tratar(evento, { consultar: async () => [] })).resolves.toBeUndefined();
    expect(p.alertas.map((a) => a.codigo)).toEqual(['recuo_recusado_pelo_banco']);
    expect(p.alertas[0]!.contexto).toEqual({ pedido_id: U(1), nota_id: U(2), evento_id: expect.any(String) });
    await expect(falha(new Error('ECONNRESET')).tratar(evento, { consultar: async () => [] })).rejects.toThrow('ECONNRESET');
    expect(p.m.armazem.eventos.filter((e) => e.motivo_codigo === 'nota_cancelada')).toHaveLength(0);
  });
});
