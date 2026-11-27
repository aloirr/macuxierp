import { describe, expect, it } from 'vitest';
import { StatusNota } from '../contracts';
import { STATUS_NFE_AUTORIZADA_EM_PRODUCAO, teveNfeAutorizadaEmProducao } from './nfe-producao';

describe('RN-CORE-16: a empresa teve NF-e autorizada em produção (trava a troca do CNPJ)', () => {
  it('RN-CORE-16: autorizada em produção conta, com ou sem a guarda do XML pendente', () => {
    expect(teveNfeAutorizadaEmProducao('producao', 'autorizada')).toBe(true);
    expect(teveNfeAutorizadaEmProducao('producao', 'autorizada_guarda_pendente')).toBe(true);
  });
  it('RN-CORE-16: autorizada que depois foi cancelada conta (o CNPJ já foi usado na SEFAZ)', () => {
    expect(teveNfeAutorizadaEmProducao('producao', 'cancelada')).toBe(true);
  });
  it('RN-CORE-16: homologação nunca conta, em nenhum status', () => {
    for (const s of StatusNota.options) expect(teveNfeAutorizadaEmProducao('homologacao', s)).toBe(false);
  });
  it('RN-CORE-16: rascunho, em autorização, rejeitada, denegada, contingência e inutilizada não contam', () => {
    for (const s of ['rascunho', 'em_autorizacao', 'rejeitada', 'denegada', 'emitida_contingencia', 'inutilizada'] as const) expect(teveNfeAutorizadaEmProducao('producao', s)).toBe(false);
  });
  it('RN-CORE-16: a lista de status é a única fonte e só tem status do contrato', () => {
    for (const s of STATUS_NFE_AUTORIZADA_EM_PRODUCAO) expect(StatusNota.options).toContain(s);
  });
});
