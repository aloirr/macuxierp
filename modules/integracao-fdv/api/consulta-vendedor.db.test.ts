/** Porta `ConsultaVendedorFdv` contra o PostgreSQL real (T-0105): achou, não achou, inativo e isolamento entre tenants. */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRegistro, type RegistroEspelho } from '../domain';
import { U } from './apoio-conector-teste';
import { criarConsultaVendedorFdv } from './consulta-vendedor';
import { gravarRegistro } from './espelho';

const EM = new Date('2026-11-25T09:00:00.000Z');
const vendedor = (chave: string, erpId: string | null, ativo: boolean, nome = 'Maria Vendedora'): RegistroEspelho => {
  const payload = { external_id: chave, ativo, nome };
  return { entidade: 'vendedor', external_id: chave, alterado_em: EM.toISOString(), ativo, payload, hash: hashRegistro(payload), erp_id: erpId, fonte_refs: {} };
};

describe.skipIf(!PG_DISPONIVEL)('consulta-vendedor: ConsultaVendedorFdv no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let A: string;
  let B: string;
  const porta = criarConsultaVendedorFdv();
  const consultar = (t: string, chave: string) => banco.comTenant(t, (tx) => porta.vendedorPorExternalId(tx, t, chave));
  const gravar = (t: string, r: RegistroEspelho) => banco.comTenant(t, (tx) => gravarRegistro(tx, t, r, EM));

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    banco = efemero.banco('macuxierp_worker', 2);
    A = await criarTenant(efemero.admin, 'vend-a', ['integracao-fdv']);
    B = await criarTenant(efemero.admin, 'vend-b', ['integracao-fdv']);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('achou: devolve o UUID do ERP, a chave, o nome e ativo', async () => {
    const erp = U();
    await gravar(A, vendedor('V-1', erp, true));
    expect(await consultar(A, 'V-1')).toEqual({ vendedor_id: erp, external_id: 'V-1', nome: 'Maria Vendedora', ativo: true });
  });

  it('não achou: chave sem registro devolve null', async () => {
    expect(await consultar(A, 'V-NAO-EXISTE')).toBeNull();
  });

  it('inativo: devolve o registro com ativo=false (o chamador decide)', async () => {
    await gravar(A, vendedor('V-2', U(), false));
    expect((await consultar(A, 'V-2'))?.ativo).toBe(false);
  });

  it('sem UUID do ERP ainda: vendedor_id fica ausente', async () => {
    await gravar(A, vendedor('V-3', null, true));
    const r = await consultar(A, 'V-3');
    expect(r).toEqual({ external_id: 'V-3', nome: 'Maria Vendedora', ativo: true });
    expect(r).not.toHaveProperty('vendedor_id');
  });

  it('isolamento: a chave do tenant A não aparece para o tenant B', async () => {
    await gravar(A, vendedor('V-ISO', U(), true));
    expect(await consultar(B, 'V-ISO')).toBeNull();
    await gravar(B, vendedor('V-ISO', U(), true, 'Outro Nome'));
    expect((await consultar(B, 'V-ISO'))?.nome).toBe('Outro Nome');
    expect((await consultar(A, 'V-ISO'))?.nome).toBe('Maria Vendedora');
  });
});
