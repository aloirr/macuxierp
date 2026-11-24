import { describe, expect, it } from 'vitest';
import type { ClienteEnderecoHub, ClienteHub, FormaPagamentoHub } from '@macuxierp/platform-sdk/hub-v1';
import { adaptarLote, indexarFormas, type ContextoAdaptacao } from './adaptar';

const forma = (o: Partial<FormaPagamentoHub> = {}): FormaPagamentoHub => ({ external_id: 'F1', ativo: true, codigo: 'BOLETO', nome: 'Boleto bancário', ...o });
const ctx: ContextoAdaptacao = {
  municipiosDaUf: (uf) => (uf === 'AM' ? [{ ibge: '1302603', nome: 'Manaus' }] : []),
  formas: indexarFormas([forma()]),
};
const base = { external_id: 'X1', ativo: true, alterado_em: '2026-11-23T14:00:00.000Z' };

describe('adaptador do registro do Hub para a linha da carga', () => {
  it('RN-INT-01: entidade fora da fase (titulo, nota ou desconhecida) recusa o lote com entidade_fora_da_fase', () => {
    for (const e of ['titulo', 'nota', 'catalogo_no', 'rota']) {
      expect(adaptarLote(e, [{ ...base }], ctx)).toEqual({ ok: false, codigo: 'entidade_fora_da_fase' });
    }
  });

  it('RN-CAD-01/03: a filial do Hub vira a linha de filial da carga (nome vira razao_social, CNPJ e município validados pela carga)', () => {
    const r = adaptarLote('filial', [{ ...base, codigo: '01', nome: 'Matriz', cidade: 'Manaus', uf: 'AM', cnpj: '11.222.333/0001-81', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cep: '69000000' }], ctx);
    expect(r.ok && r.entidade_carga).toBe('filial');
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([]);
    expect(r.linhas).toHaveLength(1);
    const l = r.linhas[0] as { linha: number; external_id: string; ativo?: boolean; dados: Record<string, unknown>; endereco?: Record<string, unknown> };
    expect(l).toMatchObject({ linha: 2, external_id: 'X1', ativo: true, dados: { cnpj: '11222333000181', razao_social: 'Matriz' }, endereco: { municipio_ibge: '1302603', cep: '69000000', uf: 'AM' } });
  });

  it('RN-CAD-01: CNPJ com dígito errado vira erro regra_invalida com indice, external_id e campo, sem o valor', () => {
    const r = adaptarLote('filial', [{ ...base, codigo: '01', nome: 'Matriz', cnpj: '11222333000199' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.linhas).toEqual([]);
    expect(r.erros).toEqual([{ indice: 0, external_id: 'X1', campo: 'cnpj', codigo: 'regra_invalida', regra: 'RN-CAD-01' }]);
    expect(JSON.stringify(r.erros)).not.toContain('11222333000199');
  });

  it('RN-INT-03: o erro leva o índice do registro no lote (base 0) e os válidos seguem', () => {
    const r = adaptarLote('vendedor', [{ ...base, external_id: 'V1', nome: 'Ana' }, { ...base, external_id: 'V2' }, { ...base, external_id: 'V3', nome: 'Rui', filial_external_id: 'F1' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.linhas.map((l) => l.external_id)).toEqual(['V1', 'V3']);
    expect(r.linhas.map((l) => l.linha)).toEqual([2, 4]);
    expect(r.erros).toEqual([{ indice: 1, external_id: 'V2', campo: 'nome', codigo: 'campo_obrigatorio' }]);
    expect(r.protegidos).toEqual(['V2']);
  });

  it('RN-INT-03: registro sem external_id legível entra no erro com external_id nulo e não protege ninguém', () => {
    const r = adaptarLote('vendedor', [{ ativo: true, nome: 'Ana' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([{ indice: 0, external_id: null, campo: 'external_id', codigo: 'campo_obrigatorio' }]);
    expect(r.protegidos).toEqual([]);
  });

  it('RN-INT-09: campo de tipo errado no registro é tipo_invalido, sem o valor', () => {
    const r = adaptarLote('vendedor', [{ ...base, nome: 12345 }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([{ indice: 0, external_id: 'X1', campo: 'nome', codigo: 'tipo_invalido' }]);
  });

  it('RN-CAD-09: prazo + forma viram UMA linha de condição (a forma vem do contexto), com o tPag do dicionário da carga', () => {
    const r = adaptarLote('prazo_pagamento', [{ ...base, external_id: 'P1', forma_external_id: 'F1', codigo: '28D', parcelas_dias: '28/56', descricao: '28 e 56 dias' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.entidade_carga).toBe('condicao_pagamento');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ external_id: 'P1', dados: { codigo: '28D', prazos_dias: [28, 56], forma_external_id: 'F1', forma_codigo: 'BOLETO', forma_nome: 'Boleto bancário', forma_tpag: '15' } });
  });

  it('RN-CAD-09: prazo à vista ("0") com forma Dinheiro passa pela regra da carga', () => {
    const c = { ...ctx, formas: indexarFormas([forma({ codigo: 'DINHEIRO', nome: 'Dinheiro' })]) };
    const r = adaptarLote('prazo_pagamento', [{ ...base, forma_external_id: 'F1', codigo: 'AV', parcelas_dias: '0' }], c);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ dados: { prazos_dias: [0], forma_tpag: '01' } });
  });

  it('RN-INT-03: prazo cuja forma não está no contexto é referencia_ausente em forma_external_id', () => {
    const r = adaptarLote('prazo_pagamento', [{ ...base, forma_external_id: 'NAO', codigo: '30', parcelas_dias: '30' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.linhas).toEqual([]);
    expect(r.erros).toEqual([{ indice: 0, external_id: 'X1', campo: 'forma_external_id', codigo: 'referencia_ausente' }]);
  });

  it('RN-CAD-09: a forma de pagamento sozinha não gera linha (ela entra na condição pelo prazo) mas é validada', () => {
    const r = adaptarLote('forma_pagamento', [forma(), { ...base, external_id: 'F2', codigo: 'PIX' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.entidade_carga).toBe('condicao_pagamento');
    expect(r.linhas).toEqual([]);
    expect(r.erros).toEqual([{ indice: 1, external_id: 'F2', campo: 'nome', codigo: 'campo_obrigatorio' }]);
  });

  it('RN-CAD-09: indexarFormas guarda por external_id e ignora a forma inativa', () => {
    const m = indexarFormas([forma(), forma({ external_id: 'F2', ativo: false })]);
    expect([...m.keys()]).toEqual(['F1']);
  });

  it('RN-CAD-04: o produto do Hub vira linha de produto (sku vira codigo, nome vira descricao, unidade em maiúsculas)', () => {
    const r = adaptarLote('produto', [{ ...base, sku: 'P-1', nome: 'Parafuso', unidade: 'UN', marca: 'Acme', ean: '7891234567895' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ external_id: 'X1', ativo: true, dados: { codigo: 'P-1', descricao: 'Parafuso', unidade_comercial: 'UN', marca: 'Acme' } });
  });

  it('RN-CAD-04: o erro do contrato sai com o nome do campo do Hub (sku, nome), não o da carga', () => {
    const r = adaptarLote('produto', [{ ...base, sku: 'S'.repeat(61), nome: 'Parafuso', unidade: 'UN' }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([{ indice: 0, external_id: 'X1', campo: 'sku', codigo: 'valor_fora_da_faixa' }]);
  });

  it('RN-CAD-04: unidade do produto com fator fracionário é recusada pela regra da carga (fator inteiro de 1 a 9999)', () => {
    const r = adaptarLote('produto_unidade', [{ ...base, produto_external_id: 'P1', unidade: 'CX', fator: 0.5, padrao: false }, { ...base, external_id: 'U2', produto_external_id: 'P1', unidade: 'DZ', fator: 12, padrao: false }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([{ indice: 0, external_id: 'X1', campo: 'fator', codigo: 'formato_invalido', regra: 'CARGA_FORMATO' }]);
    expect(r.linhas[0]).toMatchObject({ external_id: 'U2', refs: { produto: 'P1' }, dados: { unidade: 'DZ', fator: 120_000 } });
  });

  it('RN-CAD-06: o preço em centavos e as datas vão como estão; o filial ausente vale para todas', () => {
    const r = adaptarLote('preco', [{ ...base, tabela_external_id: 'T1', tabela_nome: 'Varejo', vigencia_inicio: '2026-01-01', produto_external_id: 'P1', preco_cents: 1990 }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ preco_centavos: 1990, tabela: { external_id: 'T1', nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: null }, refs: { produto: 'P1' } });
  });

  it('RN-CAD-06: vigência fim antes do início é recusada pela regra da carga', () => {
    const r = adaptarLote('preco', [{ ...base, tabela_external_id: 'T1', tabela_nome: 'V', vigencia_inicio: '2026-02-01', vigencia_fim: '2026-01-01', produto_external_id: 'P1', preco_cents: 100 }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros[0]).toMatchObject({ indice: 0, codigo: 'regra_invalida', regra: 'RN-CAD-06' });
  });

  it('RN-CAD-07: o saldo numérico do Hub vira a quantidade da carga (3 casas não é ambíguo; mais de 4 casas é recusado)', () => {
    const e = (saldo: number, id: string) => ({ ...base, external_id: id, deposito_external_id: 'D1', produto_external_id: 'P1', saldo, filial_external_id: 'F1' });
    const r = adaptarLote('estoque', [e(1.234, 'E1'), e(10, 'E2'), e(-2.5, 'E3'), e(0.00001, 'E4')], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.linhas.map((l) => (l as { saldo: number }).saldo)).toEqual([12_340, 100_000, -25_000]);
    expect(r.erros).toEqual([{ indice: 3, external_id: 'E4', campo: 'saldo', codigo: 'formato_invalido', regra: 'CARGA_FORMATO' }]);
  });

  it('RN-CAD-01/02/03: o cliente do Hub vira uma linha com o endereço principal embutido (endereco.*) e as referências', () => {
    const c: ClienteHub = { ...base, external_id: 'C1', razao_social: 'Mercado Sol', documento: '529.982.247-25', filial_external_id: 'F1', vendedor_external_id: 'V1', limite_credito_cents: 500_000, formas_pagamento: ['BOLETO'], endereco: { logradouro: 'Rua B', cidade: 'Manaus', uf: 'AM', cep: '69000-000' } };
    const r = adaptarLote('cliente', [c], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({
      external_id: 'C1', dados: { tipo_pessoa: 'PF', documento: '52998224725', razao_social: 'Mercado Sol', limite_credito_centavos: 500_000 },
      refs: { filial: 'F1', vendedor: 'V1' },
      enderecos: [{ external_id: 'C1:principal', tipo: 'principal', dados: { municipio_ibge: '1302603', cep: '69000000' } }],
    });
  });

  it('RN-CAD-01: documento inválido do cliente não leva o valor ao erro', () => {
    const r = adaptarLote('cliente', [{ ...base, external_id: 'C1', razao_social: 'X', documento: '52998224700', filial_external_id: 'F1', limite_credito_cents: 0 }], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([{ indice: 0, external_id: 'C1', campo: 'documento', codigo: 'regra_invalida', regra: 'RN-CAD-01' }]);
    expect(JSON.stringify(r.erros)).not.toContain('52998224700');
  });

  const end = (o: Partial<ClienteEnderecoHub> = {}): ClienteEnderecoHub => ({ ...base, external_id: 'E1', cliente_external_id: 'C1', logradouro: 'Rua C', cidade: 'Manaus', uf: 'AM', tipo: 'entrega', principal: false, ...o });

  it('RN-CAD-03 (T-0058): o endereço do Hub vira uma linha de cliente (external_id do cliente, tipo_endereco) sem dados nem ativo do cliente', () => {
    const r = adaptarLote('cliente_endereco', [end()], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.entidade_carga).toBe('cliente');
    expect(r.erros).toEqual([]);
    const l = r.linhas[0] as { external_id: string; ativo?: boolean; dados: Record<string, unknown>; enderecos: { external_id: string; tipo: string; seq?: number }[] };
    expect(l.external_id).toBe('C1');
    expect(l.ativo).toBeUndefined();
    expect(l.dados).toEqual({});
    expect(l.enderecos).toMatchObject([{ external_id: 'C1:entrega', tipo: 'entrega', dados: { municipio_ibge: '1302603' } }]);
  });

  it('RN-CAD-03 (T-0058): vários endereços do mesmo tipo e cliente no lote ganham seq 2, 3... (o 1º fica sem seq)', () => {
    const r = adaptarLote('cliente_endereco', [end(), end({ external_id: 'E2' }), end({ external_id: 'E3' }), end({ external_id: 'E4', tipo: 'cobranca' })], ctx);
    if (!r.ok) throw new Error('esperava ok');
    const ids = r.linhas.map((l) => (l as { enderecos: { external_id: string }[] }).enderecos[0]?.external_id);
    expect(ids).toEqual(['C1:entrega', 'C1:entrega:2', 'C1:entrega:3', 'C1:cobranca']);
  });

  it('RN-CAD-03: endereço inativo no Hub não vira linha (a carga não tem ativo por endereço) e sai como aviso', () => {
    const r = adaptarLote('cliente_endereco', [end({ ativo: false })], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.linhas).toEqual([]);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([{ indice: 0, external_id: 'E1', codigo: 'endereco_inativo_ignorado' }]);
  });

  it('RN-INT-03: endereço com município inexistente na UF é recusado (RN-CAD-03) sem o nome da cidade', () => {
    const r = adaptarLote('cliente_endereco', [end({ cidade: 'Cidade Fantasma' })], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.erros).toEqual([{ indice: 0, external_id: 'E1', campo: 'cidade', codigo: 'regra_invalida', regra: 'RN-CAD-03' }]);
    expect(JSON.stringify(r.erros)).not.toContain('Fantasma');
  });

  it('RN-INT-03: o erro de endereço protege o external_id do cliente (a chave que a sessão de carga usa)', () => {
    const r = adaptarLote('cliente_endereco', [end({ cidade: 'Cidade Fantasma' })], ctx);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.protegidos).toEqual(['C1']);
  });
});
