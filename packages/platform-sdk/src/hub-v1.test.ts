import { describe, expect, it } from 'vitest';
import {
  CABECALHO_CONECTOR_ID,
  CAMINHOS_ENTRADA_V1,
  CODIGOS_ERRO_ENTRADA,
  CodigoErro,
  ConectorIdHub,
  CorpoLote,
  CorpoSinal,
  CursorEntidade,
  ENTIDADES_HUB,
  ENTIDADES_HUB_F2,
  EnderecoClienteHub,
  EnderecoEntregaHub,
  EXTERNAL_ID_MAX,
  ExternalId,
  FormaPagamentoHub,
  ItemFaturado,
  ItemPedidoParaErp,
  LIMITE_CODIGO_FORMA_PAGAMENTO,
  LIMITE_REGISTROS_LOTE,
  LinhaErro,
  LinhaErroHub,
  LinhaInvalidaConector,
  LinhaInvalidaHub,
  LoteAceito,
  LoteEnvelope,
  LoteResultado,
  MAX_BYTES_LOTE_ENTRADA,
  NotaParaCliente,
  NotasPendentesResposta,
  ORDEM_CARGA_ENTIDADES,
  PAYLOADS_HUB,
  PedidoParaErp,
  PedidosPendentesResposta,
  RespostaSinal,
  RetornoAceito,
  RetornoErp,
  RetornoNota,
  RetornoParaHub,
  SinalConector,
} from './hub-v1';
import { ENTIDADES_ENVIO_FDV } from './portal-integracao';

const UUID = '11111111-1111-4111-8111-111111111111';
const EM = '2026-11-23T14:00:00.000Z';

/** Um registro válido e um inválido típico por entidade da F2 (ADR 0014 §2). */
const CASOS: Record<keyof typeof PAYLOADS_HUB, { valido: Record<string, unknown>; invalido: Record<string, unknown> }> = {
  filial: {
    valido: { external_id: 'F1', ativo: true, codigo: '01', nome: 'Matriz', cnpj: '11222333000181', cep: '69000000', uf: 'AM' },
    invalido: { external_id: 'F1', ativo: true, codigo: '01', nome: 'Matriz', cep: '69000-000' },
  },
  vendedor: {
    valido: { external_id: 'V1', ativo: true, nome: 'Vendedor 1', filial_external_id: 'F1' },
    invalido: { external_id: '', ativo: true, nome: 'Vendedor 1' },
  },
  forma_pagamento: {
    valido: { external_id: 'FP1', ativo: true, codigo: 'BOL', nome: 'Boleto' },
    invalido: { external_id: 'FP1', ativo: true, codigo: 'BOL' },
  },
  prazo_pagamento: {
    valido: { external_id: 'PZ1', ativo: true, forma_external_id: 'FP1', codigo: '28/56', parcelas_dias: '28/56' },
    invalido: { external_id: 'PZ1', ativo: true, forma_external_id: 'FP1', codigo: '28/56', parcelas_dias: '28,56' },
  },
  produto: {
    valido: { external_id: 'P1', ativo: true, sku: 'SKU1', nome: 'Produto 1', unidade: 'UN' },
    invalido: { external_id: 'P1', ativo: true, sku: 'SKU1', nome: 'Produto 1', unidade: 'un' },
  },
  produto_unidade: {
    valido: { external_id: 'PU1', ativo: true, produto_external_id: 'P1', unidade: 'CX', fator: 12.5, padrao: false },
    invalido: { external_id: 'PU1', ativo: true, produto_external_id: 'P1', unidade: 'CX', fator: '12', padrao: false },
  },
  preco: {
    valido: {
      external_id: 'PR1', ativo: true, tabela_external_id: 'T1', tabela_nome: 'Tabela', vigencia_inicio: '2026-11-01',
      produto_external_id: 'P1', preco_cents: 1990,
    },
    invalido: {
      external_id: 'PR1', ativo: true, tabela_external_id: 'T1', tabela_nome: 'Tabela', vigencia_inicio: '2026-11-01',
      produto_external_id: 'P1', preco_cents: 19.9,
    },
  },
  estoque: {
    valido: { external_id: 'E1', ativo: true, deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 3.25, filial_external_id: 'F1' },
    invalido: { external_id: 'E1', ativo: true, deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 3.25 },
  },
  cliente: {
    valido: {
      external_id: 'C1', ativo: true, razao_social: 'Cliente Ltda', filial_external_id: 'F1', limite_credito_cents: 500000,
      endereco: { cidade: 'Manaus', uf: 'AM' }, formas_pagamento: ['BOL'],
    },
    invalido: { external_id: 'C1', ativo: true, razao_social: 'Cliente Ltda', filial_external_id: 'F1', limite_credito_cents: -1 },
  },
  cliente_endereco: {
    valido: {
      external_id: 'CE1', ativo: true, cliente_external_id: 'C1', logradouro: 'Rua A', cidade: 'Manaus', uf: 'AM', tipo: 'entrega',
      principal: false,
    },
    invalido: {
      external_id: 'CE1', ativo: true, cliente_external_id: 'C1', logradouro: 'Rua A', cidade: 'Manaus', uf: 'AM', tipo: 'outro',
      principal: false,
    },
  },
};

const corpo = {
  versao_contrato: 'v1', entidade: 'produto', modo: 'delta', enviado_em: EM, cursor: null, linhas_invalidas: [],
  linhas_invalidas_omitidas: 0,
} as const;
const registro = (i: number) => ({ external_id: `P${i}`, alterado_em: EM, ativo: true, sku: `S${i}` });

describe('hub-v1: envelope e payloads (ADR 0014 §2)', () => {
  it('PAYLOADS_HUB tem as 10 entidades do ENTIDADES_ENVIO_FDV, na mesma ordem', () => {
    expect(Object.keys(PAYLOADS_HUB)).toEqual([...ENTIDADES_ENVIO_FDV]);
    expect(ENTIDADES_HUB).toEqual([...ENTIDADES_ENVIO_FDV, 'titulo', 'nota']);
  });

  for (const entidade of ENTIDADES_ENVIO_FDV) {
    it(`${entidade}: aceita o válido e recusa o inválido típico`, () => {
      const schema = PAYLOADS_HUB[entidade];
      expect(schema.safeParse(CASOS[entidade].valido).success).toBe(true);
      expect(schema.safeParse(CASOS[entidade].invalido).success).toBe(false);
    });
  }

  it('cliente descarta campo fora do contrato, como o e-mail (M9)', () => {
    const lido = PAYLOADS_HUB.cliente.parse({ ...CASOS.cliente.valido, email: 'x@y.z' });
    expect(lido).not.toHaveProperty('email');
  });

  it('CorpoLote aceita 5.000 registros e recusa 5.001', () => {
    const cheio = Array.from({ length: LIMITE_REGISTROS_LOTE }, (_, i) => registro(i));
    expect(CorpoLote.safeParse({ ...corpo, registros: cheio }).success).toBe(true);
    expect(CorpoLote.safeParse({ ...corpo, registros: [...cheio, registro(LIMITE_REGISTROS_LOTE)] }).success).toBe(false);
  });

  it('CorpoLote: completo exige sessão, delta não tem; data sem Z é recusada', () => {
    const sessao = { id: UUID, parte: 1, ultimo: true };
    expect(CorpoLote.safeParse({ ...corpo, registros: [], modo: 'completo' }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, registros: [], modo: 'completo', sessao }).success).toBe(true);
    expect(CorpoLote.safeParse({ ...corpo, registros: [], sessao }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, registros: [], enviado_em: '2026-11-23T10:00:00-04:00' }).success).toBe(false);
  });

  it('LinhaInvalidaHub exige mensagem e código do conjunto do Hub', () => {
    expect(LinhaInvalidaHub.safeParse({ external_id: 'P1', codigo: 'campo_obrigatorio', campo: 'sku', mensagem: 'SKU obrigatório' }).success).toBe(true);
    expect(LinhaInvalidaHub.safeParse({ external_id: 'P1', codigo: 'campo_obrigatorio', campo: 'sku' }).success).toBe(false);
    expect(LinhaInvalidaHub.safeParse({ external_id: 'P1', codigo: 'outro', mensagem: 'x' }).success).toBe(false);
  });
});

describe('hub-v1: respostas no formato do FDV (Conector 1.5.0)', () => {
  it('LoteAceito (202 de POST /lotes)', () => {
    const r = { lote_id: UUID, status: 'recebido', entidade: 'produto', modo: 'delta', recebidos: 2, repetido: false, consulta: `/integracao/v1/lotes/${UUID}` };
    expect(LoteAceito.safeParse(r).success).toBe(true);
    expect(LoteAceito.safeParse({ ...r, recebidos: 0 }).success).toBe(false);
    expect(LoteAceito.safeParse({ ...r, status: 'concluido' }).success).toBe(false);
  });

  it('LoteResultado (GET /lotes/{id}) com erro, aviso e inativação', () => {
    const r = {
      lote_id: UUID, entidade: 'cliente', modo: 'completo', status: 'concluido_com_erros',
      contagens: { recebidas: 3, duplicadas_no_lote: 0, com_erro: 1, novas: 1, atualizadas: 1, inalteradas: 0 },
      erros: [{ indice: 2, external_id: 'C3', codigo: 'referencia_ausente', campo: 'filial_external_id', mensagem: 'Filial não encontrada', reprocessavel: true, origem: 'hub' }],
      avisos: [{ indice: 0, external_id: 'C1', codigo: 'cadastro_incompleto', mensagem: 'Cadastro incompleto' }],
      cursor: { alterado_em: EM, external_id: 'C2' },
      inativacao: { situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao', candidatos: 40, percentual: 12.5 },
      recebido_em: EM, concluido_em: EM,
    };
    const lido = LoteResultado.parse(r);
    expect(lido.contagens.obsoletas).toBe(0);
    expect(lido.inativadas).toBe(0);
    expect(LoteResultado.safeParse({ ...r, status: 'cancelado' }).success).toBe(false);
    expect(LoteResultado.safeParse({ ...r, erros: [{ ...r.erros[0], codigo: 'qualquer' }] }).success).toBe(false);
  });

  it('CursorEntidade (GET /cursores/{entidade})', () => {
    expect(CursorEntidade.safeParse({ entidade: 'estoque', cursor: { alterado_em: EM, external_id: 'E1' }, atualizado_em: EM }).success).toBe(true);
    expect(CursorEntidade.safeParse({ entidade: 'estoque', cursor: null, atualizado_em: null }).success).toBe(true);
    expect(CursorEntidade.safeParse({ entidade: 'rota', cursor: null, atualizado_em: null }).success).toBe(false);
  });

  it('CorpoSinal (POST /sinal) aceita o SinalConector do 1.5.0 e descarta `atualizacao`', () => {
    const s = {
      conector_id: 'conector-1', versao_conector: '1.5.0', versao_contrato: 'v1', em: EM,
      fila: [{ estado: 'pendente', lotes: 1, linhas: 10, maisAntigo: EM }],
      entidades: [{ entidade: 'produto', fase: 'delta', ultimo_sucesso: null, bloqueada: false, lotes_na_fila: 1 }],
      parado_por_versao: false,
      atualizacao: { resultado: 'mantido', versao_de: '1.5.0', versao_para: '1.5.0', em: EM, mensagem: 'Sem atualização' },
    };
    const lido = CorpoSinal.parse(s);
    expect(lido).not.toHaveProperty('atualizacao');
    expect(CorpoSinal.safeParse({ ...s, versao_contrato: 'v2' }).success).toBe(false);
  });

  it('RespostaSinal (200 de POST /sinal) com e sem política de versão', () => {
    const politica = {
      versao_minima: '1.4.0', versao_recomendada: '1.5.0', mensagem: 'Atualize o Conector',
      pacote: { versao: '1.5.0', url: 'https://exemplo.invalid/conector-1.5.0.zip', sha256: 'a'.repeat(64) },
    };
    expect(RespostaSinal.safeParse({ politica_versao: politica, conector_id: 'conector-1', recebido_em: EM }).success).toBe(true);
    expect(RespostaSinal.safeParse({}).success).toBe(true);
    expect(RespostaSinal.safeParse({ politica_versao: { ...politica, versao_minima: '1.4' } }).success).toBe(false);
    expect(RespostaSinal.safeParse({ politica_versao: { ...politica, pacote: { ...politica.pacote, sha256: 'A'.repeat(64) } } }).success).toBe(false);
  });
});

describe('hub-v1: conector_id, envelope e limites da linha de erro (ADR 0014 §2 e §4)', () => {
  it('ConectorIdHub segue a regra do Conector [A-Za-z0-9._-]{1,100}', () => {
    expect(ConectorIdHub.safeParse('conector-1.Matriz_2').success).toBe(true);
    expect(ConectorIdHub.safeParse('a'.repeat(100)).success).toBe(true);
    for (const ruim of ['', 'a'.repeat(101), 'conector 1', 'conector\u00011', 'conector\n', 'conectór', 'conector-ü']) {
      expect(ConectorIdHub.safeParse(ruim).success).toBe(false);
    }
    expect(CorpoSinal.safeParse({ conector_id: 'conector 1' }).error?.issues.some((i) => i.path[0] === 'conector_id')).toBe(true);
  });

  it('LoteEnvelope é o CorpoLote; o conector_id vai no cabeçalho HTTP, como no FDV', () => {
    expect(LoteEnvelope).toBe(CorpoLote);
    expect(CABECALHO_CONECTOR_ID).toBe('x-macuxi-conector-id');
  });

  it('LinhaErroHub: campo com padrão de nome, mensagem até 200 e `valor` extra descartado', () => {
    const linha = { indice: 0, external_id: 'C1', codigo: 'formato_invalido', campo: 'endereco.cep', mensagem: 'CEP inválido', reprocessavel: false };
    expect(LinhaErroHub.safeParse({ ...linha, campo: null }).success).toBe(true);
    expect(LinhaErroHub.safeParse({ ...linha, campo: 'itens[0].quantidade' }).success).toBe(true);
    expect(LinhaErroHub.safeParse({ ...linha, campo: 'cep do cliente' }).success).toBe(false);
    expect(LinhaErroHub.safeParse({ ...linha, mensagem: 'm'.repeat(200) }).success).toBe(true);
    expect(LinhaErroHub.safeParse({ ...linha, mensagem: 'm'.repeat(201) }).success).toBe(false);
    expect(LinhaErroHub.parse({ ...linha, valor: '69000-000' })).not.toHaveProperty('valor');
  });
});

describe('hub-v1: limites e aliases (ADR 0014 §2 e §3)', () => {
  it('ExternalId usa EXTERNAL_ID_MAX = 200, também nos payloads (201 é recusado)', () => {
    expect(EXTERNAL_ID_MAX).toBe(200);
    expect(ExternalId.safeParse('x'.repeat(EXTERNAL_ID_MAX)).success).toBe(true);
    expect(ExternalId.safeParse('x'.repeat(EXTERNAL_ID_MAX + 1)).success).toBe(false);
    expect(ExternalId.safeParse('').success).toBe(false);
    const forma = { ativo: true, codigo: 'BOL', nome: 'Boleto', external_id: 'x'.repeat(EXTERNAL_ID_MAX + 1) };
    expect(PAYLOADS_HUB.forma_pagamento.safeParse(forma).success).toBe(false);
  });

  it('FormaPagamentoHub.codigo usa LIMITE_CODIGO_FORMA_PAGAMENTO = 30', () => {
    expect(LIMITE_CODIGO_FORMA_PAGAMENTO).toBe(30);
    const base = { external_id: 'FP1', ativo: true, nome: 'Boleto' };
    expect(FormaPagamentoHub.safeParse({ ...base, codigo: 'c'.repeat(30) }).success).toBe(true);
    expect(FormaPagamentoHub.safeParse({ ...base, codigo: 'c'.repeat(31) }).success).toBe(false);
  });

  it('MAX_BYTES_LOTE_ENTRADA = 8 MiB', () => {
    expect(MAX_BYTES_LOTE_ENTRADA).toBe(8 * 1024 * 1024);
  });

  it('ORDEM_CARGA_ENTIDADES é uma permutação das 10 entidades da F2, sem repetição', () => {
    expect(ORDEM_CARGA_ENTIDADES).toEqual([
      'filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco',
    ]);
    expect(ORDEM_CARGA_ENTIDADES).toHaveLength(ENTIDADES_HUB_F2.length);
    expect(new Set(ORDEM_CARGA_ENTIDADES).size).toBe(ORDEM_CARGA_ENTIDADES.length);
    expect([...ORDEM_CARGA_ENTIDADES].sort()).toEqual([...ENTIDADES_HUB_F2].sort());
  });

  it('aliases: SinalConector, LinhaErro, LinhaInvalidaConector e RetornoParaHub', () => {
    expect(SinalConector).toBe(CorpoSinal);
    expect(LinhaErro).toBe(LinhaErroHub);
    expect(LinhaInvalidaConector).toBe(LinhaInvalidaHub);
    expect(RetornoParaHub).toBe(RetornoErp);
  });
});

describe('hub-v1: pedidos que descem ao banco do cliente (contrato do Hub do FDV, ADR 0014 §13)', () => {
  const item = { sequencia: 1, produto_external_id: 'P1', quantidade: 2.5, preco_unitario_cents: 1000, total_cents: 2500 };
  const pedido = {
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'C1', vendedor_external_id: 'V1', criado_em: EM,
    total_cents: 2500, itens: [item],
  };
  const completo = {
    ...pedido, aprovado_em: EM, tentativa: 2, observacao: 'Entregar pela manhã', desconto_total_cents: 100,
    condicao_pagamento_erp: '28/56', filial: { codigo: '01', external_id: 'F1' },
    frete: { modalidade: 'CIF', transportadora_external_id: 'T1', transportadora: { nome: 'Transportes' } },
    endereco_entrega: { external_id: 'CE1', origem: 'erp', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69000000' },
    pagamento: { forma_external_id: 'FP1', prazo_external_id: 'PZ1', parcelas_dias: [28, 56], prazo_medio_dias: 42, percentual_ajuste: -1.5 },
    itens: [{ ...item, desconto_cents: 50, unidade: 'CX', fator: 12, quantidade_venda: 0.25, aplicacao: 'Linha leve' }],
  };

  it('aceita o pedido mínimo e o completo; nulo do FDV nos opcionais passa', () => {
    expect(PedidoParaErp.safeParse(pedido).success).toBe(true);
    expect(PedidoParaErp.safeParse(completo).success).toBe(true);
    const nulos = { aprovado_em: null, filial: null, pagamento: null, frete: null, endereco_entrega: null, observacao: null, tentativa: null };
    expect(PedidoParaErp.safeParse({ ...pedido, ...nulos }).success).toBe(true);
  });

  it('não é strict: campo desconhecido é descartado (o FDV não é strict) e os conhecidos ficam', () => {
    const lido = PedidoParaErp.parse({ ...completo, campo_novo: 1, itens: [{ ...item, outro: 'x' }] });
    expect(lido).not.toHaveProperty('campo_novo');
    expect(lido.itens[0]).not.toHaveProperty('outro');
    expect(lido.pagamento?.prazo_external_id).toBe('PZ1');
    expect(lido.endereco_entrega).toMatchObject({ external_id: 'CE1', origem: 'erp' });
    expect(lido.frete?.transportadora).toEqual({ nome: 'Transportes' });
    expect(lido.condicao_pagamento_erp).toBe('28/56');
  });

  it('obrigatórios: versão v1, uuid, chaves, criado_em com Z, total e itens', () => {
    for (const campo of ['versao_contrato', 'pedido_uuid', 'cliente_external_id', 'vendedor_external_id', 'criado_em', 'total_cents', 'itens'] as const) {
      const { [campo]: _fora, ...sem } = pedido;
      expect(PedidoParaErp.safeParse(sem).success).toBe(false);
    }
    for (const ruim of [
      { versao_contrato: 'v2' }, { pedido_uuid: 'pedido-1' }, { cliente_external_id: '' }, { vendedor_external_id: 'v'.repeat(201) },
      { criado_em: '2026-11-23T10:00:00-04:00' }, { aprovado_em: '2026-11-23' }, { total_cents: 19.9 }, { total_cents: -1 },
      { observacao: 'o'.repeat(501) }, { desconto_total_cents: 1.5 }, { tentativa: 1.5 }, { pagamento: { parcelas_dias: [28.5] } },
      { pagamento: { prazo_medio_dias: '42' } }, { pagamento: { percentual_ajuste: Number.NaN } }, { filial: { external_id: '' } },
      { endereco_entrega: { cep: 69000000 } }, { frete: { modalidade: 5 } },
    ]) expect(PedidoParaErp.safeParse({ ...pedido, ...ruim }).success).toBe(false);
  });

  it('itens: de 1 a 500; sequência ≥ 1, quantidade finita > 0 e centavos inteiros ≥ 0', () => {
    expect(PedidoParaErp.safeParse({ ...pedido, itens: [] }).success).toBe(false);
    const quinhentos = Array.from({ length: 500 }, (_, i) => ({ ...item, sequencia: i + 1 }));
    expect(PedidoParaErp.safeParse({ ...pedido, itens: quinhentos }).success).toBe(true);
    expect(PedidoParaErp.safeParse({ ...pedido, itens: [...quinhentos, { ...item, sequencia: 501 }] }).success).toBe(false);
    expect(ItemPedidoParaErp.safeParse(item).success).toBe(true);
    for (const ruim of [
      { sequencia: 0 }, { quantidade: 0 }, { quantidade: '2.5' }, { quantidade: Number.POSITIVE_INFINITY }, { preco_unitario_cents: 10.5 },
      { total_cents: -1 }, { desconto_cents: 0.5 }, { produto_external_id: '' }, { unidade: 'UNIDADE' }, { fator: 0 },
    ]) expect(ItemPedidoParaErp.safeParse({ ...item, ...ruim }).success).toBe(false);
  });

  it('endereco_entrega reaproveita os campos do EnderecoClienteHub, com external_id e origem', () => {
    expect(Object.keys(EnderecoEntregaHub.shape).sort()).toEqual([...Object.keys(EnderecoClienteHub.shape), 'external_id', 'origem'].sort());
    expect(PedidoParaErp.safeParse({ ...pedido, endereco_entrega: { external_id: null, complemento: null, logradouro: 'Rua B' } }).success).toBe(true);
  });

  it('centavos acima de Number.MAX_SAFE_INTEGER são recusados', () => {
    expect(PedidoParaErp.safeParse({ ...pedido, total_cents: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    expect(PedidoParaErp.safeParse({ ...pedido, total_cents: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });

  it('PedidosPendentesResposta é só { pedidos }: sem cancelamentos nem paginação', () => {
    expect(PedidosPendentesResposta.safeParse({ pedidos: [pedido, completo] }).success).toBe(true);
    expect(PedidosPendentesResposta.safeParse({ pedidos: [] }).success).toBe(true);
    expect(PedidosPendentesResposta.safeParse({ pedidos: [{ ...pedido, itens: [] }] }).success).toBe(false);
    expect(PedidosPendentesResposta.parse({ pedidos: [], cancelamentos: [], proximo: 'x' })).toEqual({ pedidos: [] });
  });

  it('RetornoErp: integrado, faturado com nota e itens, e recusa status fora do Hub', () => {
    const integrado = { versao_contrato: 'v1', pedido_uuid: UUID, status: 'integrado', numero_erp: '123', ocorrido_em: EM };
    expect(RetornoErp.safeParse(integrado).success).toBe(true);
    const itemFaturado = { sequencia: 1, produto_external_id: 'P1', quantidade: 2.5, valor_cents: 2500 };
    expect(ItemFaturado.safeParse(itemFaturado).success).toBe(true);
    expect(ItemFaturado.safeParse({ ...itemFaturado, valor_cents: 1.5 }).success).toBe(false);
    expect(ItemFaturado.safeParse({ ...itemFaturado, sequencia: 0 }).success).toBe(false);
    const faturado = {
      ...integrado, status: 'faturado_total', nota: { numero: 10, serie: 1, chave: '1'.repeat(44), emitida_em: EM, total_cents: 2500 },
      itens_faturados: [itemFaturado],
    };
    expect(RetornoErp.safeParse(faturado).success).toBe(true);
    for (const ruim of [
      { status: 'aprovado' }, { versao_contrato: 'v2' }, { numero_erp: '' }, { numero_erp: 'n'.repeat(31) }, { motivo: 'm'.repeat(301) },
      { ocorrido_em: '2026-11-23T10:00:00-04:00' }, { pedido_uuid: 'x' },
    ]) expect(RetornoErp.safeParse({ ...integrado, ...ruim }).success).toBe(false);
    expect(RetornoErp.parse({ ...faturado, xml: '<nfeProc/>' })).not.toHaveProperty('xml');
  });

  it('RetornoAceito = { pedido_uuid, aceito: true }', () => {
    expect(RetornoAceito.safeParse({ pedido_uuid: UUID, aceito: true }).success).toBe(true);
    expect(RetornoAceito.safeParse({ pedido_uuid: UUID, aceito: false }).success).toBe(false);
    expect(RetornoAceito.safeParse({ pedido_uuid: 'x', aceito: true }).success).toBe(false);
  });
});

describe('hub-v1: /entrada/v1 do ERP (ADR 0014 §13 e §14)', () => {
  const item = {
    n: 1, produto_external_id: 'P1', unidade: 'UN', quantidade: 1.5, valor_unitario_cents: 1000, valor_total_cents: 1500, cfop: '5102',
  };
  const nota = {
    chave: '1'.repeat(44), numero: 1, serie: 0, emitida_em: EM, pedido_uuid: UUID, cliente_external_id: 'C1',
    total_produtos_cents: 1500, total_desconto_cents: 0, total_frete_cents: 0, total_ipi_cents: 0, total_icms_st_cents: 0, total_cents: 1500,
    itens: [item],
  };
  const TOTAIS = ['total_produtos_cents', 'total_desconto_cents', 'total_frete_cents', 'total_ipi_cents', 'total_icms_st_cents', 'total_cents'] as const;

  it('NotaParaCliente aceita a nota válida, também sem pedido_uuid, e descarta o XML', () => {
    expect(NotaParaCliente.safeParse(nota).success).toBe(true);
    const { pedido_uuid: _pedido, ...semPedido } = nota;
    expect(NotaParaCliente.safeParse({ ...semPedido, serie: 999, numero: 999_999_999 }).success).toBe(true);
    expect(NotaParaCliente.parse({ ...nota, xml: '<nfeProc/>' })).not.toHaveProperty('xml');
  });

  it('NotaParaCliente recusa chave, número, série, emissão, pedido e cliente fora do formato, e exige os obrigatórios', () => {
    for (const ruim of [
      { chave: '1'.repeat(43) }, { chave: `${'1'.repeat(43)}A` }, { numero: 0 }, { numero: 1_000_000_000 }, { numero: 1.5 }, { serie: -1 },
      { serie: 1000 }, { serie: 1.5 }, { emitida_em: '2026-11-23T10:00:00-04:00' }, { pedido_uuid: 'pedido-1' }, { cliente_external_id: '' },
    ]) expect(NotaParaCliente.safeParse({ ...nota, ...ruim }).success).toBe(false);
    for (const campo of ['chave', 'numero', 'serie', 'emitida_em', 'cliente_external_id', 'itens', ...TOTAIS] as const) {
      const { [campo]: _fora, ...sem } = nota;
      expect(NotaParaCliente.safeParse(sem).success).toBe(false);
    }
  });

  it('NotaParaCliente: totais em centavos inteiros ≥ 0', () => {
    for (const campo of TOTAIS) {
      expect(NotaParaCliente.safeParse({ ...nota, [campo]: -1 }).success).toBe(false);
      expect(NotaParaCliente.safeParse({ ...nota, [campo]: 19.9 }).success).toBe(false);
    }
  });

  it('NotaParaCliente: itens de 1 a 990, n ≥ 1, unidade até 6, quantidade finita > 0, centavos e CFOP de 4 dígitos', () => {
    for (const ruim of [
      { n: 0 }, { n: 1.5 }, { unidade: '' }, { unidade: 'UNIDADE' }, { quantidade: 0 }, { quantidade: Number.POSITIVE_INFINITY },
      { quantidade: '1' }, { valor_unitario_cents: 10.5 }, { valor_total_cents: -1 }, { produto_external_id: '' }, { cfop: '510' },
      { cfop: '51022' }, { cfop: '5.102' },
    ]) expect(NotaParaCliente.safeParse({ ...nota, itens: [{ ...item, ...ruim }] }).success).toBe(false);
    expect(NotaParaCliente.safeParse({ ...nota, itens: [] }).success).toBe(false);
    const itens = Array.from({ length: 990 }, (_, i) => ({ ...item, n: i + 1 }));
    expect(NotaParaCliente.safeParse({ ...nota, itens }).success).toBe(true);
    expect(NotaParaCliente.safeParse({ ...nota, itens: [...itens, { ...item, n: 991 }] }).success).toBe(false);
  });

  it('NotasPendentesResposta: até 100 notas', () => {
    expect(NotasPendentesResposta.safeParse({ notas: [] }).success).toBe(true);
    const cem = Array.from({ length: 100 }, () => nota);
    expect(NotasPendentesResposta.safeParse({ notas: cem }).success).toBe(true);
    expect(NotasPendentesResposta.safeParse({ notas: [...cem, nota] }).success).toBe(false);
  });

  it('RetornoNota: gravada ou rejeitada, com código do catálogo opcional', () => {
    expect(RetornoNota.safeParse({ situacao: 'gravada' }).success).toBe(true);
    expect(RetornoNota.safeParse({ situacao: 'rejeitada', codigo: 'produto_inexistente' }).success).toBe(true);
    expect(RetornoNota.safeParse({ situacao: 'pendente' }).success).toBe(false);
    expect(RetornoNota.safeParse({ situacao: 'rejeitada', codigo: 'Produto não existe' }).success).toBe(false);
  });

  it('CAMINHOS_ENTRADA_V1 congelado, com as 8 rotas da /entrada/v1 (pré-cadastro fica para a v0.3.12)', () => {
    expect(Object.isFrozen(CAMINHOS_ENTRADA_V1)).toBe(true);
    expect(CAMINHOS_ENTRADA_V1).toEqual({
      lotes: '/entrada/v1/lotes', lote: '/entrada/v1/lotes/:id', cursor: '/entrada/v1/cursores/:entidade', sinal: '/entrada/v1/sinal',
      pedidosPendentes: '/entrada/v1/pedidos/pendentes', pedidoRetorno: '/entrada/v1/pedidos/:uuid/retorno',
      notasPendentes: '/entrada/v1/notas/pendentes', notaRetorno: '/entrada/v1/notas/:chave/retorno',
    });
  });

  it('CODIGOS_ERRO_ENTRADA é a lista fechada da /entrada/v1, no formato do CodigoErro', () => {
    expect(CODIGOS_ERRO_ENTRADA).toEqual([
      'entidade_fora_da_fase', 'entidade_dono_erp', 'conector_desconhecido', 'credencial_invalida', 'pepper_ausente', 'lote_em_andamento',
      'idempotencia_conflito',
    ]);
    for (const c of CODIGOS_ERRO_ENTRADA) expect(CodigoErro.safeParse(c).success).toBe(true);
  });
});
