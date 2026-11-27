import { describe, expect, it } from 'vitest';
import { LinhaInvalidaHub } from '../contracts';
import { codigoLinhaHub, ehLinhaRetida, paraLinhaHub } from './linhas';

describe('RN-INF-02: referência ausente é retida em silêncio (T-0112)', () => {
  it('só a referencia_ausente é retida: as demais inválidas seguem em linhas_invalidas', () => {
    expect(ehLinhaRetida({ external_id: 'C1', codigo: 'referencia_ausente', campo: 'filial_external_id' })).toBe(true);
    for (const codigo of ['campo_obrigatorio', 'campo_invalido', 'filial_codigo_repetido']) expect(ehLinhaRetida({ external_id: 'C1', codigo, campo: null })).toBe(false);
  });
});

describe('RN-INF-04: linha inválida no formato do Hub (P-1)', () => {
  it('mapeia os códigos do ERP para o conjunto aceito pelo Hub', () => {
    expect(codigoLinhaHub('campo_obrigatorio')).toBe('campo_obrigatorio');
    expect(codigoLinhaHub('campo_invalido')).toBe('formato_invalido');
    expect(codigoLinhaHub('quantidade_fracionaria')).toBe('formato_invalido');
    expect(paraLinhaHub({ external_id: 'U1', codigo: 'quantidade_fracionaria', campo: 'fator' }).mensagem).toContain('só aceita número inteiro');
    expect(codigoLinhaHub('filial_codigo_repetido')).toBe('regra_invalida');
  });

  it('leva mensagem do catálogo, nunca o valor, e passa no schema do Hub', () => {
    const l = paraLinhaHub({ external_id: 'C1', codigo: 'filial_codigo_repetido', campo: 'cnpj' });
    expect(LinhaInvalidaHub.safeParse(l).success).toBe(true);
    expect(l.mensagem).toContain('mesma ordem de CNPJ');
    expect(paraLinhaHub({ external_id: 'C1', codigo: 'x_desconhecido', campo: null })).not.toHaveProperty('campo');
  });
});
