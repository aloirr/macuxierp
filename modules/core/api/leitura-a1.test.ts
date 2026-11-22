import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import type { Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { cifrarColunasA1 } from './colunas-a1';
import { lerA1DecifradoDaFilial } from './leitura-a1';

const CHAVE = randomBytes(32);
const TENANT = randomUUID();
const FILIAL = randomUUID();
const PFX = Buffer.from('PFX-SECRETO-DO-TESTE');
const SENHA = 'senha-secreta-do-teste';

function txCom(linhas: unknown[]): Transacao {
  return { consultar: async () => linhas as never };
}
const linha = (tenant: string) => ({ id: randomUUID(), tenant_id: tenant, chave_versao: 1, ...cifrarColunasA1({ chave: CHAVE, tenantId: tenant, pfx: PFX, senha: SENHA }) });

describe('T-0045/T-0021: lerA1DecifradoDaFilial (ADR 0005)', () => {
  it('RN-CORE-06: devolve o pfx e a senha decifrados', async () => {
    const l = linha(TENANT);
    const r = await lerA1DecifradoDaFilial(txCom([l]), CHAVE, FILIAL);
    expect(r?.certificado_id).toBe(l.id);
    expect(r?.pfx.equals(PFX)).toBe(true);
    expect(r?.senha).toBe(SENHA);
  });

  it('RN-CORE-06: o resultado não vaza o pfx nem a senha em JSON, texto ou inspeção', async () => {
    const r = await lerA1DecifradoDaFilial(txCom([linha(TENANT)]), CHAVE, FILIAL);
    for (const s of [JSON.stringify(r), String(r), inspect(r)]) {
      expect(s).not.toContain(SENHA);
      expect(s).not.toContain('PFX-SECRETO');
      expect(s).not.toContain(PFX.toString('base64'));
    }
  });

  it('RN-CORE-06: filial sem A1 ativo devolve null', async () => {
    expect(await lerA1DecifradoDaFilial(txCom([]), CHAVE, FILIAL)).toBeNull();
  });

  it('RN-CORE-06: o tenant errado na AAD falha sem vazar o conteúdo', async () => {
    const l = { ...linha(TENANT), tenant_id: randomUUID() };
    const e = await lerA1DecifradoDaFilial(txCom([l]), CHAVE, FILIAL).then(() => null, (x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect(e?.message).not.toContain(SENHA);
  });

  it('RN-CORE-06: chave errada falha sem vazar o conteúdo', async () => {
    const e = await lerA1DecifradoDaFilial(txCom([linha(TENANT)]), randomBytes(32), FILIAL).then(() => null, (x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect(e?.message).not.toContain(SENHA);
    expect(e?.message).not.toContain('PFX-SECRETO');
  });

  it('RN-CORE-06: versão da chave diferente de 1 é recusada com mensagem fixa, sem conteúdo', async () => {
    const l = { ...linha(TENANT), chave_versao: 2 };
    const e = await lerA1DecifradoDaFilial(txCom([l]), CHAVE, FILIAL).then(() => null, (x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect(e?.message).toBe('Versão da chave do A1 não suportada');
  });

  it('RN-CORE-06: id de filial inválido é recusado antes de consultar', async () => {
    await expect(lerA1DecifradoDaFilial(txCom([]), CHAVE, 'x; DROP')).rejects.toThrow();
  });
});
