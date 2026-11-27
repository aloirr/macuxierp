/**
 * RN-CORE-16 no PostgreSQL real: `criarConsultaNfeProducao` (papel macuxierp_app, com RLS) conta só NF-e autorizada (ou autorizada e depois cancelada)
 * em produção, por tenant. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import {
  criarBancoEfemero,
  criarTenant,
  PG_DISPONIVEL,
  type BancoEfemero,
} from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarConsultaNfeProducao } from './consulta-nfe-producao';

describe.skipIf(!PG_DISPONIVEL)('ConsultaNfeProducao (RN-CORE-16, PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let T: string[];
  let seq = 0;
  const FILIAL = '00000000-0000-4000-8000-0000000000f1';
  const CLIENTE = '00000000-0000-4000-8000-0000000000c1';

  /**
   * Semeia a nota direto como admin (fora da RLS) já no status final, com chave e protocolo coerentes com os CHECKs. Os gatilhos de estado
   * (RN-FAT-02/03/04) ficam desligados só nesta conexão (`session_replication_role = replica`): a consulta lê apenas ambiente e status.
   */
  async function nota(tenant: string, ambiente: 'homologacao' | 'producao', status: string): Promise<void> {
    seq += 1;
    const numero = seq;
    const cnf = String(10_000_000 + seq);
    const chave = `13261112345678000195${'55'}001${String(numero).padStart(9, '0')}1${cnf}1`;
    const protocolada = ['autorizada', 'autorizada_guarda_pendente', 'cancelada', 'denegada'].includes(
      status,
    );
    const c = await efemero.admin.connect();
    try {
      await c.query("SET session_replication_role = 'replica'");
      await c.query(
        `INSERT INTO faturamento.nota (tenant_id, filial_id, cliente_id, ambiente, serie, numero, chave_acesso, c_nf, status, natureza_operacao, idempotencia_chave, protocolo, autorizada_em, cancelada_em)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, 'Venda', $9, $10, $11, $12)`,
        [
          tenant,
          FILIAL,
          CLIENTE,
          ambiente,
          numero,
          chave,
          cnf,
          status,
          `idem-${seq}`,
          protocolada ? '113260000000001' : null,
          protocolada && status !== 'denegada' ? new Date('2026-11-20T12:00:00Z') : null,
          status === 'cancelada' ? new Date('2026-11-21T12:00:00Z') : null,
        ],
      );
    } finally {
      await c.query('RESET session_replication_role');
      c.release();
    }
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    T = [];
    for (const s of ['sem', 'homolog', 'naoaut', 'prod', 'cancel'])
      T.push(await criarTenant(efemero.admin, `nfe-prod-${s}`, ['faturamento']));
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  const consulta = () => criarConsultaNfeProducao(app);

  it('RN-CORE-16: tenant sem nota devolve false', async () => {
    expect(await consulta().temNfeAutorizadaEmProducao(T[0]!)).toBe(false);
  });
  it('RN-CORE-16: só homologação autorizada devolve false', async () => {
    await nota(T[1]!, 'homologacao', 'autorizada');
    await nota(T[1]!, 'homologacao', 'cancelada');
    expect(await consulta().temNfeAutorizadaEmProducao(T[1]!)).toBe(false);
  });
  it('RN-CORE-16: produção rascunho, em autorização, rejeitada, denegada ou inutilizada devolve false', async () => {
    for (const s of ['rascunho', 'em_autorizacao', 'rejeitada', 'denegada', 'inutilizada'])
      await nota(T[2]!, 'producao', s);
    expect(await consulta().temNfeAutorizadaEmProducao(T[2]!)).toBe(false);
  });
  it('RN-CORE-16: produção autorizada devolve true, sem vazar para os outros tenants (RLS)', async () => {
    await nota(T[3]!, 'producao', 'autorizada');
    expect(await consulta().temNfeAutorizadaEmProducao(T[3]!)).toBe(true);
    expect(await consulta().temNfeAutorizadaEmProducao(T[0]!)).toBe(false);
    expect(await consulta().temNfeAutorizadaEmProducao(T[1]!)).toBe(false);
    expect(await consulta().temNfeAutorizadaEmProducao(T[2]!)).toBe(false);
  });
  it('RN-CORE-16: autorizada em produção e depois cancelada ainda conta (true)', async () => {
    await nota(T[4]!, 'producao', 'cancelada');
    expect(await consulta().temNfeAutorizadaEmProducao(T[4]!)).toBe(true);
  });
  it('RN-CORE-16: tenant que não é UUID é recusado', async () => {
    await expect(consulta().temNfeAutorizadaEmProducao('x')).rejects.toThrow(RangeError);
  });
});
