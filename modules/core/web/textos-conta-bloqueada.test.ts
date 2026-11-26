import { describe, expect, it } from 'vitest';
import * as dominio from '../domain';
import * as web from './index';
import * as api from '../api';

describe('RN-CORE-15: textos da conta bloqueada pelo ponto de entrada web', () => {
  it('RN-CORE-15: o web reexporta os mesmos objetos do domain, sem cópia', () => {
    expect(web.RESPOSTA_CONTA_BLOQUEADA).toBe(dominio.RESPOSTA_CONTA_BLOQUEADA);
    expect(web.TEXTO_CONTA_DESBLOQUEADA).toBe(dominio.TEXTO_CONTA_DESBLOQUEADA);
  });
  it('RN-CORE-15: a api reexporta os mesmos objetos e a mesma função do domain', () => {
    expect(api.avaliarEntrada).toBe(dominio.avaliarEntrada);
    expect(api.RESPOSTA_CONTA_BLOQUEADA).toBe(dominio.RESPOSTA_CONTA_BLOQUEADA);
    expect(api.TEXTO_CONTA_DESBLOQUEADA).toBe(dominio.TEXTO_CONTA_DESBLOQUEADA);
  });
});
