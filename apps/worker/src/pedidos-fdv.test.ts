/**
 * Peças do recebimento de pedidos do FDV no worker (T-0016): desligamento por configuração, alerta
 * do monitor sem dado pessoal (regra 8) e a recusa de ligar com o laço de agenda desligado (sem Hub ou sem a chave).
 */
import { relogioDoSistema } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { conferirRecebimentoFdv, criarAlertaMonitor, montarPedidosFdv, RecebimentoFdvIndisponivel, resolvedorChaveErpDeProducao, type ResolvedorChaveErp } from './pedidos-fdv';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const UUID = '12345678-1234-4234-8234-123456789012';
const resolvedor: ResolvedorChaveErp = { resolver: async () => new Map() };

describe('montarPedidosFdv', () => {
  it('ligado ou desligado: monta o recebedor, o resolvedor, o criador de cliente e o alerta (quem decide a busca é o montarAgendas)', () => {
    const { log } = pinoEmMemoria();
    for (const recebimento of ['desligado', 'ligado'] as const) {
      for (const aditivosCliente of [true, false]) {
        const m = montarPedidosFdv({ log, relogio: relogioDoSistema, recebimento, resolvedor, aditivosCliente });
        expect(m.recebimento).toBe(recebimento);
        expect(m.resolvedor).toBe(resolvedor);
        expect(typeof m.recebedor.receber).toBe('function');
        expect(typeof m.alertar).toBe('function');
        expect(typeof m.clientes.criador.decidir).toBe('function');
        expect(m.clientes.aditivos).toBe(aditivosCliente);
      }
    }
  });

  it('o resolvedor de produção é o do cadastros/api, tipado pela porta do integracao-fdv', () => {
    expect(typeof resolvedorChaveErpDeProducao().resolver).toBe('function');
  });
});

describe('conferirRecebimentoFdv (partida)', () => {
  it('ligado com o laço de agenda desligado derruba a partida e cita só os nomes que faltam', () => {
    const faltando = ['MACUXIERP_HUB_URL_TESTE', 'MACUXIERP_HUB_URL_PRODUCAO'];
    expect(() => conferirRecebimentoFdv('ligado', faltando)).toThrow(RecebimentoFdvIndisponivel);
    expect(() => conferirRecebimentoFdv('ligado', faltando)).toThrow(/^MACUXIERP_FDV_RECEBIMENTO=ligado sem: MACUXIERP_HUB_URL_TESTE, MACUXIERP_HUB_URL_PRODUCAO$/);
  });

  it('ligado com o laço de agenda ligado, ou desligado com ou sem ele, sobe', () => {
    expect(() => conferirRecebimentoFdv('ligado', [])).not.toThrow();
    expect(() => conferirRecebimentoFdv('desligado', [])).not.toThrow();
    expect(() => conferirRecebimentoFdv('desligado', ['MACUXIERP_CHAVE_INTEGRACAO'])).not.toThrow();
  });
});

describe('alerta do monitor (Alertar do integracao-fdv) no pino real', () => {
  it('sai como warn com alerta, tenant_id e modulo; o contexto de código e uuid passa', () => {
    const { log, registros } = pinoEmMemoria();
    criarAlertaMonitor(log)(TENANT, 'retorno_recusado_pelo_hub', { pedido_uuid: UUID, codigo: 'transicao_invalida' });
    expect(registros()).toEqual([
      expect.objectContaining({ level: 40, msg: 'alerta do monitor', alerta: 'retorno_recusado_pelo_hub', tenant_id: TENANT, modulo: 'integracao-fdv', pedido_uuid: UUID, codigo: 'transicao_invalida' }),
    ]);
  });

  it('LGPD (regra 8): texto livre, e-mail, chave reservada ou fora do padrão não chega ao log', () => {
    const { log, linhas, registros } = pinoEmMemoria();
    criarAlertaMonitor(log)(TENANT, 'Maria da Silva', {
      motivo: 'Cliente Joao pediu para suspender',
      email: 'maria@exemplo.com',
      tenant_id: 'outro',
      modulo: 'x',
      'Nome Livre': 'abc',
      pedido_uuid: UUID,
    });
    expect(registros()[0]).toMatchObject({ alerta: 'codigo_invalido', tenant_id: TENANT, modulo: 'integracao-fdv', pedido_uuid: UUID });
    const texto = linhas.join('');
    for (const s of ['Maria', 'Joao', 'maria@exemplo.com', 'Nome Livre', '"outro"']) expect(texto).not.toContain(s);
  });
});
