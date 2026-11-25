/**
 * Rotina `cadastros.completar-prazo-medio` (T-0108): o interruptor de emergência e o registro no `montarRotinas`, sem banco.
 */
import type { Banco } from '@macuxierp/platform-sdk';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { completarPrazoMedioLigado, ROTINA_COMPLETAR_PRAZO_MEDIO } from './completar-prazo-medio';
import { montarRotinas } from './modulos';

const banco = { comTenant: async () => undefined, semTenant: async () => [], ping: async () => true } as unknown as Banco;
const log = pino({ level: 'silent' });

describe('rotina cadastros.completar-prazo-medio (T-0108, decisões 14 A e 16 A)', () => {
  it('interruptor: só "desligado" (sem diferenciar maiúsculas e espaços) tira a rotina; ausente ou outro valor = ligada', () => {
    expect(completarPrazoMedioLigado({})).toBe(true);
    expect(completarPrazoMedioLigado({ MACUXIERP_COMPLETAR_PRAZO_MEDIO: 'ligado' })).toBe(true);
    expect(completarPrazoMedioLigado({ MACUXIERP_COMPLETAR_PRAZO_MEDIO: '' })).toBe(true);
    expect(completarPrazoMedioLigado({ MACUXIERP_COMPLETAR_PRAZO_MEDIO: 'desligado' })).toBe(false);
    expect(completarPrazoMedioLigado({ MACUXIERP_COMPLETAR_PRAZO_MEDIO: ' Desligado ' })).toBe(false);
  });

  it('ligada (padrão) está no montarRotinas às 0 h UTC, para rodar no primeiro ciclo depois do deploy; desligada não entra', () => {
    expect(montarRotinas({ banco, log }).find((r) => r.id === ROTINA_COMPLETAR_PRAZO_MEDIO)).toMatchObject({ horaUtc: 0 });
    expect(montarRotinas({ banco, log, completarPrazoMedio: true }).some((r) => r.id === ROTINA_COMPLETAR_PRAZO_MEDIO)).toBe(true);
    expect(montarRotinas({ banco, log, completarPrazoMedio: false }).some((r) => r.id === ROTINA_COMPLETAR_PRAZO_MEDIO)).toBe(false);
  });
});
