/**
 * T-0045, migração 0025: schema sefaz_simulador, a memória do simulador da SEFAZ-AM (homologação, ADR 0008) fora da
 * memória do worker. RLS por tenant nas quatro tabelas (sem worker_global), UNIQUEs da nota, FK do evento, faixa da
 * inutilização e faixa_sobreposta, nRec global, CHECKs de formato, sequências globais e privilégios (só o worker).
 * Motivo em docs/banco/README.md (0025).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falhaDetalhada,
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  verboso,
} from './apoio.ts';
import {
  chaveAcesso,
  cnfDoTenant,
  fixturePlataforma,
  fixtureSefazSimulador,
  novoTenant,
  type Tenant,
} from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0025_sefaz_simulador.sql', import.meta.url));
const TABELAS = ['nota', 'evento', 'inutilizacao', 'recibo'] as const;
const CNPJ = '12345678000195';

const A = novoTenant('simulador-0025-a');
const B = novoTenant('simulador-0025-b');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });

/** INSERT em sefaz_simulador.<tabela>: os valores padrão com as colunas sobrescritas (valores já em SQL). */
function sqlInsert(tabela: string, padrao: Record<string, string>, campos: Record<string, string> = {}): string {
  const v = { ...padrao, ...campos };
  return `INSERT INTO sefaz_simulador.${tabela} (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')});`;
}

/** Nota nova no destino (filial do tenant, modo normal). */
const nota = (t: Tenant): Record<string, string> => ({
  tenant_id: `'${t.id}'`,
  filial_id: `'${t.filial}'`,
  modo: `'normal'`,
  ch_nfe: `'${chaveAcesso(1, 50, cnfDoTenant(t))}'`,
  cnpj: `'${CNPJ}'`,
  serie: '1',
  nnf: '50',
  dh_emi: 'now()',
  autorizada_em: 'now()',
  situacao: `'autorizada'`,
  n_prot: `'913260000000050'`,
  c_stat: `'100'`,
  dh_recbto: `'2026-11-22T10:00:00-04:00'`,
  xml_prot: `'<protNFe/>'`,
});

/** Evento (CC-e) na nota da massa do tenant. */
const evento = (t: Tenant): Record<string, string> => ({
  tenant_id: `'${t.id}'`,
  filial_id: `'${t.filial}'`,
  modo: `'normal'`,
  ch_nfe: `'${chaveAcesso(1, 1, cnfDoTenant(t))}'`,
  tp_evento: `'110110'`,
  n_seq_evento: '2',
  n_prot: `'913260000000060'`,
  c_stat: `'135'`,
  dh_reg_evento: `'2026-11-22T10:10:00-04:00'`,
  xml_ret: `'<retEvento/>'`,
  evento_xml: `'<evento/>'`,
});

/** Inutilização da faixa [ini, fin] no destino da massa. */
const inut = (t: Tenant, ini: number, fin: number): Record<string, string> => ({
  tenant_id: `'${t.id}'`,
  filial_id: `'${t.filial}'`,
  modo: `'normal'`,
  cnpj: `'${CNPJ}'`,
  serie: '1',
  ano: `'26'`,
  nnf_ini: String(ini),
  nnf_fin: String(fin),
  n_prot: `'913260000000070'`,
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — sefaz_simulador (T-0045, 0025)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureSefazSimulador(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('nenhuma política além de isolamento_tenant (sem worker_global)', () => {
    expect(
      consultar<{ p: string }>(
        banco.conexao,
        `SELECT polname AS p FROM pg_policy p JOIN pg_class k ON k.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = k.relnamespace
         WHERE n.nspname = 'sefaz_simulador' AND p.polname <> 'isolamento_tenant'`,
      ),
    ).toEqual([]);
  });

  it('RLS entre dois tenants nas quatro tabelas: o worker no tenant A vê só A; sem tenant, nada', () => {
    expect(verificarVazamento(banco.conexao, ['sefaz_simulador'], A.id, B.id)).toEqual([]);
    // O worker no tenant A não grava linha do B.
    recusaDetalhada(banco.conexao, sqlInsert('inutilizacao', inut(B, 500, 501)), '42501', /row-level security/, WORKER(A));
  });

  it('os dois UNIQUE da nota: mesma chave no destino e mesmo número com outra chave (23505)', () => {
    const chaveMassa = `'${chaveAcesso(1, 1, cnfDoTenant(A))}'`;
    recusaDetalhada(
      banco.conexao,
      sqlInsert('nota', nota(A), { ch_nfe: chaveMassa, nnf: '77' }),
      '23505',
      /nota_chave_uq/,
      WORKER(A),
    );
    recusaDetalhada(banco.conexao, sqlInsert('nota', nota(A), { nnf: '1' }), '23505', /nota_numero_uq/, WORKER(A));
    // A mesma chave em outro modo (svc-rs) é outro destino.
    rodarComo(banco.conexao, sqlInsert('nota', nota(A), { ch_nfe: chaveMassa, nnf: '1', modo: `'svc-rs'` }), WORKER(A));
  });

  it('evento sem nota cai na FK (23503); a FK prende o destino e o tenant', () => {
    recusaDetalhada(
      banco.conexao,
      sqlInsert('evento', evento(A), { ch_nfe: `'${chaveAcesso(1, 999, 1)}'` }),
      '23503',
      /evento_nota_fk/,
      WORKER(A),
    );
    // Chave da nota do B, gravada pelo A no próprio tenant: não acha a nota.
    recusaDetalhada(
      banco.conexao,
      sqlInsert('evento', evento(A), { ch_nfe: `'${chaveAcesso(1, 1, cnfDoTenant(B))}'`, filial_id: `'${B.filial}'` }),
      '23503',
      /evento_nota_fk/,
      WORKER(A),
    );
  });

  it('UNIQUE do evento (tenant, destino, chave, tpEvento, nSeqEvento)', () => {
    recusaDetalhada(banco.conexao, sqlInsert('evento', evento(A), { n_seq_evento: '1' }), '23505', /evento_seq_uq/, WORKER(A));
    rodarComo(banco.conexao, sqlInsert('evento', evento(A), { n_seq_evento: '3' }), WORKER(A));
  });

  it('inutilização com nnf_ini > nnf_fin falha (23514)', () => {
    recusaDetalhada(banco.conexao, sqlInsert('inutilizacao', inut(A, 10, 9)), '23514', /inutilizacao_faixa_ck/, WORKER(A));
    recusaDetalhada(banco.conexao, sqlInsert('inutilizacao', inut(A, 0, 9)), '23514', /inutilizacao_nnf_ini_ck/, WORKER(A));
    rodarComo(banco.conexao, sqlInsert('inutilizacao', inut(A, 10, 10)), WORKER(A));
  });

  it('faixa_sobreposta: true e false nas bordas, só no tenant da sessão', () => {
    // A massa tem 2 a 3 no destino (filial, normal, CNPJ, série 1, ano 26) dos dois tenants.
    const sobre = (
      t: Tenant,
      ini: number,
      fin: number,
      ctx: Tenant = t,
      outros: Partial<Record<string, string>> = {},
    ) => {
      const o = {
        filial: `'${t.filial}'`,
        modo: `'normal'`,
        cnpj: `'${CNPJ}'`,
        serie: '1',
        ano: `'26'`,
        ...outros,
      };
      const [r] = consultar<{ s: boolean }>(
        banco.conexao,
        `SELECT sefaz_simulador.faixa_sobreposta(${o.filial}, ${o.modo}, ${o.cnpj}, ${o.serie}, ${o.ano}, ${ini}, ${fin}) AS s`,
        WORKER(ctx),
      );
      return r?.s;
    };
    expect(sobre(A, 1, 1)).toBe(false);
    expect(sobre(A, 1, 2)).toBe(true);
    expect(sobre(A, 2, 3)).toBe(true);
    expect(sobre(A, 3, 4)).toBe(true);
    expect(sobre(A, 4, 4)).toBe(false);
    expect(sobre(A, 1, 100)).toBe(true);
    // Outro destino, série, ano ou CNPJ não cruza.
    expect(sobre(A, 2, 3, A, { modo: `'svc-rs'` })).toBe(false);
    expect(sobre(A, 2, 3, A, { serie: '2' })).toBe(false);
    expect(sobre(A, 2, 3, A, { ano: `'25'` })).toBe(false);
    expect(sobre(A, 2, 3, A, { cnpj: `'12ABC34501DE35'` })).toBe(false);
    // A faixa do B (mesma filial do B) não aparece para a sessão do A; sem tenant, nada.
    expect(sobre(B, 2, 3, A)).toBe(false);
    expect(sobre(B, 2, 3)).toBe(true);
    const [semTenant] = consultar<{ s: boolean }>(
      banco.conexao,
      `SELECT sefaz_simulador.faixa_sobreposta('${A.filial}', 'normal', '${CNPJ}', 1, '26', 2, 3) AS s`,
      { papel: 'macuxierp_worker' },
    );
    expect(semTenant?.s).toBe(false);
    // SECURITY INVOKER, STABLE, search_path fixo; EXECUTE só do worker.
    const [f] = consultar<{
      definer: boolean;
      vol: string;
      cfg: string;
      app: boolean;
      leitura: boolean;
      worker: boolean;
    }>(
      banco.conexao,
      `SELECT p.prosecdef AS definer, p.provolatile AS vol, array_to_string(p.proconfig, ',') AS cfg,
         has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
         has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
         has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker
       FROM pg_proc p WHERE p.oid = 'sefaz_simulador.faixa_sobreposta'::regproc`,
    );
    expect(f).toEqual({
      definer: false,
      vol: 's',
      cfg: 'search_path=pg_catalog, pg_temp',
      app: false,
      leitura: false,
      worker: true,
    });
  });

  it('UNIQUE global do n_rec: o mesmo nRec em outro tenant cai (23505)', () => {
    const [r] = consultar<{ n: string }>(
      banco.conexao,
      `SELECT n_rec AS n FROM sefaz_simulador.recibo`,
      WORKER(B),
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO sefaz_simulador.recibo (tenant_id, filial_id, modo, n_rec, dh_recbto, pronto_em)
       VALUES ('${A.id}', '${A.filial}', 'normal', '${r?.n}', '2026-11-22T10:00:00-04:00', now());`,
      '23505',
      /recibo_n_rec_uq/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO sefaz_simulador.recibo (tenant_id, filial_id, modo, n_rec, dh_recbto, pronto_em, protocolos)
       VALUES ('${A.id}', '${A.filial}', 'normal', '999999999999999', 'x', now(), '{}');`,
      '23514',
      /recibo_protocolos_ck/,
      WORKER(A),
    );
  });

  it('domínios e CHECKs de formato: ch_nfe, num15, c_stat, modo, cnpj e situacao (23514)', () => {
    const casos: [Record<string, string>, RegExp][] = [
      [{ ch_nfe: `'${'1'.repeat(43)}'` }, /sefaz_simulador\.ch_nfe/],
      [{ ch_nfe: `'13261112345678000195550010000000501000000a0'` }, /sefaz_simulador\.ch_nfe/],
      [{ n_prot: `'21326000000005'` }, /sefaz_simulador\.num15/],
      [{ n_prot: `'21326000000005X'` }, /sefaz_simulador\.num15/],
      [{ c_stat: `'10'` }, /sefaz_simulador\.c_stat/],
      [{ c_stat: `'1A0'` }, /sefaz_simulador\.c_stat/],
      [{ modo: `'svc-an'` }, /sefaz_simulador\.modo/],
      [{ situacao: `'rejeitada'` }, /nota_situacao_ck/],
      [{ cnpj: `'12abc34501de35'` }, /plataforma\.cnpj/],
    ];
    for (const [campos, padrao] of casos)
      recusaDetalhada(banco.conexao, sqlInsert('nota', nota(A), { nnf: '88', ...campos }), '23514', padrao, WORKER(A));
    recusaDetalhada(
      banco.conexao,
      sqlInsert('evento', evento(A), { tp_evento: `'11011'` }),
      '23514',
      /evento_tp_evento_ck/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      sqlInsert('inutilizacao', inut(A, 30, 31), { ano: `'2'` }),
      '23514',
      /inutilizacao_ano_ck/,
      WORKER(A),
    );
    // CNPJ alfanumérico é aceito.
    rodarComo(
      banco.conexao,
      sqlInsert('nota', nota(A), {
        cnpj: `'12ABC34501DE35'`,
        nnf: '88',
        ch_nfe: `'${chaveAcesso(1, 88, cnfDoTenant(A))}'`,
      }),
      WORKER(A),
    );
  });

  it('n_prot do simulador começa com 9 em nota, evento e inutilização (23514); o n_rec não tem essa regra', () => {
    const real = `'213260000000099'`;
    recusaDetalhada(
      banco.conexao,
      sqlInsert('nota', nota(A), { nnf: '89', ch_nfe: `'${chaveAcesso(1, 89, cnfDoTenant(A))}'`, n_prot: real }),
      '23514',
      /nota_n_prot_simulado_ck/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      sqlInsert('evento', evento(A), { n_seq_evento: '9', n_prot: real }),
      '23514',
      /evento_n_prot_simulado_ck/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      sqlInsert('inutilizacao', inut(A, 40, 41), { n_prot: real }),
      '23514',
      /inutilizacao_n_prot_simulado_ck/,
      WORKER(A),
    );
    // Evento sem nProt (rejeitado) passa; nRec sem o 9 também.
    rodarComo(banco.conexao, sqlInsert('evento', evento(A), { n_seq_evento: '9', n_prot: 'NULL' }), WORKER(A));
    rodarComo(
      banco.conexao,
      `INSERT INTO sefaz_simulador.recibo (tenant_id, filial_id, modo, n_rec, dh_recbto, pronto_em)
       VALUES ('${A.id}', '${A.filial}', 'normal', '113260000000099', '2026-11-22T10:00:00-04:00', now());`,
      WORKER(A),
    );
  });

  it('sequências globais: o worker tira nextval das duas; app e leitura recebem 42501 nas sequências e nas tabelas', () => {
    const saida = rodarComo(
      banco.conexao,
      `SELECT nextval('sefaz_simulador.seq_nprot'); SELECT nextval('sefaz_simulador.seq_nprot');
       SELECT nextval('sefaz_simulador.seq_nrec');`,
      WORKER(A),
    );
    const [p1, p2, r1] = numeros(saida);
    expect(p2).toBe((p1 ?? 0) + 1);
    expect(r1).toBeGreaterThan(0);
    const seq = consultar<{ nome: string; tipo: string; max: string; ciclo: boolean }>(
      banco.conexao,
      `SELECT sequencename AS nome, data_type::text AS tipo, max_value::text AS max, cycle AS ciclo
       FROM pg_sequences WHERE schemaname = 'sefaz_simulador' ORDER BY 1`,
    );
    expect(seq).toEqual([
      { nome: 'seq_nprot', tipo: 'bigint', max: '999999999', ciclo: false },
      { nome: 'seq_nrec', tipo: 'bigint', max: '999999999', ciclo: false },
    ]);
    for (const papel of ['macuxierp_app', 'macuxierp_leitura']) {
      const ctx = { papel, tenant: A.id };
      for (const s of ['seq_nprot', 'seq_nrec'])
        recusaDetalhada(
          banco.conexao,
          `SELECT nextval('sefaz_simulador.${s}');`,
          '42501',
          /permission denied/,
          ctx,
        );
      for (const tabela of TABELAS) {
        recusaDetalhada(
          banco.conexao,
          `SELECT 1 FROM sefaz_simulador.${tabela};`,
          '42501',
          /permission denied/,
          ctx,
        );
        expect({
          papel,
          tabela,
          p: privilegiosDe(banco.conexao, papel, `sefaz_simulador.${tabela}`),
        }).toEqual({
          papel,
          tabela,
          p: '-',
        });
      }
      recusaDetalhada(
        banco.conexao,
        `SELECT sefaz_simulador.faixa_sobreposta('${A.filial}', 'normal', '${CNPJ}', 1, '26', 2, 3);`,
        '42501',
        /permission denied/,
        ctx,
      );
    }
    for (const tabela of TABELAS)
      expect(privilegiosDe(banco.conexao, 'macuxierp_worker', `sefaz_simulador.${tabela}`)).toBe('SIUD');
  });

  it('o worker apaga (purga de 400 dias), só no próprio tenant; a nota leva os eventos junto', () => {
    const contar = (t: Tenant, tabela: string) =>
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM sefaz_simulador.${tabela} WHERE tenant_id = '${t.id}'`,
      )[0]?.n;
    const antesB = TABELAS.map((t) => contar(B, t));
    rodarComo(
      banco.conexao,
      `DELETE FROM sefaz_simulador.recibo; DELETE FROM sefaz_simulador.inutilizacao;
       DELETE FROM sefaz_simulador.nota WHERE created_at < now() + interval '1 minute';`,
      WORKER(A),
    );
    for (const tabela of TABELAS) expect({ tabela, n: contar(A, tabela) }).toEqual({ tabela, n: 0 });
    expect(TABELAS.map((t) => contar(B, t))).toEqual(antesB);
    // Volta a massa do A para os testes seguintes (o vitest roda em ordem).
    executar(banco.conexao, fixtureSefazSimulador(A));
  });

  it('a 0025 reexecuta sem erro e sem duplicar nada', () => {
    const contar = () =>
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                 WHERE n.nspname = 'sefaz_simulador')
              + (SELECT count(*) FROM pg_indexes WHERE schemaname = 'sefaz_simulador')
              + (SELECT count(*) FROM pg_policies WHERE schemaname = 'sefaz_simulador') AS n`,
      )[0]?.n;
    const antes = contar();
    const [nprot] = numeros(rodarComo(banco.conexao, `SELECT last_value FROM sefaz_simulador.seq_nprot;`));
    rodarScript(banco.conexao, `BEGIN;\n${readFileSync(MIGRACAO, 'utf8')}\nCOMMIT;`);
    expect(contar()).toBe(antes);
    // A sequência não volta (nProt nunca repete).
    const [depois] = numeros(rodarComo(banco.conexao, `SELECT last_value FROM sefaz_simulador.seq_nprot;`));
    expect(depois).toBe(nprot);
    expect(verificarVazamento(banco.conexao, ['sefaz_simulador'], A.id, B.id)).toEqual([]);
  });

  it('lock_timeout de 5 s e erro detalhado com SQLSTATE (prova do helper)', () => {
    expect(readFileSync(MIGRACAO, 'utf8')).toContain(`SET LOCAL lock_timeout = '5s';`);
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(sqlInsert('inutilizacao', inut(A, 7, 6))), WORKER(A)));
    expect(e.saida).toContain('23514');
  });
});
