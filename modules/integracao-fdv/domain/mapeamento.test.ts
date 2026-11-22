import { describe, expect, it } from 'vitest';
import {
  decimal4,
  filiaisComCodigoRepetido,
  inativarRegistro,
  mapearCliente,
  mapearCondicao,
  mapearEstoque,
  mapearFilial,
  mapearPreco,
  mapearProduto,
  mapearVendedor,
  prazoMedioMaxDias,
  validarRegistro,
  type EventoCliente,
  type EventoFilial,
  type EventoProduto,
} from './mapeamento';
import { externalIdForma } from './canonico';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EM = '2026-11-21T20:00:00.123Z';
const end = { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000000', pais_bacen: '1058', municipio_nome: 'Manaus' };

const filial = (o: Partial<EventoFilial> = {}): EventoFilial => ({
  id: U(1), cnpj: '12345678000195', ie: null, razao_social: 'Empresa LTDA', nome_fantasia: null, crt: '3', endereco: end, padrao: true, emissora: true, nfe_serie: 1, nfe_numero_inicial: 1, inativo: false, ...o,
});

describe('RF-INF-01 filial', () => {
  it('codigo = ordem do CNPJ, nome cai na razão social, cidade do C-1, sem dado fiscal', () => {
    const { registro, referencia } = mapearFilial(filial(), EM);
    expect(registro.payload).toEqual({ external_id: U(1), ativo: true, codigo: '0001', nome: 'Empresa LTDA', cidade: 'Manaus', uf: 'AM' });
    expect(registro.alterado_em).toBe(EM);
    expect(referencia).toMatchObject({ tipo: 'filial_padrao', erp_id: U(1) });
    expect(JSON.stringify(registro.payload)).not.toMatch(/crt|ie|nfe/);
  });

  it('RN-CAD-08: inativa vai com ativo false; sem municipio_nome vai sem cidade; não padrão sem referência', () => {
    const { registro, referencia } = mapearFilial(filial({ inativo: true, padrao: false, nome_fantasia: 'Fantasia', endereco: { ...end, municipio_nome: undefined } }), EM);
    expect(registro.ativo).toBe(false);
    expect(registro.payload.nome).toBe('Fantasia');
    expect('cidade' in registro.payload).toBe(false);
    expect(referencia).toBeNull();
  });

  it('P-5: duas filiais com a mesma ordem de CNPJ viram linha inválida', () => {
    const a = mapearFilial(filial({ id: U(1) }), EM).registro;
    const b = mapearFilial(filial({ id: U(2), cnpj: '99999999000100' }), EM).registro;
    const c = mapearFilial(filial({ id: U(3), cnpj: '11111111000200' }), EM).registro;
    expect(filiaisComCodigoRepetido([a, b, c]).map((l) => l.external_id)).toEqual([U(1), U(2)]);
  });
});

describe('RF-INF-01 vendedor, condição, estoque', () => {
  it('vendedor: nome, filial e referência; sem código nem usuário', () => {
    const r = mapearVendedor({ id: U(5), codigo: 'V1', nome: 'Ana', filial_id: U(1), usuario_id: U(9), inativo: false }, EM);
    expect(r.payload).toEqual({ external_id: U(5), ativo: true, nome: 'Ana', filial_external_id: U(1) });
    expect(r.fonte_refs).toEqual({ filial_id: U(1) });
  });

  it('M2: a condição vira forma (UUID v5 do tPag) e prazo (id do ERP), prazos "28/56"', () => {
    const { forma, prazo } = mapearCondicao({ id: U(6), codigo: '28-56', descricao: '28 e 56 dias', forma_tpag: '15', prazos_dias: [28, 56], inativo: false, forma_codigo: null, forma_nome: null }, EM, { tenantId: U(100), formaAtiva: true });
    expect(forma.external_id).toBe(externalIdForma(U(100), '15'));
    expect(forma.payload).toMatchObject({ codigo: 'BOLETO', nome: 'Boleto bancário', ativo: true });
    expect(prazo.payload).toMatchObject({ external_id: U(6), forma_external_id: forma.external_id, parcelas_dias: '28/56', descricao: '28 e 56 dias' });
    expect(mapearCondicao({ id: U(7), codigo: 'AV', descricao: 'À vista', forma_tpag: '01', prazos_dias: [0], inativo: false, forma_codigo: null, forma_nome: null }, EM, { tenantId: U(100), formaAtiva: false }).prazo.payload.parcelas_dias).toBe('0');
  });

  it('D11: estoque com saldo decimal por string, um depósito por filial, negativo como está', () => {
    const r = mapearEstoque(U(8), { filial_id: U(1), produto_id: U(2), quantidade: -15_000 }, EM, { depositoNome: 'Matriz' });
    expect(r.payload).toEqual({ external_id: U(8), ativo: true, deposito_external_id: U(1), deposito_nome: 'Matriz', produto_external_id: U(2), saldo: '-1.5', filial_external_id: U(1) });
    expect(decimal4(10_000)).toBe('1');
    expect(decimal4(1)).toBe('0.0001');
    expect(decimal4(0)).toBe('0');
  });
});

describe('RF-INF-01 produto e produto_unidade', () => {
  const ev: EventoProduto = {
    id: U(2), codigo: 'SKU1', descricao: 'Arroz', ncm: '10063021', cest: null, unidade_comercial: 'CX', unidade_tributavel: 'UN', fator_tributavel: 120_000, ean: 'SEM GTIN', marca: 'Marca',
    origem: '0', grupo_tributacao: 'G', custo_centavos: 7771777, external_id: null, inativo: false,
    unidades: [{ id: U(3), unidade: 'CX', fator: 10_000, ean: null }, { id: U(4), unidade: 'UN', fator: 125, ean: '7891234567895' }],
  };

  it('M8: nunca leva custo nem campos fiscais; SEM GTIN fica sem ean', () => {
    const { produto } = mapearProduto(ev, EM);
    expect(produto.payload).toEqual({ external_id: U(2), ativo: true, sku: 'SKU1', nome: 'Arroz', unidade: 'CX', marca: 'Marca' });
    const texto = JSON.stringify(mapearProduto(ev, EM));
    expect(texto).not.toMatch(/custo|7771777|ncm|10063021|preco_venda/);
  });

  it('unidades: fator decimal, padrão = unidade comercial, produto inativo inativa as unidades', () => {
    const { unidades } = mapearProduto(ev, EM);
    expect(unidades.map((u) => u.payload.fator)).toEqual(['1', '0.0125']);
    expect(unidades.map((u) => u.payload.padrao)).toEqual([true, false]);
    expect(unidades[1]!.payload.ean).toBe('7891234567895');
    expect(unidades[0]!.fonte_refs).toEqual({ produto_id: U(2) });
    expect(mapearProduto({ ...ev, inativo: true }, EM).unidades.every((u) => !u.ativo)).toBe(true);
  });

  it('RN-CAD-08: unidade retirada vira ativo false com hash novo', () => {
    const u = mapearProduto(ev, EM).unidades[0]!;
    const i = inativarRegistro(u, '2026-11-22T10:00:00Z');
    expect(i.ativo).toBe(false);
    expect(i.payload.ativo).toBe(false);
    expect(i.hash).not.toBe(u.hash);
    expect(i.alterado_em).toBe('2026-11-22T10:00:00.000Z');
  });
});

describe('RF-INF-01 preço', () => {
  const ev = { tabela_preco_id: U(10), filial_id: U(1), produto_id: U(2), preco_centavos: 1990, desconto_maximo_bp: 500, inativo: false, vigencia_inicio: '2026-01-01', vigencia_fim: null };

  it('sem a referência da tabela não vai (referencia_ausente, C-2)', () => {
    expect(mapearPreco(U(11), ev, EM, { tabela: null, filialPadraoId: U(1) })).toBeNull();
  });

  it('preço em centavos, tabela com nome, sem desconto máximo; filial padrão sai sem filial (P-1)', () => {
    const r = mapearPreco(U(11), ev, EM, { tabela: { nome: 'Varejo' }, filialPadraoId: U(1) })!;
    expect(r.payload).toEqual({ external_id: U(11), ativo: true, tabela_external_id: U(10), tabela_nome: 'Varejo', vigencia_inicio: '2026-01-01', produto_external_id: U(2), preco_cents: 1990 });
    const outra = mapearPreco(U(12), { ...ev, filial_id: U(9) }, EM, { tabela: { nome: 'Varejo' }, filialPadraoId: U(1) })!;
    expect(outra.payload.filial_external_id).toBe(U(9));
    expect(JSON.stringify(r.payload)).not.toMatch(/desconto/);
  });

  it('tabela inativa = preço ativo false', () => {
    expect(mapearPreco(U(11), { ...ev, inativo: true }, EM, { tabela: { nome: 'V' }, filialPadraoId: null })!.ativo).toBe(false);
  });
});

describe('RF-INF-01 cliente com carteira (D7) e LGPD (M9)', () => {
  const ev: EventoCliente = {
    id: U(20), tipo_pessoa: 'PJ', documento: '12345678000195', ie: '123', ind_ie_dest: '1', razao_social: 'Mercado LTDA', nome_fantasia: 'Mercadinho',
    email_nfe: 'a@b.com', limite_credito_centavos: 500_000, condicao_pagamento_id: U(6), tabela_preco_id: U(10), filial_id: U(1), vendedor_id: U(5), external_id: null, inativo: false,
    enderecos: [
      { id: U(21), tipo: 'principal', ...end },
      { id: U(22), tipo: 'entrega', ...end, logradouro: 'Rua B', municipio_nome: 'Parintins' },
    ],
  };

  it('carteira = vendedor_external_id; endereço principal embutido; condição vira forma e prazo médio', () => {
    const { cliente } = mapearCliente(ev, EM, { condicao: { forma_tpag: '15', prazos_dias: [28, 56, 85] } });
    expect(cliente.payload).toMatchObject({ vendedor_external_id: U(5), filial_external_id: U(1), documento: '12345678000195', limite_credito_cents: 500_000, formas_pagamento: ['BOLETO'], prazo_medio_max_dias: 57 });
    expect((cliente.payload.endereco as Record<string, unknown>).cidade).toBe('Manaus');
    expect(cliente.fonte_refs).toEqual({ vendedor_id: U(5), filial_id: U(1), condicao_pagamento_id: U(6) });
    expect(prazoMedioMaxDias([0])).toBe(0);
  });

  it('M9: sem e-mail, contato, coordenada, observação nem tabela de preço do cliente', () => {
    const texto = JSON.stringify(mapearCliente(ev, EM, { condicao: null }));
    expect(texto).not.toMatch(/a@b\.com|email|latitude|longitude|observacao|contatos|tabela_preco|ind_ie_dest|tipo_pessoa/);
    expect(mapearCliente(ev, EM, { condicao: null }).cliente.payload.formas_pagamento).toBeUndefined();
  });

  it('C-3: um cliente_endereco por endereço com id; sem id não vai; inativo propaga', () => {
    const { enderecos } = mapearCliente(ev, EM, { condicao: null });
    expect(enderecos.map((e) => [e.external_id, e.payload.tipo, e.payload.principal, e.payload.cidade])).toEqual([
      [U(21), 'principal', true, 'Manaus'],
      [U(22), 'entrega', false, 'Parintins'],
    ]);
    expect(mapearCliente({ ...ev, enderecos: [{ ...ev.enderecos[0]!, id: undefined }] }, EM, { condicao: null }).enderecos).toEqual([]);
    const semCidade = mapearCliente({ ...ev, enderecos: [{ ...ev.enderecos[0]!, municipio_nome: undefined }] }, EM, { condicao: null }).enderecos;
    expect(semCidade).toHaveLength(1);
    expect(validarRegistro(semCidade[0]!, () => true)).toEqual({ external_id: U(21), codigo: 'campo_obrigatorio', campo: 'cidade' });
    expect(mapearCliente({ ...ev, inativo: true }, EM, { condicao: null }).enderecos.every((e) => !e.ativo)).toBe(true);
  });

  it('RN-INF-03: o hash não muda com outro ocorrido_em, muda com o conteúdo', () => {
    const a = mapearCliente(ev, EM, { condicao: null }).cliente;
    const b = mapearCliente(ev, '2027-01-01T00:00:00Z', { condicao: null }).cliente;
    expect(a.hash).toBe(b.hash);
    expect(mapearCliente({ ...ev, razao_social: 'Outro' }, EM, { condicao: null }).cliente.hash).not.toBe(a.hash);
  });
});

describe('M5 validação local sem o valor (RN-INF-04)', () => {
  const confirmadoTodos = () => true;
  const vendedor = mapearVendedor({ id: U(5), codigo: 'V1', nome: 'Ana', filial_id: U(1), usuario_id: null, inativo: false }, EM);

  it('campo obrigatório vazio vira campo_obrigatorio com o nome do campo', () => {
    const v = { ...vendedor, payload: { ...vendedor.payload, nome: '' } };
    expect(validarRegistro(v, confirmadoTodos)).toEqual({ external_id: U(5), codigo: 'campo_obrigatorio', campo: 'nome' });
  });

  it('referência não confirmada no Hub vira referencia_ausente, sem o valor', () => {
    const r = validarRegistro(vendedor, () => false);
    expect(r).toEqual({ external_id: U(5), codigo: 'referencia_ausente', campo: 'filial_external_id' });
    expect(JSON.stringify(r)).not.toContain(U(1));
    expect(validarRegistro(vendedor, confirmadoTodos)).toBeNull();
    const extra = { ...vendedor, payload: { ...vendedor.payload, cpf_do_vendedor: 'x' } };
    expect(validarRegistro(extra, confirmadoTodos)).toEqual({ external_id: U(5), codigo: 'campo_invalido', campo: 'cpf_do_vendedor' });
  });

  it('formato inválido vira campo_invalido; o valor não aparece', () => {
    const f = mapearFilial(filial({ endereco: { ...end, uf: 'amazonas' as never } }), EM).registro;
    const r = validarRegistro(f, confirmadoTodos);
    expect(r).toMatchObject({ codigo: 'campo_invalido', campo: 'uf' });
    expect(JSON.stringify(r)).not.toContain('amazonas');
  });
});
