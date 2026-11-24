import { describe, expect, it } from 'vitest';
import { ClienteParaErp, RetornoCliente } from '../contracts';
import { adaptarParaPreCadastroEntrada, montarRetornoCliente } from './pre-cadastro';

const item = ClienteParaErp.parse({
  cliente_uuid: '7d3f1c1e-5a4b-4c1d-8e2f-1a2b3c4d5e6f',
  recebido_em: '2026-11-24T10:00:00Z',
  razao_social: 'Comercial Teste Ltda',
  nome_fantasia: null,
  documento: '11.222.333/0001-81',
  inscricao_estadual: '041234567',
  telefone: null,
  email: 'a@b.com',
  logradouro: 'Rua A',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69000-000',
  latitude: null,
  longitude: null,
  filial_external_id: null,
  revisao: 2,
});
const base = { cliente_uuid: item.cliente_uuid, revisao: 2, ocorrido_em: '2026-11-24T10:01:00Z' };

describe('adaptarParaPreCadastroEntrada (RN-INT-22, T-0059)', () => {
  it('RN-INT-22: mapeia documento, razão social, IE, e-mail e endereço sem alterar valores', () => {
    expect(adaptarParaPreCadastroEntrada(item)).toEqual({
      documento: '11.222.333/0001-81',
      razao_social: 'Comercial Teste Ltda',
      ie: '041234567',
      email: 'a@b.com',
      endereco: { logradouro: 'Rua A', numero: '10', complemento: '', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69000-000' },
    });
  });
  it('RN-INT-22: IE e e-mail ausentes ou vazios ficam fora; o cadastros é quem recusa campo faltante', () => {
    const r = adaptarParaPreCadastroEntrada({ ...item, inscricao_estadual: ' ', email: null, documento: null, uf: null });
    expect(r.documento).toBe('');
    expect(r.endereco.uf).toBe('');
    expect('ie' in r).toBe(false);
    expect('email' in r).toBe(false);
  });
});

describe('montarRetornoCliente (RN-INT-22, T-0059)', () => {
  it('RN-INT-22: aceito vira vinculado com o external_id e a revisão do item', () => {
    const v = montarRetornoCliente(base, { ok: true }, { external_id: 'C000123' });
    expect(RetornoCliente.parse(v)).toEqual({ versao_contrato: 'v1', ...base, status: 'vinculado', external_id: 'C000123' });
  });
  it('RN-INT-22: recusado vira rejeitado_erp com motivo fixo, só nomes de campo, e erros preservados', () => {
    const erros = [
      { campo: 'documento', codigo: 'RN-CAD-01', mensagem: 'Documento inválido' },
      { campo: 'uf', codigo: 'CARGA_OBRIGATORIO', mensagem: 'UF é obrigatória' },
    ];
    const r = montarRetornoCliente(base, { ok: false, erros });
    expect(RetornoCliente.parse(r)).toEqual({
      versao_contrato: 'v1',
      ...base,
      status: 'rejeitado_erp',
      motivo: '2 campo(s) recusado(s): documento, uf',
      erros,
    });
  });
  it('RN-INT-22: motivo cortado em 1000 caracteres e erros em 50, ainda válidos no contrato', () => {
    const erros = Array.from({ length: 80 }, (_, i) => ({ campo: `campo_longo_numero_${i}`, codigo: 'X', mensagem: 'm' }));
    const r = montarRetornoCliente(base, { ok: false, erros });
    RetornoCliente.parse(r);
    if (r.status !== 'rejeitado_erp') throw new Error('esperava rejeitado_erp');
    expect(r.motivo.length).toBeLessThanOrEqual(1000);
    expect(r.erros).toHaveLength(50);
  });
  it('RN-INT-22: contrato recusa vinculado sem external_id e rejeitado sem motivo', () => {
    expect(RetornoCliente.safeParse({ versao_contrato: 'v1', ...base, status: 'vinculado' }).success).toBe(false);
    expect(RetornoCliente.safeParse({ versao_contrato: 'v1', ...base, status: 'rejeitado_erp' }).success).toBe(false);
  });
});
