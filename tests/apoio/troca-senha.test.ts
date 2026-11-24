/** T-0076: o helper do 403 TROCAR_SENHA aceita a API de antes (sem motivo) e a de depois (com o motivo certo). */
import { describe, expect, it } from 'vitest';
import { CODIGO_TROCAR_SENHA } from '../../packages/platform-sdk/src/index';
import { MENSAGEM_TROCAR_SENHA } from '../../apps/api/src/auth/troca-senha';
import { conferir403TrocarSenha } from './troca-senha';

const BASE = { codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA };

describe('T-0076: conferir403TrocarSenha', () => {
  it('aceita sem motivo e com o motivo esperado', () => {
    conferir403TrocarSenha(BASE, 'provisoria');
    conferir403TrocarSenha({ ...BASE, motivo: 'provisoria' }, 'provisoria');
    conferir403TrocarSenha({ ...BASE, motivo: 'temporaria' }, 'temporaria');
  });

  it.each([
    ['motivo errado', { ...BASE, motivo: 'temporaria' }],
    ['motivo fora do enum', { ...BASE, motivo: 'outro' }],
    ['chave extra', { ...BASE, campos: {} }],
    ['código diferente', { ...BASE, codigo: 'PROIBIDO' }],
    ['mensagem diferente', { ...BASE, mensagem: 'Outra mensagem' }],
    ['sem código', { mensagem: MENSAGEM_TROCAR_SENHA }],
    ['null', null],
  ])('recusa: %s', (_, corpo) => {
    expect(() => conferir403TrocarSenha(corpo, 'provisoria')).toThrow();
  });
});
