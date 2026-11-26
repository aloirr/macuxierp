import { describe, expect, it } from 'vitest';
import {
  TEXTO_CONTA_DESBLOQUEADA,
  RESPOSTA_CONTA_BLOQUEADA,
  avaliarEntrada,
} from './conta-bloqueada';

describe('RN-CORE-15: conta bloqueada, avaliarEntrada', () => {
  const casos: Array<[boolean, boolean, boolean, string]> = [
    [true, true, true, 'entra_desbloqueando'],
    [true, true, false, 'entra_desbloqueando'],
    [true, false, true, 'bloqueada'],
    [true, false, false, 'bloqueada'],
    [false, true, true, 'entra'],
    [false, false, true, 'entra'],
    [false, true, false, 'falha'],
    [false, false, false, 'falha'],
  ];
  it.each(casos)('RN-CORE-15: travada=%s temporariaVigente=%s senhaConfere=%s -> %s', (travada, temporariaVigente, senhaConfere, esperado) => {
    expect(avaliarEntrada({ travada, temporariaVigente, senhaConfere })).toBe(esperado);
  });
});

describe('RN-CORE-15: textos da tela', () => {
  it('RN-CORE-15: aviso de bloqueio exato, com a ação de recuperar a senha', () => {
    expect(RESPOSTA_CONTA_BLOQUEADA).toEqual({
      titulo: 'Conta bloqueada',
      mensagem: 'Você errou a senha muitas vezes. Para desbloquear, peça uma senha temporária.',
      acao: { rotulo: 'Recuperar a senha', destino: 'esqueci_senha' },
    });
  });
  it('RN-CORE-15: texto de conta desbloqueada', () => {
    expect(TEXTO_CONTA_DESBLOQUEADA).toBe('Conta desbloqueada.');
  });
});
