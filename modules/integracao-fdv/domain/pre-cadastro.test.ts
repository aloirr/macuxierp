import { describe, expect, it } from 'vitest';
import { ClienteParaErp, RetornoCliente } from '../contracts';
import { adaptarParaPreCadastroEntrada, montarRetornoCliente } from './pre-cadastro';

const item = ClienteParaErp.parse({
  cliente_uuid: '7d3f1c1e-5a4b-4c1d-8e2f-1a2b3c4d5e6f',
  documento: '11.222.333/0001-81',
  razao_social: 'Comercial Teste Ltda',
  inscricao_estadual: '041234567',
  email: 'a@b.com',
  cep: '69000-000',
  uf: 'AM',
  municipio_ibge: '1302603',
});

describe('adaptarParaPreCadastroEntrada (RN-INT-22, T-0059)', () => {
  it('RN-INT-22: mapeia documento, razão social, IE, e-mail e endereço sem alterar valores', () => {
    expect(adaptarParaPreCadastroEntrada(item)).toEqual({
      documento: '11.222.333/0001-81',
      razao_social: 'Comercial Teste Ltda',
      ie: '041234567',
      email: 'a@b.com',
      endereco: { uf: 'AM', municipio_ibge: '1302603', cep: '69000-000' },
    });
  });
  it('RN-INT-22: IE e e-mail ausentes ou vazios ficam fora; o cadastros é quem recusa campo faltante', () => {
    const r = adaptarParaPreCadastroEntrada({ ...item, inscricao_estadual: ' ', email: null, razao_social: null, uf: null });
    expect(r).toEqual({
      documento: '11.222.333/0001-81',
      razao_social: '',
      endereco: { uf: '', municipio_ibge: '1302603', cep: '69000-000' },
    });
    expect('ie' in r).toBe(false);
    expect('email' in r).toBe(false);
  });
});

describe('montarRetornoCliente (RN-INT-22, T-0059)', () => {
  it('RN-INT-22: aceito vira vinculado com o external_id', () => {
    const v = montarRetornoCliente({ ok: true, external_id: 'C000123' });
    expect(RetornoCliente.parse(v)).toEqual({ status: 'vinculado', external_id: 'C000123' });
  });
  it('RN-INT-22: recusado vira rejeitado_erp com motivo fixo, só nomes de campo, e erros preservados', () => {
    const erros = [
      { campo: 'documento', codigo: 'RN-CAD-01', mensagem: 'Documento inválido' },
      { campo: 'uf', codigo: 'CARGA_OBRIGATORIO', mensagem: 'UF é obrigatória' },
    ];
    const r = montarRetornoCliente({ ok: false, erros });
    expect(RetornoCliente.parse(r)).toEqual({
      status: 'rejeitado_erp',
      motivo: '2 campo(s) recusado(s): documento, uf',
      erros,
    });
  });
  it('RN-INT-22: motivo é cortado em 300 caracteres e continua válido no contrato', () => {
    const erros = Array.from({ length: 40 }, (_, i) => ({ campo: `campo_longo_numero_${i}`, codigo: 'X', mensagem: 'm' }));
    const r = montarRetornoCliente({ ok: false, erros });
    RetornoCliente.parse(r);
    expect((r as { motivo: string }).motivo.length).toBe(300);
  });
});
