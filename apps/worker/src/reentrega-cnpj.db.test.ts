/**
 * v0.3.25: reentrega do `core.empresa.cnpj_alterado@1` na partida, no PostgreSQL migrado com o papel `macuxierp_worker` (RLS).
 * No rollback de 27/11 a carga do fim da 0077 foi publicada pelo worker da v0.3.23, que não tinha o consumidor: evento com
 * `publicado_em` e sem linha em `evento_consumido`. A partida (reentrega real, `EVENTOS_REENTREGA_PADRAO`, consumidores de
 * `montarConsumidores`) leva o CNPJ à filial padrão uma vez; a segunda partida não entrega de novo; o evento com linha de
 * consumo é pulado. Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 */
import { EVENTO_CNPJ_ALTERADO } from '@macuxierp/core/contracts';
import { criarEvento } from '@macuxierp/platform-sdk';
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { despacharOutbox } from './despachante';
import { montarConsumidores } from './modulos';
import { FilaOutboxPg, FonteReentregaPg, RegistroConsumoPg } from './pg';
import { reentregarPublicados } from './reentrega';

const log = pino({ level: 'silent' });
const CNPJ_ANTIGO = '12345678000195';
const CNPJ_NOVO = '04252011000110';
const CNPJ_ANTIGO_2 = '11222333000181';
const CNPJ_NOVO_2 = '33000167000101';

describe.skipIf(!PG_DISPONIVEL)('worker: reentrega do cnpj_alterado publicado sem consumo (PostgreSQL, papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  const relogio = new RelogioFixo(new Date('2026-11-27T15:00:00Z'));
  const admin = async <L>(sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as L[];

  beforeAll(async () => {
    b = await criarBancoEfemero();
    app = b.banco('macuxierp_app');
    worker = b.banco('macuxierp_worker');
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  async function tenantComFilial(nome: string, cnpjFilial: string, cnpjEmpresa: string) {
    const T = await criarTenant(b.admin, nome, ['core', 'cadastros']);
    const [f] = await admin<{ id: string }>(
      `INSERT INTO cadastros.filial (tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao, external_id)
       VALUES ($1, $2, 'Filial Padrão', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', true, 'F01') RETURNING id`, [T, cnpjFilial],
    );
    const [e] = await admin<{ id: string }>("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Ltda', $2) RETURNING id", [T, cnpjEmpresa]);
    return { T, filial: f!.id, empresa: e!.id };
  }

  async function gravarCnpjAlterado(T: string, empresa: string, cnpj: string, requestId: string) {
    const e = criarEvento({
      nome: EVENTO_CNPJ_ALTERADO, tenant_id: T, agregado_id: T, ator: 'sistema', request_id: requestId,
      payload: { tenant_id: T, empresa_id: empresa, cnpj_novo: cnpj, request_id: requestId, alterado_em: relogio.agora().toISOString() },
    }, relogio.agora());
    await app.comTenant(T, (tx) => new OutboxPg().gravar(tx, e));
    return e;
  }

  const contagens = async () => ({
    auditoria: (await admin<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.auditoria'))[0]!.n,
    eventos: (await admin<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.evento'))[0]!.n,
    consumos: (await admin<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.evento_consumido'))[0]!.n,
  });

  it('publicado sem consumo → partida entrega uma vez (CNPJ, auditoria, filial.alterada); a segunda partida não repete; com linha de consumo é pulado', async () => {
    const a = await tenantComFilial('reentrega-cnpj-a', CNPJ_ANTIGO, CNPJ_NOVO);
    const z = await tenantComFilial('reentrega-cnpj-z', CNPJ_ANTIGO_2, CNPJ_NOVO_2);
    const ea = await gravarCnpjAlterado(a.T, a.empresa, CNPJ_NOVO, 'req-reentrega-cnpj-a');
    const ez = await gravarCnpjAlterado(z.T, z.empresa, CNPJ_NOVO_2, 'req-reentrega-cnpj-z');

    // O worker da v0.3.23 (sem o consumidor) publica a carga sem consumo.
    relogio.avancar(1_000);
    expect(await despacharOutbox({ banco: worker, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores: [], relogio, log }))
      .toMatchObject({ publicados: 2, falhas: 0 });
    expect(await admin('SELECT count(*)::int AS n FROM plataforma.evento WHERE publicado_em IS NULL')).toEqual([{ n: 0 }]);
    // O do tenant Z já tem linha de consumo (como se tivesse sido aplicado): a reentrega pula.
    await worker.comTenant(z.T, (tx) => new RegistroConsumoPg().registrar(tx, 'cadastros.cnpj-empresa', ez.id, relogio.agora()));

    const consumidores = montarConsumidores({ log, relogio });
    const partida = () => reentregarPublicados({ banco: worker, fonte: new FonteReentregaPg(), consumo: new RegistroConsumoPg(), consumidores, relogio, log });

    relogio.avancar(1_000);
    expect(await partida()).toEqual({ entregues: 1, falhas: 0 });
    expect(await admin('SELECT cnpj FROM cadastros.filial WHERE id = $1', [a.filial])).toEqual([{ cnpj: CNPJ_NOVO }]);
    expect(await admin('SELECT cnpj FROM cadastros.filial WHERE id = $1', [z.filial])).toEqual([{ cnpj: CNPJ_ANTIGO_2 }]);
    expect(await admin('SELECT acao, tenant_id FROM plataforma.auditoria WHERE request_id = $1', ['req-reentrega-cnpj-a']))
      .toEqual([{ acao: 'filial.atualizar', tenant_id: a.T }]);
    expect(await admin('SELECT count(*)::int AS n FROM plataforma.auditoria WHERE tenant_id = $1', [z.T])).toEqual([{ n: 0 }]);
    expect(await admin<{ nome: string; tenant_id: string }>(
      "SELECT nome, tenant_id FROM plataforma.evento WHERE nome = 'cadastros.filial.alterada@1'",
    )).toEqual([{ nome: 'cadastros.filial.alterada@1', tenant_id: a.T }]);
    expect(await admin("SELECT tenant_id FROM plataforma.evento_consumido WHERE consumidor = 'cadastros.cnpj-empresa' AND evento_id = $1", [ea.id]))
      .toEqual([{ tenant_id: a.T }]);

    const depois = await contagens();
    relogio.avancar(1_000);
    expect(await partida()).toEqual({ entregues: 0, falhas: 0 });
    expect(await contagens()).toEqual(depois);
    expect(await admin('SELECT cnpj FROM cadastros.filial WHERE id = $1', [a.filial])).toEqual([{ cnpj: CNPJ_NOVO }]);
  });
});
