/**
 * Pedido montado de verdade na API (T-0016, R-20261121-234202): `criarPluginPedido(dependenciasDeProducao(...))` sobre a
 * `criarConsultaParaPedido` do cadastros, no PostgreSQL migrado (papel `macuxierp_app`, RLS), com o **pino real** como
 * log da API e do módulo, escrevendo num destino em memória. Confere a ordem sessão → perfil → tenant → licença
 * (RN-CORE-02), o lançamento com `Idempotency-Key` (RN-CORE-05), o 422 RN-PED-02 e que nenhum dado pessoal do cliente
 * (nome, CPF, observação) chega ao log (regra 8). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { RepositorioCoreSql } from '@macuxierp/core/api';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, dependenciasCoreDeTeste, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { montarModulos } from './modulos';

// Massa repetida de propósito (RD-0430, manter): apps não se importam e a plataforma não conhece tabelas de módulo.
const NOME_CLIENTE = 'Maria Sigilosa da Silva';
const CPF_CLIENTE = '52998224725';
const OBSERVACAO = 'Entregar com o seu Joao no portao azul';

interface IdsMassaPedido {
  filial: string;
  cliente: string;
  produto: string;
  condicao: string;
  tabela: string;
}

/** Massa mínima do pedido (filial AM, à vista, tabela padrão, cliente PF com endereço e produto a R$ 19,90), pelo admin, fora da RLS. */
async function inserirMassaPedido(admin: BancoEfemero['admin'], tenant: string, ids: IdsMassaPedido, opcoes: { estoque?: number } = {}): Promise<void> {
  const q = (sql: string, p: unknown[]) => admin.query(sql, p);
  await q(
    `INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao, emissora, nfe_serie, nfe_numero_inicial)
     VALUES ($1, $2, '11222333000181', 'Filial Teste', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', true, true, 1, 1)`,
    [ids.filial, tenant],
  );
  await q(`INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias) VALUES ($1, $2, 'AV', 'À vista', '01', '{0}')`, [ids.condicao, tenant]);
  await q(`INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio, padrao) VALUES ($1, $2, 'Padrão', '2026-01-01', true)`, [ids.tabela, tenant]);
  await q(
    `INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id, tabela_preco_id, filial_id, limite_credito_centavos)
     VALUES ($1, $2, 'PF', $3, '9', $4, $5, $6, $7, 150000)`,
    [ids.cliente, tenant, CPF_CLIENTE, NOME_CLIENTE, ids.condicao, ids.tabela, ids.filial],
  );
  await q(
    `INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
     VALUES ($1, $2, 'principal', 'Rua B', '2', 'Centro', '1302603', 'AM', '69000001')`,
    [tenant, ids.cliente],
  );
  await q(
    `INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao, custo_centavos)
     VALUES ($1, $2, 'P1', 'Refrigerante 2 L', '22021000', 'UN', 'UN', 'padrao', 499)`,
    [ids.produto, tenant],
  );
  await q(`INSERT INTO cadastros.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos) VALUES ($1, $2, $3, $4, 1990)`, [tenant, ids.tabela, ids.filial, ids.produto]);
  if (opcoes.estoque !== undefined) {
    await q(`INSERT INTO cadastros.estoque_saldo (tenant_id, filial_id, produto_id, quantidade) VALUES ($1, $2, $3, $4)`, [tenant, ids.filial, ids.produto, opcoes.estoque]);
  }
}

describe.skipIf(!PG_DISPONIVEL)('pedido montado na API com o pino real (PostgreSQL)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let tenant: string;
  let semPedido: string;
  const linhas: string[] = [];
  const destino = new Writable({ write: (c, _e, cb) => (linhas.push(String(c)), cb()) });
  const ids = { filial: randomUUID(), cliente: randomUUID(), produto: randomUUID(), condicao: randomUUID(), tabela: randomUUID() };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, 'loja-pedido', ['cadastros', 'pedido']);
    semPedido = await criarTenant(b.admin, 'loja-sem-pedido', ['cadastros']);
    await inserirMassaPedido(b.admin, tenant, ids, { estoque: 1_000_000 });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: randomUUID(), email: 'adm@loja-pedido.teste', nome: 'Administradora', filialIds: [ids.filial] });
    await inserirAdministradorDeTeste(b.admin, semPedido, { id: randomUUID(), email: 'adm@loja-sem-pedido.teste', nome: 'Administradora', filialIds: [] });
    // Um pino só, de verdade, para a API (Fastify) e para o módulo (LogPedido): o mesmo formato de produção.
    const log = pino({ level: 'info', base: { servico: 'macuxierp-api' } }, destino);
    const modulos = montarModulos({ core: dependenciasCoreDeTeste(new RepositorioCoreSql()), log });
    ({ app } = await appPgDeTeste({ b, modulos, logger: { stream: destino } }));
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  async function token(empresa: string): Promise<string> {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa, email: `adm@${empresa}.teste`, senha: SENHA_DE_TESTE } });
    expect(r.statusCode).toBe(200);
    return `Bearer ${r.json<{ token_acesso: string }>().token_acesso}`;
  }

  const corpo = () => ({
    filial_id: ids.filial,
    cliente_id: ids.cliente,
    condicao_pagamento_id: ids.condicao,
    observacao: OBSERVACAO,
    itens: [{ produto_id: ids.produto, quantidade: 20_000, preco_unitario_centavos: 1990, desconto_centavos: 0 }],
  });

  it('RN-CORE-02: sem a licença do pedido, /v1/pedido dá 403 MODULO_INATIVO', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/pedido/pedidos', headers: { authorization: await token('loja-sem-pedido') } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
  });

  it('RN-CORE-05 e RN-PED-02: lança com Idempotency-Key (a repetição devolve o mesmo), aprovar de novo dá 422 e o pino não leva dado pessoal', async () => {
    const auth = await token('loja-pedido');
    const chave = randomUUID();
    const lancar = () => app.inject({ method: 'POST', url: '/v1/pedido/pedidos', headers: { authorization: auth, 'idempotency-key': chave }, payload: corpo() });
    const r = await lancar();
    expect(r.statusCode).toBe(201);
    const pedido = r.json<{ id: string; status: string; total_centavos: number }>();
    expect(pedido).toMatchObject({ status: 'aprovado', total_centavos: 3980 });
    const repetido = await lancar();
    expect(repetido.json<{ id: string }>().id).toBe(pedido.id);

    const lido = await app.inject({ method: 'GET', url: `/v1/pedido/pedidos/${pedido.id}`, headers: { authorization: auth } });
    expect(lido.statusCode).toBe(200);
    expect(lido.json()).toMatchObject({ id: pedido.id, cliente_retrato: { razao_social: NOME_CLIENTE } });

    const aprovar = await app.inject({ method: 'POST', url: `/v1/pedido/pedidos/${pedido.id}/aprovar`, headers: { authorization: auth }, payload: {} });
    expect(aprovar.statusCode).toBe(422);
    expect(aprovar.json()).toMatchObject({ codigo: 'RN-PED-02' });

    // O log do módulo saiu pelo pino real, em JSON, com tenant e módulo; nenhum dado pessoal em nenhuma linha.
    const registros = linhas.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(registros.find((x) => x.msg === 'pedido lançado')).toMatchObject({ servico: 'macuxierp-api', modulo: 'pedido', tenant_id: tenant, pedido_id: pedido.id, status: 'aprovado' });
    const texto = linhas.join('');
    for (const segredo of [NOME_CLIENTE, CPF_CLIENTE, OBSERVACAO, 'Rua B', SENHA_DE_TESTE]) expect(texto).not.toContain(segredo);
  });
});
