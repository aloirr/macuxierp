import { describe, expect, it } from 'vitest';
import { decidirEmailUnico, MENSAGEM_EMAIL_EM_USO_GLOBAL, normalizarEmailUsuario } from './email-unico';

describe('RN-CORE-18: e-mail único no sistema todo', () => {
  it('RN-CORE-18: normaliza em minúsculas e sem espaços', () => {
    expect(normalizarEmailUsuario('  Ana.Silva@Empresa.COM.br ')).toBe('ana.silva@empresa.com.br');
    expect(normalizarEmailUsuario('a b@x.com')).toBe('ab@x.com');
  });
  it('RN-CORE-18: e-mail vivo em outra empresa ou num superadmin dá EMAIL_EM_USO com a mensagem do produto', () => {
    expect(decidirEmailUnico({ existe_vivo_em_outra_conta: true })).toEqual({
      ok: false,
      codigo: 'EMAIL_EM_USO',
      mensagem: 'Este e-mail já está em uso em outra empresa. Use outro e-mail.',
    });
    expect(MENSAGEM_EMAIL_EM_USO_GLOBAL).toBe('Este e-mail já está em uso em outra empresa. Use outro e-mail.');
  });
  it('RN-CORE-18: sem conta viva com o e-mail (excluída não conta), aceita', () => {
    expect(decidirEmailUnico({ existe_vivo_em_outra_conta: false })).toEqual({ ok: true });
  });
});
