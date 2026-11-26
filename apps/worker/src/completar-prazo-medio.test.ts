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

  it('desligada não entra no montarRotinas (a ligada, padrão, está na lista do modulos.test)', () => {
    expect(montarRotinas({ banco, log, completarPrazoMedio: false }).some((r) => r.id === ROTINA_COMPLETAR_PRAZO_MEDIO)).toBe(false);
  });
});
