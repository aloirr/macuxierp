import { describe, expect, it } from 'vitest';
import { VALIDADE_SENHA_TEMPORARIA_HORAS } from '@macuxierp/platform-sdk';
import {
  avaliarPedidoSenhaEsquecida,
  expiraEm,
  temporariaValida,
} from './senha-esquecida';

const USUARIO = { ativo: true, excluido: false };
const EMPRESA = { situacao: 'ativo' as const };

describe('RN-CORE-13: senha temporária ("esqueci a senha")', () => {
  it('RN-CORE-13: envia só se o usuário existe, está ativo e não excluído, em empresa ativa', () => {
    expect(avaliarPedidoSenhaEsquecida(USUARIO, EMPRESA)).toEqual({ enviar: true });
    expect(avaliarPedidoSenhaEsquecida(null, EMPRESA)).toEqual({ enviar: false, motivo: 'usuario_inexistente' });
    expect(avaliarPedidoSenhaEsquecida({ ativo: false, excluido: false }, EMPRESA)).toEqual({ enviar: false, motivo: 'usuario_inativo' });
    expect(avaliarPedidoSenhaEsquecida({ ativo: true, excluido: true }, EMPRESA)).toEqual({ enviar: false, motivo: 'usuario_inativo' });
    expect(avaliarPedidoSenhaEsquecida(USUARIO, { situacao: 'suspenso' })).toEqual({ enviar: false, motivo: 'empresa_inativa' });
  });

  it('RN-CORE-13: a validade vem por parâmetro; vale até o instante de expiração (exclusive)', () => {
    const agora = new Date('2026-11-23T12:00:00Z');
    const exp = expiraEm(agora, VALIDADE_SENHA_TEMPORARIA_HORAS);
    expect(exp.toISOString()).toBe('2026-11-26T12:00:00.000Z');
    expect(expiraEm(agora, 1).toISOString()).toBe('2026-11-23T13:00:00.000Z');
    expect(temporariaValida(exp, new Date('2026-11-26T11:59:59Z'))).toBe(true);
    expect(temporariaValida(exp, exp)).toBe(false);
    expect(temporariaValida(null, agora)).toBe(false);
  });

  it('RN-CORE-13: expiraEm recusa horas inválidas', () => {
    expect(() => expiraEm(new Date(), 0)).toThrow(RangeError);
    expect(() => expiraEm(new Date(), Number.NaN)).toThrow(RangeError);
  });
});
