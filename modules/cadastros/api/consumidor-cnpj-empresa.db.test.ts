/**
 * Consumidor `core.empresa.cnpj_alterado@1` (RN-CORE-14 e RN-CORE-16) contra o PostgreSQL real, no papel macuxierp_app e com RLS.
 * Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { EVENTO_CNPJ_ALTERADO } from '@macuxierp/core/contracts';
import type { EnvelopeEvento } from '@macuxierp/platform-sdk';
import { AuditoriaPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe, transacaoDe } from './apoio-teste';
import { criarConsumidorCnpjEmpresa } from './consumidor-cnpj-empresa';
import { CNPJ_A, CNPJ_B, filialValida } from './fixtures-teste';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const CNPJ_NOVO = '04252011000110';
const AGORA = new Date('2026-11-27T15:00:00Z');

describe.skipIf(!PG_DISPONIVEL)('consumidor de troca de CNPJ da empresa (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let C: string;
  let filialA: string;
  let filialB: string;
  const avisos: Record<string, unknown>[] = [];
  const consumidor = criarConsumidorCnpjEmpresa({
    repositorios: repositoriosSql, outbox: new OutboxPg(), auditoria: new AuditoriaPg(), agora: () => AGORA, log: { warn: (o) => avisos.push(o) },
  });
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;
  const tratar = (tenant: string, cnpj: string, requestId = 'req-troca-1') =>
    app.comTenant(tenant, (tx) => consumidor.tratar({
      id: '77777777-7777-4777-8777-777777777777', nome: EVENTO_CNPJ_ALTERADO, tenant_id: tenant, agregado_id: tenant, versao: 1,
      ocorrido_em: AGORA.toISOString(), ator: 'sistema', request_id: requestId,
      payload: { tenant_id: tenant, empresa_id: tenant, cnpj_novo: cnpj, request_id: requestId, alterado_em: AGORA.toISOString() },
    } as EnvelopeEvento, tx));
  const filial = async (id: string) => (await admin('SELECT cnpj, external_id FROM cadastros.filial WHERE id = $1', [id]))[0] as { cnpj: string; external_id: string | null };
  const eventos = async (tenant: string) => admin("SELECT payload->'payload' AS payload FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'cadastros.filial.alterada@1' AND payload->>'request_id' LIKE 'req-troca-%'", [tenant]);
  const auditorias = async (tenant: string) => admin("SELECT depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'filial.atualizar' AND request_id LIKE 'req-troca-%'", [tenant]);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'cnpj-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'cnpj-b', ['cadastros']);
    C = await criarTenant(efemero.admin, 'cnpj-c', ['cadastros']);
    const amb = (t: string) => criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: { filialTemA1Valido: async () => true } }), AGORA, transacaoDe(app, t));
    const adm = sessaoDe('administrador');
    const fa = await amb(A).chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_A, external_id: 'F01' }) });
    const fb = await amb(B).chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_A, external_id: 'F01' }) });
    expect([fa.status, fb.status]).toEqual([201, 201]);
    filialA = (fa.corpo as { id: string }).id;
    filialB = (fb.corpo as { id: string }).id;
    await amb(A).chamar('POST', '/filiais', { sessao: adm, corpo: filialValida({ cnpj: CNPJ_B, external_id: 'F02', padrao: false }) });
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CORE-14: a troca grava o CNPJ na filial padrão (mesmo id e external_id), audita sem o valor e emite a filial alterada; não toca outro tenant', async () => {
    await tratar(A, CNPJ_NOVO);
    expect(await filial(filialA)).toEqual({ cnpj: CNPJ_NOVO, external_id: 'F01' });
    expect(await filial(filialB)).toMatchObject({ cnpj: CNPJ_A });
    const ev = await eventos(A);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ id: filialA, cnpj: CNPJ_NOVO });
    const aud = await auditorias(A);
    expect(aud).toHaveLength(1);
    expect(JSON.stringify(aud)).not.toContain(CNPJ_NOVO);
    expect(await eventos(B)).toHaveLength(0);
  });

  it('RN-CORE-16: o mesmo CNPJ de novo não grava, não audita e não emite', async () => {
    await tratar(A, CNPJ_NOVO, 'req-troca-2');
    expect(await eventos(A)).toHaveLength(1);
    expect(await auditorias(A)).toHaveLength(1);
  });

  it('RN-CORE-14: tenant sem filial padrão só avisa, com o tenant_id', async () => {
    await tratar(C, CNPJ_NOVO);
    expect(avisos).toEqual([{ tenant_id: C }]);
    expect(await eventos(C)).toHaveLength(0);
  });

  it('payload inválido não grava e avisa só com tenant_id e motivo', async () => {
    avisos.length = 0;
    await tratar(A, '123', 'req-troca-9');
    expect(avisos).toEqual([{ tenant_id: A, motivo: 'payload_invalido' }]);
    expect(await filial(filialA)).toMatchObject({ cnpj: CNPJ_NOVO });
  });

  it('RN-CORE-16: CNPJ já usado por outra filial do tenant recusa e o erro sobe, sem gravar', async () => {
    await expect(tratar(A, CNPJ_B, 'req-troca-3')).rejects.toThrow();
    expect(await filial(filialA)).toMatchObject({ cnpj: CNPJ_NOVO });
  });
});
