/**
 * T-0101: massa fictícia da ficha da empresa pela Receita, comum ao contrato (tests/integracao/rn/ficha-receita-contrato.test.ts)
 * e à rota (tests/integracao/plataforma/empresa-ficha.db.test.ts). CNPJ de exemplo, exemplo.invalid e CPF de teste.
 */

export const CNPJ_FICHA = '11222333000181';
export const EMAIL_FICHA = 'contato.ficha.t0101@exemplo.invalid';
/** Telefone da massa só com dígitos (DDD + número), como a ficha grava. */
export const TELEFONE_FICHA = '9232224567';
/** CPF de teste (o MEI traz o CPF do titular na razão social). */
export const CPF_FICHA = '12345678909';
export const CPF_FICHA_FMT = '123.456.789-09';

/** Ficha completa, como a BrasilAPI responde (CNAE como número); `sobrescrever` troca chaves de primeiro nível. */
export const brutaBrasilApi = (sobrescrever: Record<string, unknown> = {}): Record<string, unknown> => ({
  cnpj: CNPJ_FICHA,
  razao_social: 'FICHA FICTICIA LTDA',
  nome_fantasia: 'FICHA',
  descricao_situacao_cadastral: 'ATIVA',
  data_situacao_cadastral: '2015-03-10',
  data_inicio_atividade: '2014-07-21',
  natureza_juridica: '2062 - Sociedade Empresária Limitada',
  porte: 'EMPRESA DE PEQUENO PORTE',
  cnae_fiscal: 4639701,
  cnae_fiscal_descricao: 'Comércio atacadista de produtos alimentícios em geral',
  cnaes_secundarios: [
    { codigo: 4637199, descricao: 'Comércio atacadista especializado em outros produtos alimentícios' },
    { codigo: 4930202, descricao: 'Transporte rodoviário de carga intermunicipal' },
  ],
  descricao_tipo_de_logradouro: 'AVENIDA',
  logradouro: 'DAS FICÇÕES',
  numero: '100',
  complemento: 'GALPÃO 2',
  bairro: 'DISTRITO INDUSTRIAL',
  cep: '69075000',
  municipio: 'MANAUS',
  codigo_municipio_ibge: 1302603,
  uf: 'AM',
  email: EMAIL_FICHA,
  ddd_telefone_1: '(92) 3222-4567',
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
  ...sobrescrever,
});
