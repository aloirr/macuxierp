import { describe, expect, it } from 'vitest';
import { LinhaInvalidaHub } from '../contracts';
import { codigoLinhaHub, paraLinhaHub } from './linhas';

describe('RN-INF-04: linha inválida no formato do Hub (P-1)', () => {
  it('mapeia os códigos do ERP para o conjunto aceito pelo Hub', () => {
    expect(codigoLinhaHub('campo_obrigatorio')).toBe('campo_obrigatorio');
    expect(codigoLinhaHub('campo_invalido')).toBe('formato_invalido');
    expect(codigoLinhaHub('referencia_ausente')).toBe('regra_invalida');
    expect(codigoLinhaHub('filial_codigo_repetido')).toBe('regra_invalida');
  });

  it('leva mensagem do catálogo, nunca o valor, e passa no schema do Hub', () => {
    const l = paraLinhaHub({ external_id: 'C1', codigo: 'referencia_ausente', campo: 'filial_external_id' });
    expect(LinhaInvalidaHub.safeParse(l).success).toBe(true);
    expect(l.mensagem).toContain('ainda não foi confirmado');
    expect(paraLinhaHub({ external_id: 'C1', codigo: 'x_desconhecido', campo: null })).not.toHaveProperty('campo');
  });
});
