/** Retentativa única em deadlock (40P01) no `comPlataforma` do portal (T-0056): banco falso, sem PostgreSQL. */
import type { BancoPlataformaComLogin, SessaoPlataforma, Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { comRetentativaEmDeadlock, esperaDeadlockMs, type LogRetentativa } from './retentativa';

const SESSAO: SessaoPlataforma = { superadmin_id: '00000000-0000-4000-8000-000000000001', sessao_id: '00000000-0000-4000-8000-000000000002' };
const TX: Transacao = { consultar: async () => [] };
const erroPg = (code: string) => Object.assign(new Error('deadlock detected: processo 123 espera ShareLock em "Fulano"'), { code, detail: 'linha de Fulano' });

/** Banco falso: as primeiras `falhas` transações lançam o SQLSTATE `code`; as seguintes rodam o `fn`. */
function bancoFalso(falhas: number, code = '40P01') {
  let chamadas = 0;
  const banco: BancoPlataformaComLogin = {
    async comPlataforma(_s, fn) {
      chamadas++;
      if (chamadas <= falhas) throw erroPg(code);
      return fn(TX);
    },
    antesDaSessao: async () => {
      chamadas++;
      throw erroPg(code);
    },
  };
  return { banco, chamadas: () => chamadas };
}

function montar(falhas: number, code?: string) {
  const b = bancoFalso(falhas, code);
  const warn = vi.fn<LogRetentativa['warn']>();
  const esperar = vi.fn(async (_ms: number) => undefined);
  const banco = comRetentativaEmDeadlock(b.banco, { warn }, { esperar, sortear: () => 0.5 });
  return { banco, warn, esperar, chamadas: b.chamadas };
}

describe('comRetentativaEmDeadlock (T-0056)', () => {
  it('40P01 uma vez: refaz a transação inteira uma vez, depois da espera, e loga só sqlstate e tentativa', async () => {
    const m = montar(1);
    const fn = vi.fn(async () => 'ok');
    await expect(m.banco.comPlataforma(SESSAO, fn)).resolves.toBe('ok');
    expect(m.chamadas()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(m.esperar).toHaveBeenCalledTimes(1);
    const ms = m.esperar.mock.calls[0]![0];
    expect(ms).toBeGreaterThanOrEqual(20);
    expect(ms).toBeLessThanOrEqual(80);
    expect(m.warn).toHaveBeenCalledTimes(1);
    const [obj, msg] = m.warn.mock.calls[0]!;
    expect(obj).toStrictEqual({ sqlstate: '40P01', tentativa: 2 });
    expect(JSON.stringify([obj, msg])).not.toContain('Fulano');
  });

  it('40P01 duas vezes: o segundo erro segue, sem terceira tentativa', async () => {
    const m = montar(2);
    await expect(m.banco.comPlataforma(SESSAO, async () => 'ok')).rejects.toMatchObject({ code: '40P01' });
    expect(m.chamadas()).toBe(2);
    expect(m.esperar).toHaveBeenCalledTimes(1);
    expect(m.warn).toHaveBeenCalledTimes(1);
  });

  it.each(['40001', '23514', 'MXI03'])('%s não é refeito (só 40P01)', async (code) => {
    const m = montar(1, code);
    await expect(m.banco.comPlataforma(SESSAO, async () => 'ok')).rejects.toMatchObject({ code });
    expect(m.chamadas()).toBe(1);
    expect(m.esperar).not.toHaveBeenCalled();
    expect(m.warn).not.toHaveBeenCalled();
  });

  it('sem erro: uma transação, sem espera nem log', async () => {
    const m = montar(0);
    await expect(m.banco.comPlataforma(SESSAO, async () => 7)).resolves.toBe(7);
    expect(m.chamadas()).toBe(1);
    expect(m.warn).not.toHaveBeenCalled();
  });

  it('antesDaSessao (login) segue sem retentativa', async () => {
    const m = montar(5);
    await expect(m.banco.antesDaSessao(async () => 'ok')).rejects.toMatchObject({ code: '40P01' });
    expect(m.chamadas()).toBe(1);
  });

  it('a espera fica entre 20 e 80 ms nos extremos do sorteio', () => {
    expect(esperaDeadlockMs(() => 0)).toBe(20);
    expect(esperaDeadlockMs(() => 0.999_999)).toBe(80);
    expect(esperaDeadlockMs(() => 1)).toBe(80);
  });
});
