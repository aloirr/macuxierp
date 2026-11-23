import { describe, expect, it } from 'vitest';
import type { LinhaCliente } from '../../contracts';
import { agruparClientes, conferirDadosDoCliente, derivarExternalIdEndereco } from './cliente-grupo';

const end = (linha: number, tipo: 'principal' | 'entrega' | 'cobranca', seq?: number, ext = 'C1') => ({
  linha, tipo, seq, external_id: derivarExternalIdEndereco(ext, tipo, seq), dados: { logradouro: `Rua ${linha}` },
});
const cli = (linha: number, enderecos: LinhaCliente['enderecos'], ext = 'C1'): LinhaCliente => ({ linha, external_id: ext, avisos: [], dados: { razao_social: 'ACME' }, enderecos, refs: {} });

describe('T-0058: cliente e endereço numa carga só', () => {
  it('T-0058: external_id do endereço é <cliente>:<tipo> e, com seq, <cliente>:<tipo>:<seq>', () => {
    expect(derivarExternalIdEndereco('C1', 'principal', undefined)).toBe('C1:principal');
    expect(derivarExternalIdEndereco('C1', 'entrega', 2)).toBe('C1:entrega:2');
  });

  it('T-0058: dados do cliente diferentes da 1ª linha saem com erro, com o número da 1ª linha e sem valor de célula', () => {
    const r = conferirDadosDoCliente([
      { numero: 2, celulas: { external_id: 'C1', razao_social: 'ACME', 'endereco.cep': '69000000', tipo_endereco: 'principal' } },
      { numero: 3, celulas: { external_id: 'C1', razao_social: 'ACME', 'endereco.cep': '69000001', tipo_endereco: 'entrega', seq: '1' } },
      { numero: 4, celulas: { external_id: 'C1', razao_social: 'OUTRA SEGREDO', tipo_endereco: 'entrega', seq: '2' } },
    ]);
    expect(r.erros).toEqual([
      { linha: 4, campo: null, codigo: 'CARGA_CONFLITO', motivo: 'Dados do cliente diferentes da linha 2: deixe iguais em todas as linhas do cliente' },
    ]);
    expect(JSON.stringify(r.erros)).not.toContain('SEGREDO');
    expect([...r.recusadas]).toEqual([4]);
  });

  it('T-0058: célula vazia e espaços não contam como diferença; colunas de endereço, tipo_endereco e seq são livres', () => {
    const r = conferirDadosDoCliente([
      { numero: 2, celulas: { external_id: 'C1', email: 'a@b.com', 'endereco.uf': 'AM', seq: '' } },
      { numero: 3, celulas: { external_id: ' C1 ', email: ' a@b.com ', 'endereco.uf': 'RR', seq: '9' } },
    ]);
    expect(r.erros).toEqual([]);
  });

  it('T-0058: duas linhas com o mesmo (tipo_endereco, seq) no cliente: erro na segunda', () => {
    const g = agruparClientes([cli(2, [end(2, 'principal')]), cli(3, [end(3, 'entrega', 1)]), cli(4, [end(4, 'entrega', 1)])]);
    expect(g.erros).toEqual([
      { linha: 4, campo: 'seq', codigo: 'CARGA_DUPLICADO', motivo: 'Endereço repetido: use outra seq para o mesmo tipo de endereço do cliente' },
    ]);
    expect(g.clientes).toHaveLength(1);
    expect(g.clientes[0]?.enderecos.map((e) => e.external_id)).toEqual(['C1:principal', 'C1:entrega:1']);
  });

  it('RN-CAD-03: mais de um endereço principal no cliente: erro na segunda linha principal', () => {
    const g = agruparClientes([cli(2, [end(2, 'principal')]), cli(3, [end(3, 'principal', 2)])]);
    expect(g.erros).toEqual([
      { linha: 3, campo: 'tipo_endereco', codigo: 'RN-CAD-03', motivo: 'Só um endereço principal por cliente: troque o tipo_endereco desta linha' },
    ]);
  });

  it('T-0058: sem linha principal no grupo, a 1ª linha vira principal, com aviso e sem erro', () => {
    const g = agruparClientes([cli(2, [end(2, 'entrega', 1)]), cli(3, [end(3, 'cobranca')])]);
    expect(g.erros).toEqual([]);
    const c = g.clientes[0] as LinhaCliente;
    expect(c.enderecos.map((e) => [e.tipo, e.external_id, e.seq])).toEqual([['principal', 'C1:principal', undefined], ['cobranca', 'C1:cobranca', undefined]]);
    expect(c.avisos).toEqual(['Nenhum endereço principal no cliente: o primeiro endereço virou o principal']);
  });

  it('T-0058: cliente de uma linha só, sem endereço, segue sem aviso; clientes diferentes ficam separados e as linhas ficam em `linhas`', () => {
    const g = agruparClientes([cli(2, []), cli(3, [end(3, 'principal', undefined, 'C2')], 'C2'), cli(4, [end(4, 'entrega', 1, 'C2')], 'C2')]);
    expect(g.clientes.map((c) => [c.external_id, c.linhas, c.avisos])).toEqual([['C1', [2], []], ['C2', [3, 4], []]]);
  });
});
