/** Massa dos testes do pedido: cadastros do dublê e corpos de entrada. Os dados pessoais são de mentira e servem à varredura de log. */
import type { PedidoFdvEntrada, PedidoManualEntrada } from '../contracts';
import type { CadastrosMemoria } from './memoria';

export const IDS = {
  filial: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  filialSemEmissao: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  cliente: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  clienteInativo: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  endereco: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  produto1: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  produto2: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
  produtoInativo: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
  condicao30: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  condicaoAVista: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  condicaoInativa: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  condicaoCartao: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
  tabela: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
  vendedor: '99999999-9999-4999-8999-999999999991',
  outroVendedor: '99999999-9999-4999-8999-999999999992',
  usuarioVendedor: '77777777-7777-4777-8777-777777777771',
  usuarioOutroVendedor: '77777777-7777-4777-8777-777777777772',
  pedidoFdv: '12345678-1234-4234-8234-123456789012',
  desconhecido: '00000000-0000-4000-8000-000000000000',
} as const;

export const CPF_DO_CLIENTE = '52998224725';
export const RAZAO_DO_CLIENTE = 'Maria da Silva Exemplo';
export const OBSERVACAO = 'Entregar com o seu Joao no portao azul';
export const MOTIVO_LIVRE = 'Cliente Joao pediu para suspender por luto';

const endereco = { id: IDS.endereco, tipo: 'principal' as const, logradouro: 'Rua das Flores', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69000000', pais_bacen: '1058' };

/** Um tenant com filial emissora, cliente com limite de R$ 1.000,00, dois produtos com preço e saldo, e as condições. */
export function prepararCadastros(c: CadastrosMemoria, o: { limite?: number; saldo?: number } = {}): void {
  c.filiais.set(IDS.filial, { id: IDS.filial, emissora: true, padrao: true, inativo: false });
  c.filiais.set(IDS.filialSemEmissao, { id: IDS.filialSemEmissao, emissora: false, padrao: false, inativo: false });
  const cliente = {
    id: IDS.cliente, tipo_pessoa: 'PF' as const, documento: CPF_DO_CLIENTE, razao_social: RAZAO_DO_CLIENTE, nome_fantasia: null, ind_ie_dest: '9' as const, ie: null,
    limite_credito_centavos: o.limite ?? 100_000, condicao_pagamento_id: IDS.condicao30, tabela_preco_id: IDS.tabela, filial_id: IDS.filial, vendedor_id: IDS.vendedor,
    enderecos: [endereco], inativo: false,
  };
  c.clientes.set(IDS.cliente, cliente);
  c.clientes.set(IDS.clienteInativo, { ...cliente, id: IDS.clienteInativo, inativo: true });
  for (const [id, codigo, inativo] of [[IDS.produto1, 'P1', false], [IDS.produto2, 'P2', false], [IDS.produtoInativo, 'P3', true]] as const) {
    c.produtosPorId.set(id, { id, codigo, descricao: `Produto ${codigo}`, unidade_comercial: 'UN', ean: null, ncm: '22021000', origem: '0' as const, inativo, unidades: [] });
    c.precos.set(`${IDS.tabela}:${IDS.filial}:${id}`, { tabela_preco_id: IDS.tabela, filial_id: IDS.filial, produto_id: id, preco_centavos: 1000, desconto_maximo_bp: 500, origem_filial_id: IDS.filial, vigencia_inicio: '2026-01-01', vigencia_fim: null });
    c.saldosPor.set(`${IDS.filial}:${id}`, o.saldo ?? 1_000_000);
  }
  // RN-CAD-09: à vista (01, 17, 04) só com prazo 0; a prazo usa boleto (15).
  const condicao = (id: string, prazos: number[], forma: { tpag: string; codigo: string; nome: string }, inativo = false) =>
    c.condicoes.set(id, { id, codigo: id.slice(-1), descricao: 'Condição', forma_tpag: forma.tpag, prazos_dias: prazos, prazo_medio_dias: Math.round(prazos.reduce((a, b) => a + b, 0) / prazos.length), forma_external_id: null, forma_codigo: forma.codigo, forma_nome: forma.nome, external_id: null, inativo });
  const DINHEIRO = { tpag: '01', codigo: 'DIN', nome: 'Dinheiro' };
  const BOLETO = { tpag: '15', codigo: 'BOL', nome: 'Boleto' };
  condicao(IDS.condicao30, [30], BOLETO);
  condicao(IDS.condicaoAVista, [0], DINHEIRO);
  condicao(IDS.condicaoInativa, [30], BOLETO, true);
  condicao(IDS.condicaoCartao, [30], { tpag: '03', codigo: 'CRT', nome: 'Cartão de crédito' }); // fora do crédito (RN-PED-04)
  c.vendedores.set(IDS.usuarioVendedor, IDS.vendedor);
  c.vendedores.set(IDS.usuarioOutroVendedor, IDS.outroVendedor);
}

/** 1 unidade de P1 a R$ 10,00 (preço de tabela, sem desconto): total R$ 10,00, sem pendência. */
export const pedidoManual = (sobre: Partial<PedidoManualEntrada> = {}): PedidoManualEntrada => ({
  filial_id: IDS.filial,
  cliente_id: IDS.cliente,
  vendedor_id: null,
  condicao_pagamento_id: IDS.condicao30,
  endereco_entrega_id: null,
  observacao: null,
  itens: [{ produto_id: IDS.produto1, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }],
  ...sobre,
});

export const pedidoFdv = (sobre: Partial<PedidoFdvEntrada> = {}): PedidoFdvEntrada => ({
  pedido_uuid: IDS.pedidoFdv,
  cliente_id: IDS.cliente,
  vendedor_id: IDS.vendedor,
  filial_id: IDS.filial,
  condicao_pagamento_id: IDS.condicao30,
  emitido_em: '2026-11-21T14:00:00.000Z',
  aprovado_origem_em: '2026-11-21T14:05:00.000Z',
  observacao: OBSERVACAO,
  frete: null,
  endereco_entrega: null,
  total_informado_centavos: 2000,
  itens: [{ sequencia: 1, produto_id: IDS.produto1, quantidade: 20_000, unidade_venda: 'UN', fator_venda: 10_000, quantidade_venda: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0, total_informado_centavos: 2000, aplicacao: null }],
  ...sobre,
});

/** Define o prazo médio permitido ao cliente (RN-CAD-16); `null` = sem limite. */
export function prazoDoCliente(c: CadastrosMemoria, dias: number | null): void {
  c.clientes.set(IDS.cliente, { ...c.clientes.get(IDS.cliente)!, prazo_medio_dias: dias });
}

/** Define o prazo médio da condição (RN-CAD-15); `null` = prazo incompleto. */
export function prazoMedioDaCondicao(c: CadastrosMemoria, id: string, dias: number | null): void {
  c.condicoes.set(id, { ...c.condicoes.get(id)!, prazo_medio_dias: dias });
}
