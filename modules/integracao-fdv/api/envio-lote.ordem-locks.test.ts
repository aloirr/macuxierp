import type { Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { enviarLote, finalizar, type Exec, type LinhaLote } from './envio-lote';

/** Para a execução logo depois da primeira transação do envio (o que vem depois da chamada ao Hub não interessa). */
class ParouAqui extends Error {}

describe('ordem dos bloqueios do envio (40P01)', () => {
  it('ordem dos locks: o UPDATE de integracao_fdv.sinal vem antes do de cursor_entidade (sinal -> credencial -> cursor)', async () => {
    const sqls: string[] = [];
    const tx: Transacao = {
      consultar: async (sql) => {
        sqls.push(sql);
        return /UPDATE integracao_fdv\.lote_envio/.test(sql) ? [{ tentativas: 1 } as never] : [];
      },
    };
    const e = {
      tenant: '00000000-0000-4000-8000-000000000001',
      entidade: 'filial',
      credId: '00000000-0000-4000-8000-000000000002',
      cred: {},
      agora: new Date('2026-11-23T10:00:00.000Z'),
      ctx: {
        posseAte: new Date('2026-11-23T10:05:00.000Z'),
        emTransacao: <R>(fn: (t: Transacao) => Promise<R>) => fn(tx),
        hub: { chamar: async () => { throw new ParouAqui(); } },
      },
    } as unknown as Exec;
    const lote = { id: '00000000-0000-4000-8000-000000000003', corpo: {}, chave_idempotencia: 'k' } as unknown as LinhaLote;
    await expect(enviarLote(e, lote)).rejects.toBeInstanceOf(ParouAqui);
    const iSinal = sqls.findIndex((s) => s.includes('integracao_fdv.sinal'));
    const iCursor = sqls.findIndex((s) => s.includes('cursor_entidade'));
    expect(iSinal).toBeGreaterThanOrEqual(0);
    expect(iCursor).toBeGreaterThanOrEqual(0);
    expect(iSinal).toBeLessThan(iCursor);
  });

  it('ordem dos locks no finalizar: lote_envio -> credencial -> cursor_entidade -> registro_publicado (a mesma da 0038)', async () => {
    const sqls: string[] = [];
    const tx: Transacao = {
      consultar: async (sql) => {
        sqls.push(sql);
        return /UPDATE integracao_fdv\.lote_envio/.test(sql) ? [{ id: 'x' } as never] : [];
      },
    };
    const e = {
      tenant: '00000000-0000-4000-8000-000000000001',
      entidade: 'filial',
      credId: '00000000-0000-4000-8000-000000000002',
      agora: new Date('2026-11-23T10:00:00.000Z'),
      ctx: { posseAte: new Date('2026-11-23T10:05:00.000Z') },
      deps: { outbox: { gravar: async () => undefined } },
    } as unknown as Exec;
    const lote = {
      id: '00000000-0000-4000-8000-000000000003', modo: 'delta', geracao: 1, tentativas: 1, sessao_ultimo: null,
      corpo: { registros: [{ external_id: 'a' }] }, contagens: {},
    } as unknown as LinhaLote;
    await finalizar(tx, e, lote, 'concluido', { erros: [], contagens: {} } as never);
    const i = (re: RegExp) => sqls.findIndex((s) => re.test(s));
    const iLote = i(/UPDATE integracao_fdv\.lote_envio/);
    const iCred = i(/integracao_fdv\.credencial/);
    const iCursor = i(/cursor_entidade[\s\S]*FOR NO KEY UPDATE/);
    const iReg = i(/UPDATE integracao_fdv\.registro_publicado/);
    for (const x of [iLote, iCred, iCursor, iReg]) expect(x).toBeGreaterThanOrEqual(0);
    expect(iLote).toBeLessThan(iCred);
    expect(iCred).toBeLessThan(iCursor);
    expect(iCursor).toBeLessThan(iReg);
  });
});
