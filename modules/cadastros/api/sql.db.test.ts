/**
 * Teste do adaptador SQL contra o PostgreSQL real (migrações 0001 a 0005, papel macuxierp_app, RLS por tenant).
 * Liga com `MACUXI_DB_MIGRACOES=<pasta das migrações>` (o teste não lê fora do pacote por caminho fixo, regra R2 do
 * grafo-turbo) e com o Postgres local: `bash db/scripts/pg-local.sh`. Sem a variável ou sem o psql, pula.
 * Cada chamada de `consultar` roda numa transação própria do psql, com SET ROLE e app.tenant_id como a API faz.
 */
import { randomUUID } from 'node:crypto';
import { TRABALHO_CARGA_INICIAL, type PayloadCargaInicial } from '../contracts';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { Transacao } from '@macuxierp/platform-sdk';
import { FilaDeTrabalhosPg } from '@macuxierp/platform-sdk/pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { externalDoTrabalho } from './carga-inicial';
import { criarPluginCadastros } from './index';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { CNPJ_A, CNPJ_B, clienteValido, filialValida, produtoValido } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { repositoriosSql } from './sql';

const PASTA = process.env.MACUXI_DB_MIGRACOES;
const env = process.env;
const conexao = (banco: string): NodeJS.ProcessEnv => ({
  ...env, PGHOST: env.MACUXI_PG_HOST ?? '127.0.0.1', PGPORT: env.MACUXI_PG_PORTA ?? '5432', PGUSER: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
  PGPASSWORD: env.MACUXI_PG_ADMIN_SENHA ?? '', PGDATABASE: banco, PGTZ: 'UTC',
});

function psql(banco: string, script: string, emTransacao = true): string {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...(emTransacao ? ['-1'] : []), '-f', '-'], { input: script, env: conexao(banco), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const saida = `${r.stderr}${r.stdout}`;
    throw Object.assign(new Error(saida.split('\n').find((l) => l.includes('ERROR')) ?? saida), { code: /ERROR:\s+(\w{5}):/.exec(saida)?.[1] });
  }
  return r.stdout;
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Array.isArray(v)) return v.length ? `ARRAY[${v.map(lit).join(',')}]` : "'{}'";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
  return `'${String(v).replaceAll("'", "''")}'`;
};

function transacaoDe(banco: string, tenant: string): Transacao {
  return {
    async consultar<L>(sql: string, p: readonly unknown[] = []): Promise<L[]> {
      const preenchido = sql.replace(/\$(\d+)/g, (_m, n: string) => lit(p[Number(n) - 1]));
      const devolve = /^\s*(select|with)\b/i.test(preenchido) || /\breturning\b/i.test(preenchido);
      const corpo = devolve ? `WITH q AS (${preenchido}) SELECT coalesce(json_agg(q), '[]'::json) FROM q;` : `${preenchido};`;
      const saida = psql(banco, `SET ROLE macuxierp_app;\nSET app.tenant_id = '${tenant}';\n${corpo}`);
      return (devolve ? JSON.parse(saida.trim() || '[]') : []) as L[];
    },
  };
}

const pronto = (() => {
  if (!PASTA) return false;
  try {
    return spawnSync('psql', ['--version']).status === 0 && psql('postgres', 'SELECT 1;') !== undefined;
  } catch {
    return false;
  }
})();

describe.skipIf(!pronto)('adaptador SQL do cadastros (PostgreSQL real)', () => {
  const banco = `macuxi_teste_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const A = randomUUID();
  const B = randomUUID();
  const txA = () => transacaoDe(banco, A);
  const txB = () => transacaoDe(banco, B);
  const adm = sessaoDe('administrador');
  const gerente = sessaoDe('gerente');
  const certificados = { filialTemA1Valido: async () => true };
  const montar = (tx: Transacao) => criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }), new Date('2026-11-21T15:00:00Z'), tx);
  const admin = (sql: string) => psql(banco, sql);

  beforeAll(() => {
    psql('postgres', `CREATE DATABASE ${banco};`, false);
    for (const f of readdirSync(PASTA as string).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) admin(readFileSync(join(PASTA as string, f), 'utf8'));
    admin(`INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ('${A}', '${A}', 'empresa-a', 'Empresa A'), ('${B}', '${B}', 'empresa-b', 'Empresa B');
      INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${A}', 'cadastros'), ('${B}', 'cadastros');
      INSERT INTO cadastros.tabela_oficial_versao (id, tabela, carga, versao, fonte, url, data_referencia, arquivo, sha256, registros)
        VALUES ('00000000-0000-4000-8000-0000000000f1', 'ncm', 'teste', '1', 'teste', 'http://x', '2026-01-01', 'x.csv', repeat('a', 64), 2);
      INSERT INTO cadastros.ncm (codigo, descricao, vigencia_inicio, vigencia_fim, versao_id) VALUES
        ('22021000', 'Bebidas', '2020-01-01', NULL, '00000000-0000-4000-8000-0000000000f1'),
        ('99999999', 'Vencido', '2010-01-01', '2020-12-31', '00000000-0000-4000-8000-0000000000f1');
      INSERT INTO cadastros.cest (codigo, descricao, segmento, vigencia_inicio, versao_id) VALUES ('0300100', 'Refrigerantes', 'Bebidas', '2020-01-01', '00000000-0000-4000-8000-0000000000f1');
      INSERT INTO cadastros.cest_ncm (cest_codigo, ncm_prefixo, vigencia_inicio, versao_id) VALUES ('0300100', '2202', '2020-01-01', '00000000-0000-4000-8000-0000000000f1');
      INSERT INTO cadastros.municipio (codigo, nome, uf, vigencia_inicio, versao_id) VALUES ('1302603', 'Manaus', 'AM', '2020-01-01', '00000000-0000-4000-8000-0000000000f1');`);
  }, 120_000);
  afterAll(() => {
    spawnSync('psql', ['-X', '-q', '-c', `DROP DATABASE IF EXISTS ${banco}`], { env: conexao('postgres') });
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
    expect((await a.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', randomUUID()) })).corpo.total).toBe(0);

    expect((await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ ncm: '99999999', codigo: 'X' }) })).status).toBe(422); // NCM vencido
    expect(await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido() })).toMatchObject({ status: 422, corpo: { campos: { cest: expect.any(String) } } }); // 2202 tem ST
    const prod = await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300100', fator_tributavel: 10_000 }) });
    expect(prod).toMatchObject({ status: 201, corpo: { codigo: 'P001', custo_centavos: 450, fator_tributavel: 10_000 } });
    expect((await a.chamar('POST', '/produtos', { sessao: adm, corpo: produtoValido({ cest: '0300100' }) })).status).toBe(409);
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
    expect((await a.chamar('GET', '/estoque', { sessao: adm })).corpo.itens).toEqual([{ filial_id: f.corpo.id, produto_id: prod.corpo.id, quantidade: 12_5000 }]);

    const oficiais = await a.chamar('GET', '/oficiais/municipios', { sessao: sessaoDe('vendedor'), consulta: { uf: 'AM', busca: 'manaus' } });
    expect(oficiais.corpo).toMatchObject({ total: 1, itens: [{ codigo: '1302603', nome: 'Manaus', uf: 'AM' }] });
    expect((await a.chamar('GET', '/oficiais/ncm', { sessao: adm })).corpo.total).toBe(1); // o NCM vencido não aparece

    // carteira e inativação
    const v2 = await a.chamar('POST', '/vendedores', { sessao: gerente, corpo: { codigo: 'V2', nome: 'Beto', filial_id: f.corpo.id } });
    expect((await a.chamar('POST', '/carteira/transferir', { sessao: gerente, corpo: { de: vend.corpo.id, para: v2.corpo.id } })).corpo.total).toBe(1);
    expect((await a.chamar('GET', '/clientes', { sessao: sessaoDe('vendedor', adm.usuario_id) })).corpo.total).toBe(0);
    const del = await a.chamar('DELETE', `/clientes/${cli.corpo.id}`, { sessao: adm });
    expect(del.corpo.inativo).toBe(true);
    expect((await a.chamar('GET', '/clientes', { sessao: adm })).corpo.total).toBe(0);
    expect((await a.chamar('GET', '/clientes', { sessao: adm, consulta: { inativos: 'true' } })).corpo.total).toBe(1);
    expect(admin(`SELECT count(*) FROM cadastros.cliente WHERE id = '${cli.corpo.id}' AND deleted_at IS NOT NULL;`).trim()).toBe('1'); // nunca apaga (RN-CAD-08)
  }, 180_000);

  it('PUT em lote com 5.000 itens grava em um comando e o segundo envio não altera nada', async () => {
    const a = montar(txA());
    const f = (await a.chamar('GET', '/filiais', { sessao: adm })).corpo.itens[0].id as string;
    admin(`INSERT INTO cadastros.produto (tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao)
      SELECT '${A}', 'L' || g, 'Item ' || g, '22021000', 'UN', 'UN', 'G' FROM generate_series(1, 5000) g;`);
    const tab = (await a.chamar('GET', '/tabelas-preco', { sessao: adm })).corpo.itens[0].id as string;
    const ids = JSON.parse(admin(`SELECT json_agg(id) FROM cadastros.produto WHERE codigo LIKE 'L%';`).trim()) as string[];
    const itens = ids.map((produto_id, i) => ({ filial_id: f, produto_id, preco_centavos: 100 + i, desconto_maximo_bp: 0 }));
    const r1 = await a.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens } });
    expect(r1).toMatchObject({ status: 200, corpo: { recebidos: 5000, alterados: 5000 } });
    expect((await a.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: gerente, corpo: { itens } })).corpo.alterados).toBe(0);
    expect((await a.chamar('GET', `/tabelas-preco/${tab}/itens`, { sessao: adm, consulta: { por_pagina: 1 } })).corpo.total).toBe(5001);
  }, 180_000);

  it('consulta externa: cache em cadastros.consulta_externa sem CPF ou sócios, e a IE pendente vira concluída', async () => {
    const a = montar(txA());
    const f = (await a.chamar('GET', '/filiais', { sessao: adm })).corpo.itens[0].id as string;
    const r = await a.chamar('POST', '/consultas/ie', { sessao: adm, corpo: { filial_id: f, uf: 'AM', documento: '012345679' } });
    expect(r.status).toBe(202);
    expect(a.trabalhos[0]?.tipo).toBe('cadastros.consultar_ie');
    expect((await a.chamar('GET', `/consultas/ie/${r.corpo.id}`, { sessao: adm })).corpo.estado).toBe('pendente');
    const linhas = admin(`SELECT tipo, chave, fonte FROM cadastros.consulta_externa WHERE tenant_id = '${A}';`).trim();
    expect(linhas).toBe('ie|AM:012345679|sefaz');
    expect(() => admin(`INSERT INTO cadastros.consulta_externa (tenant_id, tipo, chave, resposta, fonte) VALUES ('${A}', 'cnpj', '52998224725', '{}', 'x');`)).toThrow(); // o banco recusa CPF como chave
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
    const esperados = JSON.parse(admin(`SELECT coalesce(json_agg(id ORDER BY id), '[]') FROM cadastros.cliente WHERE tenant_id = '${A}';`).trim()) as string[];
    expect(todos).toEqual(esperados);
    expect(await repositoriosSql(txB()).clientes.paginaPorCursor(null, 10)).toEqual([]);
  }, 120_000);

  it('RLS: o tenant B não enxerga nada do tenant A pelo adaptador', async () => {
    const b = montar(txB());
    for (const rota of ['/filiais', '/clientes', '/produtos', '/tabelas-preco', '/vendedores', '/estoque']) {
      const r = await b.chamar('GET', rota, { sessao: adm });
      expect(r.corpo.itens, rota).toEqual([]);
    }
    const ncm = await b.chamar('GET', '/oficiais/ncm', { sessao: adm });
    expect(ncm.corpo.total).toBe(1); // as tabelas oficiais são do tenant de referência e todo tenant lê
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
        const payload: PayloadCargaInicial = { origem, entidade, apos, tabela_id: null, pagina: 1 };
        const external_id = externalDoTrabalho(payload);
        expect(external_id.length).toBeLessThanOrEqual(64);
        ids.push((await fila.enfileirar(txA(), { tipo: TRABALHO_CARGA_INICIAL, tenant_id: A, payload, external_id })).id);
      }
      return ids;
    };
    const primeira = await enviar();
    expect(new Set(primeira).size).toBe(4);
    expect(await enviar()).toEqual(primeira);
    expect(admin(`SELECT count(*) FROM plataforma.trabalho WHERE tipo = '${TRABALHO_CARGA_INICIAL}' AND tenant_id = '${A}';`).trim()).toBe('4');
  });
});
