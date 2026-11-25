import { describe, expect, it } from 'vitest';
import { empresaDaFilialPadrao, type FilialParaEmpresa } from './empresa-da-filial';

const FILIAL: FilialParaEmpresa = {
  cnpj: '11222333000181',
  ie: '123456789',
  razao_social: 'Distribuidora Boa Vista Ltda',
  nome_fantasia: 'Boa Vista',
  padrao: true,
  inativo: false,
};

describe('RN-CORE-14: empresa criada pela primeira filial padrão viva', () => {
  it('RN-CORE-14: filial padrão viva, sem empresa, cria com razão social, fantasia, CNPJ e IE da filial', () => {
    expect(empresaDaFilialPadrao(FILIAL, false)).toEqual({
      razao_social: 'Distribuidora Boa Vista Ltda', nome_fantasia: 'Boa Vista', cnpj: '11222333000181', ie: '123456789',
    });
  });

  it('RN-CORE-14: filial que não é a padrão não cria', () => {
    expect(empresaDaFilialPadrao({ ...FILIAL, padrao: false }, false)).toBeNull();
  });

  it('RN-CORE-14: filial que não está viva (inativa) não cria', () => {
    expect(empresaDaFilialPadrao({ ...FILIAL, inativo: true }, false)).toBeNull();
  });

  it('RN-CORE-14: empresa já existente nunca é alterada (segunda filial padrão, evento repetido, mudança posterior)', () => {
    expect(empresaDaFilialPadrao(FILIAL, true)).toBeNull();
    expect(empresaDaFilialPadrao({ ...FILIAL, cnpj: '99888777000166', razao_social: 'Outra Ltda' }, true)).toBeNull();
  });

  it('RN-CORE-14: IE e fantasia ausentes viram null; sem razão social ou CNPJ não cria', () => {
    expect(empresaDaFilialPadrao({ ...FILIAL, ie: undefined, nome_fantasia: '  ' }, false)).toEqual(expect.objectContaining({ ie: null, nome_fantasia: null }));
    expect(empresaDaFilialPadrao({ ...FILIAL, razao_social: ' ' }, false)).toBeNull();
    expect(empresaDaFilialPadrao({ ...FILIAL, razao_social: undefined }, false)).toBeNull();
    expect(empresaDaFilialPadrao({ ...FILIAL, cnpj: '' }, false)).toBeNull();
    expect(empresaDaFilialPadrao({ ...FILIAL, cnpj: null }, false)).toBeNull();
  });

  it('RN-CORE-14: espaços e máscara são normalizados; IE em maiúsculas', () => {
    expect(empresaDaFilialPadrao({ ...FILIAL, cnpj: '11.222.333/0001-81', ie: ' isento ', razao_social: '  X Ltda ' }, false))
      .toEqual(expect.objectContaining({ cnpj: '11222333000181', ie: 'ISENTO', razao_social: 'X Ltda' }));
  });
});
