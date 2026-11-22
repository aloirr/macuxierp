/**
 * Peças do recebimento de pedidos do FDV no worker (T-0016): desligamento por configuração até a virada (T-0027), alerta
 * do monitor sem dado pessoal (regra 8) e a recusa de ligar sem as agendas do integracao-fdv.
 */
import type { ResolvedorChaveErp } from '@macuxierp/cadastros/api';
import { relogioDoSistema } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { configurarRecebimentoFdv, criarAlertaMonitor, montarPedidosFdv, RecebimentoFdvIndisponivel } from './pedidos-fdv';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const UUID = '12345678-1234-4234-8234-123456789012';
const resolvedor: ResolvedorChaveErp = { resolver: async () => new Map() };

describe('MACUXIERP_FDV_RECEBIMENTO (desligado até a virada, T-0027)', () => {
  it('ausente, vazio ou "desligado" = desligado; "ligado" (sem caixa nem espaço) = ligado', () => {
    expect(configurarRecebimentoFdv({})).toBe('desligado');
    expect(configurarRecebimentoFdv({ MACUXIERP_FDV_RECEBIMENTO: '' })).toBe('desligado');
    expect(configurarRecebimentoFdv({ MACUXIERP_FDV_RECEBIMENTO: 'desligado' })).toBe('desligado');
    expect(configurarRecebimentoFdv({ MACUXIERP_FDV_RECEBIMENTO: ' Ligado ' })).toBe('ligado');
  });

  it('valor fora da lista derruba a partida, citando só o nome da variável', () => {
    for (const v of ['sim', '1', 'true', 'on']) {
      expect(() => configurarRecebimentoFdv({ MACUXIERP_FDV_RECEBIMENTO: v })).toThrow(/^configuração inválida: MACUXIERP_FDV_RECEBIMENTO/);
    }
  });
});

describe('montarPedidosFdv', () => {
  it('desligado: monta o recebedor, o resolvedor e o alerta sem a agenda do módulo (nada vai ao Hub)', () => {
    const { log } = pinoEmMemoria();
    const m = montarPedidosFdv({ log, relogio: relogioDoSistema, recebimento: 'desligado', resolvedor, agendaDoModulo: false });
    expect(m.recebimento).toBe('desligado');
    expect(m.resolvedor).toBe(resolvedor);
    expect(typeof m.recebedor.receber).toBe('function');
  });

  it('ligado sem as agendas do integracao-fdv derruba a partida e diz só o que falta', () => {
    const { log } = pinoEmMemoria();
    const base = { log, relogio: relogioDoSistema, recebimento: 'ligado' as const, resolvedor };
    expect(() => montarPedidosFdv({ ...base, agendaDoModulo: false })).toThrow(RecebimentoFdvIndisponivel);
    expect(() => montarPedidosFdv({ ...base, agendaDoModulo: false })).toThrow(/^MACUXIERP_FDV_RECEBIMENTO=ligado sem: agendas do integracao-fdv$/);
    expect(montarPedidosFdv({ ...base, agendaDoModulo: true }).recebimento).toBe('ligado');
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
