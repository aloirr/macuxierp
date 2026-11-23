import { describe, expect, it } from 'vitest';
import { ChavesIdempotencia } from './chaves';
import { ConfigIndisponivel, ErroPlataforma, mensagemDoErro } from './erros';

const contador = () => {
  let n = 0;
  return () => `k${++n}`;
};

describe('chaves de idempotência da aba Integração', () => {
  it('a rede falhou: a mesma chave é reaproveitada na nova tentativa', () => {
    const c = new ChavesIdempotencia(contador());
    const k1 = c.de('carga:produto');
    const m = mensagemDoErro(new ConfigIndisponivel('API não respondeu'), 'integracao_fdv');
    c.aposResposta('carga:produto', { ok: false, chaveNova: m.chaveNova });
    expect(c.de('carga:produto')).toBe(k1);
  });
  it.each([409, 422])('depois do %i (chaveNova) a próxima tentativa usa chave nova', (status) => {
    const c = new ChavesIdempotencia(contador());
    const k1 = c.de('cfg:produto');
    const m = mensagemDoErro(new ErroPlataforma(status, 'CONFLITO', {}, 'Conflito.'), 'integracao_fdv');
    expect(m.chaveNova).toBe(true);
    c.aposResposta('cfg:produto', { ok: false, chaveNova: m.chaveNova });
    expect(c.de('cfg:produto')).not.toBe(k1);
  });
  it('sucesso libera a chave; ações diferentes têm chaves diferentes', () => {
    const c = new ChavesIdempotencia(contador());
    const a = c.de('testar');
    expect(c.de('retomar:preco')).not.toBe(a);
    c.aposResposta('testar', { ok: true });
    expect(c.de('testar')).not.toBe(a);
  });
});
