import { describe, expect, it } from 'vitest';
import { destinatarioDoRetrato } from './destinatario';
import { retratoCliente } from './fixtures';

describe('destinatário a partir do retrato do pedido', () => {
  it('RF-FAT-01: sem endereço do cadastro, o endereço principal do retrato é a reserva (com o xMun resolvido)', () => {
    const r = destinatarioDoRetrato(retratoCliente, null, 'Manaus');
    if (!r.ok) throw new Error('esperava ok');
    expect(r.destinatario).toMatchObject({ documento: '45.723.174/0001-10', ind_ie_dest: 1, endereco: { logradouro: 'Rua A', municipio_nome: 'Manaus', municipio_ibge: '1302603', complemento: null } });
  });
  it('RF-FAT-01: o endereço do cadastro tem preferência sobre o do retrato', () => {
    const cad = { logradouro: 'Av. B', numero: '2', bairro: 'Sul', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69000-001' };
    const r = destinatarioDoRetrato(retratoCliente, cad, null);
    expect(r.ok && r.destinatario.endereco.logradouro).toBe('Av. B');
  });
  it('RF-FAT-01: retrato sem campo do endereço ou sem nome do município não vira XML', () => {
    const sem = destinatarioDoRetrato({ ...retratoCliente, endereco: { ...retratoCliente.endereco, bairro: '' } }, null, null);
    expect(!sem.ok && sem.violacoes.map((v) => v.campo)).toEqual(['cliente.endereco.bairro', 'cliente.endereco.municipio_nome']);
  });
  it('RF-FAT-01: indIEDest do retrato (texto) vira número', () => {
    const r = destinatarioDoRetrato({ ...retratoCliente, ind_ie_dest: '9', ie: null }, null, 'Manaus');
    expect(r.ok && r.destinatario.ind_ie_dest).toBe(9);
  });
});
