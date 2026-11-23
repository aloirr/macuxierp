import { describe, expect, it } from 'vitest';
import { externosEnderecoDoArquivo, planoSubstituicaoCliente } from './substituicao-cliente';

const cel = (external_id: string, extra: Record<string, string> = {}) => ({ celulas: { external_id, ...extra } });
const cli = (id: string, external_id: string | null, inativo = false) => ({ id, external_id, inativo });
const end = (id: string, external_id: string | null, pai_id: string, inativo = false) => ({ id, external_id, inativo, pai_id });
const base = { modo: 'substituir_tudo' as const, em_uso: new Set<string>() };

describe('Substituir tudo do cliente: endereços (T-0058, RN-CAD-10)', () => {
  it('T-0058: o external_id do endereço do arquivo segue a derivação da carga (vazio = principal; seq no fim)', () => {
    const s = externosEnderecoDoArquivo([
      cel('C1', { 'endereco.logradouro': 'Rua A' }),
      cel('C1', { tipo_endereco: 'entrega', 'endereco.logradouro': 'Rua B' }),
      cel('C1', { tipo_endereco: 'ENTREGA', seq: '2', 'endereco.cep': '69000000' }),
      cel('C2'),
    ]);
    expect([...s].sort()).toEqual(['C1:entrega', 'C1:entrega:2', 'C1:principal']);
  });

  it('T-0058: o seq do arquivo vale como no mapeamento (1 a 999): 0 e 1000 não entram no external_id', () => {
    const s = externosEnderecoDoArquivo([
      cel('C1', { tipo_endereco: 'entrega', seq: '0', 'endereco.cep': '69000000' }),
      cel('C1', { tipo_endereco: 'cobranca', seq: '1000', 'endereco.cep': '69000000' }),
      cel('C1', { tipo_endereco: 'cobranca', seq: '999', 'endereco.cep': '69000000' }),
    ]);
    expect([...s].sort()).toEqual(['C1:cobranca:999', 'C1:cobranca', 'C1:entrega', 'C1:principal'].sort());
  });

  it('T-0058: sem linha principal no cliente, a 1ª vira principal (o external_id principal fica protegido)', () => {
    const s = externosEnderecoDoArquivo([cel('C1', { tipo_endereco: 'entrega', 'endereco.logradouro': 'Rua B' })]);
    expect(s.has('C1:principal')).toBe(true);
  });

  it('T-0058: endereço do cliente do arquivo que não veio é inativado; o que veio fica', () => {
    const r = planoSubstituicaoCliente({
      ...base, externos_cliente: ['C1'], externos_endereco: new Set(['C1:principal']),
      clientes: [cli('c1', 'C1')], enderecos: [end('e1', 'C1:principal', 'c1'), end('e2', 'C1:entrega', 'c1')],
    });
    expect(r.enderecos_inativar).toEqual(['e2']);
    expect(r.inativar).toEqual([]);
  });

  it('T-0058: cliente ausente do arquivo é inativado e os endereços dele acompanham, com ou sem external_id', () => {
    const r = planoSubstituicaoCliente({
      ...base, externos_cliente: ['C1'], externos_endereco: new Set(['C1:principal']),
      clientes: [cli('c1', 'C1'), cli('c2', 'C2')],
      enderecos: [end('e1', 'C1:principal', 'c1'), end('e3', 'C2:principal', 'c2'), end('e4', null, 'c2')],
    });
    expect(r.inativar).toEqual(['c2']);
    expect(r.enderecos_inativar).toEqual(['e3', 'e4']);
  });

  it('T-0058: endereço sem external_id de cliente que está no arquivo (criado no BKO) NÃO é inativado, só contado', () => {
    const r = planoSubstituicaoCliente({
      ...base, externos_cliente: ['C1'], externos_endereco: new Set(['C1:principal']),
      clientes: [cli('c1', 'C1')], enderecos: [end('e1', 'C1:principal', 'c1'), end('e9', null, 'c1')],
    });
    expect(r.enderecos_inativar).toEqual([]);
    expect(r.enderecos_sem_chave).toBe(1);
  });

  it('T-0058: cliente sem external_id (criado no BKO) não é inativado e os endereços dele ficam', () => {
    const r = planoSubstituicaoCliente({
      ...base, externos_cliente: ['C1'], externos_endereco: new Set(['C1:principal']),
      clientes: [cli('c1', 'C1'), cli('c9', null)], enderecos: [end('e1', 'C1:principal', 'c1'), end('e9', 'X:principal', 'c9')],
    });
    expect(r.inativar).toEqual([]);
    expect(r.sem_chave).toBe(1);
    expect(r.enderecos_inativar).toEqual([]);
  });

  it('T-0058: endereço já inativo não entra de novo, e o adicionar não inativa nada', () => {
    const entrada = {
      ...base, externos_cliente: ['C1'], externos_endereco: new Set(['C1:principal']),
      clientes: [cli('c1', 'C1'), cli('c2', 'C2')], enderecos: [end('e2', 'C1:entrega', 'c1', true), end('e3', 'C2:principal', 'c2')],
    };
    expect(planoSubstituicaoCliente(entrada).enderecos_inativar).toEqual(['e3']);
    const vazio = planoSubstituicaoCliente({ ...entrada, modo: 'adicionar' });
    expect(vazio).toMatchObject({ inativar: [], enderecos_inativar: [], enderecos_sem_chave: 0 });
  });

  it('T-0058: arquivo sem nenhum cliente com external_id não tem endereço de carga a proteger (inativa todos os de carga)', () => {
    const r = planoSubstituicaoCliente({
      ...base, externos_cliente: [], externos_endereco: new Set(),
      clientes: [cli('c2', 'C2')], enderecos: [end('e3', 'C2:principal', 'c2')],
    });
    expect(r.inativar).toEqual(['c2']);
    expect(r.enderecos_inativar).toEqual(['e3']);
  });
});
