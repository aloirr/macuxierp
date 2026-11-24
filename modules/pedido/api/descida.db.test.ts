/**
 * Fila de descida contra o PostgreSQL real. DEPENDE da migração 0045 do banco-dados (`pedido.descida_pedido`; ADR 0014 §8):
 * enquanto a tabela não existir no banco efêmero, os testes pulam (não criam migração). Local: `bash db/scripts/pg-local.sh`.
 */
import { auditar, criarEvento, type Transacao } from '@macuxierp/platform-sdk';
import { AuditoriaPg, LicencasPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarServicoDescida } from './descida';
import { filaDescidaSql } from './descida-sql';
import { IDS, pedidoManual, prepararCadastros } from './fixtures-teste';
import { dependenciasDeProducao } from './index';
import { CadastrosMemoria } from './memoria';
import { criarServico, type Efeitos } from './servico';

const AGORA = new Date('2026-11-24T14:00:00Z');
const USUARIO = '22222222-2222-4222-8222-222222222222';
const RETORNO_EM = '2026-11-24T15:00:00.000Z';

describe.skipIf(!PG_DISPONIVEL)('fila de descida do pedido (PostgreSQL real, migração 0045)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let ponte: string;
  let ligado: string;
  let outro: string;
  let temTabela = false;
  const cad = new CadastrosMemoria();
  const deps = dependenciasDeProducao(cad);
  const servico = criarServico(deps);
  const descida = criarServicoDescida({ ...deps, fila: filaDescidaSql, licencas: new LicencasPg() });
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any

  const efeitos = (tx: Transacao, tenant: string): Efeitos => ({
    tenant_id: tenant,
    ator: { tipo: 'usuario', id: USUARIO, perfil: 'administrador' },
    agora: AGORA,
    publicar: async (e) => {
      const ev = criarEvento({ nome: e.nome, tenant_id: tenant, agregado_id: e.agregado_id, ator: USUARIO, request_id: 'req-db', payload: e.payload }, AGORA);
      await new OutboxPg().gravar(tx, ev);
      return ev.id;
    },
    auditar: async (d) => void (await auditar(new AuditoriaPg(), tx, { tenant_id: tenant, usuario_id: USUARIO, request_id: 'req-db' }, d, AGORA)),
  });
  const novoAprovado = (tenant: string) =>
    app.comTenant(tenant, async (tx) => {
      const r = await servico.lancar(tx, efeitos(tx, tenant), pedidoManual());
      await descida.enfileirar(tx, efeitos(tx, tenant), r.pedido.id);
      return r.pedido.id;
    });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    ponte = await criarTenant(efemero.admin, 'empresa-ponte', ['pedido']);
    ligado = await criarTenant(efemero.admin, 'empresa-ligada', ['pedido', 'faturamento']);
    outro = await criarTenant(efemero.admin, 'empresa-outra', ['pedido']);
    prepararCadastros(cad, { saldo: 1_000_000_000 });
    temTabela = (await admin("SELECT to_regclass('pedido.descida_pedido') AS t"))[0]?.t != null;
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-PED-01: enfileirar duas vezes grava uma linha; pendentes lista só o do tenant (RLS); marcar descido duas vezes mantém o primeiro carimbo', async (ctx) => {
    if (!temTabela) return ctx.skip();
    const id = await novoAprovado(ponte);
    await novoAprovado(outro);
    await app.comTenant(ponte, async (tx) => expect(await descida.enfileirar(tx, efeitos(tx, ponte), id)).toBe(false));
    expect(await admin('SELECT pedido_id FROM pedido.descida_pedido WHERE pedido_id = $1', [id])).toHaveLength(1);
    const pendentes = await app.comTenant(ponte, (tx) => descida.pendentes(tx, efeitos(tx, ponte)));
    expect(pendentes.map((p) => p.pedido_id)).toEqual([id]);
    expect(await app.comTenant(ponte, (tx) => descida.marcarDescido(tx, efeitos(tx, ponte), id))).toEqual({ resultado: 'marcado', pedido_id: id });
    expect(await app.comTenant(ponte, (tx) => descida.marcarDescido(tx, efeitos(tx, ponte), id))).toEqual({ resultado: 'repetido', pedido_id: id });
    expect(await app.comTenant(ponte, (tx) => descida.pendentes(tx, efeitos(tx, ponte)))).toEqual([]);
    expect(await app.comTenant(ponte, (tx) => filaDescidaSql(tx).obter(id))).toMatchObject({ descido_em: AGORA.toISOString() });
  });

  it('RN-PED-02: no modo ponte o retorno faturado_total passa pelo gatilho do banco e é idempotente; com o faturamento ligado é recusado', async (ctx) => {
    if (!temTabela) return ctx.skip();
    const id = await novoAprovado(ponte);
    const uuid = id;
    const r1 = await app.comTenant(ponte, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ponte), { pedido_uuid: uuid, status: 'faturado_total', ocorrido_em: RETORNO_EM }));
    expect(r1).toEqual({ resultado: 'aplicado', pedido_id: id, status: 'faturado' });
    const r2 = await app.comTenant(ponte, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ponte), { pedido_uuid: uuid, status: 'faturado_total', ocorrido_em: RETORNO_EM }));
    expect(r2.resultado).toBe('repetido');
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [id]))[0]?.status).toBe('faturado');
    expect(await admin("SELECT nome FROM plataforma.evento WHERE agregado_id = $1 AND nome LIKE '%faturado_cliente%'", [id])).toHaveLength(1);
    const idL = await novoAprovado(ligado);
    await expect(app.comTenant(ligado, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ligado), { pedido_uuid: idL, status: 'faturado_total', ocorrido_em: RETORNO_EM }))).rejects.toMatchObject({ status: 422 });
  });

  it('RN-PED-02: a referência da nota do cliente grava as quatro colunas, troca no parcial, recusa a divergente (409) e o cancelado não a toca', async (ctx) => {
    if (!temTabela || !(await admin("SELECT 1 FROM information_schema.columns WHERE table_schema = 'pedido' AND table_name = 'pedido' AND column_name = 'nota_cliente_numero'")).length) return ctx.skip();
    const A = { numero: '1234', serie: '1', chave: '13261112345678000195550010000012341000000014', emitida_em: '2026-11-24T13:30:00.000Z', total_centavos: 2000 };
    const B = { numero: '1240', serie: '2', chave: '13261112345678000195550010000012401000000020', emitida_em: '2026-11-24T13:45:00.000Z', total_centavos: 3500 };
    const refA = { numero: 1234, serie: 1, emitida_em: A.emitida_em, total_centavos: 2000 };
    const id = await novoAprovado(ponte);
    const aplicar = (status: 'faturado_parcial' | 'faturado_total' | 'cancelado', nota?: typeof A) =>
      app.comTenant(ponte, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ponte), { pedido_uuid: id, status, ...(nota ? { nota } : {}), ocorrido_em: RETORNO_EM }));
    const colunas = async () => (await admin('SELECT nota_cliente_numero n, nota_cliente_serie s, nota_cliente_emitida_em e, nota_cliente_total_centavos t FROM pedido.pedido WHERE id = $1', [id]))[0];
    await aplicar('faturado_parcial', A);
    expect(await colunas()).toMatchObject({ n: 1234, s: 1, t: '2000' });
    expect(await app.comTenant(ponte, (tx) => filaDescidaSql(tx).notaCliente(id))).toEqual(refA);
    await aplicar('faturado_parcial', B);
    expect(await colunas()).toMatchObject({ n: 1240, s: 2, t: '3500' });
    await aplicar('faturado_total', A);
    await expect(aplicar('faturado_total', B)).rejects.toMatchObject({ status: 409, detalhes: { codigo: 'nota_cliente_divergente' } });
    expect(await colunas()).toMatchObject({ n: 1234 });
    const id2 = await novoAprovado(ponte);
    await app.comTenant(ponte, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ponte), { pedido_uuid: id2, status: 'faturado_parcial', nota: A, ocorrido_em: RETORNO_EM }));
    await app.comTenant(ponte, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ponte), { pedido_uuid: id2, status: 'cancelado', nota: B, ocorrido_em: RETORNO_EM }));
    expect(await app.comTenant(ponte, (tx) => filaDescidaSql(tx).notaCliente(id2))).toEqual(refA);
  });

  it('RN-PED-02: retorno de pedido de outro tenant é 404', async (ctx) => {
    if (!temTabela) return ctx.skip();
    const id = await novoAprovado(outro);
    await expect(app.comTenant(ponte, (tx) => descida.aplicarRetorno(tx, efeitos(tx, ponte), { pedido_uuid: id, status: 'cancelado', ocorrido_em: RETORNO_EM }))).rejects.toMatchObject({ status: 404 });
    expect(IDS.filial).toBeTruthy();
  });
});
