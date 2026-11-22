import { describe, expect, it } from 'vitest';
import { decidirTrocaDeChave, ehConflitoDeChave } from './troca-chave';

const ERP = '00000000-0000-4000-8000-000000000001';
const base = { erpId: ERP, chaveEspelho: 'C000123', chaveNova: 'C000123', anterior: undefined as string | null | undefined, outroErpIdComChaveNova: null as string | null };

describe('RN-CORE-05 / ADR 0010 item 3: decidirTrocaDeChave', () => {
  it('RN-CORE-05: chave igual à do espelho, ou registro ainda fora do espelho, não é troca', () => {
    expect(decidirTrocaDeChave(base)).toBe('nada');
    expect(decidirTrocaDeChave({ ...base, chaveEspelho: null })).toBe('nada');
    expect(decidirTrocaDeChave({ ...base, anterior: 'QUALQUER' })).toBe('nada');
  });

  it('RN-CORE-05: external_id_anterior igual à chave do espelho é a troca controlada', () => {
    expect(decidirTrocaDeChave({ ...base, chaveNova: 'C999', anterior: 'C000123' })).toBe('troca');
  });

  it('RN-CORE-05: campo ausente (evento antigo) com a chave mudada é chave_alterada', () => {
    expect(decidirTrocaDeChave({ ...base, chaveNova: 'C999' })).toBe('chave_alterada');
  });

  it('RN-CORE-05: marcador que não é a chave do espelho é chave_alterada', () => {
    expect(decidirTrocaDeChave({ ...base, chaveNova: 'C999', anterior: 'OUTRA' })).toBe('chave_alterada');
  });

  it('RN-CORE-05: null (adoção) vale quando a chave do espelho era o UUID do ERP; senão é chave_alterada', () => {
    expect(decidirTrocaDeChave({ chaveEspelho: ERP, chaveNova: 'C000123', anterior: null, outroErpIdComChaveNova: null, erpId: ERP })).toBe('troca');
    expect(decidirTrocaDeChave({ chaveEspelho: 'C1', chaveNova: 'C2', anterior: null, outroErpIdComChaveNova: null, erpId: ERP })).toBe('chave_alterada');
  });

  it('RN-CORE-05: chave nova já usada por outro erp_id é chave_duplicada, mesmo com marcador coerente', () => {
    expect(decidirTrocaDeChave({ ...base, chaveNova: 'C999', anterior: 'C000123', outroErpIdComChaveNova: 'outro' })).toBe('chave_duplicada');
    expect(decidirTrocaDeChave({ ...base, chaveEspelho: null, outroErpIdComChaveNova: 'outro' })).toBe('chave_duplicada');
  });
});

describe('RN-CORE-05: ehConflitoDeChave', () => {
  it('RN-CORE-05: só chave_alterada e chave_duplicada abrem conflito', () => {
    expect((['nada', 'troca', 'chave_alterada', 'chave_duplicada'] as const).filter(ehConflitoDeChave)).toEqual(['chave_alterada', 'chave_duplicada']);
  });
});
