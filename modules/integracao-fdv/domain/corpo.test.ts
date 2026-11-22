import { describe, expect, it } from 'vitest';
import { CorpoReconciliacao, CorpoSinal } from '../contracts';
import { VERSAO_CONECTOR_HUB, dataReferenciaReconciliacao, montarCorpoReconciliacao, montarCorpoSinal, proximaReconciliacaoEm } from './corpo';

describe('sinal de vida', () => {
  const base = { conectorId: 'erp-1', em: '2026-11-21T20:00:00.000Z' };

  it('RF-INF-04 e P-2: corpo no formato do Hub, sem dado pessoal e com parado_por_versao só quando verdadeiro', () => {
    const s = montarCorpoSinal({
      ...base,
      pendentes: { produto: { registros: 3, maisAntigo: '2026-11-21T19:00:00.000Z' }, cliente: { registros: 6000, maisAntigo: '2026-11-21T18:00:00.000Z' } },
      emVoo: { produto: { lotes: 1, registros: 3 } },
      entidades: [
        { entidade: 'produto', ultimo_sucesso_em: '2026-11-21T19:59:00.000Z', completa: false, pausada_motivo: null },
        { entidade: 'cliente', ultimo_sucesso_em: null, completa: true, pausada_motivo: 'versao' },
      ],
    });
    expect(CorpoSinal.parse(s)).toEqual(s);
    expect(s.versao_conector).toBe(VERSAO_CONECTOR_HUB);
    expect(s.versao_contrato).toBe('v1');
    expect(s.fila).toEqual([
      { estado: 'pendente', lotes: 3, linhas: 6003, maisAntigo: '2026-11-21T18:00:00.000Z' },
      { estado: 'em_voo', lotes: 1, linhas: 3, maisAntigo: null },
    ]);
    expect(s.entidades).toEqual([
      { entidade: 'produto', fase: 'delta', ultimo_sucesso: '2026-11-21T19:59:00.000Z', bloqueada: false, lotes_na_fila: 1 },
      { entidade: 'cliente', fase: 'completo', ultimo_sucesso: null, bloqueada: true, lotes_na_fila: 0 },
    ]);
    expect('parado_por_versao' in s).toBe(false);
    expect(montarCorpoSinal({ ...base, pendentes: {}, emVoo: {}, entidades: [], paradoPorVersao: true }).parado_por_versao).toBe(true);
  });

  it('RF-INF-04: os lotes pendentes são estimados com o limite da credencial', () => {
    const pendentes = { produto: { registros: 1000, maisAntigo: '2026-11-21T19:00:00.000Z' } };
    expect(montarCorpoSinal({ ...base, pendentes, emVoo: {}, entidades: [], limiteRegistrosLote: 100 }).fila[0]!.lotes).toBe(10);
    expect(montarCorpoSinal({ ...base, pendentes, emVoo: {}, entidades: [] }).fila[0]!.lotes).toBe(1);
  });

  it('fila vazia quando não há pendente nem lote em voo', () => {
    expect(montarCorpoSinal({ ...base, pendentes: { produto: { registros: 0, maisAntigo: null } }, emVoo: {}, entidades: [] }).fila).toEqual([]);
  });
});

describe('reconciliação diária (RF-INF-04)', () => {
  it('corpo por entidade com a contagem de ativos e soma nula', () => {
    const c = montarCorpoReconciliacao('preco', '2026-11-21', 42);
    expect(CorpoReconciliacao.parse(c)).toEqual(c);
    expect(c).toEqual({ versao_contrato: 'v1', entidade: 'preco', data_referencia: '2026-11-21', contagem: 42, soma: null });
  });

  it('próxima às 06h00 UTC (02h00 de Manaus) do dia seguinte, mesmo depois das 06h', () => {
    expect(proximaReconciliacaoEm(new Date('2026-11-21T20:15:00Z')).toISOString()).toBe('2026-11-22T06:00:00.000Z');
    expect(proximaReconciliacaoEm(new Date('2026-11-21T01:00:00Z')).toISOString()).toBe('2026-11-22T06:00:00.000Z');
    expect(proximaReconciliacaoEm(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe('2027-01-01T06:00:00.000Z');
    expect(dataReferenciaReconciliacao(new Date('2026-11-21T20:15:00Z'))).toBe('2026-11-21');
  });
});
