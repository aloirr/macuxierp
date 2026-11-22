/** Massa de teste compartilhada (domain e api): pedido aprovado e cálculo fiscal no formato real dos contracts. */
import type { ItemResultado } from '@macuxierp/fiscal/contracts';
import { valorItem } from '@macuxierp/platform-sdk';
import type { ItemCalculado, ItemPedidoAprovado, PedidoFaturavel } from './index';

export const IDS = {
  pedido: '00000000-0000-4000-8000-0000000000a1',
  filial: '00000000-0000-4000-8000-0000000000b1',
  cliente: '00000000-0000-4000-8000-0000000000c1',
  tenant: '00000000-0000-4000-8000-0000000000d1',
};

export const itemPedido = (sequencia: number, quantidade: number, preco: number, desconto = 0, ncm = '22021000'): ItemPedidoAprovado => ({
  sequencia,
  produto_id: `00000000-0000-4000-8000-00000000000${sequencia}`,
  produto_retrato: { codigo: `P${sequencia}`, descricao: `Produto ${sequencia}`, ncm, unidade_comercial: 'UN', ean: null },
  quantidade,
  preco_unitario_centavos: preco,
  desconto_centavos: desconto,
  total_centavos: valorItem(quantidade, preco) - desconto,
});

export const retratoCliente: PedidoFaturavel['pedido']['cliente_retrato'] = {
  tipo_pessoa: 'PJ',
  documento: '45.723.174/0001-10',
  razao_social: 'CLIENTE & FILHOS',
  nome_fantasia: null,
  ie: '04.123.456-1',
  ind_ie_dest: '1',
  endereco: { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000-000', pais_bacen: '1058' },
};

export function pedidoAprovado(itens: PedidoFaturavel['pedido']['itens'], extra: Partial<PedidoFaturavel> = {}): PedidoFaturavel {
  const total = itens.reduce((a, i) => a + i.total_centavos, 0);
  return {
    pedido_id: IDS.pedido,
    numero: 1,
    origem: 'bko',
    pedido_uuid: null,
    status: 'aprovado',
    status_anterior: 'em_analise',
    filial_id: IDS.filial,
    cliente_id: IDS.cliente,
    vendedor_id: null,
    total_centavos: total,
    automatica: false,
    pedido: {
      condicao_pagamento_id: null,
      tabela_preco_id: null,
      emitido_em: '2026-11-21T14:00:00.000Z',
      observacao: null,
      cliente_retrato: retratoCliente,
      endereco_entrega: null,
      frete: null,
      itens,
      total_centavos: total,
    },
    ...extra,
  };
}

/** ICMS 00 a 20% e PIS/COFINS cumulativos sobre 1000 centavos, por padrão. */
export const calc = (sequencia: number, extra: Partial<ItemResultado> = {}, cfop = '5102'): ItemCalculado => ({
  sequencia,
  cfop,
  resultado: {
    item_id: String(sequencia),
    icms: { orig: '0', cst: '00', mod_bc: 3, v_bc: 1000, p_icms: 200_000, v_icms: 200 },
    pis: { cst: '01', v_bc: 1000, p_aliq: 16_500, v_valor: 10 },
    cofins: { cst: '01', v_bc: 1000, p_aliq: 76_000, v_valor: 46 },
    regra: { id: '00000000-0000-4000-8000-0000000000e1', fonte: { tipo: 'NT', referencia: 'teste' }, versao: '1' },
    ...extra,
  },
});
