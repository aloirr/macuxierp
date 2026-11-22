/**
 * Recebedor do pedido do FDV montado como no worker (T-0016, R-20261121-234202): `criarRecebedorFdv` com as dependências
 * de produção do pedido, a `criarConsultaParaPedido` do cadastros em SQL e licença, outbox e auditoria em PostgreSQL, no
 * papel `macuxierp_worker` (RLS). Log no pino real, sem dado pessoal. Sem rede e sem Hub: só a porta que a agenda do
 * `integracao-fdv` vai chamar. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { randomUUID } from 'node:crypto';
import { criarResolvedorChaveErp, repositoriosSql } from '@macuxierp/cadastros/api';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinoEmMemoria } from './apoio-teste';
import { montarPedidosFdv } from './pedidos-fdv';

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
async function inserirMassaPedido(admin: BancoEfemero['admin'], tenant: string, ids: IdsMassaPedido): Promise<void> {
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
}

const AGORA = new Date('2026-11-22T12:00:00Z');

describe.skipIf(!PG_DISPONIVEL)('recebedor do pedido do FDV montado no worker (PostgreSQL, papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let worker: BancoPg;
  let comPedido: string;
  let semPedido: string;
  let recebedor: ReturnType<typeof montarPedidosFdv>['recebedor'];
  const { log, linhas, registros } = pinoEmMemoria();
  const ids = { filial: randomUUID(), cliente: randomUUID(), produto: randomUUID(), condicao: randomUUID(), tabela: randomUUID() };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    worker = b.banco('macuxierp_worker');
    comPedido = await criarTenant(b.admin, 'worker-fdv', ['cadastros', 'pedido', 'integracao-fdv']);
    semPedido = await criarTenant(b.admin, 'worker-fdv-sem-pedido', ['cadastros', 'integracao-fdv']);
    await inserirMassaPedido(b.admin, comPedido, ids);
    ({ recebedor } = montarPedidosFdv({ log, relogio: new RelogioFixo(AGORA), recebimento: 'desligado', resolvedor: criarResolvedorChaveErp(repositoriosSql), agendaDoModulo: false }));
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  const entrada = (pedido_uuid = randomUUID(), cliente_id = ids.cliente) => ({
    pedido_uuid,
    cliente_id,
    vendedor_id: null,
    filial_id: ids.filial,
    condicao_pagamento_id: ids.condicao,
    emitido_em: '2026-11-22T11:00:00.000Z',
    aprovado_origem_em: '2026-11-22T11:05:00.000Z',
    observacao: OBSERVACAO,
    frete: null,
    endereco_entrega: null,
    total_informado_centavos: 3980,
    itens: [{ sequencia: 1, produto_id: ids.produto, quantidade: 20_000, unidade_venda: 'UN', fator_venda: 10_000, quantidade_venda: 20_000, preco_unitario_centavos: 1990, desconto_centavos: 0, total_informado_centavos: 3980, aplicacao: null }],
  });

  it('RF-PED-01 e RN-PED-01: cria aprovado com eventos na outbox, a repetição devolve o mesmo, e o pino não leva dado pessoal', async () => {
    const uuid = randomUUID();
    const r = await worker.comTenant(comPedido, (tx) => recebedor.receber(tx, entrada(uuid)));
    expect(r).toMatchObject({ resultado: 'criado', status: 'aprovado', numero: 1 });
    expect(await worker.comTenant(comPedido, (tx) => recebedor.receber(tx, entrada(uuid)))).toMatchObject({ resultado: 'repetido', numero: 1 });
    const eventos = await b.admin.query<{ nome: string }>('SELECT nome FROM plataforma.evento WHERE tenant_id = $1 ORDER BY versao', [comPedido]);
    expect(eventos.rows.map((e) => e.nome)).toEqual(['pedido.pedido.recebido@1', 'pedido.pedido.aprovado@1']);
    const auditoria = await b.admin.query('SELECT acao, usuario_id FROM plataforma.auditoria WHERE tenant_id = $1', [comPedido]);
    expect(auditoria.rows).toEqual([{ acao: 'pedido.receber', usuario_id: null }]);

    // cadastro desconhecido recusa sem gastar número; o log sai em JSON com tenant e módulo
    expect(await worker.comTenant(comPedido, (tx) => recebedor.receber(tx, entrada(randomUUID(), randomUUID())))).toEqual({ resultado: 'recusado', codigo: 'cliente_inexistente' });
    expect(registros()).toContainEqual(expect.objectContaining({ modulo: 'pedido', tenant_id: comPedido, codigo: 'cliente_inexistente' }));
    const texto = linhas.join('');
    for (const s of [NOME_CLIENTE, CPF_CLIENTE, OBSERVACAO, 'Rua B']) expect(texto).not.toContain(s);
  });

  it('sem a licença do pedido, recusa com modulo_pedido_inativo e não grava nada (a agenda do módulo desliga a busca)', async () => {
    expect(await worker.comTenant(semPedido, (tx) => recebedor.receber(tx, entrada()))).toEqual({ resultado: 'recusado', codigo: 'modulo_pedido_inativo' });
    const n = await b.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM pedido.pedido WHERE tenant_id = $1', [semPedido]);
    expect(n.rows[0]!.n).toBe(0);
  });
});
