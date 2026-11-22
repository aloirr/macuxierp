/**
 * Gravação do espelho `registro_publicado` contra o PostgreSQL real (papel macuxierp_worker, RLS). Sem Postgres o teste pula
 * (`bash db/scripts/pg-local.sh`). RN-CORE-05 e ADR 0010 item 3: a chave do Hub é de um cadastro só, nada é sobrescrito.
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRegistro, type RegistroEspelho } from '../domain';
import { U, admSql } from './apoio-conector-teste';
import { gravarRegistro } from './espelho';

const EM = new Date('2026-11-22T09:00:00.000Z');
const registro = (chave: string, erpId: string | null, nome: string, o: Partial<RegistroEspelho> = {}): RegistroEspelho => {
  const payload = { external_id: chave, ativo: true, sku: `SKU-${chave}`, nome, unidade: 'UN' };
  return { entidade: 'produto', external_id: chave, alterado_em: EM.toISOString(), ativo: true, payload, hash: hashRegistro(payload), erp_id: erpId, fonte_refs: {}, ...o };
};

describe.skipIf(!PG_DISPONIVEL)('espelho: gravação do registro no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  let T: string;
  const gravar = (r: RegistroEspelho, em = EM) => banco.comTenant(T, (tx) => gravarRegistro(tx, T, r, em));
  const linha = async (chave: string) =>
    (await adm("SELECT payload, hash, erp_id, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'produto' AND registro_external_id = $2", [T, chave]))[0];

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    banco = efemero.banco('macuxierp_worker', 2);
    adm = admSql(efemero);
    T = await criarTenant(efemero.admin, 'esp-a', ['integracao-fdv']);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CORE-05: a chave do Hub que já é de outro cadastro (erp_id diferente) não é sobrescrita; devolve conflito', async () => {
    const dono = U();
    const intruso = U();
    expect(await gravar(registro('PROD-1', dono, 'Do dono'))).toEqual({ resultado: 'gravado', pendente: true });
    const antes = await linha('PROD-1');
    expect(await gravar(registro('PROD-1', intruso, 'Do intruso'), new Date(EM.getTime() + 60_000))).toEqual({ resultado: 'conflito' });
    expect(await linha('PROD-1')).toEqual(antes); // payload, hash, erp_id e pendência intactos
    expect(antes!.erp_id).toBe(dono);
    // o mesmo cadastro segue atualizando a própria chave; evento mais velho de outro erp_id também é conflito, não descarte
    expect((await gravar(registro('PROD-1', dono, 'Do dono, novo nome'), new Date(EM.getTime() + 120_000))).resultado).toBe('gravado');
    expect((await linha('PROD-1'))!.payload.nome).toBe('Do dono, novo nome');
    expect(await gravar(registro('PROD-1', intruso, 'Velho do intruso'), new Date(EM.getTime() - 60_000))).toEqual({ resultado: 'conflito' });
  });

  it('RN-CORE-05: registro sem erp_id gravado antes (entidade sem UUID) aceita o mesmo sem erp_id e recusa quem traz um', async () => {
    expect((await gravar(registro('PROD-2', null, 'Sem UUID'))).resultado).toBe('gravado');
    expect((await gravar(registro('PROD-2', null, 'Sem UUID 2'), new Date(EM.getTime() + 1000))).resultado).toBe('gravado');
    // linha sem erp_id não é de ninguém: quem chega com UUID assume (regra literal: só `erp_id` não nulo e diferente conflita)
    expect((await gravar(registro('PROD-2', U(), 'Com UUID'), new Date(EM.getTime() + 2000))).resultado).toBe('gravado');
  });
});
