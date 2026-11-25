/**
 * Consumidor RN-CORE-14 (T-0100) contra o PostgreSQL real, no papel `macuxierp_worker` (o que roda os consumidores) e
 * com RLS: cria uma vez, evento repetido e 2ª filial padrão não alteram, filial inativa ou não padrão não cria,
 * isolamento entre tenants. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { EnvelopeEvento, Outbox } from '@macuxierp/platform-sdk';
import { AuditoriaPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarConsumidorEmpresaDaFilial, EVENTO_FILIAL_ALTERADA } from './consumidor-empresa-da-filial';

describe.skipIf(!PG_DISPONIVEL)('RN-CORE-14: consumidor da empresa pela filial padrão (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let worker: BancoPg;
  let A: string;
  let B: string;
  const publicados: EnvelopeEvento[] = [];
  const outbox: Outbox = { gravar: async (_tx, e) => publicados.push(e) && publicados.length };
  const consumidor = criarConsumidorEmpresaDaFilial({ outbox, auditoria: new AuditoriaPg(), agora: () => new Date('2026-11-24T20:00:00Z') });
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;

  const filial = (extra: Record<string, unknown> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111', padrao: true, inativo: false, cnpj: '11222333000181', ie: '123456789',
    razao_social: 'Distribuidora Boa Vista Ltda', nome_fantasia: 'Boa Vista', crt: '1', ...extra,
  });
  const tratar = (tenant: string, id: string, payload: unknown) =>
    worker.comTenant(tenant, (tx) => consumidor.tratar({
      id, nome: EVENTO_FILIAL_ALTERADA, tenant_id: tenant, agregado_id: '11111111-1111-4111-8111-111111111111', versao: 1,
      ocorrido_em: '2026-11-24T20:00:00.000Z', ator: 'sistema', request_id: 'r', payload,
    } as EnvelopeEvento, tx));
  const empresas = (tenant: string) => admin('SELECT razao_social, nome_fantasia, cnpj::text AS cnpj, ie, fuso FROM core.empresa WHERE tenant_id = $1', [tenant]);
  const ev = (n: number) => `55555555-5555-4555-8555-55555555555${n}`;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'emp-a', ['core']);
    B = await criarTenant(efemero.admin, 'emp-b', ['core']);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CORE-14: tenant novo cria a empresa com os dados da filial padrão, audita e publica core.empresa.alterada@1', async () => {
    await tratar(A, ev(1), filial());
    expect(await empresas(A)).toEqual([{ razao_social: 'Distribuidora Boa Vista Ltda', nome_fantasia: 'Boa Vista', cnpj: '11222333000181', ie: '123456789', fuso: 'America/Manaus' }]);
    expect(publicados.map((e) => [e.nome, e.tenant_id])).toEqual([['core.empresa.alterada@1', A]]);
    const aud = await admin("SELECT acao, usuario_id, depois->>'origem' AS origem, depois->>'filial_id' AS filial_id FROM plataforma.auditoria WHERE tenant_id = $1", [A]);
    expect(aud).toEqual([{ acao: 'core.empresa.criada', usuario_id: null, origem: 'filial_padrao', filial_id: '11111111-1111-4111-8111-111111111111' }]);
  });

  it('RN-CORE-14: evento repetido e 2ª filial padrão não duplicam nem alteram a empresa', async () => {
    const antes = publicados.length;
    await tratar(A, ev(1), filial());
    await tratar(A, ev(2), filial({ id: '22222222-2222-4222-8222-222222222222', cnpj: '99888777000166', razao_social: 'Outra Ltda' }));
    expect(await empresas(A)).toEqual([expect.objectContaining({ razao_social: 'Distribuidora Boa Vista Ltda', cnpj: '11222333000181' })]);
    expect(publicados).toHaveLength(antes);
    expect(await admin('SELECT 1 FROM plataforma.auditoria WHERE tenant_id = $1', [A])).toHaveLength(1);
  });

  it('RN-CORE-14: payload inválido ou filial recusada pela regra não cria; fantasia e IE ausentes viram null', async () => {
    await tratar(B, ev(4), filial({ padrao: false }));
    await tratar(B, ev(7), { id: 'nao-e-uuid' });
    expect(await empresas(B)).toEqual([]);
    await tratar(B, ev(8), filial({ ie: null, nome_fantasia: null }));
    expect(await empresas(B)).toEqual([expect.objectContaining({ nome_fantasia: null, ie: null })]);
  });

  it('RN-CORE-14: o evento de um tenant nunca grava empresa em outro (RLS)', async () => {
    expect(await admin('SELECT tenant_id FROM core.empresa ORDER BY tenant_id')).toHaveLength(2);
    await expect(worker.comTenant(A, (tx) => tx.consultar("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'X Ltda', '11222333000181')", [B]))).rejects.toThrow();
  });

  it('RN-CORE-14: empresa que já existe antes do evento (backfill 0059) não é alterada', async () => {
    const C = await criarTenant(efemero.admin, 'emp-c', ['core']);
    await efemero.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Já Existia Ltda', '99888777000166')", [C]);
    await tratar(C, ev(9), filial());
    expect(await empresas(C)).toEqual([expect.objectContaining({ razao_social: 'Já Existia Ltda', cnpj: '99888777000166' })]);
  });
});
