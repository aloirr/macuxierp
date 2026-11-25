import { describe, expect, it } from 'vitest';
import { SugestaoCnpj } from './index';

const ANTIGA = { cnpj: '11222333000181', razao_social: 'ACME', nome_fantasia: null, situacao_cadastral: 'ATIVA', cnae_fiscal: '4712100', endereco: { municipio: 'Manaus' } };

describe('SugestaoCnpj ampliada (T-0101, aditiva)', () => {
  it('RF-CAD-02: aceita a resposta antiga, sem os campos novos', () => {
    const r = SugestaoCnpj.parse(ANTIGA);
    expect(r.cnae_secundarios).toBeUndefined();
    expect(r.email).toBeUndefined();
  });
  it('RF-CAD-02: aceita a resposta nova, com nulos e valores', () => {
    const nova = { ...ANTIGA, cnae_secundarios: ['4713002'], porte: 'DEMAIS', natureza_juridica: 'Sociedade Empresária Limitada', email: null, telefone: '9233334444', opcao_simples: true, opcao_mei: false, data_situacao_cadastral: '2020-01-31', endereco: { municipio: 'Manaus', municipio_ibge: '1302603' } };
    expect(SugestaoCnpj.parse(nova)).toMatchObject(nova);
  });
  it('RF-CAD-02: data_abertura é opcional (contrato antigo) e aceita nulo', () => {
    expect(SugestaoCnpj.parse(ANTIGA).data_abertura).toBeUndefined();
    expect(SugestaoCnpj.parse({ ...ANTIGA, data_abertura: null }).data_abertura).toBeNull();
    expect(SugestaoCnpj.parse({ ...ANTIGA, data_abertura: '1999-02-28' }).data_abertura).toBe('1999-02-28');
  });
});
