/**
 * Contingência por filial e ambiente contra o PostgreSQL real (`faturamento.contingencia`, 0013 + 0032): abrir com `ligada_por`, encerrar com `desligada_por`,
 * uma aberta por (tenant, filial, ambiente), RLS e a lista das EPEC pendentes (nota tipo_emissao 4 com epec_protocolo). Sem Postgres o teste pula
 * (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { randomUUID } from 'node:crypto';
import { type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuid } from './apoio-teste';
import { repositorioContingenciaSql as repo } from './sql-contingencia';

const MOTIVO = 'SEFAZ-AM sem resposta há 5 min';
const INICIO = new Date('2026-11-21T10:00:00Z');
const FIM = new Date('2026-11-21T11:00:00Z');

describe.skipIf(!PG_DISPONIVEL)('contingência por filial (PostgreSQL real, 0013 e 0032)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let cnf = 41_000;

  const abrir = (t: string, filial: string, modalidade: 'svc_an' | 'svc_rs' | 'epec' = 'svc_rs', por = uuid(5)) =>
    app.comTenant(t, (tx) => repo.abrir(tx, { filial_id: filial, ambiente: 'homologacao', modalidade, motivo: MOTIVO, inicio_em: INICIO, ligada_por: por }));

  /** Nota EPEC emitida com o evento autorizado (o caminho do banco: rascunho, em autorização, contingência epec aberta, emitida_contingencia com tpEmis 4 e epec_protocolo). */
  async function notaEpec(t: string, filial: string, autorizadaEm: string, protocolo: string): Promise<string> {
    const id = randomUUID();
    const n = ++cnf;
    const cnfTxt = String(n).padStart(8, '0');
    await app.comTenant(t, async (tx) => {
      await tx.consultar(
        `INSERT INTO faturamento.nota (id, tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id, natureza_operacao)
         VALUES ($1, plataforma.tenant_atual(), $2, 1, faturamento.reservar_numero($2, 'homologacao', 1::smallint, 1), $3, $4, 'Venda')`,
        [id, filial, randomUUID(), randomUUID()],
      );
      const [linha] = await tx.consultar<{ numero: number }>('SELECT numero FROM faturamento.nota WHERE id = $1', [id]);
      const numero = linha?.numero ?? 0;
      const chave = `1326111234567800019555001${String(numero).padStart(9, '0')}4${cnfTxt}0`;
      await tx.consultar(`UPDATE faturamento.nota SET status = 'em_autorizacao', tipo_emissao = 4, chave_acesso = $2, c_nf = $3, contingencia_em = $5::timestamptz, contingencia_justificativa = $4 WHERE id = $1`, [id, chave, cnfTxt, MOTIVO, INICIO.toISOString()]);
      await tx.consultar(`UPDATE faturamento.nota SET status = 'emitida_contingencia', epec_protocolo = $2, epec_autorizada_em = $3::timestamptz WHERE id = $1`, [id, protocolo, autorizadaEm]);
    });
    return id;
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'fat-cont-a', ['faturamento']);
    B = await criarTenant(efemero.admin, 'fat-cont-b', ['faturamento']);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-FAT-05: abre no ambiente da filial (sem configuração = homologação) com ligada_por, datas em UTC e fim nulo; a aberta e a leitura voltam iguais', async () => {
    const f = randomUUID();
    const a = await abrir(A, f, 'epec');
    expect(a).toEqual({ id: a.id, filial_id: f, ambiente: 'homologacao', modalidade: 'epec', motivo: MOTIVO, inicio_em: '2026-11-21T10:00:00.000Z', fim_em: null, ligada_por: uuid(5), desligada_por: null });
    expect(await app.comTenant(A, (tx) => repo.aberta(tx, f, 'homologacao'))).toEqual(a);
    expect(await app.comTenant(A, (tx) => repo.aberta(tx, f, 'producao'))).toBeNull();
  });

  it('RN-FAT-05: uma aberta por filial e ambiente: a segunda abertura bate no índice (23505); outra filial abre normalmente', async () => {
    const f = randomUUID();
    await abrir(A, f);
    await expect(abrir(A, f, 'epec')).rejects.toMatchObject({ code: '23505' });
    await expect(abrir(A, randomUUID())).resolves.toBeTruthy();
  });

  it('RN-FAT-09: encerra com fim_em e desligada_por; encerrar de novo devolve nulo; vai ao histórico e a filial abre de novo', async () => {
    const f = randomUUID();
    const a = await abrir(A, f, 'svc_an', uuid(5));
    const e = await app.comTenant(A, (tx) => repo.encerrar(tx, f, 'homologacao', FIM, uuid(6)));
    expect(e).toEqual({ ...a, fim_em: '2026-11-21T11:00:00.000Z', desligada_por: uuid(6) });
    expect(await app.comTenant(A, (tx) => repo.encerrar(tx, f, 'homologacao', FIM, uuid(6)))).toBeNull();
    expect(await app.comTenant(A, (tx) => repo.aberta(tx, f, 'homologacao'))).toBeNull();
    expect(await app.comTenant(A, (tx) => repo.historico(tx, f, 'homologacao', 10))).toEqual([e]);
    const b = await abrir(A, f, 'svc_rs');
    expect(await app.comTenant(A, (tx) => repo.historico(tx, f, 'homologacao', 10))).toEqual([e]);
    expect(b.fim_em).toBeNull();
  });

  it('RN-FAT-05: fim antes do início é recusado pelo banco (contingencia_periodo)', async () => {
    const f = randomUUID();
    await abrir(A, f);
    await expect(app.comTenant(A, (tx) => repo.encerrar(tx, f, 'homologacao', new Date('2026-11-21T09:00:00Z'), uuid(6)))).rejects.toThrow(/contingencia_periodo/);
  });

  it('RN-CORE-01: a contingência de um tenant não aparece nem encerra no outro (RLS)', async () => {
    const f = randomUUID();
    await abrir(A, f);
    expect(await app.comTenant(B, (tx) => repo.aberta(tx, f, 'homologacao'))).toBeNull();
    expect(await app.comTenant(B, (tx) => repo.encerrar(tx, f, 'homologacao', FIM, uuid(6)))).toBeNull();
    expect(await app.comTenant(A, (tx) => repo.aberta(tx, f, 'homologacao'))).not.toBeNull();
  });

  it('RN-FAT-09: a lista das EPEC pendentes traz só nota tpEmis 4 com o evento autorizado, por filial, da autorização mais antiga para a mais nova; some do tenant vizinho', async () => {
    const T = await criarTenant(efemero.admin, 'fat-cont-epec', ['faturamento']);
    const f1 = randomUUID();
    const f2 = randomUUID();
    await abrir(T, f1, 'epec');
    await abrir(T, f2, 'epec');
    const nova = await notaEpec(T, f1, '2026-11-21T12:00:00Z', '913260000000002');
    const velha = await notaEpec(T, f1, '2026-11-20T12:00:00Z', '913260000000001');
    const outra = await notaEpec(T, f2, '2026-11-21T13:00:00Z', '913260000000003');
    const todas = await app.comTenant(T, (tx) => repo.epecPendentes(tx, {}));
    expect(todas.map((n) => n.id)).toEqual([velha, nova, outra]);
    expect(todas[0]).toMatchObject({ filial_id: f1, ambiente: 'homologacao', serie: 1, status: 'emitida_contingencia', epec_protocolo: '913260000000001', epec_autorizada_em: '2026-11-20T12:00:00.000Z' });
    expect((await app.comTenant(T, (tx) => repo.epecPendentes(tx, { filial_id: f2 }))).map((n) => n.id)).toEqual([outra]);
    expect(await app.comTenant(B, (tx) => repo.epecPendentes(tx, {}))).toEqual([]);
  });

  it('RN-FAT-09: nota SVC e nota EPEC que voltou a em_autorizacao não entram na lista de pendentes', async () => {
    const T = await criarTenant(efemero.admin, 'fat-cont-epec2', ['faturamento']);
    const f = randomUUID();
    await abrir(T, f, 'epec');
    const id = await notaEpec(T, f, '2026-11-21T12:00:00Z', '913260000000009');
    expect(await app.comTenant(T, (tx) => repo.epecPendentes(tx, {}))).toHaveLength(1);
    await app.comTenant(T, (tx) => tx.consultar(`UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = $1`, [id]));
    expect(await app.comTenant(T, (tx) => repo.epecPendentes(tx, {}))).toEqual([]);
  });
});
