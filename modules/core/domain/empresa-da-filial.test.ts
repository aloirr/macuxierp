import { describe, expect, it } from 'vitest';
import { decidirEmpresaDaFilial, type FilialParaEmpresa } from './empresa-da-filial';

const FILIAL: FilialParaEmpresa = {
  cnpj: '11222333000181',
  ie: '123456789',
  razao_social: 'Distribuidora Boa Vista Ltda',
  nome_fantasia: 'Boa Vista',
  padrao: true,
  inativo: false,
};
const VAZIA = { razao_social: null, nome_fantasia: null, cnpj: null, ie: null };

describe('RN-CORE-14: empresa criada a partir da primeira filial padrão', () => {
  it('RN-CORE-14: primeira filial padrão sem empresa preenchida cria a empresa com os dados da filial', () => {
    expect(decidirEmpresaDaFilial(FILIAL, null)).toEqual({
      acao: 'criar',
      campos: { razao_social: 'Distribuidora Boa Vista Ltda', nome_fantasia: 'Boa Vista', cnpj: '11222333000181', ie: '123456789' },
    });
  });

  it('RN-CORE-14: filial que não é a padrão é ignorada', () => {
    expect(decidirEmpresaDaFilial({ ...FILIAL, padrao: false }, null)).toEqual({ acao: 'ignorar', motivo: 'filial_nao_padrao' });
  });

  it('RN-CORE-14: filial que não está viva (inativa ou com deleted_at) é ignorada', () => {
    expect(decidirEmpresaDaFilial({ ...FILIAL, inativo: true }, null)).toEqual({ acao: 'ignorar', motivo: 'filial_inativa' });
    expect(decidirEmpresaDaFilial({ ...FILIAL, deleted_at: '2026-11-24T10:00:00Z' }, null)).toEqual({ acao: 'ignorar', motivo: 'filial_inativa' });
    expect(decidirEmpresaDaFilial({ ...FILIAL, deleted_at: null }, null).acao).toBe('criar');
  });

  it('RN-CORE-14: segunda filial padrão (troca da padrão) não mexe na empresa já preenchida', () => {
    const atual = { razao_social: 'Distribuidora Boa Vista Ltda', nome_fantasia: 'Boa Vista', cnpj: '11222333000181', ie: '123456789' };
    const outra = { ...FILIAL, cnpj: '99888777000166', razao_social: 'Outra Ltda' };
    expect(decidirEmpresaDaFilial(outra, atual)).toEqual({ acao: 'ignorar', motivo: 'empresa_ja_preenchida' });
  });

  it('RN-CORE-14: evento repetido é idempotente (não duplica nem sobrescreve)', () => {
    const primeira = decidirEmpresaDaFilial(FILIAL, null);
    expect(primeira.acao).toBe('criar');
    const atual = primeira.acao === 'criar' ? primeira.campos : VAZIA;
    expect(decidirEmpresaDaFilial(FILIAL, atual)).toEqual({ acao: 'ignorar', motivo: 'empresa_ja_preenchida' });
  });

  // PENDENTE (R-20261124-230054): ramo fora da RN-CORE-14; o engenheiro-software decide se fica ou sai.
  it('PENDENTE: empresa sem CNPJ é completada nos vazios, sem trocar o que já está preenchido', () => {
    const atual = { razao_social: 'Nome Já Digitado', nome_fantasia: null, cnpj: null, ie: null };
    expect(decidirEmpresaDaFilial(FILIAL, atual)).toEqual({
      acao: 'criar',
      campos: { razao_social: 'Nome Já Digitado', nome_fantasia: 'Boa Vista', cnpj: '11222333000181', ie: '123456789' },
    });
  });

  it('RN-CORE-14: empresa com CNPJ já preenchido nunca é alterada (o CNPJ amarra o A1)', () => {
    const atual = { ...VAZIA, cnpj: '11222333000181' };
    expect(decidirEmpresaDaFilial(FILIAL, atual)).toEqual({ acao: 'ignorar', motivo: 'empresa_ja_preenchida' });
  });

  it('RN-CORE-14: IE e fantasia ausentes viram null; razão social e CNPJ são obrigatórios', () => {
    const r = decidirEmpresaDaFilial({ ...FILIAL, ie: undefined, nome_fantasia: '  ' }, null);
    expect(r).toEqual({ acao: 'criar', campos: expect.objectContaining({ ie: null, nome_fantasia: null }) });
    expect(decidirEmpresaDaFilial({ ...FILIAL, razao_social: ' ' }, null)).toEqual({ acao: 'ignorar', motivo: 'dados_incompletos' });
    expect(decidirEmpresaDaFilial({ ...FILIAL, cnpj: '' }, null)).toEqual({ acao: 'ignorar', motivo: 'dados_incompletos' });
  });

  it('RN-CORE-14: ISENTO e espaços são normalizados; CNPJ fica só com dígitos', () => {
    const r = decidirEmpresaDaFilial({ ...FILIAL, cnpj: '11.222.333/0001-81', ie: ' isento ', razao_social: '  X Ltda ' }, null);
    expect(r).toEqual({ acao: 'criar', campos: expect.objectContaining({ cnpj: '11222333000181', ie: 'ISENTO', razao_social: 'X Ltda' }) });
  });
});
