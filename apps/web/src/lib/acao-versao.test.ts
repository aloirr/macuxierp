import { describe, expect, it, vi } from 'vitest';
import { CHAVE_RASCUNHO_LOGIN, CHAVE_TRAVA_VERSAO, ErroVersaoNova, VALIDADE_TRAVA_MS, chamarAcao, guardarRascunho, lerRascunho, type Ambiente } from './acao-versao';
import { tipoDoErro } from './falha-log';

class UnrecognizedActionError extends Error {
  constructor() {
    super('Server Action "4009" was not found on the server.');
    this.name = 'UnrecognizedActionError';
  }
}

function armazemFalso() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function ambiente(armazem = armazemFalso()) {
  const a = { armazem, recarregar: vi.fn(), avisar: vi.fn(), agora: () => 1_000_000, build: 'abc123' } satisfies Ambiente;
  return a;
}

const rascunho = () => ({ email: 'ana@exemplo.com.br' });
const versaoNova = () => Promise.reject(new UnrecognizedActionError());

describe('chamarAcao (action de um build anterior)', () => {
  it('versão nova: recarrega uma vez, guarda só o e-mail e deixa a promessa pendente', async () => {
    const a = ambiente();
    const acao = vi.fn(versaoNova);
    const r = await Promise.race([chamarAcao(acao, [], { rascunho }, a), new Promise((ok) => setTimeout(() => ok('pendente'), 20))]);
    expect(r).toBe('pendente');
    expect(a.recarregar).toHaveBeenCalledTimes(1);
    expect(a.avisar).not.toHaveBeenCalled();
    expect(JSON.parse(a.armazem.m.get(CHAVE_TRAVA_VERSAO) ?? '{}')).toMatchObject({ de: 'abc123', em: 1_000_000 });
    expect(JSON.parse(a.armazem.m.get(CHAVE_RASCUNHO_LOGIN) ?? '{}')).toEqual(rascunho());
  });

  it('de novo com a trava posta: não recarrega, mostra o aviso (e solta o botão com `lancar`)', async () => {
    const a = ambiente();
    a.armazem.m.set(CHAVE_TRAVA_VERSAO, JSON.stringify({ de: 'antigo', em: 1_000_000 - 5_000 }));
    await expect(chamarAcao(versaoNova, [], { rascunho, lancar: true }, a)).rejects.toBeInstanceOf(ErroVersaoNova);
    expect(a.recarregar).not.toHaveBeenCalled();
    expect(a.avisar).toHaveBeenCalledTimes(1);
  });

  it('trava vencida (outro deploy, tempo depois): recarrega de novo uma vez', async () => {
    const a = ambiente();
    a.armazem.m.set(CHAVE_TRAVA_VERSAO, JSON.stringify({ de: 'antigo', em: 1_000_000 - VALIDADE_TRAVA_MS - 1 }));
    void chamarAcao(versaoNova, [], {}, a);
    await new Promise((ok) => setTimeout(ok, 5));
    expect(a.recarregar).toHaveBeenCalledTimes(1);
  });

  it('armazenamento bloqueado: avisa em vez de arriscar o laço de recarga', async () => {
    const a = ambiente();
    a.armazem.setItem = () => { throw new Error('bloqueado'); };
    await expect(chamarAcao(versaoNova, [], { lancar: true }, a)).rejects.toBeInstanceOf(ErroVersaoNova);
    expect(a.recarregar).not.toHaveBeenCalled();
    expect(a.avisar).toHaveBeenCalled();
  });

  it('erro de rede/API segue como estava: não recarrega nem avisa', async () => {
    const a = ambiente();
    const rede = new TypeError('fetch failed');
    await expect(chamarAcao(() => Promise.reject(rede), [], { rascunho }, a)).rejects.toBe(rede);
    expect(a.recarregar).not.toHaveBeenCalled();
    expect(a.avisar).not.toHaveBeenCalled();
    expect(a.armazem.m.size).toBe(0);
  });

  it('a senha nunca vai ao storage, nem se vier no rascunho', async () => {
    const a = ambiente();
    void chamarAcao(versaoNova, [], { rascunho: () => ({ email: 'a@b.co', senha: 'segredo-123' } as never) }, a);
    await new Promise((ok) => setTimeout(ok, 5));
    const tudo = JSON.stringify([...a.armazem.m.entries()]);
    expect(tudo).not.toContain('segredo-123');
    expect(tudo).not.toContain('senha');
  });

  it('sucesso devolve o retorno e apaga a trava', async () => {
    const a = ambiente();
    a.armazem.m.set(CHAVE_TRAVA_VERSAO, '{"em":1}');
    expect(await chamarAcao(async (x: number) => x + 1, [1], {}, a)).toBe(2);
    expect(a.armazem.m.has(CHAVE_TRAVA_VERSAO)).toBe(false);
  });
});

describe('rascunho do login', () => {
  it('lê uma vez e apaga', () => {
    const z = armazemFalso();
    guardarRascunho(rascunho(), z);
    expect(lerRascunho(z)).toEqual(rascunho());
    expect(lerRascunho(z)).toBeUndefined();
    expect(z.m.size).toBe(0);
  });
});

describe('log do servidor sem dado pessoal', () => {
  it('traz só o tipo (name, code, causa, digest), nunca a mensagem', () => {
    const e = Object.assign(new Error('falhou para ana@exemplo.com.br senha 123'), { code: 'ECONNREFUSED', digest: 'd1', cause: { name: 'ConnectError', code: 'ECONNRESET' } });
    const t = tipoDoErro(e);
    expect(t).toEqual({ name: 'Error', code: 'ECONNREFUSED', causa_name: 'ConnectError', causa_code: 'ECONNRESET', digest: 'd1' });
    expect(JSON.stringify(t)).not.toContain('ana@');
  });
});
