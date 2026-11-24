/**
 * Consulta de cadastros para o pedido (T-0015) contra o PostgreSQL real: cada método da porta, o recuo do preço para a
 * filial padrão (RN-CAD-06), o inativo devolvido e a RLS entre dois tenants. Mesmo banco efêmero do `sql.db.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { criarConsultaParaPedido } from './consulta-pedido';
import { CNPJ_B, clienteValido, filialValida, produtoValido } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('consulta de cadastros para o pedido (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const consulta = criarConsultaParaPedido(repositoriosSql);
  const adm = sessaoDe('administrador');
  const gerente = sessaoDe('gerente');
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'empresa-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'empresa-b', ['cadastros']);
    const a = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }), new Date('2026-11-21T15:00:00Z'), transacaoDe(app, A));
    const post = async (rota: string, corpo: unknown, sessao = adm) => {
      const r = await a.chamar('POST', rota, { sessao, corpo });
      expect(r.status, rota).toBe(201);
      return r.corpo as { id: string };
    };
    ids.filialPadrao = (await post('/filiais', filialValida())).id;
    ids.filialOutra = (await post('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false }))).id;
    ids.vendedor = (await post('/vendedores', { codigo: 'V1', nome: 'Ana', filial_id: ids.filialPadrao, usuario_id: adm.usuario_id }, gerente)).id;
    ids.condicao = (await post('/condicoes-pagamento', { codigo: '30D', descricao: '30 dias', forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30 }, gerente)).id;
    ids.cliente = (await post('/clientes', clienteValido(ids.filialPadrao, { limite_credito_centavos: 500_000, vendedor_id: ids.vendedor, condicao_pagamento_id: ids.condicao }))).id;
    ids.p1 = (await post('/produtos', produtoValido({ cest: '0300700', ean: '7891000100103' }))).id;
    ids.p2 = (await post('/produtos', produtoValido({ codigo: 'P002', cest: '0300700', ncm: '22021000' }))).id;
    ids.p3 = (await post('/produtos', produtoValido({ codigo: 'P003', cest: '0300700' }))).id;
    await post(`/produtos/${ids.p1}/unidades`, { unidade: 'CX', fator: 120_000 });
    ids.tabela = (await post('/tabelas-preco', { nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', padrao: true }, gerente)).id;
    const put = await a.chamar('PUT', `/tabelas-preco/${ids.tabela}/itens`, {
      sessao: gerente,
      corpo: {
        itens: [
          { filial_id: ids.filialPadrao, produto_id: ids.p1, preco_centavos: 1990, desconto_maximo_bp: 500 },
          { filial_id: ids.filialOutra, produto_id: ids.p1, preco_centavos: 2100, desconto_maximo_bp: 300 },
          { filial_id: ids.filialPadrao, produto_id: ids.p2, preco_centavos: 3000, desconto_maximo_bp: 0 },
        ],
      },
    });
    expect(put.status).toBe(200);
    for (const [p, q] of [[ids.p1, 10_0000], [ids.p2, 5_0000]] as const) {
      expect((await a.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: { filial_id: ids.filialPadrao, produto_id: p, tipo: 'entrada', quantidade: q, motivo: 'Compra' } })).status).toBe(201);
    }
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  const txA = () => transacaoDe(app, A);
  const txB = () => transacaoDe(app, B);

  it('cliente: campos do pick com o endereço principal e sem e-mail ou contatos; inativo volta marcado', async () => {
    const c = await consulta.cliente(txA(), ids.cliente as string);
    expect(c).toMatchObject({ id: ids.cliente, tipo_pessoa: 'PJ', documento: CNPJ_B, ind_ie_dest: '1', limite_credito_centavos: 500_000, condicao_pagamento_id: ids.condicao, filial_id: ids.filialPadrao, vendedor_id: ids.vendedor, inativo: false });
    expect(c?.enderecos).toHaveLength(1);
    expect(c?.enderecos[0]).toMatchObject({ tipo: 'principal', municipio_ibge: '1302603', municipio_nome: 'Manaus' });
    const [linha] = await admin('SELECT id FROM cadastros.cliente_endereco WHERE cliente_id = $1', [ids.cliente]);
    expect(c?.enderecos[0]?.id).toBe(linha.id);
    expect(Object.keys(c as object).sort()).toEqual(['condicao_pagamento_id', 'documento', 'enderecos', 'filial_id', 'id', 'ie', 'inativo', 'ind_ie_dest', 'limite_credito_centavos', 'nome_fantasia', 'razao_social', 'tabela_preco_id', 'tipo_pessoa', 'vendedor_id']);
    expect(await consulta.cliente(txA(), randomUUID())).toBeNull();
  });

  it('filial e filialPadrao: emissora, padrão e inativo', async () => {
    expect(await consulta.filial(txA(), ids.filialPadrao as string)).toEqual({ id: ids.filialPadrao, emissora: true, padrao: true, inativo: false });
    expect(await consulta.filial(txA(), ids.filialOutra as string)).toEqual({ id: ids.filialOutra, emissora: false, padrao: false, inativo: false });
    expect(await consulta.filialPadrao(txA())).toBe(ids.filialPadrao);
    expect(await consulta.filial(txA(), randomUUID())).toBeNull();
  });

  it('produtos: em lote, com unidades, sem custo, e o inativo vem marcado', async () => {
    const r = await consulta.produtos(txA(), [ids.p1 as string, ids.p2 as string, ids.p1 as string, randomUUID()]);
    expect(r.map((p) => p.id).sort()).toEqual([ids.p1, ids.p2].sort());
    const p1 = r.find((p) => p.id === ids.p1);
    expect(p1).toMatchObject({ codigo: 'P001', unidade_comercial: 'UN', ean: '7891000100103', ncm: '22021000', origem: '0', inativo: false, unidades: [{ unidade: 'CX', fator: 120_000 }] });
    expect(r.find((p) => p.id === ids.p2)?.unidades).toEqual([]);
    for (const p of r) expect(p).not.toHaveProperty('custo_centavos');
    expect(await consulta.produtos(txA(), [])).toEqual([]);
    await admin("UPDATE cadastros.produto SET deleted_at = '2026-11-21T15:00:00Z' WHERE id = $1", [ids.p3]);
    expect((await consulta.produtos(txA(), [ids.p3 as string]))[0]?.inativo).toBe(true);
  });

  it('tabelaPadrao: a padrão vigente na data; fora da vigência dá null', async () => {
    expect(await consulta.tabelaPadrao(txA(), '2026-11-21')).toBe(ids.tabela);
    expect(await consulta.tabelaPadrao(txA(), '2026-12-31')).toBe(ids.tabela);
    expect(await consulta.tabelaPadrao(txA(), '2027-01-01')).toBeNull();
    expect(await consulta.tabelaPadrao(txA(), '2025-12-31')).toBeNull();
  });

  it('RN-CAD-06: precosVigentes usa o preço da filial e recua para a padrão; produto sem preço fica fora; vigência vencida dá vazio', async () => {
    const c = { tabela_preco_id: ids.tabela as string, filial_id: ids.filialOutra as string, produto_ids: [ids.p1 as string, ids.p2 as string, ids.p3 as string], data: '2026-11-21' };
    const r = await consulta.precosVigentes(txA(), c);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.produto_id === ids.p1)).toMatchObject({ preco_centavos: 2100, desconto_maximo_bp: 300, origem_filial_id: ids.filialOutra, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31' });
    expect(r.find((x) => x.produto_id === ids.p2)).toMatchObject({ preco_centavos: 3000, origem_filial_id: ids.filialPadrao, filial_id: ids.filialPadrao });
    expect(await consulta.precosVigentes(txA(), { ...c, data: '2027-01-01' })).toEqual([]);
    expect(await consulta.precosVigentes(txA(), { ...c, tabela_preco_id: randomUUID() })).toEqual([]);
    expect(await consulta.precosVigentes(txA(), { ...c, produto_ids: [] })).toEqual([]);
  });

  it('saldos: em lote por filial; produto sem linha de saldo fica fora', async () => {
    const r = await consulta.saldos(txA(), ids.filialPadrao as string, [ids.p1 as string, ids.p2 as string, ids.p3 as string]);
    expect(r).toEqual(expect.arrayContaining([{ filial_id: ids.filialPadrao, produto_id: ids.p1, quantidade: 10_0000 }, { filial_id: ids.filialPadrao, produto_id: ids.p2, quantidade: 5_0000 }]));
    expect(r).toHaveLength(2);
    expect(await consulta.saldos(txA(), ids.filialOutra as string, [ids.p1 as string])).toEqual([]);
    expect(await consulta.saldos(txA(), ids.filialPadrao as string, [])).toEqual([]);
  });

  it('condicao e vendedorDoUsuario', async () => {
    expect(await consulta.condicao(txA(), ids.condicao as string)).toMatchObject({ id: ids.condicao, codigo: '30D', forma_tpag: '15', prazos_dias: [30], inativo: false });
    expect(await consulta.condicao(txA(), randomUUID())).toBeNull();
    expect(await consulta.vendedorDoUsuario(txA(), adm.usuario_id)).toBe(ids.vendedor);
    expect(await consulta.vendedorDoUsuario(txA(), randomUUID())).toBeNull();
  });

  it('RLS: o tenant B não enxerga cliente, filial, produto, preço, saldo, condição, tabela padrão nem vendedor do A', async () => {
    const tx = txB();
    expect(await consulta.cliente(tx, ids.cliente as string)).toBeNull();
    expect(await consulta.filial(tx, ids.filialPadrao as string)).toBeNull();
    expect(await consulta.filialPadrao(tx)).toBeNull();
    expect(await consulta.produtos(tx, [ids.p1 as string, ids.p2 as string])).toEqual([]);
    expect(await consulta.tabelaPadrao(tx, '2026-11-21')).toBeNull();
    expect(await consulta.precosVigentes(tx, { tabela_preco_id: ids.tabela as string, filial_id: ids.filialPadrao as string, produto_ids: [ids.p1 as string], data: '2026-11-21' })).toEqual([]);
    expect(await consulta.saldos(tx, ids.filialPadrao as string, [ids.p1 as string])).toEqual([]);
    expect(await consulta.condicao(tx, ids.condicao as string)).toBeNull();
    expect(await consulta.vendedorDoUsuario(tx, adm.usuario_id)).toBeNull();
  });
});
