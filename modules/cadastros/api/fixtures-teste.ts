import type { FonteExterna } from './portas';
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

/** Fonte de CNPJ/CEP de teste: registra as chamadas e devolve a resposta (ou lança o erro). */
export function fonte(id: FonteExterna<Record<string, unknown>>['id'], resposta: Record<string, unknown> | null | Error) {
  const f = {
    id, chamadas: [] as { chave: string; timeoutMs: number }[],
    async consultar(chave: string, o: { timeoutMs: number }) {
      f.chamadas.push({ chave, timeoutMs: o.timeoutMs });
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
  return f;
}

export const BRASILAPI_CNPJ = {
  cnpj: '11222333000181', razao_social: 'ACME COMERCIO LTDA', nome_fantasia: 'ACME', descricao_situacao_cadastral: 'ATIVA', cnae_fiscal: 4712100,
  descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'DJALMA BATISTA', numero: '100', complemento: '', bairro: 'CHAPADA', municipio: 'MANAUS',
  codigo_municipio_ibge: 1302603, uf: 'AM', cep: '69050010', email: 'contato@acme.com.br', ddd_telefone_1: '9233334444',
  qsa: [{ nome_socio: 'FULANO DE TAL', cnpj_cpf_do_socio: '***529982**', qualificacao_socio: 'Sócio-Administrador' }],
};

