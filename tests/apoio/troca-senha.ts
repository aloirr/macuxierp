/** Conferência única do corpo do 403 TROCAR_SENHA (T-0052, RN-CORE-10/13) nos testes de tests/. */
import { expect } from 'vitest';
import { CODIGO_TROCAR_SENHA, type MOTIVOS_TROCA_SENHA } from '../../packages/platform-sdk/src/index';
import { MENSAGEM_TROCAR_SENHA } from '../../apps/api/src/auth/troca-senha';

const CHAVES = ['codigo', 'mensagem', 'motivo'];

/**
 * Código e mensagem exatos, sem chave fora de {codigo, mensagem, motivo}; o `motivo`, se vier, é o esperado.
 * T-0076: motivo opcional até o PR da API (frente login); depois vira obrigatório.
 */
export function conferir403TrocarSenha(corpo: unknown, motivoEsperado: (typeof MOTIVOS_TROCA_SENHA)[number], rotulo?: string): void {
  expect(corpo, rotulo).toBeTypeOf('object');
  expect(corpo, rotulo).not.toBeNull();
  const c = corpo as Record<string, unknown>;
  expect(Object.keys(c).filter((k) => !CHAVES.includes(k)), rotulo).toEqual([]);
  expect(c.codigo, rotulo).toBe(CODIGO_TROCAR_SENHA);
  expect(c.mensagem, rotulo).toBe(MENSAGEM_TROCAR_SENHA);
  if ('motivo' in c) expect(c.motivo, rotulo).toBe(motivoEsperado);
}
