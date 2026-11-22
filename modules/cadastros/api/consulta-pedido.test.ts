/**
 * Consulta de cadastros para o pedido (T-0015) com o adaptador em memória: cada método da porta pelo caminho da
 * consulta, o inativo devolvido, o produto sem custo, o recuo do preço para a filial padrão (RN-CAD-06) e a lista vazia.
 * O mesmo cenário roda no PostgreSQL real em `consulta-pedido.db.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarConsultaParaPedido } from './consulta-pedido';
import { CNPJ_B, clienteValido, filialValida, produtoValido } from './fixtures-teste';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';

describe('consulta de cadastros para o pedido (memória)', () => {
  const m = dependenciasEmMemoria();
  const consulta = criarConsultaParaPedido(m.deps.repositorios);
  const tx = { consultar: async () => [] };
  const adm = sessaoDe('administrador');
  const gerente = sessaoDe('gerente');
  const ids: Record<string, string> = {};
  const DATA = '2026-11-21';

  beforeAll(async () => {
    m.repos.oficiais.municipios.set('1302603', 'Manaus');
    m.repos.oficiais.ncms.add('22021000');
    m.repos.oficiais.cests.set('22021000', ['0300700']);
    m.repos.oficiais.todosCests.add('0300700');
    const a = criarAmbiente(criarPluginCadastros(m.deps));
    const post = async (rota: string, corpo: unknown, sessao = adm) => {
      const r = await a.chamar('POST', rota, { sessao, corpo });
      expect(r.status, rota).toBe(201);
      return r.corpo as { id: string };
    };
    ids.filialPadrao = (await post('/filiais', filialValida())).id;
    ids.filialOutra = (await post('/filiais', filialValida({ cnpj: CNPJ_B, padrao: false, emissora: false }))).id;
    ids.cliente = (await post('/clientes', clienteValido(ids.filialPadrao, { limite_credito_centavos: 500_000 }))).id;
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
    expect((await a.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: { filial_id: ids.filialPadrao, produto_id: ids.p1, tipo: 'entrada', quantidade: 10_0000, motivo: 'Compra' } })).status).toBe(201);
  });

  it('produtos: em lote sem repetição, com unidades e sem custo; inativo volta marcado; lista vazia dá vazio', async () => {
    const r = await consulta.produtos(tx, [ids.p1 as string, ids.p2 as string, ids.p1 as string, randomUUID()]);
    expect(r.map((p) => p.id).sort()).toEqual([ids.p1, ids.p2].sort());
    expect(r.find((p) => p.id === ids.p1)).toMatchObject({ codigo: 'P001', ean: '7891000100103', inativo: false, unidades: [{ unidade: 'CX', fator: 120_000 }] });
    expect(r.find((p) => p.id === ids.p2)?.unidades).toEqual([]);
    for (const p of r) expect(p).not.toHaveProperty('custo_centavos');
    expect(await consulta.produtos(tx, [])).toEqual([]);
    const a = criarAmbiente(criarPluginCadastros(m.deps));
    expect((await a.chamar('DELETE', `/produtos/${ids.p3}`, { sessao: adm })).status).toBeLessThan(300);
    expect((await consulta.produtos(tx, [ids.p3 as string]))[0]?.inativo).toBe(true);
  });

  it('tabelaPadrao: a padrão vigente na data; fora da vigência dá null', async () => {
    expect(await consulta.tabelaPadrao(tx, DATA)).toBe(ids.tabela);
    expect(await consulta.tabelaPadrao(tx, '2026-12-31')).toBe(ids.tabela);
    expect(await consulta.tabelaPadrao(tx, '2027-01-01')).toBeNull();
    expect(await consulta.tabelaPadrao(tx, '2025-12-31')).toBeNull();
  });

  it('RN-CAD-06: precosVigentes usa a filial, recua para a padrão, deixa fora o produto sem preço e a tabela vencida', async () => {
    const c = { tabela_preco_id: ids.tabela as string, filial_id: ids.filialOutra as string, produto_ids: [ids.p1 as string, ids.p2 as string, ids.p3 as string], data: DATA };
    const r = await consulta.precosVigentes(tx, c);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.produto_id === ids.p1)).toMatchObject({ preco_centavos: 2100, origem_filial_id: ids.filialOutra });
    expect(r.find((x) => x.produto_id === ids.p2)).toMatchObject({ preco_centavos: 3000, origem_filial_id: ids.filialPadrao });
    expect(await consulta.precosVigentes(tx, { ...c, data: '2027-01-01' })).toEqual([]);
    expect(await consulta.precosVigentes(tx, { ...c, tabela_preco_id: randomUUID() })).toEqual([]);
    expect(await consulta.precosVigentes(tx, { ...c, produto_ids: [] })).toEqual([]);
  });

  it('saldos: em lote por filial; produto sem saldo e lista vazia dão vazio', async () => {
    const r = await consulta.saldos(tx, ids.filialPadrao as string, [ids.p1 as string, ids.p2 as string]);
    expect(r).toEqual([{ filial_id: ids.filialPadrao, produto_id: ids.p1, quantidade: 10_0000 }]);
    expect(await consulta.saldos(tx, ids.filialOutra as string, [ids.p1 as string])).toEqual([]);
    expect(await consulta.saldos(tx, ids.filialPadrao as string, [])).toEqual([]);
  });

  it('cliente e filial: só os campos do pick; filialPadrao', async () => {
    const c = await consulta.cliente(tx, ids.cliente as string);
    expect(c).toMatchObject({ id: ids.cliente, limite_credito_centavos: 500_000, inativo: false });
    expect(c).not.toHaveProperty('email');
    expect(await consulta.filial(tx, ids.filialOutra as string)).toEqual({ id: ids.filialOutra, emissora: false, padrao: false, inativo: false });
    expect(await consulta.filialPadrao(tx)).toBe(ids.filialPadrao);
    expect(await consulta.cliente(tx, randomUUID())).toBeNull();
  });
});
