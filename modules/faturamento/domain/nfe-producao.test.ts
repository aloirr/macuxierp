import { describe, expect, it } from 'vitest';
import { StatusNota } from '../contracts';
import { STATUS_NFE_QUE_TRAVA_TROCA_CNPJ, notaTravaTrocaDeCnpj } from './nfe-producao';

const QUE_CONTAM = ['autorizada', 'autorizada_guarda_pendente', 'cancelada', 'em_autorizacao', 'emitida_contingencia'] as const;
const QUE_NAO_CONTAM = ['rascunho', 'rejeitada', 'denegada', 'inutilizada'] as const;

describe('RN-CORE-16: a nota trava a troca do CNPJ (na dúvida, bloqueia)', () => {
  it('RN-CORE-16: autorizada em produção trava, com ou sem a guarda do XML pendente', () => {
    expect(notaTravaTrocaDeCnpj('producao', 'autorizada')).toBe(true);
    expect(notaTravaTrocaDeCnpj('producao', 'autorizada_guarda_pendente')).toBe(true);
  });
  it('RN-CORE-16: cancelada trava (o CNPJ já foi usado na SEFAZ)', () => {
    expect(notaTravaTrocaDeCnpj('producao', 'cancelada')).toBe(true);
  });
  it('RN-CORE-16: em contingência trava (DANFE e XML já saíram com o CNPJ atual)', () => {
    expect(notaTravaTrocaDeCnpj('producao', 'emitida_contingencia')).toBe(true);
  });
  it('RN-CORE-16: em autorização trava (pode voltar autorizada logo após a troca)', () => {
    expect(notaTravaTrocaDeCnpj('producao', 'em_autorizacao')).toBe(true);
  });
  it('RN-CORE-16: rascunho, rejeitada, denegada e inutilizada em produção não travam', () => {
    for (const s of QUE_NAO_CONTAM) expect(notaTravaTrocaDeCnpj('producao', s)).toBe(false);
  });
  it('RN-CORE-16: homologação nunca trava, nem com cada um dos 5 status que contam em produção', () => {
    for (const s of QUE_CONTAM) expect(notaTravaTrocaDeCnpj('homologacao', s)).toBe(false);
    for (const s of StatusNota.options) expect(notaTravaTrocaDeCnpj('homologacao', s)).toBe(false);
  });
  it('RN-CORE-16: a lista tem exatamente os 5 status e todos são do contrato; os demais cobrem o resto', () => {
    expect([...STATUS_NFE_QUE_TRAVA_TROCA_CNPJ].sort()).toEqual([...QUE_CONTAM].sort());
    for (const s of STATUS_NFE_QUE_TRAVA_TROCA_CNPJ) expect(StatusNota.options).toContain(s);
    expect([...QUE_CONTAM, ...QUE_NAO_CONTAM].sort()).toEqual([...StatusNota.options].sort());
  });
});
