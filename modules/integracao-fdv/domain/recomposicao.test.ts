import { describe, expect, it } from 'vitest';
import { mapearCliente, mapearEstoque, mapearFilial, mapearPreco, mapearVendedor, validarRegistro, type EventoCliente } from './mapeamento';
import { ALVO_DA_CHAVE_REFS, CHAVE_FONTE_REFS, assinaturaDaReferenciaTabela, assinaturaDaTabela, assinaturaDeDerivados, recomporRegistro, tabelaDaReferencia, type FontesRecomposicao } from './recomposicao';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EM = '2026-11-21T20:00:00.123Z';
const end = { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000000', pais_bacen: '1058', municipio_nome: 'Manaus' };

const semFontes: FontesRecomposicao = { chave: () => null, tabela: () => null, filialPadraoId: null, nomeFilial: () => null, condicao: () => null };
const comFontes = (o: Partial<FontesRecomposicao>): FontesRecomposicao => ({ ...semFontes, ...o });

describe('RN-INF-02: chaves cruzadas pelo external_id da carga (23h22)', () => {
  it('vendedor aponta para a filial pela chave do Hub; sem a filial no espelho vale o UUID do ERP', () => {
    const v = mapearVendedor({ id: U(5), codigo: 'V1', nome: 'Ana', filial_id: U(1), usuario_id: null, external_id: 'VEN-5', inativo: false }, EM);
    expect(v.external_id).toBe('VEN-5');
    expect(recomporRegistro(v, semFontes).payload.filial_external_id).toBe(U(1));
    const r = recomporRegistro(v, comFontes({ chave: (e, id) => (e === 'filial' && id === U(1) ? 'FIL-01' : null) }));
    expect(r.payload.filial_external_id).toBe('FIL-01');
    expect(r.hash).not.toBe(recomporRegistro(v, semFontes).hash);
  });

  it('é idempotente: recompor de novo com as mesmas fontes não muda o hash', () => {
    const f = comFontes({ chave: () => 'X-1', nomeFilial: () => 'Matriz' });
    const e = mapearEstoque(U(8), { filial_id: U(1), produto_id: U(2), quantidade: 15_000 }, EM, { depositoNome: null });
    const a = recomporRegistro(e, f);
    expect(recomporRegistro(a, f).hash).toBe(a.hash);
    expect(a.payload).toMatchObject({ deposito_external_id: 'X-1', filial_external_id: 'X-1', produto_external_id: 'X-1', deposito_nome: 'Matriz' });
  });

  it('cliente: filial, carteira, forma e prazo médio da condição (M10) e cliente_endereco aponta para a chave do cliente', () => {
    const ev: EventoCliente = {
      id: U(20), tipo_pessoa: 'PJ', documento: '12345678000195', ie: null, ind_ie_dest: '1', razao_social: 'Mercado', nome_fantasia: null, email_nfe: null,
      limite_credito_centavos: 0, condicao_pagamento_id: U(6), tabela_preco_id: null, filial_id: U(1), vendedor_id: U(5), external_id: 'CLI-20', inativo: false,
      enderecos: [{ id: U(21), tipo: 'principal', ...end }],
    };
    const { cliente, enderecos } = mapearCliente(ev, EM, { condicao: null });
    const f = comFontes({
      chave: (e, id) => ({ filial: 'FIL-01', vendedor: 'VEN-5', cliente: 'CLI-20' } as Record<string, string>)[e] ?? id,
      condicao: () => ({ forma_codigo: 'BOLETO', prazos_dias: [28, 56, 85] }),
    });
    expect(cliente.payload.formas_pagamento).toBeUndefined();
    const c = recomporRegistro(cliente, f);
    expect(c.payload).toMatchObject({ external_id: 'CLI-20', filial_external_id: 'FIL-01', vendedor_external_id: 'VEN-5', formas_pagamento: ['BOLETO'], prazo_medio_max_dias: 57 });
    expect(recomporRegistro(enderecos[0]!, f).payload.cliente_external_id).toBe('CLI-20');
    // condição que sumiu: o cliente deixa de levar forma e prazo
    expect(recomporRegistro(c, semFontes).payload.formas_pagamento).toBeUndefined();
  });
});

describe('M10: preço compõe tabela, vigência e filial padrão', () => {
  const ev = { tabela_preco_id: U(10), filial_id: U(1), produto_id: U(2), preco_centavos: 1990, desconto_maximo_bp: 0, inativo: false, vigencia_inicio: '2026-01-01', vigencia_fim: null };
  const tabela = { external_id: 'TAB-A', nome: 'Varejo', vigencia_inicio: '2026-03-01', vigencia_fim: '2026-12-31', inativo: false };

  it('a chegada da tabela recompõe nome, vigência e chave; tabela inativa inativa o preço', () => {
    const p = mapearPreco(U(11), ev, EM, { tabela: null, filialPadraoId: null });
    const r = recomporRegistro(p, comFontes({ tabela: () => tabela }));
    expect(r.payload).toMatchObject({ tabela_external_id: 'TAB-A', tabela_nome: 'Varejo', vigencia_inicio: '2026-03-01', vigencia_fim: '2026-12-31', filial_external_id: U(1) });
    expect(validarRegistro(r, () => true)).toBeNull();
    expect(recomporRegistro(p, comFontes({ tabela: () => ({ ...tabela, inativo: true }) })).ativo).toBe(false);
  });

  it('P-1: o item da filial padrão sai sem filial; trocar a padrão recompõe', () => {
    const p = recomporRegistro(mapearPreco(U(11), ev, EM, { tabela: null, filialPadraoId: null }), comFontes({ tabela: () => tabela }));
    expect(recomporRegistro(p, comFontes({ tabela: () => tabela, filialPadraoId: U(1) })).payload.filial_external_id).toBeUndefined();
    expect(recomporRegistro(recomporRegistro(p, comFontes({ tabela: () => tabela, filialPadraoId: U(1) })), comFontes({ tabela: () => tabela, filialPadraoId: U(9) })).payload.filial_external_id).toBe(U(1));
  });
});

describe('assinatura dos derivados (evita recompor dependentes sem necessidade)', () => {
  it('só muda quando muda a chave ou o nome da filial', () => {
    const f = (nome: string, uf = 'AM') =>
      mapearFilial({ id: U(1), cnpj: '12345678000195', ie: null, razao_social: nome, nome_fantasia: null, crt: '3', endereco: { ...end, uf }, padrao: true, emissora: true, nfe_serie: 1, nfe_numero_inicial: 1, inativo: false, external_id: null }, EM).registro;
    expect(assinaturaDeDerivados(f('A'))).toBe(assinaturaDeDerivados(f('A', 'PA')));
    expect(assinaturaDeDerivados(f('A'))).not.toBe(assinaturaDeDerivados(f('B')));
  });
});

describe('referência da tabela de preço (a mesma leitura no espelho e no consumidor)', () => {
  it('RD-0318: tabelaDaReferencia lê a chave do Hub em dados.chave; faltando vigência fim, nula', () => {
    expect(tabelaDaReferencia({ chave: 'TAB-1', nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', inativo: true })).toEqual({
      external_id: 'TAB-1', nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', inativo: true,
    });
    expect(tabelaDaReferencia({ chave: U(1) })).toEqual({ external_id: U(1), nome: '', vigencia_inicio: '', vigencia_fim: null, inativo: false });
  });

  it('RD-0318: referência sem dados.chave (anterior à 0018) não vira tabela: o preço fica referencia_ausente', () => {
    expect(tabelaDaReferencia({ nome: 'Varejo', vigencia_inicio: '2026-01-01' })).toBeNull();
    expect(tabelaDaReferencia({ chave: '  ' })).toBeNull();
  });

  it('RD-0318: assinaturaDaReferenciaTabela é nula sem dados.chave e muda com a chave', () => {
    expect(assinaturaDaReferenciaTabela({ nome: 'V' })).toBeNull();
    expect(assinaturaDaReferenciaTabela({ chave: 'A', nome: 'V' })).not.toBe(assinaturaDaReferenciaTabela({ chave: 'B', nome: 'V' }));
  });

  it('RD-0318: trocar a chave da tabela muda a assinatura e recompõe tabela_external_id do preço', () => {
    const ev = { tabela_preco_id: U(10), filial_id: U(1), produto_id: U(2), preco_centavos: 1990, desconto_maximo_bp: 0, inativo: false, vigencia_inicio: '2026-01-01', vigencia_fim: null };
    const velha = tabelaDaReferencia({ chave: 'TAB-A', nome: 'V', vigencia_inicio: '2026-01-01' })!;
    const nova = tabelaDaReferencia({ chave: 'TAB-B', nome: 'V', vigencia_inicio: '2026-01-01' })!;
    expect(assinaturaDaTabela(velha)).not.toBe(assinaturaDaTabela(nova));
    const p = recomporRegistro(mapearPreco(U(11), ev, EM, { tabela: null, filialPadraoId: null }), comFontes({ tabela: () => velha }));
    const r = recomporRegistro(p, comFontes({ tabela: () => nova }));
    expect(r.payload.tabela_external_id).toBe('TAB-B');
    expect(r.hash).not.toBe(p.hash);
  });

  it('RN-INF-02: o alvo de cada chave de fonte_refs é derivado de CHAVE_FONTE_REFS (mais a tabela de preço)', () => {
    for (const [entidade, chave] of Object.entries(CHAVE_FONTE_REFS)) expect(ALVO_DA_CHAVE_REFS[chave!]).toBe(entidade);
    expect(ALVO_DA_CHAVE_REFS.tabela_preco_id).toBe('tabela');
    expect(Object.keys(ALVO_DA_CHAVE_REFS)).toHaveLength(Object.keys(CHAVE_FONTE_REFS).length + 1);
  });
});
