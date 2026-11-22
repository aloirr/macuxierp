import { describe, expect, it } from 'vitest';
import { type RespostaHub, atrasoRetentativaSegundos, classificarResposta, codigoSeguro } from './resposta';

describe('curva de retentativa do Hub', () => {
  it('RN-INF-04: 5 s, 10 s, 20 s… até 15 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50].map((n) => atrasoRetentativaSegundos(n))).toEqual([5, 10, 20, 40, 80, 160, 320, 640, 900, 900, 900]);
  });

  it('RN-INF-04: respeita Retry-After maior que a curva e ignora o menor', () => {
    expect(atrasoRetentativaSegundos(1, 120)).toBe(120);
    expect(atrasoRetentativaSegundos(3, 2)).toBe(20);
    expect(atrasoRetentativaSegundos(1, 999_999)).toBe(3600);
  });
});

describe('classificação de resposta HTTP', () => {
  const ok = (replay = false): RespostaHub => ({ tipo: 'ok', status: 202, corpo: {}, replay });
  const ret = (status: number | null, retryAfterMs: number | null = null, codigo: string | null = null): RespostaHub => ({ tipo: 'retentavel', status, codigo, retryAfterMs });
  const rec = (status: number, codigo: string | null = null): RespostaHub => ({ tipo: 'recusa', status, codigo });
  const c = classificarResposta;

  it('RN-INF-03: 202 é ok e 202 com Idempotent-Replay é replay', () => {
    expect(c(ok())).toEqual({ acao: 'ok' });
    expect(c(ok(true))).toEqual({ acao: 'replay' });
  });

  it('RN-INF-04: rede, 5xx e 429 retentam, 429 com Retry-After', () => {
    expect(c(ret(null))).toEqual({ acao: 'retentar', retryAfterSegundos: null, codigo: 'rede' });
    expect(c(ret(503))).toMatchObject({ acao: 'retentar', codigo: 'http_503' });
    expect(c(ret(429, 45_000))).toMatchObject({ acao: 'retentar', retryAfterSegundos: 45 });
  });

  it('RN-INF-04: 401 e 403 de credencial pausam todas as entidades', () => {
    expect(c(rec(401))).toMatchObject({ acao: 'pausar', motivo: 'credencial', todasEntidades: true });
    expect(c(rec(403, 'chave_revogada'))).toMatchObject({ motivo: 'credencial', todasEntidades: true });
  });

  it('RN-INF-04: 403 modulo_inativo, 426, 409 de idempotência e outro conector pausam só a entidade', () => {
    expect(c(rec(403, 'modulo_inativo'))).toMatchObject({ motivo: 'licenca_fdv', todasEntidades: true });
    expect(c(rec(426))).toMatchObject({ motivo: 'versao', todasEntidades: false });
    expect(c(rec(409, 'chave_idempotencia_reutilizada'))).toMatchObject({ motivo: 'idempotencia' });
    expect(c(rec(422, 'entidade_de_outro_conector'))).toMatchObject({ motivo: 'topologia' });
  });

  it('RF-INF-02: 413 e 422 acima_do_limite dividem o lote; outro 422 e o 400 pausam', () => {
    expect(c(rec(413))).toEqual({ acao: 'dividir' });
    expect(c(rec(422, 'acima_do_limite'))).toEqual({ acao: 'dividir' });
    expect(c(rec(422, 'outro'))).toMatchObject({ motivo: 'envelope', codigo: 'outro' });
    expect(c(rec(400))).toMatchObject({ motivo: 'envelope' });
  });

  it('RN-INF-04: código fora do formato de identificador cai para http_<status> ou rede', () => {
    expect(codigoSeguro('CHAVE-REVOGADA', 403)).toBe('http_403');
    expect(codigoSeguro('texto livre', null)).toBe('rede');
    expect(codigoSeguro('chave_revogada', 403)).toBe('chave_revogada');
    expect(c(rec(403, 'CHAVE-REVOGADA'))).toMatchObject({ motivo: 'credencial', codigo: 'http_403' });
    expect(c(ret(500, null, 'Erro: CPF 123'))).toMatchObject({ acao: 'retentar', codigo: 'http_500' });
  });
});
