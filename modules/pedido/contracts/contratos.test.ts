import { describe, expect, it } from 'vitest';
import { AprovarEntrada, CancelarEntrada, PedidoCanceladoV1, PedidoManualEntrada, PedidoRecusadoV1, RecusarEntrada, ResultadoRecebimentoFdv, CodigoRecusaRecebimento, StatusPedido, Frete, PedidoAprovado, ProdutoRetrato, ClienteRetrato, EnderecoEntrega, SituacaoPedidoParaFaturar, PedidoFaturadoV1 } from './index';

const U = '00000000-0000-4000-8000-000000000001';

describe('contratos do pedido', () => {
  it('RN-PED-05: motivo outro exige motivo_texto na recusa e no cancelamento', () => {
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'outro' }).success).toBe(false);
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'outro', motivo_texto: 'x' }).success).toBe(true);
    expect(CancelarEntrada.safeParse({ motivo_codigo: 'outro' }).success).toBe(false);
    expect(CancelarEntrada.safeParse({ motivo_codigo: 'sem_estoque' }).success).toBe(true);
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'outro', motivo_texto: 'x'.repeat(301) }).success).toBe(false);
  });
  it('RN-PED-05: motivo de cancelamento não vale na recusa e vice-versa', () => {
    expect(RecusarEntrada.safeParse({ motivo_codigo: 'sem_estoque' }).success).toBe(false);
    expect(CancelarEntrada.safeParse({ motivo_codigo: 'credito_insuficiente' }).success).toBe(false);
  });
  it('RN-PED-03: justificativa até 500', () => {
    expect(AprovarEntrada.safeParse({ justificativa: 'x'.repeat(501) }).success).toBe(false);
    expect(AprovarEntrada.safeParse({}).success).toBe(true);
  });
  it('RF-PED-02: pedido manual exige itens e quantidade positiva', () => {
    const item = { produto_id: U, quantidade: 10_000, preco_unitario_centavos: 100 };
    expect(PedidoManualEntrada.safeParse({ filial_id: U, cliente_id: U, itens: [item] }).success).toBe(true);
    expect(PedidoManualEntrada.safeParse({ filial_id: U, cliente_id: U, itens: [] }).success).toBe(false);
    expect(PedidoManualEntrada.safeParse({ filial_id: U, cliente_id: U, itens: [{ ...item, quantidade: 0 }] }).success).toBe(false);
  });
  it('P9: motivo_texto no evento só é não nulo quando o motivo é outro', () => {
    const base = { pedido_id: U, numero: 1, origem: 'bko', pedido_uuid: null, status: 'recusado', status_anterior: 'em_analise', filial_id: U, cliente_id: U, vendedor_id: null, total_centavos: 100 };
    expect(PedidoRecusadoV1.safeParse({ ...base, motivo_codigo: 'outro', motivo_texto: 'x' }).success).toBe(true);
    expect(PedidoRecusadoV1.safeParse({ ...base, motivo_codigo: 'preco_divergente', motivo_texto: null }).success).toBe(true);
    expect(PedidoRecusadoV1.safeParse({ ...base, motivo_codigo: 'preco_divergente', motivo_texto: 'dado pessoal' }).success).toBe(false);
    expect(PedidoCanceladoV1.safeParse({ ...base, status: 'cancelado', motivo_codigo: 'sem_estoque', motivo_texto: 'x' }).success).toBe(false);
    expect(PedidoCanceladoV1.safeParse({ ...base, status: 'cancelado', motivo_codigo: 'outro', motivo_texto: 'x' }).success).toBe(true);
  });
});

describe('ResultadoRecebimentoFdv', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('rejeita criado com status em_analise', () => {
    expect(ResultadoRecebimentoFdv.safeParse({ resultado: 'criado', pedido_id: id, numero: 1, status: 'em_analise' }).success).toBe(false);
  });
  it('aceita repetido com qualquer StatusPedido', () => {
    for (const status of StatusPedido.options) expect(ResultadoRecebimentoFdv.safeParse({ resultado: 'repetido', pedido_id: id, numero: 1, status }).success).toBe(true);
  });
  it('os códigos de recusa são exatamente os 11 esperados', () => {
    expect([...CodigoRecusaRecebimento.options].sort()).toEqual(
      ['cliente_inativo', 'cliente_inexistente', 'condicao_ausente', 'condicao_inativa', 'condicao_inexistente', 'filial_inexistente', 'filial_nao_emissora', 'item_incoerente', 'modulo_pedido_inativo', 'produto_inativo', 'produto_inexistente'],
    );
  });
  it('T-0021: SituacaoPedidoParaFaturar traz status e itens com quantidade e quantidade_faturada em Qtd4', () => {
    expect(SituacaoPedidoParaFaturar.safeParse({ status: 'aprovado', itens: [{ sequencia: 1, quantidade: 20_000, quantidade_faturada: 0 }] }).success).toBe(true);
    expect(SituacaoPedidoParaFaturar.safeParse({ status: 'x', itens: [] }).success).toBe(false);
    expect(SituacaoPedidoParaFaturar.safeParse({ status: 'aprovado', itens: [{ sequencia: 1, quantidade: 1.5, quantidade_faturada: 0 }] }).success).toBe(false);
  });
  it('T-0021: Frete.valor_centavos é opcional: ausente passa (nulo vale 0)', () => {
    expect(Frete.parse({ modalidade: 'CIF' }).valor_centavos).toBeUndefined();
    expect(Frete.parse({ modalidade: 'FOB', valor_centavos: 1500 }).valor_centavos).toBe(1500);
    expect(Frete.safeParse({ modalidade: 'FOB', valor_centavos: 1.5 }).success).toBe(false);
  });
  it('T-0021: forma_tpag, forma_codigo e forma_nome do PedidoAprovado são nulos por padrão e forma_tpag tem 2 dígitos', () => {
    const base = PedidoAprovado.shape;
    expect(base.forma_tpag.parse(undefined)).toBeNull();
    expect(base.forma_codigo.parse(undefined)).toBeNull();
    expect(base.forma_nome.parse(undefined)).toBeNull();
    expect(base.forma_tpag.safeParse('01').success).toBe(true);
    expect(base.forma_tpag.safeParse('1').success).toBe(false);
  });
  it('T-0021: municipio_nome nos retratos (opcional, sem default) e origem do produto de 0 a 8 com padrão 0', () => {
    const end = { logradouro: 'R', numero: '1', complemento: null, bairro: 'B', municipio_ibge: '1302603', uf: 'AM', cep: '69000000', pais_bacen: '1058' };
    const cli = { tipo_pessoa: 'PF', documento: '1', razao_social: 'X', nome_fantasia: null, ie: null, ind_ie_dest: '9', endereco: end };
    expect(ClienteRetrato.parse({ ...cli, endereco: { ...end, municipio_nome: null } }).endereco.municipio_nome).toBeNull();
    expect(ClienteRetrato.parse(cli).endereco.municipio_nome).toBeUndefined();
    expect(ClienteRetrato.parse({ ...cli, endereco: { ...end, municipio_nome: 'Manaus' } }).endereco.municipio_nome).toBe('Manaus');
    expect(EnderecoEntrega.parse({ retrato: { logradouro: 'R' } }).retrato).toMatchObject({ logradouro: 'R' });
    const prod = { codigo: 'P', descricao: 'D', unidade_comercial: 'UN', ean: null, ncm: '22021000' };
    expect(ProdutoRetrato.parse(prod).origem).toBe('0');
    expect(ProdutoRetrato.parse({ ...prod, origem: '2' }).origem).toBe('2');
    expect(ProdutoRetrato.safeParse({ ...prod, origem: '9' }).success).toBe(false);
  });
  describe('pedido.pedido.faturado@1 (T-0015)', () => {
    const base = {
      pedido_id: U, numero: 1, origem: 'fdv', pedido_uuid: U, status: 'faturado', status_anterior: 'aprovado', filial_id: U, cliente_id: U, vendedor_id: null, total_centavos: 100,
      ambiente: 'homologacao',
      nota: { id: U, numero: 1, serie: 1, chave: '13261112345678000199550010000001231876543210', emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 100 },
      itens_faturados: [{ sequencia: 1, produto_id: U, quantidade: 10_000, valor_centavos: 100 }],
    };
    it('T-0015: conta_como_real é opcional e booleano (aditivo no @1)', () => {
      expect(PedidoFaturadoV1.safeParse(base).success).toBe(true);
      expect(PedidoFaturadoV1.safeParse({ ...base, conta_como_real: true }).success).toBe(true);
      expect(PedidoFaturadoV1.safeParse({ ...base, conta_como_real: 'sim' }).success).toBe(false);
    });
    it('T-0015: nota.chave aceita CNPJ alfanumérico e rejeita formato inválido', () => {
      const chave = (c: string) => ({ ...base, nota: { ...base.nota, chave: c } });
      expect(PedidoFaturadoV1.safeParse(chave('13261112AB34CD01DE3555001000000123187654321' + '0')).success).toBe(true);
      expect(PedidoFaturadoV1.safeParse(chave('13261112ab34cd01de3555001000000123187654321' + '0')).success).toBe(false);
      expect(PedidoFaturadoV1.safeParse(chave('13261112AB34CD01DE35550010000001231876543210' + '1')).success).toBe(false);
    });
  });
});

describe('fila de descida e retorno do cliente (ADR 0014 §13 e §15)', () => {
  it('RN-PED-02: o retorno do cliente aceita só faturado_parcial, faturado_total e cancelado, tolera campo novo e rejeita integrado', async () => {
    const { RetornoClientePedido } = await import('./index');
    const base = { pedido_uuid: '12345678-1234-4234-8234-123456789012', ocorrido_em: '2026-11-24T15:00:00.000Z' };
    expect(RetornoClientePedido.safeParse({ ...base, status: 'faturado_total', campo_novo: 1 }).success).toBe(true);
    expect(RetornoClientePedido.safeParse({ ...base, status: 'integrado' }).success).toBe(false);
  });
});
