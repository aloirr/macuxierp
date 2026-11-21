import { describe, expect, it } from 'vitest';
import { conferirSenha, gerarHashSenha } from './senha';

const RAPIDO = { memoria: 64, passes: 1, paralelismo: 1 };

describe('senha com argon2id (crypto.argon2 do Node 24.7)', () => {
  it('gera hash PHC argon2id com sal próprio e confere só a senha certa', async () => {
    const a = await gerarHashSenha('segredo', RAPIDO);
    const b = await gerarHashSenha('segredo', RAPIDO);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    expect(a).not.toBe(b);
    expect(await conferirSenha('segredo', a)).toBe(true);
    expect(await conferirSenha('Segredo', a)).toBe(false);
  });

  it('hash fora do formato confere como falso, sem lançar', async () => {
    expect(await conferirSenha('x', 'texto-puro')).toBe(false);
    expect(await conferirSenha('x', '$argon2i$v=19$m=64,t=1,p=1$YWJj$YWJj')).toBe(false);
  });

  it('usa os parâmetros gravados no hash (troca de custo não invalida hash antigo)', async () => {
    const antigo = await gerarHashSenha('segredo', { memoria: 128, passes: 2, paralelismo: 1 });
    expect(await conferirSenha('segredo', antigo)).toBe(true);
  });
});
