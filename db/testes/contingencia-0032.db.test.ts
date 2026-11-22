/** T-0021, migração 0032; motivos em docs/banco/README.md (0032). */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contexto } from '../src/psql.ts';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  numeros,
  PG_DISPONIVEL,
  type PastaDeMigracoes,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import {
  chaveAcesso,
  cnfDe,
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  novoTenant,
  sqlAbrirContingencia,
  sqlNotaAutorizada,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0032_faturamento_contingencia_epec.sql', import.meta.url));
const A = novoTenant('contingencia-0032-a');
const B = novoTenant('contingencia-0032-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const APP_B = { papel: 'macuxierp_app', tenant: B.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };
const CT = 'faturamento.contingencia';
const MOTIVO = 'SEFAZ-AM sem resposta há 5 min';
const PROTOCOLO_EPEC = '913260000000123';

const sqlAbrir = (filial: string, modalidade: string, por: string | null = A.usuario) =>
  sqlAbrirContingencia(filial, modalidade, por);

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — contingência com EPEC (T-0021, 0032)', () => {
  let banco: BancoDeTeste;
  let cnf = 32000;

  const recusa = (sql: string, codigo: string, padrao: RegExp, ctx: Contexto = APP_A) =>
    recusaDetalhada(banco.conexao, sql, codigo, padrao, ctx);

  /** Nota em rascunho numerada (série 1, próximo número da filial) do A. */
  const notaNumerada = (filial: string) => {
    const id = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO faturamento.nota (id, tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
         natureza_operacao)
       VALUES ('${id}', plataforma.tenant_atual(), '${filial}', 1,
         faturamento.reservar_numero('${filial}', 'homologacao', 1::smallint, 1), '${randomUUID()}', '${A.cliente}',
         'Venda');`,
      APP_A,
    );
    const [l] = consultar<{ numero: number }>(
      banco.conexao,
      `SELECT numero FROM faturamento.nota WHERE id = '${id}'`,
      LEITURA_A,
    );
    return { id, numero: l?.numero ?? 0, cnf: ++cnf };
  };

  /** Leva a nota ao status pedido com o tpEmis pedido (chave e cNF coerentes; contingência se tpEmis ≠ 1). */
  const sqlEmitir = (n: { id: string; numero: number; cnf: number }, tipo: number, status = 'emitida_contingencia', extra = '') =>
    `UPDATE faturamento.nota SET status = '${status}', tipo_emissao = ${tipo},
       chave_acesso = '${chaveAcesso(1, n.numero, n.cnf, tipo)}', c_nf = '${cnfDe(n.cnf)}'${
         tipo === 1 ? '' : `, contingencia_em = now(), contingencia_justificativa = '${MOTIVO}'`
       }${extra} WHERE id = '${n.id}';`;

  const sqlEpec = (id: string, protocolo: string | null = PROTOCOLO_EPEC, em: string | null = 'now()') =>
    `UPDATE faturamento.nota SET epec_protocolo = ${protocolo ? `'${protocolo}'` : 'NULL'},
       epec_autorizada_em = ${em ?? 'NULL'} WHERE id = '${id}';`;

  /** Nota EPEC emitida numa filial nova, com a contingência epec aberta. */
  const notaEpecEmitida = () => {
    const filial = randomUUID();
    executar(banco.conexao, sqlAbrir(filial, 'epec'), APP_A);
    const n = notaNumerada(filial);
    executar(banco.conexao, sqlEmitir(n, 4), APP_A);
    return { ...n, filial };
  };

  const nota = (id: string) =>
    consultar<{ status: string; tipo: number; protocolo: string | null; em: boolean }>(
      banco.conexao,
      `SELECT status, tipo_emissao AS tipo, epec_protocolo AS protocolo, epec_autorizada_em IS NOT NULL AS em
       FROM faturamento.nota WHERE id = '${id}'`,
      LEITURA_A,
    );

  const restricoes = () =>
    consultar<{ n: string; d: string; v: boolean }>(
      banco.conexao,
      `SELECT conname AS n, pg_get_constraintdef(oid) AS d, convalidated AS v FROM pg_constraint
       WHERE contype = 'c' AND conrelid IN ('${CT}'::regclass, 'faturamento.nota'::regclass)
         AND (conname LIKE 'contingencia_%' OR conname LIKE 'nota_epec_%' OR conname LIKE 'nota_tipo_emissao%'
           OR conname = 'nota_emitida_contingencia')
       ORDER BY conname`,
    );

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t)).join('\n'),
    );
  });

  afterAll(() => banco?.remover());

  it('estrutura: colunas novas, CHECKs nomeados (sem os inline da 0013) e validados no banco novo', () => {
    const cols = consultar<{ t: string; c: string; tipo: string }>(
      banco.conexao,
      `SELECT table_name AS t, column_name AS c, data_type AS tipo FROM information_schema.columns
       WHERE table_schema = 'faturamento' AND column_name IN ('ligada_por', 'desligada_por', 'epec_protocolo',
         'epec_autorizada_em') ORDER BY table_name, column_name`,
    );
    expect(cols).toEqual([
      { t: 'contingencia', c: 'desligada_por', tipo: 'uuid' },
      { t: 'contingencia', c: 'ligada_por', tipo: 'uuid' },
      { t: 'nota', c: 'epec_autorizada_em', tipo: 'timestamp with time zone' },
      { t: 'nota', c: 'epec_protocolo', tipo: 'text' },
    ]);
    const r = Object.fromEntries(restricoes().map((x) => [x.n, x]));
    expect(r.contingencia_modalidade_check).toBeUndefined();
    expect(r.nota_tipo_emissao_check).toBeUndefined();
    expect(r.contingencia_modalidade_ck?.d).toContain("'epec'");
    expect(r.contingencia_desligada_ck).toMatchObject({ v: true });
    expect(r.nota_tipo_emissao_ck?.d).toContain('ARRAY[1, 4, 6, 7]');
    expect(r.nota_emitida_contingencia?.d).toContain('ARRAY[4, 6, 7]');
    expect(r.nota_epec_protocolo_ck).toMatchObject({ v: true });
    expect(r.nota_epec_coerente_ck?.d).toContain('num_nulls');
    // A leitura lê as colunas do EPEC (sem dado pessoal), como as outras da nota.
    expect(nota(A.nota)).toEqual([{ status: 'autorizada', tipo: 1, protocolo: null, em: false }]);
  });

  it('abrir a contingência epec com ligada_por passa; sem ligada_por 23514; a segunda aberta 23505', () => {
    const filial = randomUUID();
    recusa(sqlAbrir(filial, 'epec', null), '23514', /ligada_por é obrigatório/);
    executar(banco.conexao, sqlAbrir(filial, 'epec'), APP_A);
    recusa(sqlAbrir(filial, 'svc_an'), '23505', /contingencia_uma_aberta/);
    const [c] = consultar<{ m: string; por: string; amb: string }>(
      banco.conexao,
      `SELECT modalidade AS m, ligada_por AS por, ambiente AS amb FROM ${CT} WHERE filial_id = '${filial}'`,
      LEITURA_A,
    );
    expect(c).toEqual({ m: 'epec', por: A.usuario, amb: 'homologacao' });
  });

  it('fecha com fim_em e desligada_por juntos, uma vez; depois não muda nem reabre', () => {
    const filial = randomUUID();
    executar(banco.conexao, sqlAbrir(filial, 'epec'), APP_A);
    const onde = `WHERE filial_id = '${filial}'`;
    recusa(`UPDATE ${CT} SET fim_em = now() ${onde};`, '23514', /contingencia_desligada_ck/);
    recusa(`UPDATE ${CT} SET desligada_por = '${A.usuario}' ${onde};`, '23514', /contingencia_desligada_ck/);
    recusa(`UPDATE ${CT} SET ligada_por = '${randomUUID()}' ${onde};`, '42501', /ligada_por recusado/);
    executar(banco.conexao, `UPDATE ${CT} SET fim_em = now(), desligada_por = '${A.usuario}' ${onde};`, APP_A);
    expect(
      consultar<{ fechada: boolean; por: string }>(
        banco.conexao,
        `SELECT fim_em IS NOT NULL AS fechada, desligada_por AS por FROM ${CT} ${onde}`,
        LEITURA_A,
      ),
    ).toEqual([{ fechada: true, por: A.usuario }]);
    recusa(`UPDATE ${CT} SET fim_em = NULL, desligada_por = NULL ${onde};`, '42501', /só recebe o fim, uma vez/);
  });

  it("modalidade 'svc_rs' continua passando; 'fs_da' (fora da v1) cai em 23514", () => {
    executar(banco.conexao, sqlAbrir(randomUUID(), 'svc_rs'), APP_A);
    recusa(sqlAbrir(randomUUID(), 'fs_da'), '23514', /contingencia_modalidade_ck/);
  });

  it('nota: tpEmis 4 com a contingência epec aberta vai a emitida_contingencia; tpEmis 5 cai em 23514', () => {
    const n = notaEpecEmitida();
    expect(nota(n.id)).toEqual([{ status: 'emitida_contingencia', tipo: 4, protocolo: null, em: false }]);
    const r = notaNumerada(randomUUID());
    recusa(
      `UPDATE faturamento.nota SET tipo_emissao = 5, contingencia_em = now(), contingencia_justificativa = '${MOTIVO}'
         WHERE id = '${r.id}';`,
      '23514',
      /nota_tipo_emissao_ck/,
    );
  });

  it('nota: epec_protocolo sem a data, epec_* com tpEmis 6 e protocolo fora do formato caem em 23514', () => {
    const n = notaEpecEmitida();
    recusa(sqlEpec(n.id, PROTOCOLO_EPEC, null), '23514', /nota_epec_coerente_ck/, WORKER_A);
    recusa(sqlEpec(n.id, null, 'now()'), '23514', /nota_epec_coerente_ck/, WORKER_A);
    recusa(sqlEpec(n.id, '91326000000012'), '23514', /nota_epec_protocolo_ck/, WORKER_A);
    recusa(sqlEpec(n.id, '91326000000012A'), '23514', /nota_epec_protocolo_ck/, WORKER_A);

    const filial = randomUUID();
    executar(banco.conexao, sqlAbrir(filial, 'svc_an'), APP_A);
    const svc = notaNumerada(filial);
    executar(banco.conexao, sqlEmitir(svc, 6), APP_A);
    recusa(sqlEpec(svc.id), '23514', /nota_epec_coerente_ck/, WORKER_A);
    expect(nota(svc.id)).toEqual([{ status: 'emitida_contingencia', tipo: 6, protocolo: null, em: false }]);
  });

  it('nota emitida_contingencia recebe o EPEC uma vez, de nulo para valor; depois não muda (regra 7)', () => {
    const n = notaEpecEmitida();
    executar(banco.conexao, sqlEpec(n.id), WORKER_A);
    expect(nota(n.id)).toEqual([
      { status: 'emitida_contingencia', tipo: 4, protocolo: PROTOCOLO_EPEC, em: true },
    ]);
    recusa(sqlEpec(n.id, '913260000000999'), '42501', /epec_\w+ recusado/, WORKER_A);
    recusa(
      `UPDATE faturamento.nota SET epec_autorizada_em = now() - interval '1 minute' WHERE id = '${n.id}';`,
      '42501',
      /epec_autorizada_em recusado/,
      WORKER_A,
    );
    recusa(sqlEpec(n.id, null, null), '42501', /recusado/, WORKER_A);
    // Volta à SEFAZ normal (RN-FAT-09): em autorização, o EPEC também não muda.
    executar(banco.conexao, `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`, WORKER_A);
    recusa(sqlEpec(n.id, '913260000000999'), '42501', /epec_\w+ recusado/, WORKER_A);
    expect(nota(n.id)).toEqual([{ status: 'em_autorizacao', tipo: 4, protocolo: PROTOCOLO_EPEC, em: true }]);
  });

  it('RN-FAT-05: o tpEmis exige a contingência aberta da mesma modalidade (svc_an 6, epec 4, svc_rs 7)', () => {
    const svcAn = randomUUID();
    executar(banco.conexao, sqlAbrir(svcAn, 'svc_an'), APP_A);
    executar(banco.conexao, sqlEmitir(notaNumerada(svcAn), 6, 'em_autorizacao'), APP_A);

    const epec = randomUUID();
    executar(banco.conexao, sqlAbrir(epec, 'epec'), APP_A);
    recusa(sqlEmitir(notaNumerada(epec), 6, 'em_autorizacao'), '23514', /RN-FAT-05: tpEmis 6 .*svc_an/);
    recusa(sqlEmitir(notaNumerada(epec), 6), '23514', /RN-FAT-05: tpEmis 6 .*svc_an/);
    const n4 = notaNumerada(epec);
    executar(banco.conexao, sqlEmitir(n4, 4), APP_A);
    expect(nota(n4.id)).toEqual([{ status: 'emitida_contingencia', tipo: 4, protocolo: null, em: false }]);

    recusa(sqlEmitir(notaNumerada(randomUUID()), 7, 'em_autorizacao'), '23514', /RN-FAT-05: tpEmis 7 .*svc_rs/);
  });

  it('EPEC numa escrita só: em_autorizacao → emitida_contingencia com tpEmis 4 e o protocolo do evento', () => {
    const filial = randomUUID();
    const n = notaNumerada(filial);
    executar(banco.conexao, sqlEmitir(n, 1, 'em_autorizacao'), APP_A);
    executar(banco.conexao, sqlAbrir(filial, 'epec'), APP_A);
    executar(
      banco.conexao,
      sqlEmitir(n, 4, 'emitida_contingencia', `, epec_protocolo = '${PROTOCOLO_EPEC}', epec_autorizada_em = now()`),
      WORKER_A,
    );
    expect(nota(n.id)).toEqual([{ status: 'emitida_contingencia', tipo: 4, protocolo: PROTOCOLO_EPEC, em: true }]);
    // Sem a contingência epec aberta, a mesma entrada cai (RN-FAT-05).
    const m = notaNumerada(randomUUID());
    executar(banco.conexao, sqlEmitir(m, 1, 'em_autorizacao'), APP_A);
    recusa(
      sqlEmitir(m, 4, 'emitida_contingencia', `, epec_protocolo = '${PROTOCOLO_EPEC}', epec_autorizada_em = now()`),
      '23514',
      /RN-FAT-05: tpEmis 4 .*epec/,
      WORKER_A,
    );
  });

  it('RN-FAT-09: a nota EPEC sem o evento autorizado não volta a em_autorizacao (23514)', () => {
    const n = notaEpecEmitida();
    const voltar = `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`;
    recusa(voltar, '23514', /RN-FAT-09/, WORKER_A);
    executar(banco.conexao, sqlEpec(n.id), WORKER_A);
    // Com o evento, volta mesmo com a contingência já fechada.
    executar(
      banco.conexao,
      `UPDATE ${CT} SET fim_em = now(), desligada_por = '${A.usuario}' WHERE filial_id = '${n.filial}';`,
      APP_A,
    );
    executar(banco.conexao, voltar, WORKER_A);
    expect(nota(n.id)).toEqual([{ status: 'em_autorizacao', tipo: 4, protocolo: PROTOCOLO_EPEC, em: true }]);
  });

  it('o EPEC gravado não muda nem volta a nulo também na rejeitada (RN-FAT-08, regra 7)', () => {
    const n = notaEpecEmitida();
    executar(banco.conexao, sqlEpec(n.id), WORKER_A);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';
       UPDATE faturamento.nota SET status = 'rejeitada', c_stat = '539', x_motivo = 'Rejeicao' WHERE id = '${n.id}';`,
      WORKER_A,
    );
    expect(nota(n.id)).toEqual([{ status: 'rejeitada', tipo: 4, protocolo: PROTOCOLO_EPEC, em: true }]);
    recusa(sqlEpec(n.id, null, null), '42501', /RN-FAT-08: .*epec_protocolo recusado/);
    recusa(sqlEpec(n.id, '913260000000999'), '42501', /epec_protocolo recusado/);
    recusa(
      `UPDATE faturamento.nota SET epec_autorizada_em = now() - interval '1 minute' WHERE id = '${n.id}';`,
      '42501',
      /epec_autorizada_em recusado/,
    );
  });

  it('RN-FAT-05/07/09: a nota EPEC com o evento, rejeitada na volta, é reenviada com a contingência fechada', () => {
    const n = notaEpecEmitida();
    executar(banco.conexao, sqlEpec(n.id), WORKER_A);
    const rejeitar = `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';
       UPDATE faturamento.nota SET status = 'rejeitada', c_stat = '539', x_motivo = 'Rejeicao' WHERE id = '${n.id}';`;
    executar(banco.conexao, rejeitar, WORKER_A);
    executar(
      banco.conexao,
      `UPDATE ${CT} SET fim_em = now(), desligada_por = '${A.usuario}' WHERE filial_id = '${n.filial}';`,
      APP_A,
    );
    executar(banco.conexao, `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`, WORKER_A);
    expect(nota(n.id)).toEqual([{ status: 'em_autorizacao', tipo: 4, protocolo: PROTOCOLO_EPEC, em: true }]);

    // A mesma nota sem o evento EPEC: rejeitada, com a contingência fechada, não volta (RN-FAT-05).
    const filial = randomUUID();
    executar(banco.conexao, sqlAbrir(filial, 'epec'), APP_A);
    const m = notaNumerada(filial);
    executar(banco.conexao, sqlEmitir(m, 4, 'em_autorizacao'), APP_A);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'rejeitada', c_stat = '539', x_motivo = 'Rejeicao' WHERE id = '${m.id}';`,
      WORKER_A,
    );
    executar(
      banco.conexao,
      `UPDATE ${CT} SET fim_em = now(), desligada_por = '${A.usuario}' WHERE filial_id = '${filial}';`,
      APP_A,
    );
    const voltar = `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${m.id}';`;
    recusa(voltar, '23514', /RN-FAT-05: tpEmis 4 .*epec/, WORKER_A);
    // Nem gravando o EPEC na rejeitada para cair na exceção (RN-FAT-08).
    recusa(sqlEpec(m.id), '42501', /RN-FAT-08: o EPEC entra só com a nota em emitida_contingencia/, WORKER_A);
    expect(nota(m.id)).toEqual([{ status: 'rejeitada', tipo: 4, protocolo: null, em: false }]);
  });

  it('nota autorizada não recebe EPEC (regra 7)', () => {
    const { id, sql } = sqlNotaAutorizada(A, randomUUID(), 'homologacao', ++cnf);
    executar(banco.conexao, sql);
    recusa(sqlEpec(id), '42501', /nunca é editada/, WORKER_A);
  });

  it('RLS: o UPDATE do tenant B na contingência e na nota do A atinge 0 linhas', () => {
    const n = notaEpecEmitida();
    const contar = (sql: string) => numeros(rodarComo(banco.conexao, sql, APP_B));
    expect(
      contar(
        `WITH u AS (UPDATE ${CT} SET fim_em = now(), desligada_por = '${B.usuario}'
           WHERE filial_id = '${n.filial}' RETURNING 1) SELECT count(*) FROM u;`,
      ),
    ).toEqual([0]);
    expect(
      contar(
        `WITH u AS (UPDATE faturamento.nota SET epec_protocolo = '${PROTOCOLO_EPEC}', epec_autorizada_em = now()
           WHERE id = '${n.id}' RETURNING 1) SELECT count(*) FROM u;`,
      ),
    ).toEqual([0]);
    expect(nota(n.id)).toEqual([{ status: 'emitida_contingencia', tipo: 4, protocolo: null, em: false }]);
    expect(
      consultar<{ aberta: boolean }>(
        banco.conexao,
        `SELECT fim_em IS NULL AS aberta FROM ${CT} WHERE filial_id = '${n.filial}'`,
        LEITURA_A,
      ),
    ).toEqual([{ aberta: true }]);
  });

  it('a 0032 roda de novo sem erro, sem duplicar CHECK nem gatilho, e as travas continuam valendo', () => {
    const antes = restricoes();
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(restricoes()).toEqual(antes);
    const [g] = consultar<{ ct: number; nota: number }>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = '${CT}'::regclass) AS ct,
         (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
            AND tgrelid = 'faturamento.nota'::regclass AND tgname = 'nota_antes_alterar') AS nota`,
    );
    // contingencia: tocar_updated_at, contingencia_antes e contingencia_sem_exclusao.
    expect(g).toEqual({ ct: 3, nota: 1 });
    recusa(sqlAbrir(randomUUID(), 'epec', null), '23514', /ligada_por é obrigatório/);
    recusa(sqlAbrir(randomUUID(), 'fs_da'), '23514', /contingencia_modalidade_ck/);
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0032 sobre a contingência de antes (T-0021)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  const C = novoTenant('contingencia-0032-c');
  const APP_C = { papel: 'macuxierp_app', tenant: C.id };

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0032');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('a fechada de antes fica sem desligada_por (CHECK NOT VALID); a aberta de antes fecha com desligada_por', () => {
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(
      '0032_faturamento_contingencia_epec.sql',
    );
    permitirSetRole(banco.conexao);
    const aberta = randomUUID();
    executar(
      banco.conexao,
      fixturePlataforma(C) +
        fixtureModulos(C) +
        fixtureFaturamento(C, false, true) +
        `INSERT INTO ${CT} (tenant_id, filial_id, modalidade, motivo)
         VALUES ('${C.id}', '${aberta}', 'svc_rs', '${MOTIVO}');`,
    );

    expect(migrar(banco.conexao, { oficiais: false })).toContain('0032_faturamento_contingencia_epec.sql');
    const [v] = consultar<{ v: boolean }>(
      banco.conexao,
      `SELECT convalidated AS v FROM pg_constraint
       WHERE conrelid = '${CT}'::regclass AND conname = 'contingencia_desligada_ck'`,
    );
    expect(v).toEqual({ v: false });
    expect(
      consultar<{ m: string; ligada: boolean; desligada: boolean; fechada: boolean }>(
        banco.conexao,
        `SELECT modalidade AS m, ligada_por IS NOT NULL AS ligada, desligada_por IS NOT NULL AS desligada,
           fim_em IS NOT NULL AS fechada FROM ${CT} WHERE tenant_id = '${C.id}' ORDER BY modalidade`,
      ),
    ).toEqual([
      { m: 'svc_an', ligada: false, desligada: false, fechada: true },
      { m: 'svc_rs', ligada: false, desligada: false, fechada: false },
    ]);

    // A aberta de antes (sem ligada_por) ainda fecha, agora com desligada_por; só fim_em cai em 23514.
    const onde = `WHERE filial_id = '${aberta}'`;
    recusaDetalhada(banco.conexao, `UPDATE ${CT} SET fim_em = now() ${onde};`, '23514', /contingencia_desligada_ck/, APP_C);
    executar(banco.conexao, `UPDATE ${CT} SET fim_em = now(), desligada_por = '${C.usuario}' ${onde};`, APP_C);
    // Rodar de novo com a linha antiga ainda inválida mantém o NOT VALID, sem erro.
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    const [v2] = consultar<{ v: boolean }>(
      banco.conexao,
      `SELECT convalidated AS v FROM pg_constraint
       WHERE conrelid = '${CT}'::regclass AND conname = 'contingencia_desligada_ck'`,
    );
    expect(v2).toEqual({ v: false });
  });
});
