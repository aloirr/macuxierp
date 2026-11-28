import { describe, expect, it } from 'vitest';
import { fichaEmpresa } from './empresa-ficha';

const EMPRESA = { id: '3f2c2d8e-5a64-4f0d-9c53-0a6d7d2b1e11', razao_social: 'Comercial Rio Negro LTDA', nome_fantasia: 'Rio Negro', cnpj: '11222333000181', ie: null, fuso: 'America/Manaus', updated_at: '2026-11-24T10:00:00.000Z' };
const F1 = '22222222-2222-4222-8222-222222222222';

describe('T-0125: ficha da Empresa em 12 colunas (RF-CORE-01, regra 11)', () => {
  it('a linha da grade soma 12 colunas, a IE é campo curto e o CNPJ é só texto', () => {
    const f = fichaEmpresa(EMPRESA, [{ filial_id: F1, ambiente: 'homologacao' }], { [F1]: 'Matriz' });
    const dados = f.blocos.find((b) => b.id === 'dados');
    expect((dados?.campos ?? []).reduce((s, c) => s + c.colunas, 0)).toBe(12);
    expect(dados?.campos.find((c) => c.nome === 'ie')?.colunas).toBeLessThanOrEqual(2);
    expect(dados?.campos.find((c) => c.nome === 'cnpj')).toMatchObject({ somenteLeitura: true, valor: '11.222.333/0001-81' });
  });

  it('o Ambiente fiscal é um bloco da ficha e o título da página é o do menu, Empresa', () => {
    const f = fichaEmpresa(EMPRESA, [{ filial_id: F1, ambiente: 'producao' }], { [F1]: 'Matriz' });
    expect(f.titulo).toBe('Empresa');
    expect(f.blocos.map((b) => b.id)).toEqual(['dados', 'ambiente-fiscal']);
    expect(f.blocos[1]?.titulo).toBe('Ambiente fiscal');
    expect(f.ambiente.filiais).toEqual([expect.objectContaining({ filial: 'Matriz', rotulo: 'Produção' })]);
  });

  it('RN-CORE-08: a ficha não oferece troca para produção', () => {
    const f = fichaEmpresa(EMPRESA, [{ filial_id: F1, ambiente: 'homologacao' }]);
    expect(JSON.stringify(f)).not.toMatch(/aprovo produção/);
    expect(f.ambiente.texto_homologacao).toBeTruthy();
  });
});
