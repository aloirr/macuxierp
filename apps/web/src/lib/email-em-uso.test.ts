import { CODIGO_EMAIL_EM_USO, MENSAGEM_EMAIL_EM_USO } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { erroEmailEmUso } from './email-em-uso';

describe('erroEmailEmUso (ADR 0021 §1)', () => {
  it('409 com o código do SDK devolve o texto e o campo e-mail', () => {
    expect(erroEmailEmUso(409, { codigo: CODIGO_EMAIL_EM_USO })).toEqual({ mensagem: MENSAGEM_EMAIL_EM_USO, campos: { email: MENSAGEM_EMAIL_EM_USO } });
  });
  it('outro status, outro código ou sem detalhes devolve null', () => {
    expect(erroEmailEmUso(422, { codigo: CODIGO_EMAIL_EM_USO })).toBeNull();
    expect(erroEmailEmUso(409, { codigo: 'outro' })).toBeNull();
    expect(erroEmailEmUso(409, undefined)).toBeNull();
  });
});
