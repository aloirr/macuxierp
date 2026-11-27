import { type ClienteEnderecoHub, type ClienteHub, type FilialHub } from '@macuxierp/platform-sdk/hub-v1';
import { describe, expect, it, vi } from 'vitest';
import type { EntidadeCarga } from '../../contracts';
import { LAYOUT, mapearLinha } from '../carga';
import { adaptarCliente, adaptarClienteEndereco, adaptarEstoque, adaptarFilial, adaptarForma, adaptarLote, adaptarPrazoPagamento, adaptarPreco, adaptarProduto, adaptarProdutoUnidade, adaptarVendedor, decidirChaveDaForma, tpagGuardadoDaForma, type ContextoAdaptacao } from './adaptar';

vi.mock('../carga', async (original) => {
  const m = await original<typeof import('../carga')>();
  return { ...m, mapearLinha: vi.fn(m.mapearLinha) };
});

const ctx: ContextoAdaptacao = {
  municipiosDaUf: (uf) => (uf === 'AM' ? [{ ibge: '1302603', nome: 'Manaus' }] : []),
  formas: new Map([['FP1', { codigo: 'BOLETO', nome: 'Boleto bancário' }]]),
};
const ok = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
};
const ruim = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(false);
  return (r as unknown as { erros: { campo: string | null; codigo: string; motivo: string }[] }).erros;
};

const filial: FilialHub = {
  external_id: 'F1', ativo: true, codigo: '01', nome: 'Matriz', cidade: 'Manaus', uf: 'AM', cnpj: '99.000.001/0001-01',
  logradouro: 'Rua Exemplo', numero: '100', bairro: 'Centro', cep: '69000000',
};
const cliente: ClienteHub = {
  external_id: 'C1', ativo: true, razao_social: 'Cliente 1 Ltda', documento: '99.000.002/0001-48', filial_external_id: 'F1', vendedor_external_id: 'V1',
  limite_credito_cents: 100_000, prazo_medio_max_dias: 45, endereco: { logradouro: 'Rua Teste', cidade: 'Manaus', uf: 'AM', cep: '69000-001' },
};
const prazo = { external_id: 'PZ1', ativo: true, forma_external_id: 'FP1', codigo: 'P28', parcelas_dias: '28/56', descricao: '28 e 56 dias' };
const estoque = { external_id: 'E1', ativo: true, deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 10.5, filial_external_id: 'F1' };
const enderecoHub: ClienteEnderecoHub = { external_id: 'CE1', ativo: false, cliente_external_id: 'C1', logradouro: 'Rua Entrega', cidade: 'Manaus', uf: 'AM', tipo: 'entrega', principal: false, cep: '69000-002' };

describe('T-0057 C2: adaptadores do hub-v1 só convertem a forma (a regra é do mapearLinha)', () => {
  it('RN-CAD-08: ativo booleano vira sim/nao e o índice (base 0) vira a linha (base 2)', () => {
    const l = ok(adaptarVendedor({ external_id: 'V1', ativo: false, nome: 'Ana', filial_external_id: 'F1' }, 3, ctx)).linha;
    expect(l).toMatchObject({ linha: 5, external_id: 'V1', ativo: false, dados: { nome: 'Ana' }, refs: { filial: 'F1' } });
  });

  it('RN-CAD-11: dinheiro do Hub (centavos inteiros) vira a célula de centavos', () => {
    const p = { external_id: 'PR1', ativo: true, tabela_external_id: 'T1', tabela_nome: 'Tabela 1', vigencia_inicio: '2026-01-01', produto_external_id: 'P1', preco_cents: 1999 };
    expect(ok(adaptarPreco(p, 0, ctx)).linha).toMatchObject({ preco_centavos: 1999, tabela: { vigencia_fim: null } });
    expect(ok(adaptarCliente(cliente, 0, ctx)).linha.dados).toMatchObject({ limite_credito_centavos: 100_000, prazo_medio_dias: 45 });
  });

  it('RN-CAD-07 e RN-CAD-17: quantidade numérica vira decimal de 4 casas; notação científica e casas demais são recusadas', () => {
    expect(ok(adaptarEstoque(estoque, 0, ctx)).linha.saldo).toBe(105_000);
    expect(ok(adaptarEstoque({ ...estoque, saldo: -2 }, 0, ctx)).linha.saldo).toBe(-20_000);
    expect(ruim(adaptarEstoque({ ...estoque, saldo: 1e-7 }, 0, ctx))).toHaveLength(1);
    expect(ruim(adaptarEstoque({ ...estoque, saldo: 0.00001 }, 0, ctx))).toHaveLength(1);
    const u = { external_id: 'U1', ativo: true, produto_external_id: 'P1', padrao: false };
    expect(ok(adaptarProdutoUnidade({ ...u, unidade: 'KG', fator: 0.25 }, 0, ctx)).linha.dados.fator).toBe(2_500);
  });

  it('RN-CAD-03: o endereço do cliente vira o principal e o do Hub mantém o external_id e não mexe no ativo do cliente', () => {
    expect(ok(adaptarCliente(cliente, 0, ctx)).linha.enderecos).toMatchObject([{ external_id: 'C1:principal', tipo: 'principal', dados: { municipio_ibge: '1302603', cep: '69000001' } }]);
    const l = ok(adaptarClienteEndereco(enderecoHub, 0, ctx)).linha;
    expect(l).toMatchObject({ external_id: 'C1', dados: {}, enderecos: [{ external_id: 'CE1', tipo: 'entrega', dados: { cep: '69000002' } }] });
    expect(l.ativo).toBeUndefined();
    expect(ok(adaptarClienteEndereco({ ...enderecoHub, tipo: 'cobranca', principal: true }, 0, ctx)).linha.enderecos[0]?.tipo).toBe('principal');
  });

  it('RN-INT-01: o erro do mapearLinha atravessa o adaptador com a linha e sem o valor', () => {
    const e = ruim(adaptarFilial({ ...filial, cnpj: '11.111.111/0001-11' }, 4, ctx));
    expect(e[0]).toMatchObject({ linha: 6, codigo: 'RN-CAD-01' });
    expect(JSON.stringify(e)).not.toContain('11.111.111');
  });

  it('RN-CAD-09: a forma do contexto completa o prazo; a forma fora do dicionário vira tPag recusado', () => {
    expect(ok(adaptarPrazoPagamento(prazo, 0, ctx)).linha.dados).toMatchObject({ prazos_dias: [28, 56], forma_external_id: 'FP1', forma_codigo: 'BOLETO', forma_nome: 'Boleto bancário', forma_tpag: '15' });
    expect(adaptarForma({ external_id: 'FP9', ativo: true, codigo: 'CHEQUE', nome: 'Cheque' })).toEqual({ external_id: 'FP9', codigo: 'CHEQUE', nome: 'Cheque', tpag: '99', ativo: true });
  });

  it('RN-CAD-15 e T-0108: prazo sem forma no contexto e sem prazo_medio_dias passa pelo mapearLinha (forma pelo external_id; o prazo médio é calculado na gravação)', () => {
    const l = ok(adaptarPrazoPagamento({ ...prazo, forma_external_id: 'FPX' }, 0, ctx)).linha;
    expect(l.dados).toMatchObject({ forma_external_id: 'FPX', prazos_dias: [28, 56] });
    expect(l.dados.forma_codigo).toBeUndefined();
    expect(l.dados.prazo_medio_dias).toBeUndefined();
  });

  it('RN-CAD-09: a forma é única por (tenant, código): com forma de mesmo código existente a entrada reaproveita o external_id dela e o recebido vira alias', () => {
    expect(decidirChaveDaForma('THA-FOR-1', { external_id: 'FP-EXISTENTE' })).toEqual({ external_id: 'FP-EXISTENTE', alias: true });
    expect(decidirChaveDaForma('THA-FOR-1', { external_id: null })).toEqual({ external_id: null, alias: true });
    expect(decidirChaveDaForma('THA-FOR-1', { external_id: 'THA-FOR-1' })).toEqual({ external_id: 'THA-FOR-1', alias: false });
    expect(decidirChaveDaForma('THA-FOR-1', null)).toEqual({ external_id: 'THA-FOR-1', alias: false });
    const c = { ...ctx, formaCanonica: new Map<string, string | null>([['FP1', 'FP-EXISTENTE'], ['FP2', null]]) };
    expect(ok(adaptarPrazoPagamento(prazo, 0, c)).linha.dados).toMatchObject({ forma_external_id: 'FP-EXISTENTE', forma_codigo: 'BOLETO', forma_tpag: '15' });
    const derivada = ok(adaptarPrazoPagamento({ ...prazo, forma_external_id: 'FP2' }, 0, { ...c, formas: new Map([['FP2', { codigo: 'BOLETO', nome: 'Boleto bancário', tpag: '15' }]]) })).linha.dados;
    expect(derivada.forma_external_id).toBeUndefined();
    expect(derivada).toMatchObject({ forma_codigo: 'BOLETO', forma_tpag: '15' });
  });

  it('RN-CAD-15: parcelas "28/56" na entrada viram a lista de inteiros [28, 56] (e "0" à vista, [0])', () => {
    expect(ok(adaptarPrazoPagamento(prazo, 0, ctx)).linha.dados.prazos_dias).toEqual([28, 56]);
    expect(ok(adaptarPrazoPagamento({ ...prazo, parcelas_dias: '0' }, 0, ctx)).linha.dados.prazos_dias).toEqual([0]);
    // o SDK normaliza "028/56" para "28/56" antes do adaptador; a conversão string -> lista é só do adaptador
    expect(ok(adaptarPrazoPagamento({ ...prazo, parcelas_dias: '028/56' }, 0, ctx)).linha.dados.prazos_dias).toEqual([28, 56]);
  });

  it('RN-INT-06: o envelope de carga completa não é adaptado (a API responde 422)', () => {
    expect(adaptarLote({ entidade: 'filial', modo: 'completo', registros: [filial] }, ctx)).toEqual({
      ok: false, status: 422, codigo: 'CARGA_COMPLETA_NAO_SUPORTADA', motivo: 'Carga completa não aceita: envie só as alterações (delta)',
    });
  });

  it('ADR 0014 §2: titulo e nota ficam fora da fase (422 ENTIDADE_FORA_DA_FASE)', () => {
    expect(adaptarLote({ entidade: 'titulo', modo: 'delta', registros: [] }, ctx)).toEqual({
      ok: false, status: 422, codigo: 'ENTIDADE_FORA_DA_FASE',
      motivo: 'Entidade não aceita: envie filial, vendedor, forma e prazo de pagamento, produto, unidade, preço, estoque, cliente ou endereço do cliente',
    });
  });

  it('adaptarLote valida pelo Zod do SDK e adapta o delta linha a linha; a forma só devolve as formas', () => {
    const r = ok(adaptarLote({ entidade: 'filial', modo: 'delta', registros: [filial, { external_id: 'F2', ativo: true }] }, ctx));
    expect(r.entidade).toBe('filial');
    expect(r.resultados.map((x) => x.ok)).toEqual([true, false]);
    expect(ruim(r.resultados[1] as { ok: boolean }).every((e) => (e as { linha?: number }).linha === 3)).toBe(true);
    const f = ok(adaptarLote({ entidade: 'forma_pagamento', modo: 'delta', registros: [{ external_id: 'FP1', ativo: true, codigo: 'PIX', nome: 'Pix' }] }, ctx));
    expect(f).toMatchObject({ entidade: null, formas: [{ external_id: 'FP1', tpag: '17' }] });
  });

  it('as chaves que cada adaptador manda ao mapearLinha estão em LAYOUT[entidade].usadas', () => {
    const casos: [EntidadeCarga, () => unknown][] = [
      ['filial', () => adaptarFilial({ ...filial, complemento: 'Sala 1' }, 0, ctx)],
      ['vendedor', () => adaptarVendedor({ external_id: 'V1', ativo: true, nome: 'Ana', filial_external_id: 'F1' }, 0, ctx)],
      ['condicao_pagamento', () => adaptarPrazoPagamento(prazo, 0, ctx)],
      ['produto', () => adaptarProduto({ external_id: 'P1', ativo: true, sku: 'S1', nome: 'Parafuso', unidade: 'UN', ean: '7891000100103', marca: 'Acme' }, 0, ctx)],
      ['produto_unidade', () => adaptarProdutoUnidade({ external_id: 'U1', ativo: true, produto_external_id: 'P1', unidade: 'CX', fator: 12, ean: '7891000100103', padrao: true }, 0, ctx)],
      ['preco', () => adaptarPreco({ external_id: 'PR1', ativo: true, tabela_external_id: 'T1', tabela_nome: 'T', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', produto_external_id: 'P1', preco_cents: 1, filial_external_id: 'F1' }, 0, ctx)],
      ['estoque', () => adaptarEstoque(estoque, 0, ctx)],
      ['cliente', () => adaptarCliente({ ...cliente, nome_fantasia: 'C1', inscricao_estadual: 'ISENTO', endereco: { logradouro: 'R', numero: '1', complemento: 'c', bairro: 'b', cidade: 'Manaus', uf: 'AM', cep: '69000001' } }, 0, ctx)],
      ['cliente', () => adaptarClienteEndereco({ ...enderecoHub, numero: '1', complemento: 'c', bairro: 'b' }, 0, ctx)],
    ];
    const spy = vi.mocked(mapearLinha);
    for (const [entidade, chamar] of casos) {
      spy.mockClear();
      chamar();
      const reg = spy.mock.calls[0]?.[1] ?? {};
      const fora = Object.keys(reg).filter((k) => !LAYOUT[entidade].usadas.includes(k));
      expect(fora, entidade).toEqual([]);
    }
  });
});

describe('T-0057 D1/D2 (ADR 0014, emenda de 27/11): crt da filial e ncm do produto vêm da entrada', () => {
  it('ADR 0014: crt e ncm presentes chegam a linha.dados', () => {
    const r = ok(adaptarLote({ entidade: 'filial', modo: 'delta', registros: [{ ...filial, crt: '3' }] }, ctx)).resultados[0] as { linha: { dados: { crt?: string } } };
    expect(r.linha.dados.crt).toBe('3');
    const p = ok(adaptarLote({ entidade: 'produto', modo: 'delta', registros: [{ external_id: 'P1', ativo: true, sku: 'S1', nome: 'Parafuso', unidade: 'UN', ncm: '73181500' }] }, ctx)).resultados[0] as { linha: { dados: { ncm?: string } } };
    expect(p.linha.dados.ncm).toBe('73181500');
  });

  it('RN-CAD-09: tpagGuardadoDaForma guarda o tPag do dicionário e, sem resolução (sentinela 99), devolve nulo para a forma e para as irmãs', () => {
    const forma = (codigo: string) => adaptarForma({ external_id: 'FPX', ativo: true, codigo, nome: 'Forma' });
    expect(tpagGuardadoDaForma(forma('BOLETO'))).toBe('15');
    expect(tpagGuardadoDaForma(forma('boleto'))).toBe('15');
    expect(tpagGuardadoDaForma(forma('CHEQUE'))).toBeNull();
    expect(forma('CHEQUE').tpag).toBe('99'); // o adaptador mantém o sentinela; quem guarda usa a função
  });
});
