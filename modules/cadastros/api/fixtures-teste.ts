/** Dados de teste válidos (CNPJ, IBGE e IE com dígito verificador correto). */
export const CNPJ_A = '11222333000181';
export const CNPJ_B = '11444777000161';
export const ENDERECO_AM = {
  logradouro: 'Av. Djalma Batista', numero: '100', complemento: null, bairro: 'Chapada', municipio_ibge: '1302603', uf: 'AM', cep: '69050010', pais_bacen: '1058',
};
export const filialValida = (o: Record<string, unknown> = {}) => ({
  cnpj: CNPJ_A, ie: '012345679', razao_social: 'Thathyany Comercio Ltda', nome_fantasia: 'Thathyany', crt: '1', endereco: ENDERECO_AM,
  padrao: true, emissora: true, nfe_serie: 1, nfe_numero_inicial: 1, ...o,
});
export const clienteValido = (filial_id: string, o: Record<string, unknown> = {}) => ({
  tipo_pessoa: 'PJ', documento: CNPJ_B, ie: '012345679', ind_ie_dest: '1', razao_social: 'Cliente Exemplo Ltda', filial_id,
  enderecos: [{ ...ENDERECO_AM, tipo: 'principal' }], ...o,
});
export const produtoValido = (o: Record<string, unknown> = {}) => ({
  codigo: 'P001', descricao: 'Refrigerante 2L', ncm: '22021000', unidade_comercial: 'UN', unidade_tributavel: 'UN', grupo_tributacao: 'BEBIDAS', custo_centavos: 450, ...o,
});
