import { PAYLOADS_HUB, type ClienteEnderecoHub, type ClienteHub, type FilialHub } from '@macuxierp/platform-sdk/hub-v1';
import { describe, expect, it } from 'vitest';
import { ENTIDADES_ENTRADA, adaptarCliente, adaptarClienteEndereco, adaptarEstoque, adaptarFilial, adaptarForma, adaptarLote, adaptarPrazoPagamento, adaptarPreco, adaptarProduto, adaptarProdutoUnidade, adaptarVendedor, type ContextoAdaptacao } from './adaptar';

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

describe('T-0057 C2: adaptadores do hub-v1 viram a linha da carga (o formato do gravarLinhas)', () => {
  it('cobre as 10 entidades do Hub da F2', () => {
    expect([...ENTIDADES_ENTRADA].sort()).toEqual(Object.keys(PAYLOADS_HUB).sort());
  });

  it('RN-CAD-01 e RN-CAD-03: filial com CNPJ de dígito válido e município pelo nome vigente da UF', () => {
    const l = ok(adaptarFilial(filial, 0, ctx)).linha;
    expect(l).toMatchObject({ linha: 2, external_id: 'F1', dados: { razao_social: 'Matriz' }, endereco: { municipio_ibge: '1302603', uf: 'AM', cep: '69000000' } });
    expect(ruim(adaptarFilial({ ...filial, cnpj: '11.111.111/0001-11' }, 0, ctx)).some((e) => e.codigo === 'RN-CAD-01')).toBe(true);
    expect(ruim(adaptarFilial({ ...filial, cidade: 'Lugar Nenhum' }, 0, ctx)).some((e) => e.codigo === 'RN-CAD-03')).toBe(true);
  });

  it('RN-CAD-08: ativo=false do Hub inativa (não apaga); o índice vira a linha (base 0 → 2)', () => {
    const l = ok(adaptarVendedor({ external_id: 'V1', ativo: false, nome: 'Ana', filial_external_id: 'F1' }, 3, ctx)).linha;
    expect(l).toMatchObject({ linha: 5, external_id: 'V1', ativo: false, dados: { nome: 'Ana' }, refs: { filial: 'F1' } });
  });

  it('RN-CAD-09: o prazo vira condição com a forma do contexto; a forma fora do contexto segue só pelo external_id', () => {
    const p = { external_id: 'PZ1', ativo: true, forma_external_id: 'FP1', codigo: 'P28', parcelas_dias: '28/56', descricao: '28 e 56 dias' };
    const l = ok(adaptarPrazoPagamento(p, 0, ctx)).linha;
    expect(l.dados).toMatchObject({ codigo: 'P28', prazos_dias: [28, 56], forma_external_id: 'FP1', forma_codigo: 'BOLETO', forma_nome: 'Boleto bancário', forma_tpag: '15' });
    const sem = ok(adaptarPrazoPagamento({ ...p, forma_external_id: 'FPX' }, 0, ctx)).linha;
    expect(sem.dados.forma_external_id).toBe('FPX');
    expect(sem.dados.forma_codigo).toBeUndefined();
  });

  it('RN-CAD-09: forma fora das quatro aceitas vira tPag recusado (a gravação a recusa); a forma sozinha só alimenta o contexto', () => {
    const f = ok(adaptarForma({ external_id: 'FP9', ativo: true, codigo: 'CHEQUE', nome: 'Cheque' }));
    expect(f.forma).toEqual({ external_id: 'FP9', codigo: 'CHEQUE', nome: 'Cheque', tpag: '99', ativo: true });
    const pz = ok(adaptarPrazoPagamento({ external_id: 'PZ9', ativo: true, forma_external_id: 'FP9', codigo: 'P0', parcelas_dias: '0' }, 0, { ...ctx, formas: new Map([['FP9', { codigo: 'CHEQUE', nome: 'Cheque' }]]) })).linha;
    expect(pz.dados.forma_tpag).toBe('99');
  });

  it('RN-CAD-15: à vista é "0" e prazo com dia acima de 365 é recusado', () => {
    expect(ok(adaptarPrazoPagamento({ external_id: 'PZ0', ativo: true, forma_external_id: 'FP1', codigo: 'AV', parcelas_dias: '0' }, 0, ctx)).linha.dados.prazos_dias).toEqual([0]);
    expect(ruim(adaptarPrazoPagamento({ external_id: 'PZ1', ativo: true, forma_external_id: 'FP1', codigo: 'LONGO', parcelas_dias: '400' }, 0, ctx)).length).toBeGreaterThan(0);
  });

  it('RN-CAD-04 e RN-CAD-11: produto sem custo nem preço de venda (M8); a unidade vai em maiúsculas', () => {
    const l = ok(adaptarProduto({ external_id: 'P1', ativo: true, sku: 'SKU1', nome: 'Parafuso', unidade: 'UN', ean: '7891000100103', marca: 'Acme' }, 0, ctx)).linha;
    expect(l).toMatchObject({ external_id: 'P1', dados: { codigo: 'SKU1', descricao: 'Parafuso', unidade_comercial: 'UN', ean: '7891000100103', marca: 'Acme' } });
    expect(l.dados.custo_centavos).toBeUndefined();
  });

  it('RN-CAD-12 e RN-CAD-17: fator de embalagem na escala de 4 casas; fracionário só em KG e M', () => {
    const base = { external_id: 'U1', ativo: true, produto_external_id: 'P1', padrao: false };
    expect(ok(adaptarProdutoUnidade({ ...base, unidade: 'CX', fator: 12 }, 0, ctx)).linha.dados.fator).toBe(120_000);
    expect(ok(adaptarProdutoUnidade({ ...base, unidade: 'KG', fator: 0.25 }, 0, ctx)).linha.dados.fator).toBe(2_500);
    expect(ruim(adaptarProdutoUnidade({ ...base, unidade: 'CX', fator: 1.5 }, 0, ctx)).some((e) => e.codigo === 'RN-CAD-17')).toBe(true);
  });

  it('RN-CAD-06 e RN-CAD-11: preço em centavos inteiros, vigência civil e filial opcional (sem filial = todas)', () => {
    const p = { external_id: 'PR1', ativo: true, tabela_external_id: 'T1', tabela_nome: 'Tabela 1', vigencia_inicio: '2026-01-01', produto_external_id: 'P1', preco_cents: 1999 };
    const l = ok(adaptarPreco(p, 0, ctx)).linha;
    expect(l).toMatchObject({ preco_centavos: 1999, tabela: { external_id: 'T1', vigencia_inicio: '2026-01-01', vigencia_fim: null }, refs: { produto: 'P1' } });
    expect(l.refs.filial).toBeUndefined();
    expect(ruim(adaptarPreco({ ...p, vigencia_fim: '2025-12-31' }, 0, ctx)).length).toBeGreaterThan(0);
  });

  it('RN-CAD-07: estoque aceita saldo fracionário (4 casas) e negativo chega à linha (a permissão é da gravação)', () => {
    const e = { external_id: 'E1', ativo: true, deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 10.5, filial_external_id: 'F1' };
    expect(ok(adaptarEstoque(e, 0, ctx)).linha).toMatchObject({ saldo: 105_000, refs: { produto: 'P1', filial: 'F1' } });
    expect(ok(adaptarEstoque({ ...e, saldo: -2 }, 0, ctx)).linha.saldo).toBe(-20_000);
    expect(ruim(adaptarEstoque({ ...e, saldo: 0.00001 }, 0, ctx)).length).toBeGreaterThan(0);
  });

  it('RN-CAD-01, RN-CAD-02 e RN-CAD-16: cliente com documento válido, endereço principal, limite em centavos e prazo médio', () => {
    const l = ok(adaptarCliente(cliente, 0, ctx)).linha;
    expect(l).toMatchObject({
      external_id: 'C1', dados: { tipo_pessoa: 'PJ', limite_credito_centavos: 100_000, prazo_medio_dias: 45 },
      refs: { filial: 'F1', vendedor: 'V1' },
      enderecos: [{ external_id: 'C1:principal', tipo: 'principal', dados: { municipio_ibge: '1302603', cep: '69000001' } }],
    });
    expect(ruim(adaptarCliente({ ...cliente, documento: '11.111.111/1111-11' }, 0, ctx)).some((e) => e.codigo === 'RN-CAD-01')).toBe(true);
    expect(ruim(adaptarCliente({ ...cliente, inscricao_estadual: '123' }, 0, ctx)).some((e) => e.codigo === 'RN-CAD-02')).toBe(true);
  });

  it('RN-CAD-03: o endereço do Hub vira endereço do cliente com o external_id dele e não mexe nos dados nem no ativo do cliente', () => {
    const e: ClienteEnderecoHub = { external_id: 'CE1', ativo: false, cliente_external_id: 'C1', logradouro: 'Rua Entrega', cidade: 'Manaus', uf: 'AM', tipo: 'entrega', principal: false, cep: '69000-002' };
    const l = ok(adaptarClienteEndereco(e, 0, ctx)).linha;
    expect(l.external_id).toBe('C1');
    expect(l.ativo).toBeUndefined();
    expect(l.dados).toEqual({});
    expect(l.enderecos).toMatchObject([{ external_id: 'CE1', tipo: 'entrega', dados: { municipio_ibge: '1302603', cep: '69000002' } }]);
    expect(ok(adaptarClienteEndereco({ ...e, tipo: 'cobranca', principal: true }, 0, ctx)).linha.enderecos[0]?.tipo).toBe('principal');
  });

  it('RN-INT-01: o erro por linha cita só o campo e o código, nunca o valor', () => {
    const e = ruim(adaptarFilial({ ...filial, cnpj: '11.111.111/0001-11' }, 0, ctx));
    expect(JSON.stringify(e)).not.toContain('11.111.111');
  });

  it('RN-INT-06: o envelope de carga completa não é adaptado (a API responde 422)', () => {
    const r = adaptarLote({ entidade: 'filial', modo: 'completo', registros: [filial] }, ctx);
    expect(r).toEqual({ ok: false, status: 422, codigo: 'carga_completa_nao_suportada', motivo: expect.any(String) });
  });

  it('ADR 0014 §2: titulo e nota ficam fora da fase (422 entidade_fora_da_fase)', () => {
    const r = adaptarLote({ entidade: 'titulo', modo: 'delta', registros: [] }, ctx);
    expect(r).toMatchObject({ ok: false, status: 422, codigo: 'entidade_fora_da_fase' });
  });

  it('adaptarLote valida o payload pelo Zod do SDK e adapta o delta linha a linha', () => {
    const r = ok(adaptarLote({ entidade: 'filial', modo: 'delta', registros: [filial, { external_id: 'F2', ativo: true }] }, ctx));
    expect(r.entidade).toBe('filial');
    expect(r.resultados.map((x) => x.ok)).toEqual([true, false]);
    const erros = ruim(r.resultados[1] as { ok: boolean });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros.every((e) => (e as { linha?: number }).linha === 3)).toBe(true);
  });

  it('adaptarLote de forma_pagamento só devolve as formas para o contexto dos prazos', () => {
    const r = ok(adaptarLote({ entidade: 'forma_pagamento', modo: 'delta', registros: [{ external_id: 'FP1', ativo: true, codigo: 'PIX', nome: 'Pix' }] }, ctx));
    expect(r.entidade).toBeNull();
    expect(r.formas).toEqual([{ external_id: 'FP1', codigo: 'PIX', nome: 'Pix', tpag: '17', ativo: true }]);
  });
});
