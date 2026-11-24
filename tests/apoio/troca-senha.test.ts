/** T-0076: o helper do 403 TROCAR_SENHA aceita a API de antes (sem motivo) e a de depois (o SenhaATrocarResposta do SDK). */
import { describe, expect, it } from 'vitest';
import { CODIGO_TROCAR_SENHA } from '../../packages/platform-sdk/src/index';
import { MENSAGEM_TROCAR_SENHA } from '../../apps/api/src/auth/troca-senha';
import { conferir403TrocarSenha } from './troca-senha';

const BASE = { codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA };
const EXPIRA = '2026-11-27T03:00:00.000Z';

describe('T-0076: conferir403TrocarSenha', () => {
  it('aceita sem motivo, com o motivo esperado, com destino válido e com expira_em na temporária', () => {
    conferir403TrocarSenha(BASE, 'provisoria');
    conferir403TrocarSenha({ ...BASE, motivo: 'provisoria' }, 'provisoria');
    conferir403TrocarSenha({ ...BASE, motivo: 'temporaria' }, 'temporaria');
    conferir403TrocarSenha({ ...BASE, motivo: 'provisoria', destino: 'bko' }, 'provisoria');
    conferir403TrocarSenha({ ...BASE, motivo: 'temporaria', expira_em: EXPIRA, destino: 'config' }, 'temporaria');
  });

  it.each([
    ['motivo errado', { ...BASE, motivo: 'temporaria' }],
    ['motivo fora do enum', { ...BASE, motivo: 'outro' }],
    ['chave extra sem motivo', { ...BASE, campos: {} }],
    ['chave fora do schema com motivo', { ...BASE, motivo: 'provisoria', campos: {} }],
    ['destino inválido', { ...BASE, motivo: 'provisoria', destino: 'app' }],
    ['expira_em com provisoria', { ...BASE, motivo: 'provisoria', expira_em: EXPIRA }],
    ['destino sem motivo', { ...BASE, destino: 'bko' }],
    ['código diferente', { ...BASE, codigo: 'PROIBIDO' }],
    ['código diferente com motivo', { ...BASE, codigo: 'PROIBIDO', motivo: 'provisoria' }],
    ['mensagem diferente', { ...BASE, mensagem: 'Outra mensagem' }],
    ['mensagem diferente com motivo', { ...BASE, mensagem: 'Outra mensagem', motivo: 'provisoria' }],
    ['sem código', { mensagem: MENSAGEM_TROCAR_SENHA }],
    ['null', null],
  ])('recusa: %s', (_, corpo) => {
    expect(() => conferir403TrocarSenha(corpo, 'provisoria')).toThrow();
  });
});
