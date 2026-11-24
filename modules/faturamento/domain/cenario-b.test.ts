import { describe, expect, it } from 'vitest';
import { modoFaturamento, notaPodeDescer, type NotaParaDescer } from './cenario-b';

const PEDIDO = '11111111-1111-4111-8111-111111111111';

describe('modo de faturamento (ADR 0014 §15, RN-CORE-02)', () => {
  it('RN-CORE-02: o modo é a licença do módulo faturamento, sem chave nova', () => {
    expect(modoFaturamento(true)).toBe('ligado');
    expect(modoFaturamento(false)).toBe('desligado');
  });
});

const nota: NotaParaDescer = { status: 'autorizada', ambiente: 'producao', xml_guardado: true, chave_acesso: '13261112345678000195550010000012341000012345', pedido_id: PEDIDO, faturamento: 'ligado' };
const rns = (n: Partial<NotaParaDescer>) => notaPodeDescer({ ...nota, ...n }).map((v) => v.rn);

describe('nota pode descer ao banco do cliente (ADR 0014 §13 e §15)', () => {
  it('RN-FAT-03: nota autorizada de produção, com XML guardado e faturamento ligado, desce', () => {
    expect(notaPodeDescer(nota)).toEqual([]);
  });
  it('RN-FAT-03: sem o XML guardado (autorizada_guarda_pendente ou flag falsa) não desce', () => {
    expect(rns({ status: 'autorizada_guarda_pendente' })).toContain('RN-FAT-03');
    expect(rns({ xml_guardado: false })).toContain('RN-FAT-03');
  });
  it('RN-FAT-03: só autorizada desce (rejeitada, cancelada, contingência, denegada não)', () => {
    for (const status of ['rascunho', 'em_autorizacao', 'rejeitada', 'denegada', 'cancelada', 'emitida_contingencia', 'inutilizada'] as const) {
      expect(rns({ status }).length).toBeGreaterThan(0);
    }
  });
  it('RN-FAT-04: nota de homologação ou do simulador nunca desce como se fosse produção', () => {
    expect(rns({ ambiente: 'homologacao' })).toContain('RN-FAT-04');
  });
  it('RN-FAT-11: faturamento desligado não emite, então não há nota do ERP para descer; sem chave ou pedido também não', () => {
    expect(rns({ faturamento: 'desligado' })).toContain('RN-FAT-11');
    expect(rns({ chave_acesso: null })).toContain('RN-FAT-11');
    expect(rns({ pedido_id: null })).toContain('RN-FAT-11');
  });
});
