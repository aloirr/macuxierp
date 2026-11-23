import { StatusIntegracaoFdvTenant, ENTIDADES_ENVIO_FDV, falhaEnvioFdv } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { montarStatusTenant, type CredencialStatus, type CursorStatus } from './status';

const credencial: CredencialStatus = { conector_id: 'conector-01', ambiente: 'teste', chave_prefixo: 'mx_abcd1', entidades_habilitadas: ['filial', 'produto'] };
const cursor = (entidade: CursorStatus['entidade'], o: Partial<CursorStatus> = {}): CursorStatus => ({
  entidade, ultimo_envio_em: null, pausada_motivo: null, ultimo_lote_estado: null, erros_abertos: 0, ...o,
});
const cursores = (o: Partial<Record<CursorStatus['entidade'], Partial<CursorStatus>>> = {}) => ENTIDADES_ENVIO_FDV.map((e) => cursor(e, o[e]));

describe('montarStatusTenant (RF-INF-04, RN-INF-02)', () => {
  it('RN-INF-02: sem credencial ativa, tudo desligado e os dados da credencial nulos', () => {
    const r = montarStatusTenant(null, cursores(), null);
    expect(StatusIntegracaoFdvTenant.parse(r)).toEqual(r);
    expect(r.conector_id).toBeNull();
    expect(r.cadastros).toHaveLength(10);
    expect(r.cadastros.every((c) => !c.ligada)).toBe(true);
  });

  it('RN-INF-02: ligada só nos cadastros habilitados, na ordem de carga', () => {
    const r = montarStatusTenant(credencial, cursores(), null);
    expect(StatusIntegracaoFdvTenant.parse(r)).toEqual(r);
    expect(r.cadastros.map((c) => c.entidade)).toEqual([...ENTIDADES_ENVIO_FDV]);
    expect(r.cadastros.filter((c) => c.ligada).map((c) => c.entidade)).toEqual(['filial', 'produto']);
    expect(r).toMatchObject({ conector_id: 'conector-01', ambiente: 'teste', chave_prefixo: 'mx_abcd1' });
  });

  it('RF-INF-04: a falha vem do falhaEnvioFdv do SDK (sem cópia da precedência no domain)', () => {
    const entrada = { pausada_motivo: 'credencial' as const, ultimo_lote_estado: 'recusado', erros_abertos: 3 };
    const r = montarStatusTenant(credencial, cursores({ filial: entrada }), null);
    expect(StatusIntegracaoFdvTenant.parse(r)).toEqual(r);
    expect(r.cadastros.find((c) => c.entidade === 'filial')?.falha).toEqual(falhaEnvioFdv(entrada));
    expect(r.cadastros.find((c) => c.entidade === 'produto')?.falha).toBeNull();
  });

  it('RF-INF-04: leva o último envio do cursor e o último sinal recebido, sem campo a mais', () => {
    const sinal = { ultimo_envio_em: '2026-11-23T10:00:00.000Z', ultimo_aceito_em: null, ultimo_http: 202, parado_por_versao: false };
    const r = montarStatusTenant(credencial, cursores({ filial: { ultimo_envio_em: '2026-11-23T09:00:00.000Z' } }), sinal);
    expect(r.cadastros[0]).toEqual({ entidade: 'filial', ligada: true, ultimo_envio_em: '2026-11-23T09:00:00.000Z', falha: null });
    expect(r.ultimo_sinal).toEqual(sinal);
  });

  it('RN-INF-02: cursor faltando ou fora de ordem vira cadastro sem envio, sempre os 10 na ordem de carga', () => {
    const r = montarStatusTenant(credencial, [cursor('produto', { ultimo_envio_em: '2026-11-23T09:00:00.000Z' }), cursor('filial')], null);
    expect(StatusIntegracaoFdvTenant.parse(r)).toEqual(r);
    expect(r.cadastros).toHaveLength(10);
    expect(r.cadastros.find((c) => c.entidade === 'produto')?.ultimo_envio_em).toBe('2026-11-23T09:00:00.000Z');
    expect(r.cadastros.find((c) => c.entidade === 'cliente')?.ultimo_envio_em).toBeNull();
  });
});
