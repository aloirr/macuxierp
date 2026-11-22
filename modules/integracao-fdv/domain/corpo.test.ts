import { describe, expect, it } from 'vitest';
import { CorpoSinal } from '../contracts';
import { VERSAO_CONECTOR_HUB, montarCorpoSinal } from './corpo';

describe('sinal de vida', () => {
  it('RF-INF-04 e P-2: corpo válido, sem dado pessoal e com parado_por_versao só quando verdadeiro', () => {
    const s = montarCorpoSinal({
      conectorId: 'erp-1',
      em: '2026-11-21T20:00:00.000Z',
      pendentes: { produto: 3 },
      entidades: [
        { entidade: 'produto', ultimo_envio_em: '2026-11-21T19:59:00.000Z', pausada_motivo: null },
        { entidade: 'cliente', ultimo_envio_em: null, pausada_motivo: 'versao' },
      ],
    });
    expect(CorpoSinal.parse(s)).toEqual(s);
    expect(s.versao_conector).toBe(VERSAO_CONECTOR_HUB);
    expect(VERSAO_CONECTOR_HUB).toBe('1.4.0');
    expect(s.versao_contrato).toBe('v1');
    expect(s.fila).toEqual([{ entidade: 'produto', pendentes: 3 }, { entidade: 'cliente', pendentes: 0 }]);
    expect(s.entidades[1]!.situacao).toBe('pausada');
    expect('parado_por_versao' in s).toBe(false);
    expect(montarCorpoSinal({ conectorId: 'c', em: s.em, pendentes: {}, entidades: [], paradoPorVersao: true }).parado_por_versao).toBe(true);
  });
});
