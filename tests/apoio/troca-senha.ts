/** Conferência única do corpo do 403 TROCAR_SENHA (T-0052, RN-CORE-10/13) nos testes de tests/. */
import { expect } from 'vitest';
import { CODIGO_TROCAR_SENHA, SenhaATrocarResposta, type MOTIVOS_TROCA_SENHA } from '../../packages/platform-sdk/src/index';
import { MENSAGEM_TROCAR_SENHA } from '../../apps/api/src/auth/troca-senha';

/**
 * Sem `motivo` (a API de antes): o corpo é exatamente {codigo, mensagem}. Com `motivo`: segue o `SenhaATrocarResposta`
 * do SDK, sem chave fora do schema, com código, mensagem e motivo exatos; `expira_em` só na temporária.
 * T-0076: motivo opcional até o PR da API (frente login); depois vira obrigatório.
 */
export function conferir403TrocarSenha(corpo: unknown, motivoEsperado: (typeof MOTIVOS_TROCA_SENHA)[number], rotulo?: string): void {
  expect(corpo, rotulo).toBeTypeOf('object');
  expect(corpo, rotulo).not.toBeNull();
  if (!('motivo' in (corpo as object))) {
    expect(corpo, rotulo).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA });
    return;
  }
  const c = SenhaATrocarResposta.strict().parse(corpo); // o z.literal do schema já confere o código
  expect(c.mensagem, rotulo).toBe(MENSAGEM_TROCAR_SENHA);
  expect(c.motivo, rotulo).toBe(motivoEsperado);
  if (motivoEsperado === 'provisoria') expect('expira_em' in c, rotulo).toBe(false);
}
