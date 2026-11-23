/** Peças puras do portal `/config` na API (T-0050, ADR 0012 §4 e §6): SQLSTATE → HTTP e limite de login por IP. */
import { ErroApi } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { erroDaPlataforma } from './erros';
import { LimitePorIp } from './limite-ip';

const pg = (code: string, message = 'empresa "Fulano de Tal" não encontrada') => Object.assign(new Error(message), { code });

describe('erroDaPlataforma (ADR 0012 §4)', () => {
  it.each([
    ['MXS01', 401, 'NAO_AUTENTICADO'],
    ['P0002', 404, 'NAO_ENCONTRADO'],
    ['23505', 409, 'CONFLITO'],
    ['23514', 422, 'REGRA_PLATAFORMA'],
  ])('%s vira %i %s com mensagem fixa, sem o texto do banco', (code, status, codigo) => {
    const e = erroDaPlataforma(pg(code));
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status, codigo });
    expect((e as ErroApi).message).not.toContain('Fulano');
  });

  it('o resto segue como está (ErroApi do plugin, erro de programação → 500)', () => {
    const api = new ErroApi(422, 'RN-CORE-02', 'x');
    expect(erroDaPlataforma(api)).toBe(api);
    const outro = pg('42501');
    expect(erroDaPlataforma(outro)).toBe(outro);
  });
});

describe('LimitePorIp (ADR 0012 §6)', () => {
  it('10 tentativas por IP em 15 min; a 11ª é recusada; a janela vence; IPs são independentes', () => {
    const l = new LimitePorIp(10, 15 * 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(l.contar('1.1.1.1', t0 + i)).toBe(true);
    expect(l.contar('1.1.1.1', t0 + 11)).toBe(false);
    expect(l.contar('2.2.2.2', t0 + 11)).toBe(true);
    expect(l.contar('1.1.1.1', t0 + 15 * 60_000)).toBe(true);
  });

  it('não cresce sem fim: a limpeza tira as janelas vencidas', () => {
    const l = new LimitePorIp(10, 1000, 100);
    for (let i = 0; i < 150; i++) l.contar(`ip-${i}`, 0);
    l.contar('novo', 5000);
    expect(l.tamanho).toBeLessThanOrEqual(51);
  });
});
