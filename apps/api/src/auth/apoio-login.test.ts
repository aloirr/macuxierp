/**
 * RN-CORE-15 (T-0111; RD-2288 e RD-2301): toda recusa do login custa `CONFERENCIAS_POR_RECUSA` conferências argon2, exista a
 * conta ou não, travada ou livre, com a temporária vigente, vencida ou sem ela. Conta as chamadas de `conferirSenha` com um
 * espião que repassa à função real. Dados fictícios.
 */
import { ErroApi } from '@macuxierp/platform-sdk';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as senha from './senha';
import { ARGON2_RAPIDO } from '../apoio-teste';
import { CONFERENCIAS_POR_RECUSA, ConferenciaCustoIgual, type ContaParaEntrada } from './apoio-login';
import { TravaContaMemoria } from '../plataforma/limite-ip';

vi.mock('./senha', async (original) => {
  const real = await original<typeof import('./senha')>();
  return { ...real, conferirSenha: vi.fn(real.conferirSenha) };
});

const AGORA = new Date('2026-11-26T12:00:00Z');
const DEPOIS = new Date(AGORA.getTime() + 3_600_000);
const ANTES = new Date(AGORA.getTime() - 60_000);
const ATUAL = 'Senha-atual-de-teste-1';
const TEMPORARIA = 'Temp-de-teste-9!';
const ERRADA = 'Senha-errada-de-teste-2';

let hashAtual: string;
let hashTemporaria: string;
beforeAll(async () => {
  hashAtual = await senha.gerarHashSenha(ATUAL, ARGON2_RAPIDO);
  hashTemporaria = await senha.gerarHashSenha(TEMPORARIA, ARGON2_RAPIDO);
});
beforeEach(() => vi.mocked(senha.conferirSenha).mockClear());

const conta = (o: { travada?: boolean; temporaria?: 'vigente' | 'vencida' | 'nenhuma' }): ContaParaEntrada => ({
  senha_hash: hashAtual,
  bloqueado_ate: o.travada ? DEPOIS : null,
  senha_temporaria_hash: o.temporaria && o.temporaria !== 'nenhuma' ? hashTemporaria : null,
  senha_temporaria_expira_em: o.temporaria === 'vigente' ? DEPOIS : o.temporaria === 'vencida' ? ANTES : null,
});

async function recusa(c: ConferenciaCustoIgual, senhaDigitada: string, alvo: ContaParaEntrada): Promise<{ status: number; conferencias: number }> {
  const d = await c.decidirEntrada(senhaDigitada, alvo, AGORA);
  expect(d.resultado === 'bloqueada' || d.resultado === 'falha').toBe(true);
  const e = await c.recusarConta(senhaDigitada, { recusa: d.resultado === 'bloqueada' ? 'bloqueada' : 'falha', conferencias: d.conferencias }, () => new ErroApi(401, 'NAO_AUTENTICADO', 'x')).catch((x: ErroApi) => x);
  return { status: e.status, conferencias: vi.mocked(senha.conferirSenha).mock.calls.length };
}

describe('RN-CORE-15: o mesmo custo argon2 em toda recusa do login', () => {
  it.each([
    ['travada, sem temporária', { travada: true, temporaria: 'nenhuma' }, ATUAL, 423],
    ['travada, temporária vencida (RD-2288)', { travada: true, temporaria: 'vencida' }, TEMPORARIA, 423],
    ['travada, temporária vigente e errada', { travada: true, temporaria: 'vigente' }, ERRADA, 423],
    ['livre, senha errada, sem temporária', { temporaria: 'nenhuma' }, ERRADA, 401],
    ['livre, senha errada, temporária vencida', { temporaria: 'vencida' }, ERRADA, 401],
    ['livre, senha errada, temporária vigente (RD-2301)', { temporaria: 'vigente' }, ERRADA, 401],
  ] as const)('%s: %i conferências', async (_nome, o, digitada, status) => {
    const r = await recusa(new ConferenciaCustoIgual(ARGON2_RAPIDO), digitada, conta(o));
    expect(r).toEqual({ status, conferencias: CONFERENCIAS_POR_RECUSA });
  });

  it('conta que não existe, livre e travada na memória: o mesmo custo, 401 e depois o 423', async () => {
    const c = new ConferenciaCustoIgual(ARGON2_RAPIDO);
    const trava = new TravaContaMemoria({ maxFalhas: 1, travaMinutos: 15 });
    const primeira = await c.recusarSemConta(ERRADA, trava, 'chave', AGORA, () => new ErroApi(401, 'NAO_AUTENTICADO', 'x')).catch((x: ErroApi) => x);
    expect([primeira.status, vi.mocked(senha.conferirSenha).mock.calls.length]).toEqual([401, CONFERENCIAS_POR_RECUSA]);
    vi.mocked(senha.conferirSenha).mockClear();
    const segunda = await c.recusarSemConta(ERRADA, trava, 'chave', AGORA, () => new ErroApi(401, 'NAO_AUTENTICADO', 'x')).catch((x: ErroApi) => x);
    expect([segunda.status, vi.mocked(senha.conferirSenha).mock.calls.length]).toEqual([423, CONFERENCIAS_POR_RECUSA]);
  });

  it('a temporária vigente certa entra desbloqueando a conta travada', async () => {
    const d = await new ConferenciaCustoIgual(ARGON2_RAPIDO).decidirEntrada(TEMPORARIA, conta({ travada: true, temporaria: 'vigente' }), AGORA);
    expect(d).toEqual({ resultado: 'entra_desbloqueando', fimTemporaria: DEPOIS, conferencias: 1 });
  });
});
