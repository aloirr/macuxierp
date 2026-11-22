/**
 * Leitura das regras e do IBPT contra o PostgreSQL real (migrações 0013 e 0021, papel macuxierp_app, RLS por tenant). Sem Postgres o teste pula
 * (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarCalculoFiscal } from './calculo';
import { repositorioFiscalSql } from './sql';

describe.skipIf(!PG_DISPONIVEL)('leitura fiscal (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let REF: string;
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows;
  const regraSql = (tenant: string, o: { uf_destino?: string; codigo?: string; aliquota?: number; fim?: string | null; inicio?: string; p_dif?: number | null; p_icms_efet?: number | null; ncm?: string | null } = {}) =>
    admin(
      `INSERT INTO fiscal.regra_tributaria (tenant_id, ncm_prefixo, uf_destino, codigo, aliquota_icms, p_dif, p_icms_efet, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins,
         fonte_tipo, fonte_referencia, versao, vigencia_inicio, vigencia_fim)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '01', 6500, '01', 30000, 'convenio', 'Convênio ICMS 142/2018', '2026.1', $8, $9)`,
      [tenant, o.ncm ?? null, o.uf_destino ?? null, o.codigo ?? '00', o.aliquota ?? 180000, o.p_dif ?? null, o.p_icms_efet ?? null, o.inicio ?? '2026-01-01', o.fim ?? null],
    );
  const filtro = { data_emissao: '2026-11-21', uf_origem: 'AM', uf_destino: 'AM', crt: 3 as const, ncms: ['22021000'] };

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'fis-a', ['fiscal']);
    B = await criarTenant(efemero.admin, 'fis-b', ['fiscal']);
    REF = (await admin('SELECT plataforma.tenant_referencia() AS id'))[0]!.id as string;
    await regraSql(A, { aliquota: 200000, p_dif: 500000, codigo: '51' });
    await regraSql(A, { uf_destino: 'SP', aliquota: 120000 });
    await regraSql(A, { inicio: '2025-01-01', fim: '2025-12-31', aliquota: 170000 });
    await regraSql(A, { inicio: '2027-01-01', aliquota: 190000 });
    await regraSql(A, { ncm: '99', aliquota: 50000 });
    await regraSql(B, { aliquota: 70000 });
    const ibpt = (t: string, fed: number) =>
      admin(
        `INSERT INTO fiscal.carga_aproximada (tenant_id, ncm, uf, aliquota_federal_nacional, vigencia_inicio, versao, fonte) VALUES ($1, '22021000', 'AM', $2, '2026-01-01', '26.2.A', 'IBPT')`,
        [t, fed],
      );
    await ibpt(REF, 100000);
    await ibpt(A, 150000);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-FIS-04: lê só as regras vigentes na data de emissão, com p_dif e fonte (0021)', async () => {
    const r = await app.comTenant(A, (tx) => repositorioFiscalSql.regras(tx, filtro));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ aliquota_icms: 200000, p_dif: 500000, p_icms_efet: null, fonte: { tipo: 'convenio', referencia: 'Convênio ICMS 142/2018' }, vigencia_inicio: '2026-01-01', vigencia_fim: null });
    const antiga = await app.comTenant(A, (tx) => repositorioFiscalSql.regras(tx, { ...filtro, data_emissao: '2025-06-01' }));
    expect(antiga.map((x) => x.aliquota_icms)).toEqual([170000]);
  });
  it('RN-FIS-01: filtra por UF de destino e por prefixo de NCM', async () => {
    const sp = await app.comTenant(A, (tx) => repositorioFiscalSql.regras(tx, { ...filtro, uf_destino: 'SP' }));
    expect(sp.map((x) => x.aliquota_icms).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([120000, 200000]);
    const ncm = await app.comTenant(A, (tx) => repositorioFiscalSql.regras(tx, { ...filtro, ncms: ['99000000'] }));
    expect(ncm.map((x) => x.aliquota_icms).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([50000, 200000]);
  });
  it('RN-FIS-01: RLS, um tenant não vê a regra do outro', async () => {
    const b = await app.comTenant(B, (tx) => repositorioFiscalSql.regras(tx, filtro));
    expect(b.map((x) => x.aliquota_icms)).toEqual([70000]);
    const a = await app.comTenant(A, (tx) => repositorioFiscalSql.regras(tx, filtro));
    expect(a.map((x) => x.aliquota_icms)).not.toContain(70000);
  });
  it('RF-FIS-04: IBPT do tenant vence a tabela geral; outro tenant usa a geral', async () => {
    const f = { data_emissao: '2026-11-21', uf: 'AM', ncms: ['22021000'] };
    const a = await app.comTenant(A, (tx) => repositorioFiscalSql.cargas(tx, f));
    expect(a.get('22021000')?.federal_nacional).toBe(150000);
    const b = await app.comTenant(B, (tx) => repositorioFiscalSql.cargas(tx, f));
    expect(b.get('22021000')).toMatchObject({ federal_nacional: 100000, versao: '26.2.A', fonte: 'IBPT' });
  });
  it('RN-FIS-03: o adaptador calcula de ponta a ponta no banco (CST 51 com p_dif, vTotTrib do IBPT)', async () => {
    const calc = criarCalculoFiscal({ emitentes: { emitente: async () => ({ uf: 'AM', crt: 3, regime_pis_cofins: 'cumulativo' }), producaoPropria: async () => new Set<string>() } });
    const r = await app.comTenant(A, (tx) =>
      calc.calcular(tx, {
        filial_id: 'f', data_emissao: '2026-11-21',
        pedido: { pedido: { cliente_retrato: { tipo_pessoa: 'PJ', ind_ie_dest: '1', endereco: { uf: 'AM' } } } },
        itens: [{ sequencia: 1, ncm: '22021000', origem: '0', quantidade: 1, preco_unitario_centavos: 100000, valor_centavos: 100000, desconto_centavos: 0, frete_centavos: 0, outras_centavos: 0 }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.saida.itens[0]?.icms).toMatchObject({ cst: '51', v_icms_op: 20000, p_dif: 500000, v_icms_dif: 10000, v_icms: 10000 });
    expect(r.saida.itens[0]?.carga_aproximada?.versao).toBe('26.2.A');
    expect(r.cfops).toEqual({ 1: '5102' });
  });
});
