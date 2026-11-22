/**
 * Ligação do worker (T-0035, T-0040, T-0016): `montarRotinas` e `montarExecutores` usam os adaptadores SQL do core;
 * `montarConsumidores` e `montarAgendas` ligam os do `integracao-fdv` (o conector só com o envio ligado; a busca e o retorno de pedidos só com o recebimento ligado).
 * Um banco que só grava o SQL prova o caminho sem PostgreSQL; as rodadas reais ficam em `modulos.db.test.ts` e
 * `worker.db.test.ts`.
 */
import { exportadorCadastros } from '@macuxierp/cadastros/api';
import { EVENTO_CARGA_INICIAL, TRABALHO_CARGA_INICIAL } from '@macuxierp/cadastros/contracts';
import { exportadorCore } from '@macuxierp/core/api';
import { AGENDA_BUSCA_PEDIDOS_ID, AGENDA_CONECTOR_ID, AGENDA_RETORNO_PEDIDOS_ID, CONSUMIDOR_PUBLICAR_CADASTROS, EVENTOS_CADASTROS_PUBLICADOS } from '@macuxierp/integracao-fdv/api';
import { exportadorPedido } from '@macuxierp/pedido/api';
import { TRABALHO_EXPORTAR } from '@macuxierp/core/contracts';
import { ArmazenamentoMemoria, relogioDoSistema, type Banco, type Transacao } from '@macuxierp/platform-sdk';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import type { EstadoEnvioFdv } from './envio-fdv';
import { EXPORTADORES, montarAgendas, montarConsumidores, montarExecutores, montarRotinas } from './modulos';
import { montarPedidosFdv, type EstadoRecebimentoFdv } from './pedidos-fdv';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const CERT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FILIAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const AGORA = new Date('2026-11-21T11:00:00Z');

/** Banco que grava o SQL de cada consulta e responde pelo primeiro trecho que casar. */
function bancoGravador(respostas: [RegExp, unknown[]][]) {
  const sql: string[] = [];
  const tx: Transacao = {
    consultar: async <T>(texto: string) => {
      sql.push(texto.replace(/\s+/g, ' ').trim());
      return (respostas.find(([re]) => re.test(texto))?.[1] ?? []) as T[];
    },
  } as Transacao;
  const banco: Banco = { comTenant: async (_t, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };
  return { banco, sql };
}

const log = pino({ level: 'silent' });

describe('worker: rotinas e executores com os adaptadores reais', () => {
  it('RF-CORE-04: uma rotina, o alerta do A1 às 11 h UTC (7 h em Manaus), pelos adaptadores SQL do core', async () => {
    const { banco, sql } = bancoGravador([
      [/tenants_ativos/, [{ id: T1 }]],
      [/FROM core\.certificado/, [{ id: CERT, filial_id: FILIAL, valido_ate: new Date('2026-12-01T00:00:00Z') }]],
      [/INSERT INTO core\.aviso_a1/, [{ id: 'novo' }]],
    ]);
    const rotinas = montarRotinas({ banco, log });
    expect(rotinas.map((r) => [r.id, r.horaUtc])).toEqual([['core.alerta_a1', 11]]);
    expect(await rotinas[0]!.executar(AGORA)).toEqual({ tenants: 1, avisos: 1, repetidos: 0, falhas: 0 });
    expect(sql).toEqual([
      expect.stringContaining('plataforma.tenants_ativos()'),
      expect.stringContaining('FROM core.certificado'),
      expect.stringContaining('INSERT INTO core.aviso_a1'),
    ]);
    // regras 8 e 9: nenhuma consulta lê o .pfx, a senha do A1 nem o titular
    expect(sql.join('\n')).not.toMatch(/pfx_cifrado|senha_cifrada|titular/);
  });

  it('RF-CORE-06: a exportação LGPD, com o registro SQL do core e os exportadores de core, cadastros (T-0037) e pedido (T-0016)', async () => {
    const { banco, sql } = bancoGravador([[/SELECT estado FROM core\.exportacao/, [{ estado: 'pronta' }]]]);
    const executores = montarExecutores({ banco, log, armazenamento: new ArmazenamentoMemoria(), catalogo: { inserir: async () => undefined }, agora: () => AGORA });
    expect(executores.map((e) => e.tipo)).toEqual([TRABALHO_EXPORTAR, TRABALHO_CARGA_INICIAL]);
    expect(EXPORTADORES).toEqual([exportadorCore, exportadorCadastros, exportadorPedido]);
    const id = '10000000-0000-4000-8000-000000000001';
    const r = await banco.comTenant(T1, (tx) => executores[0]!.executar({ id, tipo: TRABALHO_EXPORTAR, tenant_id: T1, payload: { exportacao_id: id }, tentativas: 0 }, tx));
    // já pronta: não gera de novo (idempotente), e quem respondeu foi a core.exportacao
    expect(r).toEqual({ exportacao_id: id, estado: 'pronta' });
    expect(sql).toEqual([expect.stringContaining('FROM core.exportacao')]);
  });

  it('C-4 (T-0042): o consumidor da carga inicial enfileira um trabalho por entidade, pela fila PG na transação', async () => {
    const { banco, sql } = bancoGravador([[/INSERT INTO plataforma\.trabalho/, [{ id: 'novo' }]]]);
    const consumidores = montarConsumidores({ log, relogio: relogioDoSistema });
    expect(consumidores[0]!.eventos).toEqual([EVENTO_CARGA_INICIAL]);
    const evento = { id: '20000000-0000-4000-8000-000000000002', nome: EVENTO_CARGA_INICIAL, tenant_id: T1, agregado_id: T1, versao: 1, ocorrido_em: AGORA.toISOString(), ator: 'sistema' as const, request_id: 'r', payload: { entidades: ['filial', 'cliente'] } };
    await banco.comTenant(T1, (tx) => consumidores[0]!.tratar(evento, tx));
    expect(sql).toEqual([expect.stringContaining('plataforma.trabalho'), expect.stringContaining('plataforma.trabalho')]);
  });
});

describe('worker: integracao-fdv ligado (T-0016)', () => {
  const resolvedor = { resolver: async () => new Map<string, string>() };
  const agendas = (recebimento: EstadoRecebimentoFdv, envio: EstadoEnvioFdv = 'ligado') => {
    const { log: pinoLog } = pinoEmMemoria();
    const pedidosFdv = montarPedidosFdv({ log: pinoLog, relogio: relogioDoSistema, recebimento, resolvedor });
    return montarAgendas({ log: pinoLog, relogio: relogioDoSistema, pedidosFdv, envio, outbox: { gravar: async () => 1 } }).map((a) => [a.id, a.modulo]);
  };

  it('MACUXIERP_FDV_ENVIO=desligado (trava de 22/11): sem a agenda do conector, nenhuma escrita no Hub (lotes, sinal, reconciliação)', () => {
    expect(agendas('desligado', 'desligado')).toEqual([]);
    // o recebimento é outra chave: ligado, só as agendas de pedidos entram, sem o conector
    expect(agendas('ligado', 'desligado')).toEqual([
      [AGENDA_BUSCA_PEDIDOS_ID, 'integracao-fdv'],
      [AGENDA_RETORNO_PEDIDOS_ID, 'integracao-fdv'],
    ]);
  });

  it('MACUXIERP_FDV_ENVIO=ligado: a agenda do conector entra', () => {
    expect(agendas('desligado', 'ligado')).toEqual([[AGENDA_CONECTOR_ID, 'integracao-fdv']]);
  });

  it('consumidores: carga inicial, espelho dos cadastros e retorno do pedido, cada um uma vez', () => {
    const consumidores = montarConsumidores({ log, relogio: relogioDoSistema });
    expect(consumidores.map((c) => c.id)).toEqual(['cadastros.carga-inicial', CONSUMIDOR_PUBLICAR_CADASTROS, 'integracao-fdv.retorno-pedido']);
    expect(consumidores[1]!.eventos).toEqual(EVENTOS_CADASTROS_PUBLICADOS);
    expect(consumidores[2]!.eventos).toEqual(['pedido.pedido.recebido@1', 'pedido.pedido.cancelado@1', 'pedido.pedido.faturado@1']);
  });

  it('MACUXIERP_FDV_RECEBIMENTO=desligado: só o conector entra; nem a busca nem o retorno de pedidos', () => {
    expect(agendas('desligado')).toEqual([[AGENDA_CONECTOR_ID, 'integracao-fdv']]);
  });

  it('MACUXIERP_FDV_RECEBIMENTO=ligado: conector, busca e retorno', () => {
    expect(agendas('ligado')).toEqual([
      [AGENDA_CONECTOR_ID, 'integracao-fdv'],
      [AGENDA_BUSCA_PEDIDOS_ID, 'integracao-fdv'],
      [AGENDA_RETORNO_PEDIDOS_ID, 'integracao-fdv'],
    ]);
  });

  it('T-0011: o retorno faturado descartado sem chave do produto (prazo vencido) avisa o monitor (alerta) só com o código e o pedido_uuid', async () => {
    const { log: pinoLog, registros } = pinoEmMemoria();
    const { banco } = bancoGravador([
      [/FROM integracao_fdv\.pedido_recebido/, [{ '?column?': 1 }]],
      [/INSERT INTO integracao_fdv\.retorno_enviado/, [{ id: 'novo' }]],
    ]);
    const relogio = { agora: () => new Date(AGORA.getTime() + 25 * 60 * 60 * 1000) };
    const retorno = montarConsumidores({ log: pinoLog, relogio })[2]!;
    const pedido = '30000000-0000-4000-8000-000000000006';
    const uuid = '40000000-0000-4000-8000-000000000007';
    const produto = '50000000-0000-4000-8000-000000000008';
    const payload = {
      pedido_id: pedido, numero: 8, origem: 'fdv', pedido_uuid: uuid, status: 'faturado', ambiente: 'producao',
      nota: { numero: 1, serie: 1, chave: '1'.repeat(44), emitida_em: AGORA.toISOString(), total_centavos: 1990 },
      itens_faturados: [{ sequencia: 1, produto_id: produto, quantidade: 1, valor_centavos: 1990 }],
    };
    const evento = { id: '20000000-0000-4000-8000-000000000009', nome: 'pedido.pedido.faturado@1', tenant_id: T1, agregado_id: pedido, versao: 1, ocorrido_em: AGORA.toISOString(), ator: 'sistema' as const, request_id: 'r', payload };
    await banco.comTenant(T1, (tx) => retorno.tratar(evento, tx));
    const alerta = registros().find((r) => r.alerta === 'retorno_sem_chave_produto');
    expect(alerta).toMatchObject({ level: 40, tenant_id: T1, modulo: 'integracao-fdv', pedido_uuid: uuid });
  });

  it('o consumidor do retorno sem pedido_recebido do conector (recebimento desligado) só loga o código e não grava nada', async () => {
    const { log: pinoLog, linhas } = pinoEmMemoria();
    const { banco, sql } = bancoGravador([]);
    const retorno = montarConsumidores({ log: pinoLog, relogio: relogioDoSistema })[2]!;
    const pedido = '30000000-0000-4000-8000-000000000003';
    const uuid = '40000000-0000-4000-8000-000000000004';
    const evento = { id: '20000000-0000-4000-8000-000000000005', nome: 'pedido.pedido.recebido@1', tenant_id: T1, agregado_id: pedido, versao: 1, ocorrido_em: AGORA.toISOString(), ator: 'sistema' as const, request_id: 'r', payload: { pedido_id: pedido, numero: 7, origem: 'fdv', pedido_uuid: uuid, status: 'aprovado' } };
    await banco.comTenant(T1, (tx) => retorno.tratar(evento, tx));
    expect(sql).toEqual([expect.stringContaining('FROM integracao_fdv.pedido_recebido')]);
    expect(JSON.parse(linhas[0]!)).toMatchObject({ level: 40, tenant_id: T1, modulo: 'integracao-fdv', pedido_uuid: uuid, codigo: 'pedido_nao_recebido_pelo_conector' });
  });
});
