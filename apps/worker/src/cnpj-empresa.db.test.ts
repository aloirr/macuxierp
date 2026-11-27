/**
 * RN-CORE-14 e RN-CORE-16 (v0.3.24) no worker montado como no `main.ts` (`montarConsumidores` + `despacharOutbox`), no
 * PostgreSQL migrado com o papel `macuxierp_worker` (RLS): `core.empresa.cnpj_alterado@1` leva o CNPJ à filial padrão, sai um
 * `cadastros.filial.alterada@1`, o consumidor da empresa da filial não faz nada (a empresa já existe) e a cadeia termina:
 * nenhum novo `cnpj_alterado`, nenhum evento pendente. O consumidor isolado está em modules/cadastros (consumidor-cnpj-empresa.db.test.ts).
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
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
import { FilaOutboxPg, RegistroConsumoPg } from './pg';

const log = pino({ level: 'silent' });
const CNPJ_ANTIGO = '12345678000195';
const CNPJ_NOVO = '04252011000110';

describe.skipIf(!PG_DISPONIVEL)('worker: troca do CNPJ da empresa chega à filial padrão sem laço (PostgreSQL, papel macuxierp_worker)', () => {
  let b: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let T: string;
  let filial: string;
  let empresa: string;
  const relogio = new RelogioFixo(new Date('2026-11-27T15:00:00Z'));
  const admin = async <L>(sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as L[];

  beforeAll(async () => {
    b = await criarBancoEfemero();
    app = b.banco('macuxierp_app');
    worker = b.banco('macuxierp_worker');
    T = await criarTenant(b.admin, 'worker-cnpj', ['core', 'cadastros']);
    [{ id: filial }] = await admin<{ id: string }>(
      `INSERT INTO cadastros.filial (tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao, external_id)
       VALUES ($1, $2, 'Filial Padrão', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', true, 'F01') RETURNING id`, [T, CNPJ_ANTIGO],
    ) as [{ id: string }];
    [{ id: empresa }] = await admin<{ id: string }>(
      "INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Ltda', $2) RETURNING id", [T, CNPJ_NOVO],
    ) as [{ id: string }];
  }, 120_000);
  afterAll(async () => {
    await b?.remover();
  });

  it('cnpj_alterado → filial recebe o CNPJ → um filial.alterada → a cadeia para (sem novo cnpj_alterado, nada pendente)', async () => {
    const e = criarEvento({
      nome: EVENTO_CNPJ_ALTERADO, tenant_id: T, agregado_id: T, ator: 'sistema', request_id: 'req-worker-cnpj',
      payload: { tenant_id: T, empresa_id: empresa, cnpj_novo: CNPJ_NOVO, request_id: 'req-worker-cnpj', alterado_em: relogio.agora().toISOString() },
    }, relogio.agora());
    await app.comTenant(T, (tx) => new OutboxPg().gravar(tx, e));

    const consumidores = montarConsumidores({ log, relogio });
    const resumos = [];
    for (let i = 0; i < 5; i++) {
      relogio.avancar(1_000);
      const r = await despacharOutbox({ banco: worker, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores, relogio, log });
      resumos.push(r);
      if (r.publicados === 0) break;
    }
    // 1ª rodada: o cnpj_alterado; 2ª: o filial.alterada que ele gerou; 3ª: nada mais.
    expect(resumos).toEqual([
      { publicados: 1, falhas: 0, adiados: 0, desistidos: 0 },
      { publicados: 1, falhas: 0, adiados: 0, desistidos: 0 },
      { publicados: 0, falhas: 0, adiados: 0, desistidos: 0 },
    ]);

    expect(await admin('SELECT cnpj, external_id FROM cadastros.filial WHERE id = $1', [filial])).toEqual([{ cnpj: CNPJ_NOVO, external_id: 'F01' }]);
    const eventos = await admin<{ nome: string; publicado: boolean; erro: string | null }>(
      'SELECT nome, publicado_em IS NOT NULL AS publicado, erro FROM plataforma.evento WHERE tenant_id = $1 ORDER BY ocorrido_em', [T],
    );
    expect(eventos).toEqual([
      { nome: EVENTO_CNPJ_ALTERADO, publicado: true, erro: null },
      { nome: 'cadastros.filial.alterada@1', publicado: true, erro: null },
    ]);
    const consumos = await admin<{ consumidor: string }>(
      'SELECT consumidor FROM plataforma.evento_consumido WHERE tenant_id = $1 ORDER BY consumidor', [T],
    );
    expect(consumos.map((c) => c.consumidor)).toEqual(expect.arrayContaining(['cadastros.cnpj-empresa', 'core.empresa-da-filial-padrao']));
    // A empresa não muda (já existia): uma linha, o mesmo CNPJ; nenhuma auditoria de criação.
    expect(await admin('SELECT id, cnpj::text AS cnpj FROM core.empresa WHERE tenant_id = $1', [T])).toEqual([{ id: empresa, cnpj: CNPJ_NOVO }]);
    expect(await admin("SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 AND request_id = 'req-worker-cnpj' ORDER BY acao", [T]))
      .toEqual([{ acao: 'filial.atualizar' }]);
  });

  it('o mesmo CNPJ de novo não grava nem emite: o evento é publicado e nada mais sai', async () => {
    const e = criarEvento({
      nome: EVENTO_CNPJ_ALTERADO, tenant_id: T, agregado_id: T, ator: 'sistema', request_id: 'req-worker-cnpj-2',
      payload: { tenant_id: T, empresa_id: empresa, cnpj_novo: CNPJ_NOVO, request_id: 'req-worker-cnpj-2', alterado_em: relogio.agora().toISOString() },
    }, relogio.agora());
    await app.comTenant(T, (tx) => new OutboxPg().gravar(tx, e));
    relogio.avancar(1_000);
    const consumidores = montarConsumidores({ log, relogio });
    const despachar = () => despacharOutbox({ banco: worker, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores, relogio, log });
    expect(await despachar()).toEqual({ publicados: 1, falhas: 0, adiados: 0, desistidos: 0 });
    expect(await despachar()).toEqual({ publicados: 0, falhas: 0, adiados: 0, desistidos: 0 });
    expect(await admin('SELECT count(*)::int AS n FROM plataforma.evento WHERE tenant_id = $1', [T])).toEqual([{ n: 3 }]);
  });
});
