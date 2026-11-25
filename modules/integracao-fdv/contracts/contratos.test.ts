import * as sdk from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import * as c from './index';
import { CorpoLote, CredencialEntrada, CredencialResumo, MonitorResposta, ENTIDADES_CARGA_INICIAL, EVENTOS, EVENTO_CARGA_INICIAL, EVENTO_LOTE_FALHOU, LinhaInvalida, LinhaInvalidaHub, ProdutoUnidadeHub, EstoqueHub, PrazoPagamentoHub, PrazoPagamentoHubV2, PRAZO_CONTRATO_V2_LIGADO, ClienteHub } from './index';

const corpo = { versao_contrato: 'v1', entidade: 'produto', enviado_em: '2026-11-21T20:00:00.000Z', cursor: null, registros: [], linhas_invalidas: [], linhas_invalidas_omitidas: 0 };

describe('contratos do módulo', () => {
  it('RF-INF-02: completo exige sessão; delta não tem sessão', () => {
    const sessao = { id: '11111111-1111-4111-8111-111111111111', parte: 1, ultimo: true };
    expect(CorpoLote.safeParse({ ...corpo, modo: 'completo' }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'completo', sessao }).success).toBe(true);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'delta', sessao }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'delta' }).success).toBe(true);
  });

  it('RN-INF-04: campo do erro segue o formato do banco', () => {
    const l = (campo: string | null) => LinhaInvalida.safeParse({ external_id: 'a', codigo: 'campo_invalido', campo }).success;
    expect(l('endereco.cidade')).toBe(true);
    expect(l('itens[0]')).toBe(true);
    expect(l(null)).toBe(true);
    expect(l('com espaço')).toBe(false);
    expect(l('x'.repeat(81))).toBe(false);
  });

  it('RF-INF-05: chave da credencial sem espaço e com no mínimo 32 caracteres', () => {
    const c = (chave: string) => CredencialEntrada.safeParse({ conector_id: 'erp-1', chave, ambiente: 'teste' }).success;
    expect(c('a'.repeat(32))).toBe(true);
    expect(c('a'.repeat(31))).toBe(false);
    expect(c(`${'a'.repeat(32)} b`)).toBe(false);
  });

  it('C-4: carga inicial pede lista explícita; lote.falhou traz o estado', () => {
    expect(EVENTOS[EVENTO_CARGA_INICIAL].safeParse({ entidades: [] }).success).toBe(false);
    expect(EVENTOS[EVENTO_CARGA_INICIAL].safeParse({ entidades: ['preco', 'tabela_preco'] }).success).toBe(true);
    expect(ENTIDADES_CARGA_INICIAL).toHaveLength(12);
    const f = { lote_envio_id: '11111111-1111-4111-8111-111111111111', entidade: 'produto', modo: 'delta', geracao: 1, codigo: 'rede', tentativas: 3, falhou_em: '2026-11-21T20:00:00.000Z' };
    expect(EVENTOS[EVENTO_LOTE_FALHOU].safeParse({ ...f, estado: 'recusado' }).success).toBe(true);
    expect(EVENTOS[EVENTO_LOTE_FALHOU].safeParse({ ...f, estado: 'concluido' }).success).toBe(false);
  });

  it('P-1 (conferido no FDV): linha inválida leva mensagem e código do conjunto do Hub; quantidade é número', () => {
    const l = { external_id: 'a', codigo: 'campo_obrigatorio', campo: 'nome', mensagem: 'Campo obrigatório vazio.' };
    expect(LinhaInvalidaHub.safeParse(l).success).toBe(true);
    expect(LinhaInvalidaHub.safeParse({ ...l, mensagem: undefined }).success).toBe(false);
    expect(LinhaInvalidaHub.safeParse({ ...l, codigo: 'referencia_ausente' }).success).toBe(false);
    expect(LinhaInvalidaHub.safeParse({ ...l, mensagem: 'x'.repeat(301) }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...corpo, modo: 'delta', linhas_invalidas: [{ external_id: 'a', codigo: 'campo_obrigatorio', campo: 'nome' }] }).success).toBe(false);
    const un = { external_id: 'u', ativo: true, produto_external_id: 'p', unidade: 'CX', padrao: true };
    expect(ProdutoUnidadeHub.safeParse({ ...un, fator: 12 }).success).toBe(true);
    expect(ProdutoUnidadeHub.safeParse({ ...un, fator: '12' }).success).toBe(false);
    const es = { external_id: 'e', ativo: true, deposito_external_id: 'd', produto_external_id: 'p', filial_external_id: 'f' };
    expect(EstoqueHub.safeParse({ ...es, saldo: -1.5 }).success).toBe(true);
    expect(EstoqueHub.safeParse({ ...es, saldo: '1.5' }).success).toBe(false);
  });

  it('RF-INF-05: o resumo da credencial nunca devolve a chave', () => {
    expect(Object.keys(CredencialResumo.shape)).not.toContain('chave');
    expect(Object.keys(CredencialResumo.shape)).not.toContain('chave_cifrada');
  });

  it('RF-INF-04: a resposta do monitor não tem campo de mensagem crua nem de chave', () => {
    const ch = Object.keys(MonitorResposta.shape);
    expect(ch).toEqual(['credencial', 'configuracao', 'sinal', 'entidades', 'erros', 'conflitos']);
  });
});

describe('T-0086: tipos do SDK reexportados sem duplicar', () => {
  it('CodigoErro, CampoErro e a versão do conector são os do SDK (uma só fonte)', () => {
    expect(c.CodigoErro).toBe(sdk.CodigoErroFdv);
    expect(c.CampoErro).toBe(sdk.CampoErroFdv);
    expect(c.CorpoSinal.shape.versao_conector).toBe(sdk.VersaoConectorFdv);
  });
});


/** Fixture do contrato do Hub v2 do prazo (ADR 0072 do FDV): os limites são os do contrato, um a um. */
const PRAZO_V2 = { external_id: 'PZ-1', alterado_em: '2026-11-24T20:00:00.000Z', codigo: '28-56', forma_external_id: 'FP-1', descricao: '28 e 56 dias', parcelas_dias: [28, 56], prazo_medio_dias: 42 };
const PRAZO_V1 = { external_id: 'PZ-1', ativo: true, codigo: '28-56', forma_external_id: 'FP-1', descricao: '28 e 56 dias', parcelas_dias: [28, 56], prazo_medio_dias: 42 };

describe('T-0085 lote 2: prazo no Hub', () => {
  it('T-0105: o prazo sai em v2', () => {
    expect(PRAZO_CONTRATO_V2_LIGADO).toBe(true);
  });

  it('v1: descricao (1 a 60) e prazo_medio_dias (0 a 365) são obrigatórios', () => {
    const v1 = (o: Record<string, unknown>) => PrazoPagamentoHub.safeParse({ ...PRAZO_V1, ...o }).success;
    expect(v1({})).toBe(true);
    expect(PrazoPagamentoHub.safeParse({ ...PRAZO_V1, descricao: undefined }).success).toBe(false);
    expect(PrazoPagamentoHub.safeParse({ ...PRAZO_V1, prazo_medio_dias: undefined }).success).toBe(false);
    expect(v1({ descricao: 'x'.repeat(61) })).toBe(false);
    expect(v1({ prazo_medio_dias: 366 })).toBe(false);
  });

  it('v2 válida: obrigatórios; ativo, ordem e percentual_ajuste opcionais', () => {
    expect(PrazoPagamentoHubV2.safeParse(PRAZO_V2).success).toBe(true);
    expect(PrazoPagamentoHubV2.safeParse({ ...PRAZO_V2, ativo: false, ordem: 3, percentual_ajuste: -2.5 }).success).toBe(true);
    expect(PrazoPagamentoHubV2.safeParse({ ...PRAZO_V2, parcelas_dias: [0], prazo_medio_dias: 0 }).success).toBe(true); // à vista
  });

  it('v2 inválida em cada limite', () => {
    const v2 = (o: Record<string, unknown>) => PrazoPagamentoHubV2.safeParse({ ...PRAZO_V2, ...o }).success;
    for (const campo of ['external_id', 'alterado_em', 'codigo', 'forma_external_id', 'descricao', 'parcelas_dias', 'prazo_medio_dias']) {
      expect(PrazoPagamentoHubV2.safeParse({ ...PRAZO_V2, [campo]: undefined }).success, `${campo} é obrigatório`).toBe(false);
    }
    expect(v2({ codigo: '' })).toBe(false);
    expect(v2({ codigo: 'x'.repeat(20) })).toBe(true);
    expect(v2({ codigo: 'x'.repeat(21) })).toBe(false);
    expect(v2({ descricao: 'x'.repeat(60) })).toBe(true);
    expect(v2({ descricao: 'x'.repeat(61) })).toBe(false);
    expect(v2({ parcelas_dias: [] })).toBe(false);
    expect(v2({ parcelas_dias: Array.from({ length: 24 }, (_, i) => i), prazo_medio_dias: 12 })).toBe(true);
    expect(v2({ parcelas_dias: Array.from({ length: 25 }, (_, i) => i), prazo_medio_dias: 12 })).toBe(false);
    expect(v2({ parcelas_dias: [365], prazo_medio_dias: 365 })).toBe(true);
    expect(v2({ parcelas_dias: [366], prazo_medio_dias: 366 })).toBe(false);
    expect(v2({ parcelas_dias: [-1], prazo_medio_dias: 0 })).toBe(false);
    expect(v2({ parcelas_dias: [28.5], prazo_medio_dias: 28 })).toBe(false);
    expect(v2({ parcelas_dias: [56, 28] })).toBe(false); // decrescente
    expect(v2({ parcelas_dias: [28, 28, 56] })).toBe(true); // iguais não decrescem
    expect(v2({ prazo_medio_dias: 27 })).toBe(false); // abaixo da menor parcela
    expect(v2({ prazo_medio_dias: 57 })).toBe(false); // acima da maior
    expect(v2({ prazo_medio_dias: 28 })).toBe(true);
    expect(v2({ prazo_medio_dias: 56 })).toBe(true);
    expect(v2({ alterado_em: '24/11/2026' })).toBe(false);
  });

  it('envelope v2 só para prazo_pagamento', () => {
    const c = { ...corpo, modo: 'delta' };
    expect(CorpoLote.safeParse({ ...c, versao_contrato: 'v2', entidade: 'prazo_pagamento' }).success).toBe(true);
    expect(CorpoLote.safeParse({ ...c, versao_contrato: 'v2', entidade: 'produto' }).success).toBe(false);
    expect(CorpoLote.safeParse({ ...c, versao_contrato: 'v3', entidade: 'prazo_pagamento' }).success).toBe(false);
  });

  it('RN-CAD-16: o cliente leva prazo_medio_max_dias e não leva mais formas_pagamento', () => {
    const cli = { external_id: 'C1', ativo: true, razao_social: 'X', filial_external_id: 'F1', limite_credito_cents: 0, prazo_medio_max_dias: 30 };
    expect(ClienteHub.strict().safeParse(cli).success).toBe(true);
    expect(ClienteHub.strict().safeParse({ ...cli, formas_pagamento: ['BOLETO'] }).success).toBe(false);
  });
});
