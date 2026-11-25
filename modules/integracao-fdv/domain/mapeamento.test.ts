import { describe, expect, it } from 'vitest';
import {
  quantidade4,
  filiaisComCodigoRepetido,
  inativarRegistro,
  mapearCliente,
  mapearCondicaoOpcional as mapearCondicao,
  mapearCondicao as mapearCondicaoEstrita,
  mapearEstoque,
  mapearFilial,
  mapearPreco,
  mapearProduto,
  mapearTabelaPreco,
  mapearVendedor,
  validarRegistro,
  type EventoCliente,
  type EventoFilial,
  type EventoProduto,
} from './mapeamento';
import { externalIdForma } from './canonico';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EM = '2026-11-21T20:00:00.123Z';
const end = { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000000', pais_bacen: '1058', municipio_nome: 'Manaus' };

/** CNPJ com dígito verificador válido (módulo 11), de teste. */
const CNPJ_OK = '11222333000181';
const filial = (o: Partial<EventoFilial> = {}): EventoFilial => ({
  id: U(1), cnpj: CNPJ_OK, ie: null, razao_social: 'Empresa LTDA', nome_fantasia: null, crt: '3', endereco: end, padrao: true, emissora: true, nfe_serie: 1, nfe_numero_inicial: 1, inativo: false, ...o,
});

describe('RF-INF-01 filial', () => {
  it('codigo = ordem do CNPJ, nome cai na razão social, cidade do C-1, sem dado fiscal', () => {
    const { registro, referencia } = mapearFilial(filial(), EM);
    expect(registro.payload).toEqual({
      external_id: U(1), ativo: true, codigo: '0001', nome: 'Empresa LTDA', cidade: 'Manaus', uf: 'AM',
      cnpj: CNPJ_OK, logradouro: 'Rua A', numero: '10', bairro: 'Centro', cep: '69000000',
    });
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

  it('A-01 (RN-CORE-39 do FDV): CNPJ sem máscara, endereço e CEP só com dígitos; complemento só quando existe', () => {
    const p = mapearFilial(filial({ cnpj: '11.222.333/0001-81', endereco: { ...end, cep: '69.000-000', complemento: 'Sala 2' } } as Partial<EventoFilial>), EM).registro.payload;
    expect(p).toMatchObject({ cnpj: '11222333000181', cep: '69000000', complemento: 'Sala 2', logradouro: 'Rua A', numero: '10', bairro: 'Centro' });
    expect('telefone' in p).toBe(false);
  });

  it('A-01: CNPJ de dígito válido passa; dígito inválido vira campo_invalido em cnpj sem ecoar o valor', () => {
    const ok = mapearFilial(filial(), EM).registro;
    expect(validarRegistro(ok, () => true)).toBeNull();
    const ruim = mapearFilial(filial({ cnpj: '11222333000182' }), EM).registro;
    const l = validarRegistro(ruim, () => true);
    expect(l).toEqual({ external_id: U(1), codigo: 'campo_invalido', campo: 'cnpj' });
    expect(JSON.stringify(l)).not.toContain('11222333000182');
  });

  it('A-01: filial sem logradouro, número, bairro, CEP, cidade ou UF é campo_obrigatorio no campo certo', () => {
    for (const [campo, endereco] of [
      ['logradouro', { ...end, logradouro: '' }],
      ['numero', { ...end, numero: '' }],
      ['bairro', { ...end, bairro: '' }],
      ['cep', { ...end, cep: '' }],
      ['cidade', { ...end, municipio_nome: undefined }],
      ['uf', { ...end, uf: '' }],
    ] as const) {
      const r = mapearFilial(filial({ endereco } as Partial<EventoFilial>), EM).registro;
      expect(validarRegistro(r, () => true)).toEqual({ external_id: U(1), codigo: 'campo_obrigatorio', campo });
    }
  });

  it('P-5: duas filiais com a mesma ordem de CNPJ viram linha inválida', () => {
    const a = mapearFilial(filial({ id: U(1) }), EM).registro;
    const b = mapearFilial(filial({ id: U(2), cnpj: '99999999000100' }), EM).registro;
    const c = mapearFilial(filial({ id: U(3), cnpj: '11111111000200' }), EM).registro;
    expect(filiaisComCodigoRepetido([a, b, c]).map((l) => l.external_id)).toEqual([U(1), U(2)]);
  });
});

describe('A-04 sigla da medida (RN-CORE-19 do FDV)', () => {
  const prod = (unidade: string, unidades: EventoProduto['unidades'] = []): EventoProduto =>
    ({ id: U(2), codigo: 'SKU1', descricao: 'Arroz', ncm: '10063021', cest: null, unidade_comercial: unidade, unidade_tributavel: 'UN', fator_tributavel: 10_000, ean: null, marca: null, origem: '0', grupo_tributacao: 'G', custo_centavos: 1, external_id: null, inativo: false, unidades }) as EventoProduto;

  it('sobe em maiúsculas e sem espaços; 1 a 4 letras passa', () => {
    const { produto, unidades } = mapearProduto(prod(' cx ', [{ id: U(3), unidade: 'pct', fator: 120_000, ean: null }]), EM);
    expect(produto.payload.unidade).toBe('CX');
    expect(unidades[0]!.payload).toMatchObject({ unidade: 'PCT', padrao: false });
    expect(validarRegistro(produto, () => true)).toBeNull();
  });

  it('sigla com número, símbolo ou mais de 4 letras vira campo_invalido em unidade, sem o valor', () => {
    for (const ruim of ['C1', 'CAIXA', 'KG.', 'M²']) {
      const { produto, unidades } = mapearProduto(prod(ruim, [{ id: U(3), unidade: ruim, fator: 10_000, ean: null }]), EM);
      expect(validarRegistro(produto, () => true)).toEqual({ external_id: produto.external_id, codigo: 'campo_invalido', campo: 'unidade' });
      expect(validarRegistro(unidades[0]!, () => true)).toEqual({ external_id: U(3), codigo: 'campo_invalido', campo: 'unidade' });
    }
  });
});

describe('RF-INF-01 vendedor, condição, estoque', () => {
  it('vendedor: nome, filial e referência; sem código nem usuário', () => {
    const r = mapearVendedor({ id: U(5), codigo: 'V1', nome: 'Ana', filial_id: U(1), usuario_id: U(9), inativo: false }, EM);
    expect(r.payload).toEqual({ external_id: U(5), ativo: true, nome: 'Ana', filial_external_id: U(1) });
    expect(r.erp_id).toBe(U(5));
    expect(r.fonte_refs).toEqual({ filial_id: U(1) });
  });

  it('M2: a condição vira forma (UUID v5 do tPag) e prazo (id do ERP), parcelas_dias [28, 56]', () => {
    const { forma, prazo } = mapearCondicao({ id: U(6), codigo: '28-56', descricao: '28 e 56 dias', forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 42, inativo: false, forma_codigo: null, forma_nome: null }, EM, { tenantId: U(100), formaAtiva: true });
    expect(forma.external_id).toBe(externalIdForma(U(100), '15'));
    expect(forma.payload).toMatchObject({ codigo: 'BOLETO', nome: 'Boleto bancário', ativo: true });
    expect(prazo!.payload).toMatchObject({ external_id: U(6), forma_external_id: forma.external_id, parcelas_dias: [28, 56], descricao: '28 e 56 dias', prazo_medio_dias: 42 });
    expect(mapearCondicao({ id: U(7), codigo: 'AV', descricao: 'À vista', forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 0, inativo: false, forma_codigo: null, forma_nome: null }, EM, { tenantId: U(100), formaAtiva: false }).prazo!.payload.parcelas_dias).toEqual([0]);
  });

  it('RN-CAD-15: prazo incompleto (prazo médio nulo, descrição vazia ou sem parcela) não sai; a forma sai assim mesmo', () => {
    const base = { id: U(6), codigo: '28-56', descricao: '28 e 56 dias', forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 42 as number | null, inativo: false, forma_codigo: null, forma_nome: null };
    for (const ruim of [{ prazo_medio_dias: null }, { descricao: ' ' }, { prazos_dias: [] }]) {
      const r = mapearCondicao({ ...base, ...ruim }, EM, { tenantId: U(100), formaAtiva: true });
      expect(r.prazo).toBeNull();
      expect(r.forma.payload).toMatchObject({ ativo: true });
    }
    expect(mapearCondicao(base, EM, { tenantId: U(100), formaAtiva: true }).prazo).not.toBeNull();
  });

  it('RN-CAD-15: a variante estrita devolve o prazo e lança com prazo incompleto', () => {
    const base = { id: U(6), codigo: '28-56', descricao: '28 e 56 dias', forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 42 as number | null, inativo: false, forma_codigo: null, forma_nome: null };
    expect(mapearCondicaoEstrita(base, EM, { tenantId: U(100), formaAtiva: true }).prazo.payload.parcelas_dias).toEqual([28, 56]);
    expect(() => mapearCondicaoEstrita({ ...base, prazo_medio_dias: null }, EM, { tenantId: U(100), formaAtiva: true })).toThrow(/RN-CAD-15/);
  });

  it('contrato v2 do prazo (opção): valida os limites da v2 e aponta o campo, sem o valor', () => {
    const ev = { id: U(6), codigo: '28-56', descricao: '28 e 56 dias', forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 42, inativo: false, forma_codigo: null, forma_nome: null };
    const { prazo } = mapearCondicao(ev, EM, { tenantId: U(100), formaAtiva: true });
    expect(validarRegistro(prazo!, () => true, { prazoV2: true })).toBeNull();
    expect(validarRegistro(prazo!, () => true)).toBeNull(); // v1
    const decrescente = mapearCondicao({ ...ev, prazos_dias: [56, 28] }, EM, { tenantId: U(100), formaAtiva: true }).prazo!;
    expect(validarRegistro(decrescente, () => true, { prazoV2: true })).toEqual({ external_id: decrescente.external_id, codigo: 'campo_invalido', campo: 'parcelas_dias' }); // v2: sem decrescer
    expect(validarRegistro(decrescente, () => true)).toBeNull(); // v1 aceita
    const longo = mapearCondicao({ ...ev, prazos_dias: [400], prazo_medio_dias: 400 }, EM, { tenantId: U(100), formaAtiva: true }).prazo!;
    expect(validarRegistro(longo, () => true)).toEqual({ external_id: longo.external_id, codigo: 'campo_invalido', campo: 'parcelas_dias' }); // o Hub v1 real já limita a 365
  });

  it('D11: estoque com saldo numérico, um depósito por filial, negativo como está', () => {
    const r = mapearEstoque(U(8), { filial_id: U(1), produto_id: U(2), quantidade: -15_000 }, EM, { depositoNome: 'Matriz' });
    expect(r.payload).toEqual({ external_id: U(8), ativo: true, deposito_external_id: U(1), deposito_nome: 'Matriz', produto_external_id: U(2), saldo: -1.5, filial_external_id: U(1) });
    expect(quantidade4(10_000)).toBe(1);
    expect(quantidade4(1)).toBe(0.0001);
    expect(quantidade4(0)).toBe(0);
    expect(JSON.stringify(quantidade4(125))).toBe('0.0125');
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
    expect(unidades.map((u) => u.payload.fator)).toEqual([1, 0.0125]);
    expect(unidades.map((u) => u.payload.padrao)).toEqual([true, false]);
    expect(unidades[1]!.payload.ean).toBe('7891234567895');
    expect(unidades[0]!.erp_id).toBe(U(3));
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

  it('sem a referência da tabela o preço entra sem tabela_nome e vira referencia_ausente (C-2)', () => {
    const r = mapearPreco(U(11), ev, EM, { tabela: null, filialPadraoId: U(1) });
    expect(r.payload.tabela_nome).toBeUndefined();
    // RD-0318: sem a referência não há chave da tabela; o UUID cru do evento nunca vira tabela_external_id
    expect(r.payload.tabela_external_id).toBeUndefined();
    expect(validarRegistro(r, () => true)).toMatchObject({ codigo: 'referencia_ausente', campo: 'tabela_external_id' });
  });

  it('RD-0318: tabela_external_id é a chave do Hub da referência (external_id da carga), não o UUID da tabela', () => {
    const r = mapearPreco(U(11), ev, EM, { tabela: { chave: 'TAB-KIT', nome: 'Varejo' }, filialPadraoId: U(1) });
    expect(r.payload.tabela_external_id).toBe('TAB-KIT');
    expect(r.payload.tabela_external_id).not.toBe(ev.tabela_preco_id);
    expect(r.fonte_refs.tabela_preco_id).toBe(ev.tabela_preco_id);
  });

  it('preço em centavos, tabela com nome, sem desconto máximo; filial padrão sai sem filial (P-1)', () => {
    const r = mapearPreco(U(11), ev, EM, { tabela: { chave: U(10), nome: 'Varejo' }, filialPadraoId: U(1) });
    expect(r.payload).toEqual({ external_id: U(11), ativo: true, tabela_external_id: U(10), tabela_nome: 'Varejo', vigencia_inicio: '2026-01-01', produto_external_id: U(2), preco_cents: 1990 });
    const outra = mapearPreco(U(12), { ...ev, filial_id: U(9) }, EM, { tabela: { chave: U(10), nome: 'Varejo' }, filialPadraoId: U(1) });
    expect(outra.payload.filial_external_id).toBe(U(9));
    expect(JSON.stringify(r.payload)).not.toMatch(/desconto/);
  });

  it('tabela inativa = preço ativo false', () => {
    expect(mapearPreco(U(11), { ...ev, inativo: true }, EM, { tabela: { chave: U(10), nome: 'V' }, filialPadraoId: null }).ativo).toBe(false);
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

  it('carteira = vendedor_external_id; endereço principal embutido; RN-CAD-16: prazo_medio_max_dias é o do cliente e formas_pagamento não sai', () => {
    const { cliente } = mapearCliente({ ...ev, prazo_medio_dias: 57 }, EM);
    expect(cliente.payload).toMatchObject({ vendedor_external_id: U(5), filial_external_id: U(1), documento: '12345678000195', limite_credito_cents: 500_000, prazo_medio_max_dias: 57 });
    expect(cliente.payload).not.toHaveProperty('formas_pagamento');
    expect((cliente.payload.endereco as Record<string, unknown>).cidade).toBe('Manaus');
    expect(cliente.erp_id).toBe(U(20));
    expect(cliente.fonte_refs).toEqual({ vendedor_id: U(5), filial_id: U(1) });
  });

  it('M9: sem e-mail, contato, coordenada, observação nem tabela de preço do cliente', () => {
    const texto = JSON.stringify(mapearCliente(ev, EM));
    expect(texto).not.toMatch(/a@b\.com|email|latitude|longitude|observacao|contatos|tabela_preco|ind_ie_dest|tipo_pessoa/);
    expect(mapearCliente(ev, EM).cliente.payload).not.toHaveProperty('prazo_medio_max_dias'); // RN-CAD-16: sem prazo médio no cliente, o campo é omitido
  });

  it('C-3: um cliente_endereco por endereço com id; sem id não vai; inativo propaga', () => {
    const { enderecos } = mapearCliente(ev, EM);
    expect(enderecos.map((e) => [e.external_id, e.payload.tipo, e.payload.principal, e.payload.cidade])).toEqual([
      [U(21), 'principal', true, 'Manaus'],
      [U(22), 'entrega', false, 'Parintins'],
    ]);
    expect(mapearCliente({ ...ev, enderecos: [{ ...ev.enderecos[0]!, id: undefined }] }, EM).enderecos).toEqual([]);
    const semCidade = mapearCliente({ ...ev, enderecos: [{ ...ev.enderecos[0]!, municipio_nome: undefined }] }, EM).enderecos;
    expect(semCidade).toHaveLength(1);
    expect(validarRegistro(semCidade[0]!, () => true)).toEqual({ external_id: U(21), codigo: 'campo_obrigatorio', campo: 'cidade' });
    expect(mapearCliente({ ...ev, inativo: true }, EM).enderecos.every((e) => !e.ativo)).toBe(true);
  });

  it('RN-INF-03: o hash não muda com outro ocorrido_em, muda com o conteúdo', () => {
    const a = mapearCliente(ev, EM).cliente;
    const b = mapearCliente(ev, '2027-01-01T00:00:00Z').cliente;
    expect(a.hash).toBe(b.hash);
    expect(mapearCliente({ ...ev, razao_social: 'Outro' }, EM).cliente.hash).not.toBe(a.hash);
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

describe('RN-INF-02: chave do Hub = external_id da carga, senão o UUID (23h22)', () => {
  it('filial, produto, cliente e vendedor usam o external_id quando existe', () => {
    expect(mapearFilial(filial({ external_id: 'FIL-01' }), EM).registro.external_id).toBe('FIL-01');
    expect(mapearFilial(filial(), EM).registro.external_id).toBe(U(1));
    expect(mapearVendedor({ id: U(5), codigo: 'V1', nome: 'Ana', filial_id: U(1), usuario_id: null, external_id: ' VEN-5 ', inativo: false }, EM).external_id).toBe('VEN-5');
    expect(mapearFilial(filial({ external_id: 'FIL-01' }), EM).registro.erp_id).toBe(U(1));
  });

  it('D12 (T-0026): a forma da carga viaja na condição; sem ela, UUID v5 do tPag e nome do MOC', () => {
    const ev = { id: U(6), codigo: 'AV', descricao: 'À vista', forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 0, inativo: false, forma_external_id: 'FP-DIN', forma_codigo: 'DIN', forma_nome: 'Dinheiro da loja', external_id: 'PZ-1' };
    const { forma, prazo } = mapearCondicao(ev, EM, { tenantId: U(100), formaAtiva: true });
    expect(forma.external_id).toBe('FP-DIN');
    expect(forma.payload).toMatchObject({ codigo: 'DIN', nome: 'Dinheiro da loja' });
    expect(prazo!.external_id).toBe('PZ-1');
    expect(prazo!.payload.forma_external_id).toBe('FP-DIN');
  });

  it('RD-0318: a tabela de preço vira referência com a chave do Hub em dados.chave e sem vigencia_fim nula', () => {
    const r = mapearTabelaPreco({ id: U(10), nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: true, external_id: 'TAB-A', inativo: false }, EM);
    expect(r).toEqual({ tipo: 'tabela_preco', erp_id: U(10), dados: { chave: 'TAB-A', nome: 'Varejo', vigencia_inicio: '2026-01-01', inativo: false }, fonte_ocorrido_em: EM });
    expect(r).not.toHaveProperty('external_id');
    // sem external_id (cadastro sem carga) a chave do Hub é o próprio id
    expect(mapearTabelaPreco({ id: U(10), nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: true, external_id: null, inativo: false }, EM).dados.chave).toBe(U(10));
  });
});

describe('ADR 0010: chave do Hub de unidade, endereço e preço (RN-INF-02)', () => {
  const prod = (unidades: unknown[], o: Record<string, unknown> = {}) =>
    ({ id: U(2), codigo: 'SKU1', descricao: 'Arroz', ncm: '10063021', cest: null, unidade_comercial: 'CX', unidade_tributavel: 'UN', fator_tributavel: 10_000, ean: null, marca: null, origem: '0', grupo_tributacao: 'G', custo_centavos: 1, external_id: 'P-KIT', inativo: false, unidades, ...o }) as unknown as EventoProduto;

  it('a unidade usa o external_id do kit e guarda o UUID como erp_id; sem external_id fica o UUID; o pai vai pela chave do pai', () => {
    const { unidades } = mapearProduto(prod([{ id: U(3), unidade: 'CX', fator: 10_000, ean: null, external_id: 'UN-KIT' }, { id: U(4), unidade: 'UN', fator: 1_000, ean: null, external_id: null }, { id: U(5), unidade: 'PCT', fator: 500, ean: null }]), EM);
    expect(unidades.map((u) => [u.external_id, u.erp_id, u.payload.external_id])).toEqual([['UN-KIT', U(3), 'UN-KIT'], [U(4), U(4), U(4)], [U(5), U(5), U(5)]]);
    expect(unidades[0]!.payload.produto_external_id).toBe('P-KIT');
  });

  it('o endereço usa o external_id do kit (erp_id = id); sem external_id fica o UUID', () => {
    const ev = { id: U(20), razao_social: 'Cliente', documento: '12345678000195', filial_id: U(1), vendedor_id: U(5), condicao_pagamento_id: U(6), external_id: 'CLI-KIT', inativo: false, enderecos: [{ ...end, id: U(21), tipo: 'principal', external_id: 'END-KIT' }, { ...end, id: U(22), tipo: 'entrega' }] } as unknown as EventoCliente;
    const { enderecos } = mapearCliente(ev, EM);
    expect(enderecos.map((e) => [e.external_id, e.erp_id])).toEqual([['END-KIT', U(21)], [U(22), U(22)]]);
    expect(enderecos[0]!.payload.cliente_external_id).toBe('CLI-KIT');
  });

  it('o preço usa o external_id do evento; o agregado_id segue como erp_id; sem external_id fica o agregado_id', () => {
    const ev = { tabela_preco_id: U(10), filial_id: U(1), produto_id: U(2), preco_centavos: 1990, desconto_maximo_bp: 0, inativo: false, vigencia_inicio: '2026-01-01', vigencia_fim: null };
    const ctx = { tabela: { chave: 'TAB', nome: 'V' }, filialPadraoId: U(1) };
    const com = mapearPreco(U(11), { ...ev, external_id: 'PR-KIT' } as never, EM, ctx);
    expect([com.external_id, com.erp_id, com.payload.external_id]).toEqual(['PR-KIT', U(11), 'PR-KIT']);
    expect(mapearPreco(U(11), { ...ev, external_id: null } as never, EM, ctx).external_id).toBe(U(11));
    expect(mapearPreco(U(11), ev as never, EM, ctx).external_id).toBe(U(11));
  });
});

describe('T-0085: fator fracionário ou acima do limite do Hub é recusado por registro', () => {
  const unidade = (fator: number) => {
    const ev = { id: U(2), codigo: 'SKU1', descricao: 'Arroz', ncm: '10063021', cest: null, unidade_comercial: 'UN', unidade_tributavel: 'UN', fator_tributavel: 10_000, ean: null, marca: null, origem: '0', grupo_tributacao: 'G', custo_centavos: 1, external_id: null, inativo: false, unidades: [{ id: U(3), unidade: 'CX', fator, ean: null }] } as EventoProduto;
    return mapearProduto(ev, EM).unidades[0]!;
  };

  it('RN-INF-04: fator fracionário vira quantidade_fracionaria no campo fator, sem ecoar o valor', () => {
    const l = validarRegistro(unidade(15_000), () => true);
    expect(l).toEqual({ external_id: U(3), codigo: 'quantidade_fracionaria', campo: 'fator' });
    expect(JSON.stringify(l)).not.toContain('1.5');
  });

  it('RN-INF-04: fator inteiro até 9999 passa; acima de 9999 é campo_invalido no fator', () => {
    expect(validarRegistro(unidade(120_000), () => true)).toBeNull();
    expect(validarRegistro(unidade(9999 * 10_000), () => true)).toBeNull();
    expect(validarRegistro(unidade(10_000 * 10_000), () => true)).toEqual({ external_id: U(3), codigo: 'campo_invalido', campo: 'fator' });
  });
});
