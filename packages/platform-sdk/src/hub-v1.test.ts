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
  LIMITE_REGISTROS_LOTE,
  LinhaErroHub,
  LinhaInvalidaHub,
  LoteAceito,
  LoteEnvelope,
  NotaParaCliente,
  LoteResultado,
  PAYLOADS_HUB,
  RespostaSinal,
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

  it('external_id com 201 caracteres é recusado (200 passa)', () => {
    const base = { ativo: true, codigo: 'BOL', nome: 'Boleto' };
    expect(PAYLOADS_HUB.forma_pagamento.safeParse({ ...base, external_id: 'x'.repeat(200) }).success).toBe(true);
    expect(PAYLOADS_HUB.forma_pagamento.safeParse({ ...base, external_id: 'x'.repeat(201) }).success).toBe(false);
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

describe('hub-v1: /entrada/v1 do ERP (ADR 0014 §13 e §14)', () => {
  const item = { numero_item: 1, produto_external_id: 'P1', quantidade: 1.5, valor_unitario_cents: 1000, valor_total_cents: 1500 };
  const nota = {
    chave: '1'.repeat(44), numero: 1, serie: 0, emissao: EM, pedido_uuid: UUID, cliente_external_id: 'C1',
    total_produtos_cents: 1500, total_desconto_cents: 0, total_frete_cents: 0, total_impostos_cents: 180, total_nota_cents: 1500,
    itens: [item],
  };

  it('NotaParaCliente aceita a nota válida, também sem pedido_uuid, e descarta o XML', () => {
    expect(NotaParaCliente.safeParse(nota).success).toBe(true);
    const { pedido_uuid: _pedido, ...semPedido } = nota;
    expect(NotaParaCliente.safeParse({ ...semPedido, serie: 999 }).success).toBe(true);
    expect(NotaParaCliente.parse({ ...nota, xml: '<nfeProc/>' })).not.toHaveProperty('xml');
  });

  it('NotaParaCliente recusa chave, número, série, emissão, pedido e cliente fora do formato', () => {
    for (const ruim of [
      { chave: '1'.repeat(43) }, { chave: `${'1'.repeat(43)}A` }, { numero: 0 }, { numero: 1.5 }, { serie: -1 }, { serie: 1000 },
      { emissao: '2026-11-23T10:00:00-04:00' }, { pedido_uuid: 'pedido-1' }, { cliente_external_id: '' },
    ]) expect(NotaParaCliente.safeParse({ ...nota, ...ruim }).success).toBe(false);
  });

  it('NotaParaCliente: centavos inteiros ≥ 0, quantidade finita > 0 e pelo menos 1 item', () => {
    for (const campo of ['total_produtos_cents', 'total_desconto_cents', 'total_frete_cents', 'total_impostos_cents', 'total_nota_cents'] as const) {
      expect(NotaParaCliente.safeParse({ ...nota, [campo]: -1 }).success).toBe(false);
      expect(NotaParaCliente.safeParse({ ...nota, [campo]: 19.9 }).success).toBe(false);
    }
    for (const ruim of [
      { quantidade: 0 }, { quantidade: Number.POSITIVE_INFINITY }, { quantidade: '1' }, { valor_unitario_cents: 10.5 },
      { valor_total_cents: -1 }, { numero_item: 0 }, { produto_external_id: '' },
    ]) expect(NotaParaCliente.safeParse({ ...nota, itens: [{ ...item, ...ruim }] }).success).toBe(false);
    expect(NotaParaCliente.safeParse({ ...nota, itens: [] }).success).toBe(false);
  });

  it('CAMINHOS_ENTRADA_V1 congelado, com as 10 rotas da /entrada/v1', () => {
    expect(Object.isFrozen(CAMINHOS_ENTRADA_V1)).toBe(true);
    expect(CAMINHOS_ENTRADA_V1).toEqual({
      lotes: '/entrada/v1/lotes', lote: '/entrada/v1/lotes/:id', cursor: '/entrada/v1/cursores/:entidade', sinal: '/entrada/v1/sinal',
      pedidosPendentes: '/entrada/v1/pedidos/pendentes', pedidoRetorno: '/entrada/v1/pedidos/:uuid/retorno',
      notasPendentes: '/entrada/v1/notas/pendentes', notaRetorno: '/entrada/v1/notas/:chave/retorno',
      clientesPendentes: '/entrada/v1/clientes/pendentes', clienteRetorno: '/entrada/v1/clientes/:uuid/retorno',
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
