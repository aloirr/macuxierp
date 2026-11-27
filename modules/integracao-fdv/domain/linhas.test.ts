import { describe, expect, it } from 'vitest';
import { LinhaInvalidaHub } from '../contracts';
import { codigoLinhaHub, ehLinhaRetida, erroDoHubReprocessavel, paraLinhaHub } from './linhas';

describe('RN-INF-02: referência ausente é retida em silêncio (T-0112)', () => {
  it('só a referencia_ausente é retida: as demais inválidas seguem em linhas_invalidas', () => {
    expect(ehLinhaRetida({ external_id: 'C1', codigo: 'referencia_ausente', campo: 'filial_external_id' })).toBe(true);
    for (const codigo of ['campo_obrigatorio', 'campo_invalido', 'filial_codigo_repetido']) expect(ehLinhaRetida({ external_id: 'C1', codigo, campo: null })).toBe(false);
  });
});

describe('RN-INF-02: erro do Hub reprocessável (decisão 37 A)', () => {
  it('RN-INF-02: referencia_ausente do Hub é reprocessável mesmo com reprocessavel false ou ausente', () => {
    expect(erroDoHubReprocessavel('referencia_ausente', false)).toBe(true);
    expect(erroDoHubReprocessavel('referencia_ausente', undefined)).toBe(true);
  });
  it('RN-INF-02: dependência inexistente do Hub (v0.3.26) é reprocessável: o dependente fica retido, sem laço 4xx', () => {
    expect(erroDoHubReprocessavel('filial_inexistente', false)).toBe(true);
    expect(erroDoHubReprocessavel('forma_external_id_inexistente', undefined)).toBe(true);
  });
  it('RN-INF-02: os demais códigos seguem o que o Hub disse', () => {
    expect(erroDoHubReprocessavel('falha_processamento', true)).toBe(true);
    expect(erroDoHubReprocessavel('valor_fora_da_faixa', false)).toBe(false);
    expect(erroDoHubReprocessavel('valor_fora_da_faixa', undefined)).toBe(false);
  });
});

describe('RN-INF-04: linha inválida no formato do Hub (P-1)', () => {
  it('mapeia os códigos do ERP para o conjunto aceito pelo Hub', () => {
    expect(codigoLinhaHub('campo_obrigatorio')).toBe('campo_obrigatorio');
    expect(codigoLinhaHub('campo_invalido')).toBe('formato_invalido');
    expect(codigoLinhaHub('quantidade_fracionaria')).toBe('formato_invalido');
    expect(paraLinhaHub({ external_id: 'U1', codigo: 'quantidade_fracionaria', campo: 'fator' }).mensagem).toContain('não aceita fração');
    expect(codigoLinhaHub('filial_codigo_repetido')).toBe('regra_invalida');
  });

  it('leva mensagem do catálogo, nunca o valor, e passa no schema do Hub', () => {
    const l = paraLinhaHub({ external_id: 'C1', codigo: 'filial_codigo_repetido', campo: 'cnpj' });
    expect(LinhaInvalidaHub.safeParse(l).success).toBe(true);
    expect(l.mensagem).toContain('mesma ordem de CNPJ');
    expect(paraLinhaHub({ external_id: 'C1', codigo: 'x_desconhecido', campo: null })).not.toHaveProperty('campo');
  });
});
