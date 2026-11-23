/**
 * T-0021, migração 0020: tipo nfe_assinada em faturamento.nota_xml (uma linha por versão do conteúdo, sem protocolo,
 * só INSERT, sem mudar o status da nota; RN-FAT-03 e RN-FAT-07). Motivo em docs/banco/README.md.
 */
import { randomUUID } from 'node:crypto';
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
  PG_DISPONIVEL,
  type PastaDeMigracoes,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  rodarScript,
  verboso,
} from './apoio.ts';
import {
  chaveAcesso,
  cnfDe,
  cnfDoTenant,
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  hashSql,
  novoTenant,
  sqlAbrirContingencia,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0020_nota_xml_nfe_assinada.sql', import.meta.url));
const A = novoTenant('nota-xml-0020-a');
const B = novoTenant('nota-xml-0020-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };

interface Nota {
  id: string;
  chave: string;
  numero: number;
  cnf: number;
}

interface Linha {
  tipo?: string;
  nota?: string;
  chave?: string;
  protocolo?: string | null;
  versao?: number | null;
  xml?: string;
  extra?: { coluna: string; valor: string };
}

/** INSERT de uma linha de nota_xml (padrão: nfe_assinada, sem protocolo), no tenant da sessão. */
const sqlXml = (l: Linha): string => {
  const xml = l.xml ?? `<NFe>${randomUUID()}</NFe>`;
  const protocolo = l.protocolo === undefined || l.protocolo === null ? 'NULL' : `'${l.protocolo}'`;
  const versao = l.versao === undefined || l.versao === null ? 'NULL' : String(l.versao);
  const extraCol = l.extra ? `, ${l.extra.coluna}` : '';
  const extraVal = l.extra ? `, ${l.extra.valor}` : '';
  return `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, versao, xml, sha256${extraCol})
  VALUES (plataforma.tenant_atual(), '${l.tipo ?? 'nfe_assinada'}', '${l.nota}', '${l.chave}', ${protocolo}, ${versao},
    '${xml}', ${hashSql(xml)}${extraVal});`;
};

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — nota_xml nfe_assinada (T-0021, 0020)', () => {
  let banco: BancoDeTeste;
  let cnf = 5000;

  /** Nota do tenant A em rascunho numerada e com chave (pronta para assinar), ou já enviada. */
  const criarNota = (enviar = false): Nota => {
    const c = ++cnf;
    const saida = rodarScript(
      banco.conexao,
      `SET ROLE macuxierp_app;
SET app.tenant_id = '${A.id}';
BEGIN;
SELECT faturamento.reservar_numero('${A.filial}', 'homologacao', 1::smallint, 1) AS n \\gset
INSERT INTO faturamento.nota (tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id, natureza_operacao)
  VALUES (plataforma.tenant_atual(), '${A.filial}', 1, :n, '${randomUUID()}', '${A.cliente}', 'Venda')
  RETURNING id || ' ' || numero;
COMMIT;`,
    );
    const [id = '', numero = '0'] = (saida.trim().split('\n').pop() ?? '').split(' ');
    const chave = chaveAcesso(1, Number(numero), c);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET chave_acesso = '${chave}', c_nf = '${cnfDe(c)}' WHERE id = '${id}';` +
        (enviar ? `\nUPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${id}';` : ''),
      APP_A,
    );
    return { id, chave, numero: Number(numero), cnf: c };
  };

  const status = (id: string): string =>
    consultar<{ s: string }>(banco.conexao, `SELECT status AS s FROM faturamento.nota WHERE id = '${id}'`)[0]?.s ??
    '';

  /** Falha esperada: o SQLSTATE e o padrão na mensagem. */
  const recusa = (sql: string, codigo: string, padrao: RegExp, ctx = WORKER_A) => {
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(sql), ctx));
    expect({ sql, saida: e.saida }).toMatchObject({ sql, saida: expect.stringContaining(codigo) });
    expect({ sql, mensagem: e.mensagem }).toMatchObject({ sql, mensagem: expect.stringMatching(padrao) });
  };

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

  it('constraints e índice com nomes estáveis; o CHECK inline do tipo saiu; protocolo anulável', () => {
    const cons = consultar<{ nome: string; validado: boolean }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validado FROM pg_constraint
       WHERE conrelid = 'faturamento.nota_xml'::regclass AND contype = 'c'
         AND (conname LIKE 'nota_xml_tipo%' OR conname IN ('nota_xml_versao_ck', 'nota_xml_protocolo_ck',
           'nota_xml_referencia'))
       ORDER BY 1`,
    );
    expect(cons).toEqual([
      { nome: 'nota_xml_protocolo_ck', validado: true },
      { nome: 'nota_xml_referencia', validado: true },
      { nome: 'nota_xml_tipo_ck', validado: true },
      { nome: 'nota_xml_versao_ck', validado: true },
    ]);
    const [r] = consultar<{ nulo: boolean; uq: number; leitura: boolean }>(
      banco.conexao,
      `SELECT (SELECT NOT attnotnull FROM pg_attribute WHERE attrelid = 'faturamento.nota_xml'::regclass
                 AND attname = 'protocolo') AS nulo,
              (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'faturamento'
                 AND indexname = 'nota_xml_assinada_versao_uq') AS uq,
              has_column_privilege('macuxierp_leitura', 'faturamento.nota_xml', 'versao', 'SELECT') AS leitura`,
    );
    expect(r).toEqual({ nulo: true, uq: 1, leitura: true });
  });

  it('versões 1 e 2 da mesma nota passam (worker e app); versão repetida falha com 23505', () => {
    const n = criarNota();
    executar(banco.conexao, sqlXml({ nota: n.id, chave: n.chave, versao: 1 }), WORKER_A);
    executar(banco.conexao, sqlXml({ nota: n.id, chave: n.chave, versao: 2 }), APP_A);
    recusa(sqlXml({ nota: n.id, chave: n.chave, versao: 2 }), '23505', /nota_xml_assinada_versao_uq/);
    expect(
      consultar<{ v: number }>(
        banco.conexao,
        `SELECT versao AS v FROM faturamento.nota_xml WHERE nota_id = '${n.id}' ORDER BY 1`,
        LEITURA_A,
      ),
    ).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it('protocolo preenchido na nfe_assinada falha; protocolo nulo nos outros tipos falha', () => {
    const n = criarNota();
    recusa(
      sqlXml({ nota: n.id, chave: n.chave, versao: 1, protocolo: '113260000000777' }),
      '23514',
      /nota_xml_protocolo_ck/,
    );
    // nfe_autorizada sem protocolo: a trigger (protocolo diferente do da nota) ou o CHECK recusa.
    recusa(
      sqlXml({ tipo: 'nfe_autorizada', nota: A.nota, chave: chaveAcesso(1, 1, cnfDoTenant(A)) }),
      '23514',
      /RN-FAT-03|nota_xml_protocolo_ck/,
    );
    // Evento pendente sem protocolo próprio: passa na trigger e cai no CHECK.
    executar(
      banco.conexao,
      `INSERT INTO faturamento.nota_evento (tenant_id, nota_id, tipo, n_seq_evento, texto)
         VALUES (plataforma.tenant_atual(), '${A.nota}', 'cce', 2, 'Segunda correção do complemento do endereço');`,
      APP_A,
    );
    const xml = '<procEventoNFe>sem protocolo</procEventoNFe>';
    recusa(
      `INSERT INTO faturamento.nota_xml (tenant_id, tipo, evento_id, xml, sha256)
         SELECT plataforma.tenant_atual(), 'evento_cce', e.id, '${xml}', ${hashSql(xml)}
         FROM faturamento.nota_evento e WHERE e.nota_id = '${A.nota}' AND e.n_seq_evento = 2;`,
      '23514',
      /nota_xml_protocolo_ck/,
    );
  });

  it('versao nula na nfe_assinada, versao em outro tipo e versao 0 falham com 23514', () => {
    const n = criarNota();
    recusa(sqlXml({ nota: n.id, chave: n.chave }), '23514', /nota_xml_versao_ck/);
    recusa(sqlXml({ nota: n.id, chave: n.chave, versao: 0 }), '23514', /nota_xml_versao_ck/);
    // nfe_autorizada com versao: a nota da massa já foi guardada, então usa uma nota com guarda pendente.
    const p = criarNota(true);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'autorizada_guarda_pendente', protocolo = '113260000000301',
         autorizada_em = now(), c_stat = 100 WHERE id = '${p.id}';`,
      WORKER_A,
    );
    recusa(
      sqlXml({ tipo: 'nfe_autorizada', nota: p.id, chave: p.chave, protocolo: '113260000000301', versao: 1 }),
      '23514',
      /nota_xml_versao_ck/,
    );
    // Sem a versao, a mesma nota se autoriza (a nfe_autorizada continua como na 0013).
    executar(
      banco.conexao,
      sqlXml({ tipo: 'nfe_autorizada', nota: p.id, chave: p.chave, protocolo: '113260000000301' }),
      WORKER_A,
    );
    expect(status(p.id)).toBe('autorizada');
  });

  it('a nfe_assinada referencia a nota com a chave dela, antes do envio', () => {
    const n = criarNota();
    const outra = criarNota();
    recusa(sqlXml({ nota: n.id, chave: outra.chave, versao: 1 }), '23514', /chave do XML assinado/);
    // Nota autorizada (a da massa) não recebe XML assinado.
    recusa(
      sqlXml({ nota: A.nota, chave: chaveAcesso(1, 1, cnfDoTenant(A)), versao: 1 }),
      '23514',
      /XML assinado entra só/,
    );
    // Com evento: nfe_assinada não aceita evento_id (nota_xml_referencia).
    recusa(
      sqlXml({
        nota: n.id,
        chave: n.chave,
        versao: 1,
        extra: { coluna: 'evento_id', valor: `(SELECT id FROM faturamento.nota_evento LIMIT 1)` },
      }),
      '23514',
      /nota_xml_referencia/,
    );
  });

  it('o INSERT da nfe_assinada não muda o status; em_autorizacao recusa; rejeitada aceita a nova versão', () => {
    const n = criarNota();
    executar(banco.conexao, sqlXml({ nota: n.id, chave: n.chave, versao: 1 }), APP_A);
    expect(status(n.id)).toBe('rascunho');
    executar(banco.conexao, `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`, WORKER_A);
    // Em autorização não entra versão nova: a última guardada é a transmitida.
    recusa(sqlXml({ nota: n.id, chave: n.chave, versao: 2 }), '23514', /XML assinado entra só/);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'rejeitada', c_stat = 225, x_motivo = 'Falha no schema'
         WHERE id = '${n.id}';`,
      WORKER_A,
    );
    // Reenvio da rejeitada (RN-FAT-07): a versão 2 entra e o status não muda.
    executar(banco.conexao, sqlXml({ nota: n.id, chave: n.chave, versao: 2 }), WORKER_A);
    expect(status(n.id)).toBe('rejeitada');

    const p = criarNota(true);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'autorizada_guarda_pendente', protocolo = '113260000000401',
         autorizada_em = now(), c_stat = 100 WHERE id = '${p.id}';`,
      WORKER_A,
    );
    // Sem a nfe_autorizada, a nota não passa a autorizada (a trigger da nota exige o XML autorizado).
    recusa(
      `UPDATE faturamento.nota SET status = 'autorizada' WHERE id = '${p.id}';`,
      '23514',
      /guarda pendente/,
    );
    expect(status(p.id)).toBe('autorizada_guarda_pendente');
    // A assinada não entra depois da autorização.
    recusa(sqlXml({ nota: p.id, chave: p.chave, versao: 1 }), '23514', /XML assinado entra só/);
  });

  it('contingência: na mesma transação a nota vai a emitida_contingencia com a chave nova e a assinada entra', () => {
    const n = criarNota(true);
    const nova = chaveAcesso(1, n.numero, n.cnf, 6);
    expect(nova).not.toBe(n.chave);
    // A contingência da massa está encerrada; abre uma na filial do A (RN-FAT-05).
    executar(
      banco.conexao,
      sqlAbrirContingencia(A.filial, 'svc_an', A.usuario),
      APP_A,
    );
    // Com a chave antiga, a assinada não entra nem antes nem depois da troca (em_autorizacao; chave diferente).
    recusa(sqlXml({ nota: n.id, chave: n.chave, versao: 1 }), '23514', /XML assinado entra só/);
    rodarScript(
      banco.conexao,
      `SET ROLE macuxierp_worker;
SET app.tenant_id = '${A.id}';
BEGIN;
UPDATE faturamento.nota SET status = 'emitida_contingencia', tipo_emissao = 6, chave_acesso = '${nova}',
  contingencia_em = now(), contingencia_justificativa = 'SEFAZ-AM sem resposta há 5 min' WHERE id = '${n.id}';
${sqlXml({ nota: n.id, chave: nova, versao: 1 })}
COMMIT;`,
    );
    expect(status(n.id)).toBe('emitida_contingencia');
    expect(
      consultar<{ chave: string; v: number }>(
        banco.conexao,
        `SELECT chave_acesso AS chave, versao AS v FROM faturamento.nota_xml WHERE nota_id = '${n.id}'`,
        LEITURA_A,
      ),
    ).toEqual([{ chave: nova, v: 1 }]);
    recusa(sqlXml({ nota: n.id, chave: n.chave, versao: 2 }), '23514', /chave do XML assinado/);
    executar(
      banco.conexao,
      `UPDATE faturamento.contingencia SET fim_em = now(), desligada_por = '${A.usuario}'
       WHERE filial_id = '${A.filial}' AND fim_em IS NULL;`,
      APP_A,
    );
  });

  it('RLS: o tenant B não vê a nfe_assinada do A', () => {
    const n = criarNota();
    executar(banco.conexao, sqlXml({ nota: n.id, chave: n.chave, versao: 1 }), WORKER_A);
    const contar = (ctx: typeof WORKER_A) =>
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM faturamento.nota_xml WHERE tipo = 'nfe_assinada' AND nota_id = '${n.id}'`,
        ctx,
      );
    expect(contar(WORKER_A)).toEqual([{ n: 1 }]);
    expect(contar(WORKER_B)).toEqual([{ n: 0 }]);
    // O B também não grava na nota do A (a trigger não acha a nota sob a RLS).
    recusa(
      sqlXml({ nota: n.id, chave: n.chave, versao: 2 }),
      '23514',
      /XML assinado entra só/,
      WORKER_B,
    );
  });

  it('a 0020 roda de novo sem erro, sem duplicar constraints nem índice', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    const [r] = consultar<{ cons: number; uq: number; tipo: number }>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'faturamento.nota_xml'::regclass
                 AND conname IN ('nota_xml_tipo_ck', 'nota_xml_versao_ck', 'nota_xml_protocolo_ck',
                   'nota_xml_referencia')) AS cons,
              (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'faturamento'
                 AND indexname = 'nota_xml_assinada_versao_uq') AS uq,
              (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'faturamento.nota_xml'::regclass
                 AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%evento_cce%'
                 AND conname NOT IN ('nota_xml_tipo_ck')) AS tipo`,
    );
    expect(r).toEqual({ cons: 4, uq: 1, tipo: 0 });
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0020 sobre nota_xml gravado antes (T-0021)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  const C = novoTenant('nota-xml-0020-c');

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0020');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('as linhas de antes da 0020 (nfe_autorizada, evento e inutilização) continuam válidas', () => {
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(
      '0020_nota_xml_nfe_assinada.sql',
    );
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(C) + fixtureModulos(C) + fixtureFaturamento(C, true));

    expect(migrar(banco.conexao, { oficiais: false })).toContain('0020_nota_xml_nfe_assinada.sql');

    const r = consultar<{ tipo: string; versao: number | null; protocolo: boolean }>(
      banco.conexao,
      `SELECT tipo, versao, protocolo IS NOT NULL AS protocolo FROM faturamento.nota_xml
       WHERE tenant_id = '${C.id}' ORDER BY tipo`,
    );
    expect(r).toEqual([
      { tipo: 'evento_cce', versao: null, protocolo: true },
      { tipo: 'inutilizacao', versao: null, protocolo: true },
      { tipo: 'nfe_autorizada', versao: null, protocolo: true },
    ]);
    const [v] = consultar<{ invalidas: number }>(
      banco.conexao,
      `SELECT count(*)::int AS invalidas FROM pg_constraint
       WHERE conrelid = 'faturamento.nota_xml'::regclass AND NOT convalidated`,
    );
    expect(v).toEqual({ invalidas: 0 });
    expect(
      consultar<{ s: string }>(banco.conexao, `SELECT status AS s FROM faturamento.nota WHERE id = '${C.nota}'`),
    ).toEqual([{ s: 'autorizada' }]);
  });
});
