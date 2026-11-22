import { ENTIDADES_CARGA, ENTIDADES_IGNORADAS, type EntidadeCarga } from '../../contracts';

/**
 * Layout dos 10 arquivos do kit (docs/desenho/T-0026.md, seção 3; D1 e D2). `usadas` = colunas do kit lidas mais as
 * colunas do ERP (todas opcionais); `ignoradas` = colunas do kit sem destino no ERP (aviso, uma vez por arquivo).
 * Tamanhos máximos são os do contrato do ERP, em `LIMITES`: acima disso a linha é recusada, nunca cortada.
 */
export interface LayoutArquivo {
  obrigatorias: readonly string[];
  usadas: readonly string[];
  ignoradas: readonly string[];
}

const ign = (s: string) => s.split(' ');

export const LAYOUT: Readonly<Record<EntidadeCarga, LayoutArquivo>> = {
  filial: {
    obrigatorias: ign('external_id codigo nome cidade uf cnpj logradouro numero bairro cep'),
    usadas: ign('external_id nome ativo cidade uf cnpj logradouro numero complemento bairro cep crt ie municipio_ibge industrial_ipi regime_pis_cofins'),
    ignoradas: ign('codigo alterado_em telefone'),
  },
  vendedor: {
    obrigatorias: ign('external_id nome'),
    usadas: ign('external_id nome ativo filial_external_id codigo'),
    ignoradas: ign('alterado_em email telefone'),
  },
  forma_pagamento: {
    obrigatorias: ign('external_id codigo nome'),
    usadas: ign('external_id codigo nome ativo tpag'),
    ignoradas: ign('alterado_em ordem'),
  },
  prazo_pagamento: {
    obrigatorias: ign('external_id forma_external_id codigo parcelas_dias'),
    usadas: ign('external_id forma_external_id codigo parcelas_dias ativo descricao'),
    ignoradas: ign('alterado_em prazo_medio_dias percentual_ajuste ordem'),
  },
  produto: {
    obrigatorias: ign('external_id sku nome unidade'),
    usadas: ign('external_id sku nome unidade ativo ean marca custo_cents desconto_maximo_pct ncm cest origem grupo_tributacao producao_propria'),
    ignoradas: ign(
      'alterado_em marca_codigo categoria embalagem_medida embalagem_quantidade catalogo_no_external_id preco_venda_cents aplicacao ' +
        'referencia_1 marca_referencia_codigo_1 marca_referencia_1 referencia_2 marca_referencia_codigo_2 marca_referencia_2 ' +
        'referencia_3 marca_referencia_codigo_3 marca_referencia_3',
    ),
  },
  produto_unidade: {
    obrigatorias: ign('external_id produto_external_id unidade fator'),
    usadas: ign('external_id produto_external_id unidade fator ativo ean'),
    ignoradas: ign('alterado_em padrao'),
  },
  preco: {
    obrigatorias: ign('external_id tabela_external_id tabela_nome vigencia_inicio produto_external_id preco_cents'),
    usadas: ign('external_id tabela_external_id tabela_nome vigencia_inicio produto_external_id preco_cents ativo vigencia_fim unidade filial_external_id'),
    ignoradas: ign('alterado_em'),
  },
  estoque: {
    obrigatorias: ign('external_id deposito_external_id produto_external_id saldo'),
    usadas: ign('external_id produto_external_id saldo filial_external_id'),
    ignoradas: ign('deposito_external_id alterado_em ativo deposito_nome'),
  },
  cliente: {
    obrigatorias: ign('external_id razao_social'),
    usadas: ign(
      'external_id razao_social ativo nome_fantasia documento vendedor_external_id endereco.logradouro endereco.numero endereco.complemento ' +
        'endereco.bairro endereco.cidade endereco.uf endereco.cep email limite_credito_cents inscricao_estadual tabela_preco_external_id ' +
        'filial_external_id ind_ie_dest endereco.municipio_ibge condicao_pagamento_external_id',
    ),
    ignoradas: ign('alterado_em latitude longitude telefone observacao bloqueado canal prazo_medio_max_dias formas_pagamento'),
  },
  cliente_endereco: {
    obrigatorias: ign('external_id cliente_external_id logradouro cidade uf'),
    usadas: ign('external_id cliente_external_id logradouro cidade uf ativo tipo numero complemento bairro cep municipio_ibge'),
    ignoradas: ign('alterado_em descricao latitude longitude principal'),
  },
};

/** Tamanhos do contrato do ERP (limite da NF-e): excedeu, `CARGA_TAMANHO`. `external_id` e `*_external_id`: 64 (D3). */
export const LIMITES = {
  id_externo: 64, texto60: 60, codigo20: 20, nome80: 80, descricao120: 120, unidade6: 6, grupo30: 30,
} as const;

/** UF: 2 letras maiúsculas (a coluna é normalizada antes). */
export const PADRAO_UF = /^[A-Z]{2}$/;

export type ClasseArquivo =
  | { classe: 'carga'; entidade: EntidadeCarga }
  | { classe: 'ignorado'; entidade: (typeof ENTIDADES_IGNORADAS)[number] }
  | { classe: 'recusado' };

/** D1: `<entidade>.csv`, sem diferença de maiúsculas; os 6 do kit fora da v1 são ignorados; outro nome é recusado. */
export function classificarArquivo(nome: string): ClasseArquivo {
  const m = /^([a-z_]+)\.csv$/i.exec(nome.trim());
  const base = m?.[1]?.toLowerCase();
  const entidade = (ENTIDADES_CARGA as readonly string[]).find((e) => e === base);
  if (entidade) return { classe: 'carga', entidade: entidade as EntidadeCarga };
  const ignorada = (ENTIDADES_IGNORADAS as readonly string[]).find((e) => e === base);
  if (ignorada) return { classe: 'ignorado', entidade: ignorada as (typeof ENTIDADES_IGNORADAS)[number] };
  return { classe: 'recusado' };
}
