/**
 * Teste do adaptador SQL do cadastros contra o PostgreSQL real (migrações do `@macuxierp/db`, papel macuxierp_app, RLS por
 * tenant). Banco efêmero de `@macuxierp/platform-sdk/pg-testes`, migrado pela CLI do `@macuxierp/db` (o turbo repassa
 * `MACUXI_DB_MIGRACOES` e `MACUXI_PG_*`); sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 * Local: `bash db/scripts/pg-local.sh`. Cada chamada de `consultar` roda numa transação própria no papel da aplicação
 * e com `app.tenant_id` (`BancoPg.comTenant`), como a API faz.
 */
import { randomUUID } from 'node:crypto';
import { TRABALHO_CARGA_INICIAL, type PayloadCargaInicial } from '../contracts';
import { externalDoTrabalho } from './carga-inicial';
import { FilaDeTrabalhosPg } from '@macuxierp/platform-sdk/pg';
import type { Transacao } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPluginCadastros, exportadorCadastros } from './index';
import { TABELAS_EXPORTADAS } from './exportador';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { CNPJ_A, CNPJ_B, clienteValido, filialValida, produtoValido } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { repositoriosSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('adaptador SQL do cadastros (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const txA = () => transacaoDe(app, A);
  const txB = () => transacaoDe(app, B);
  const adm = sessaoDe('administrador');
  const gerente = sessaoDe('gerente');
  const certificados = { filialTemA1Valido: async () => true };
  const montar = (tx: Transacao) => criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }), new Date('2026-11-21T15:00:00Z'), tx);
  /** Comando ou consulta do admin (fora da RLS): massa de teste e conferências. Devolve as linhas. */
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'empresa-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'empresa-b', ['cadastros']);
    // As tabelas oficiais (NCM, CEST, municípios) já vêm das migrações/seeds do @macuxierp/db no banco efêmero.
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('fluxo real: filial, produto com NCM oficial, cliente, carteira, preço em lote e estoque, pelas rotas e pelo SQL', async () => {
    const a = montar(txA());
    const f = await a.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida() });
    expect(f.status).toBe(201);
    expect(f.corpo).toMatchObject({ cnpj: CNPJ_A, padrao: true, endereco: { municipio_ibge: '1302603' }, nfe_serie: 1 });
    expect((await a.chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ padrao: false }) })).status).toBe(409); // índice único do banco
    const vend = await a.chamar('POST', '/vendedores', { sessao: gerente, corpo: { codigo: 'V1', nome: 'Ana', filial_id: f.corpo.id, usuario_id: adm.usuario_id } });
    expect(vend.status).toBe(201);
    const cli = await a.chamar('POST', '/clientes', { sessao: adm, corpo: clienteValido(f.corpo.id, { limite_credito_centavos: 2_500_000_000, vendedor_id: vend.corpo.id }) });
    expect(cli.status).toBe(201);
    expect(cli.corpo).toMatchObject({ limite_credito_centavos: 2_500_000_000, documento: CNPJ_B });
    expect(cli.corpo.enderecos).toHaveLength(1);
    const meus = await a.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', adm.usuario_id), consulta: { busca: 'exemplo' } });
    expect(meus.corpo.itens.map((c: { id: string }) => c.id)).toEqual([cli.corpo.id]);
    expect((await a.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', randomUUID()) })).corpo).toEqual({ itens: [], proximo_cursor: null });

    expect((await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ ncm: '99999999', codigo: 'X' }) })).status).toBe(422); // NCM vencido
    expect(await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).toMatchObject({ status: 422, corpo: { campos: { cest: expect.any(String) } } }); // 2202 tem ST
    const prod = await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300700', fator_tributavel: 10_000 }) });
    expect(prod).toMatchObject({ status: 201, corpo: { codigo: 'P001', custo_centavos: 450, fator_tributavel: 10_000 } });
    expect((await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300700' }) })).status).toBe(409);
    // RN-CORE-05 (ADR 0010): adota no PATCH; a troca controlada grava no banco e publica external_id_anterior
    expect((await a.chamar('PATCH', `/produtos/${prod.corpo.id}`, { sessao: adm, corpo: { external_id: 'KIT-1' } })).status).toBe(200);
    expect(await a.chamar('POST', `/produtos/${prod.corpo.id}/external-id`, { sessao: adm, corpo: { external_id: 'KIT-2', motivo: 'Correção' } })).toMatchObject({ status: 200, corpo: { external_id: 'KIT-2' } });
    expect(a.eventos.at(-1)).toMatchObject({ nome: 'cadastros.produto.alterado@1', payload: { external_id: 'KIT-2', external_id_anterior: 'KIT-1' } });
    const un = await a.chamar('POST', `/produtos/${prod.corpo.id}/unidades`, { sessao: adm, corpo: { unidade: 'CX', fator: 120_000 } });
    expect(un).toMatchObject({ status: 201, corpo: { unidade: 'CX', fator: 120_000 } });
    expect(a.eventos.at(-1)).toMatchObject({ nome: 'cadastros.produto.alterado@1', payload: { unidades: [{ unidade: 'CX' }] } });

    const tab = await a.chamar('POST', '/tabelas-preco', { sessao: gerente, corpo: { nome: 'Varejo', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: true } });
    expect(tab).toMatchObject({ status: 201, corpo: { vigencia_inicio: '2026-01-01', vigencia_fim: null } });
    const lote = await a.chamar('PUT', `/tabelas-preco/${tab.corpo.id}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f.corpo.id, produto_id: prod.corpo.id, preco_centavos: 1990, desconto_maximo_bp: 500 }] } });
    expect(lote.corpo).toEqual({ recebidos: 1, alterados: 1 });
    expect((await a.chamar('PUT', `/tabelas-preco/${tab.corpo.id}/itens`, { sessao: gerente, corpo: { itens: [{ filial_id: f.corpo.id, produto_id: prod.corpo.id, preco_centavos: 1990, desconto_maximo_bp: 500 }] } })).corpo.alterados).toBe(0);
    const vig = await a.chamar('GET', '/precos/vigente', { sessao: adm, consulta: { produto_id: prod.corpo.id, filial_id: f.corpo.id, tabela_preco_id: tab.corpo.id, data: '2026-06-01' } });
    expect(vig.corpo).toMatchObject({ preco_centavos: 1990, desconto_maximo_bp: 500, origem_filial_id: f.corpo.id });

    const mov = await a.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: { filial_id: f.corpo.id, produto_id: prod.corpo.id, tipo: 'entrada', quantidade: 12_5000, motivo: 'Compra', external_id: 'm1' } });
    expect(mov).toMatchObject({ status: 201, corpo: { quantidade: 12_5000 } });
    expect(await a.chamar('POST', '/estoque/movimentos', { sessao: sessaoDe('faturista'), corpo: { filial_id: f.corpo.id, produto_id: prod.corpo.id, tipo: 'saida', quantidade: 20_0000, motivo: 'Venda' } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-07' } });
    expect((await a.chamar('POST', '/estoque/movimentos', { sessao: adm, corpo: { filial_id: f.corpo.id, produto_id: prod.corpo.id, tipo: 'entrada', quantidade: 12_5000, motivo: 'Compra', external_id: 'm1' } })).status).toBe(200);
    const lista = (await a.chamar('GET', '/estoque', { sessao: adm })).corpo;
    expect(lista).toEqual({ itens: [{ id: expect.any(String), filial_id: f.corpo.id, produto_id: prod.corpo.id, quantidade: 12_5000 }], proximo_cursor: null });
    expect((await a.chamar('GET', '/estoque', { sessao: adm, consulta: { busca: 'refrigerante', limite: 1 } })).corpo.itens).toHaveLength(1); // D-05: busca pelo produto
    expect((await a.chamar('GET', '/estoque', { sessao: adm, consulta: { busca: 'nada-disso' } })).corpo.itens).toEqual([]);
    expect((await a.chamar('GET', '/estoque', { sessao: adm, consulta: { cursor: lista.itens[0].id } })).corpo.itens).toEqual([]);
    // D-05: a busca do estoque ignora produto excluído (subconsulta em cadastros.produto filtra deleted_at)
    await admin('UPDATE cadastros.produto SET deleted_at = now() WHERE id = $1', [prod.corpo.id]);
    expect((await a.chamar('GET', '/estoque', { sessao: adm, consulta: { busca: 'refrigerante' } })).corpo.itens).toEqual([]);
    await admin('UPDATE cadastros.produto SET deleted_at = NULL WHERE id = $1', [prod.corpo.id]);

    const oficiais = await a.chamar('GET', '/oficiais/municipios', { sessao: sessaoDe('vendedor'), consulta: { uf: 'AM', busca: 'manaus' } });
    expect(oficiais.corpo).toMatchObject({ proximo_cursor: null, itens: [{ codigo: '1302603', nome: 'Manaus', uf: 'AM' }] });
    expect((await a.chamar('GET', '/oficiais/ncm', { sessao: adm, consulta: { busca: '22021000' } })).corpo.itens).toHaveLength(1);
    expect((await a.chamar('GET', '/oficiais/ncm', { sessao: adm, consulta: { busca: '99999999' } })).corpo.itens).toEqual([]); // o NCM vencido não aparece

    // carteira e inativação
    const v2 = await a.chamar('POST', '/vendedores', { sessao: gerente, corpo: { codigo: 'V2', nome: 'Beto', filial_id: f.corpo.id } });
    expect((await a.chamar('POST', '/carteira/transferir', { sessao: gerente, corpo: { de: vend.corpo.id, para: v2.corpo.id } })).corpo.total).toBe(1);
    expect((await a.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', adm.usuario_id) })).corpo.itens).toHaveLength(0);
    const del = await a.chamar('DELETE', `/clientes/${cli.corpo.id}`, { sessao: adm });
    expect(del.corpo.inativo).toBe(true);
    expect((await a.chamar('GET', '/clientes', { sessao: adm })).corpo.itens).toHaveLength(0);
    expect((await a.chamar('GET', '/clientes', { sessao: adm, consulta: { inativos: 'true' } })).corpo.itens).toHaveLength(1);
    expect((await admin('SELECT count(*)::int AS n FROM cadastros.cliente WHERE id = $1 AND deleted_at IS NOT NULL', [cli.corpo.id]))[0]?.n).toBe(1); // nunca apaga (RN-CAD-08)
  }, 180_000);

  it('D-06: ?filial_id= filtra os vendedores no Postgres', async () => {
    const a = montar(txA());
    const f = (await a.chamar('GET', '/filiais', { sessao: adm })).corpo.itens[0].id as string;
    const todos = (await a.chamar('GET', '/vendedores', { sessao: adm })).corpo.itens as { id: string }[];
    expect(todos.length).toBeGreaterThan(0);
    expect((await a.chamar('GET', '/vendedores', { sessao: adm, consulta: { filial_id: f } })).corpo.itens).toHaveLength(todos.length);
    expect((await a.chamar('GET', '/vendedores', { sessao: adm, consulta: { filial_id: randomUUID() } })).corpo.itens).toEqual([]);
  }, 60_000);

  it('PUT em lote com 5.000 itens grava em um comando e o segundo envio não altera nada', async () => {
    const a = montar(txA());
    const f = (await a.chamar('GET', '/filiais', { sessao: adm })).corpo.itens[0].id as string;
    await admin(`INSERT INTO cadastros.produto (tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao)
      SELECT '${A}', 'L' || g, 'Item ' || g, '22021000', 'UN', 'UN', 'G' FROM generate_series(1, 5000) g;`);
    const tab = (await a.chamar('GET', '/tabelas-preco', { sessao: adm })).corpo.itens[0].id as string;
    const ids = (await admin("SELECT id FROM cadastros.produto WHERE codigo LIKE 'L%'")).map((l) => l.id as string);
    const itens = ids.map((produto_id, i) => ({ filial_id: f, produto_id, preco_centavos: 100 + i, desconto_maximo_bp: 0 }));
    const r1 = await a.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens } });
    expect(r1).toMatchObject({ status: 200, corpo: { recebidos: 5000, alterados: 5000 } });
    expect((await a.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens } })).corpo.alterados).toBe(0);
    // cursor: 5.001 itens (5.000 + o do primeiro teste) em páginas de 200, sem repetir nem pular nenhum
    const vistos = new Set<string>();
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const p = await a.chamar('GET', `/tabelas-preco/${tab}/itens`, { sessao: adm, consulta: { limite: '200', ...(cursor ? { cursor } : {}) } });
      for (const i of p.corpo.itens as { id: string }[]) {
        expect(vistos.has(i.id)).toBe(false);
        vistos.add(i.id);
      }
      cursor = p.corpo.proximo_cursor ?? undefined;
      paginas++;
    } while (cursor);
    expect(vistos.size).toBe(5001);
    expect(paginas).toBe(26);
  }, 180_000);

  it('consulta externa: cache em cadastros.consulta_externa sem CPF ou sócios, e a IE pendente vira concluída', async () => {
    const a = montar(txA());
    const f = (await a.chamar('GET', '/filiais', { sessao: adm })).corpo.itens[0].id as string;
    const r = await a.chamar('POST', '/consultas/ie', { sessao: adm, corpo: { filial_id: f, uf: 'AM', documento: '012345679' } });
    expect(r.status).toBe(202);
    expect(a.trabalhos[0]?.tipo).toBe('cadastros.consultar_ie');
    expect((await a.chamar('GET', `/consultas/ie/${r.corpo.id}`, { sessao: adm })).corpo.estado).toBe('pendente');
    const linhas = await admin('SELECT tipo, chave, fonte FROM cadastros.consulta_externa WHERE tenant_id = $1', [A]);
    expect(linhas).toEqual([{ tipo: 'ie', chave: 'AM:012345679', fonte: 'sefaz' }]);
    await expect(admin(`INSERT INTO cadastros.consulta_externa (tenant_id, tipo, chave, resposta, fonte) VALUES ('${A}', 'cnpj', '52998224725', '{}', 'x')`)).rejects.toThrow(); // o banco recusa CPF como chave
  }, 120_000);

  it('RN-CORE-07: a exportação LGPD traz só as linhas do tenant (RLS), inclusive o cliente inativo, e nenhum dado do outro tenant', async () => {
    const dados = await app.comTenant(A, (tx) => exportadorCadastros.exportar(tx));
    expect(Object.keys(dados)).toEqual([...TABELAS_EXPORTADAS]);
    expect(dados.filial).toHaveLength(1);
    expect(dados.cliente).toHaveLength(1); // inativado no primeiro teste: a exportação traz também o inativo
    expect(dados.cliente_endereco?.length).toBeGreaterThan(0);
    expect(dados.produto?.length).toBeGreaterThan(5000);
    const deB = await app.comTenant(B, (tx) => exportadorCadastros.exportar(tx));
    expect(Object.values(deB).every((l) => l.length === 0)).toBe(true);
  }, 120_000);

  it('C-1 e C-4: nomesMunicipios pelo IBGE e página por cursor com inativos, só do tenant', async () => {
    const rA = repositoriosSql(txA());
    const nomes = await rA.oficiais.nomesMunicipios(['1302603', '0000000']);
    expect(nomes.get('0000000')).toBeUndefined();
    const todos: string[] = [];
    for (let apos: string | null = null; ; ) {
      const lote: { id: string }[] = await rA.clientes.paginaPorCursor(apos, 1);
      if (lote.length === 0) break;
      todos.push(...lote.map((c) => c.id));
      apos = (lote.at(-1) as { id: string }).id;
    }
    const esperados = (await admin(`SELECT id FROM cadastros.cliente WHERE tenant_id = '${A}' ORDER BY id;`)).map((l) => l.id as string);
    expect(todos).toEqual(esperados);
    expect(await repositoriosSql(txB()).clientes.paginaPorCursor(null, 10)).toEqual([]);
  }, 120_000);

  it('RLS: o tenant B não enxerga nada do tenant A pelo adaptador', async () => {
    const b = montar(txB());
    for (const rota of ['/filiais', '/clientes', '/produtos', '/tabelas-preco', '/vendedores', '/estoque']) {
      const r = await b.chamar('GET', rota, { sessao: adm });
      expect(r.corpo.itens, rota).toEqual([]);
    }
    const ncm = await b.chamar('GET', '/oficiais/ncm', { sessao: adm, consulta: { busca: '22021000' } });
    expect(ncm.corpo.itens).toHaveLength(1); // as tabelas oficiais são do tenant de referência e todo tenant lê
  }, 120_000);
  it('carga inicial: enfileira 1a e 2a página (cursor UUID e cursor composto do estoque) dentro do limite do external_id e o reenvio é idempotente', async () => {
    const fila = new FilaDeTrabalhosPg();
    const origem = randomUUID();
    const cursores: [PayloadCargaInicial['entidade'], string | null][] = [
      ['cliente', null], ['cliente', randomUUID()], ['estoque', null], ['estoque', `${randomUUID()}|${randomUUID()}`],
    ];
    const enviar = async () => {
      const ids: string[] = [];
      for (const [entidade, apos] of cursores) {
        const payload: PayloadCargaInicial = { origem, entidade, apos, tabela_id: null, pagina: 1, cursor_itens: null };
        const external_id = externalDoTrabalho(payload);
        expect(external_id.length).toBeLessThanOrEqual(64);
        ids.push((await fila.enfileirar(txA(), { tipo: TRABALHO_CARGA_INICIAL, tenant_id: A, payload, external_id })).id);
      }
      return ids;
    };
    const primeira = await enviar();
    expect(new Set(primeira).size).toBe(4);
    expect(await enviar()).toEqual(primeira);
    expect(Number((await admin(`SELECT count(*) AS n FROM plataforma.trabalho WHERE tipo = '${TRABALHO_CARGA_INICIAL}' AND tenant_id = '${A}';`))[0]?.n)).toBe(4);
  });
});
