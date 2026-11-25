/**
 * T-0059 (v0.3.12, migração 0057; desenho docs/desenho/T-0059.md §3; RN-INF-06): pré-cadastro de cliente recebido do
 * Macuxi FDV. cliente_recebido (uma linha por cliente_uuid e revisão; reenvio = revisão nova, a mesma revisão de novo
 * cai na mesma linha), cliente_retorno (molde do retorno_enviado), registro_publicado.aguarda_vinculo, a agenda no sinal,
 * o vinculo_divergente do conflito_chave e o expurgo diário do recusado (180 dias depois da última recusa, só contagens
 * na auditoria). O expurgo roda pela expurgar_pre_cadastro (0062). Dados fictícios.
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
  falha,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarScript,
} from './apoio.ts';
import { fixtureIntegracao, fixturePlataforma, novoTenant } from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0057_integracao_fdv_pre_cadastro_cliente.sql', import.meta.url));
const A = novoTenant('pre-cadastro-0057-a');
const B = novoTenant('pre-cadastro-0057-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };
const CORTE = `now() - interval '180 days'`;
/** Expurgo da 0062 no tenant do contexto; aqui só há recusado (o sem-decisão fica no pre-cadastro-0062). */
const expurgoDoRecusado = (revisoes: number, pre_cadastros: number) => ({
  r: { recusado: { revisoes, pre_cadastros }, sem_decisao: { revisoes: 0, pre_cadastros: 0 } },
});
const ERROS = '[{"campo": "documento", "codigo": "documento_invalido", "mensagem": "Documento inválido."}]';

interface Pre {
  uuid: string;
  revisao?: number;
  situacao?: 'recebido' | 'recusado' | 'aceito' | 'reenviado';
  /** Dias atrás da recusa (recusado) ou da decisão (aceito). */
  dias?: number;
  payload?: boolean;
}

/** INSERT do worker de uma revisão do pré-cadastro (dados fictícios). */
const pre = (t: string, p: Pre): string => {
  const situacao = p.situacao ?? 'recebido';
  const decidido = situacao === 'aceito' || situacao === 'recusado' ? `now() - interval '${p.dias ?? 0} days'` : 'NULL';
  const payload = situacao === 'aceito' || p.payload === false ? 'NULL' : `'{"razao_social": "Mercadinho Ficticio", "documento": "11444777000161"}'`;
  return `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, codigo_fdv, razao_social,
    documento_mascarado, vendedor_external_id, payload, recebido_em, situacao, motivo, erros, cliente_id, decidido_em,
    ultima_recusa_em)
  VALUES ('${t}', '${p.uuid}', ${p.revisao ?? 1}, repeat('${(p.revisao ?? 1) % 10}', 64), '12345', 'Mercadinho Ficticio',
    '11.444.777/****-**', ${situacao === 'aceito' ? `'V1'` : 'NULL'}, ${payload}, '2026-11-24T10:00:00.000-04:00',
    '${situacao}', ${situacao === 'recusado' ? `'Documento inválido.'` : 'NULL'},
    ${situacao === 'recusado' ? `'${ERROS}'` : 'NULL'}, ${situacao === 'aceito' ? 'gen_random_uuid()' : 'NULL'}, ${decidido},
    ${situacao === 'recusado' ? decidido : 'NULL'});`;
};

let banco: BancoDeTeste;
const um = <T,>(sql: string, ctx?: Parameters<typeof consultar>[2]): T => consultar<T>(banco.conexao, sql, ctx)[0] as T;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — pré-cadastro de cliente do FDV (T-0059, 0057)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureIntegracao(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  // colunas padrão e RLS: a varredura geral de plataforma.db.test.ts
  it('estrutura: política só por tenant, chave (cliente_uuid, revisao) e índices da tela, do expurgo e da fila', () => {
    for (const t of ['cliente_recebido', 'cliente_retorno']) {
      const r = um<Record<string, unknown>>(
        `SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'integracao_fdv' AND tablename = '${t}'
                    AND policyname = 'isolamento_tenant') AS politica,
           NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'integracao_fdv' AND tablename = '${t}'
                    AND policyname = 'worker_global') AS sem_global`,
      );
      expect({ t, ...r }).toEqual({ t, politica: true, sem_global: true });
    }
    const ix = consultar<{ i: string; d: string }>(
      banco.conexao,
      `SELECT indexname AS i, indexdef AS d FROM pg_indexes WHERE schemaname = 'integracao_fdv'
         AND indexname IN ('cliente_recebido_revisao_uq', 'cliente_recebido_chegada_idx', 'cliente_recebido_expurgo_idx',
           'cliente_retorno_uq', 'cliente_retorno_fila_idx', 'registro_publicado_fila_livre_idx',
           'registro_publicado_fila_idx', 'sinal_proxima_busca_clientes_idx', 'sinal_proximo_retorno_clientes_idx')
       ORDER BY 1`,
    );
    expect(ix.map((x) => `${x.i}: ${x.d.replace(/.* USING btree /, '')}`)).toEqual([
      'cliente_recebido_chegada_idx: (tenant_id, chegou_em DESC)',
      "cliente_recebido_expurgo_idx: (tenant_id, ultima_recusa_em) WHERE ((situacao = 'recusado'::text) AND (payload IS NOT NULL))",
      'cliente_recebido_revisao_uq: (tenant_id, cliente_uuid, revisao)',
      "cliente_retorno_fila_idx: (tenant_id, created_at) WHERE (estado = 'pendente'::text)",
      'cliente_retorno_uq: (tenant_id, cliente_uuid, revisao, status, hash)',
      'registro_publicado_fila_idx: (tenant_id, entidade, alterado_em, registro_external_id) WHERE pendente',
      'registro_publicado_fila_livre_idx: (tenant_id, entidade, alterado_em, registro_external_id) WHERE (pendente AND (NOT aguarda_vinculo))',
      'sinal_proxima_busca_clientes_idx: (proxima_busca_clientes_em) WHERE (proxima_busca_clientes_em IS NOT NULL)',
      'sinal_proximo_retorno_clientes_idx: (proximo_retorno_clientes_em) WHERE (proximo_retorno_clientes_em IS NOT NULL)',
    ]);
    // vendedor_external_id aceita nulo (o FDV não manda ou o vendedor não tem código: a tela mostra "—")
    expect(
      um(`SELECT is_nullable AS n FROM information_schema.columns WHERE table_schema = 'integracao_fdv'
            AND table_name = 'cliente_recebido' AND column_name = 'vendedor_external_id'`),
    ).toEqual({ n: 'YES' });
  });

  it('isolamento: nenhum papel vaza entre tenants nas tabelas novas; o worker de B não vê nem altera o pré-cadastro de A', () => {
    expect(verificarVazamento(banco.conexao, ['integracao_fdv'], A.id, B.id)).toEqual([]);
    const u = randomUUID();
    executar(banco.conexao, pre(A.id, { uuid: u }), WORKER_A);
    expect(um(`SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = '${u}'`, WORKER_B)).toEqual({ n: 0 });
    executar(banco.conexao, `UPDATE integracao_fdv.cliente_recebido SET tentativas_fdv = 9 WHERE cliente_uuid = '${u}';`, WORKER_B);
    expect(um(`SELECT tentativas_fdv AS n FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = '${u}'`, WORKER_A)).toEqual({ n: 1 });
    // gravar no tenant B a partir da sessão de A: a política barra
    expect(falha(() => executar(banco.conexao, pre(B.id, { uuid: randomUUID() }), WORKER_A))).toMatch(/row-level security/);
    // sem tenant na sessão, nada
    expect(um(`SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido`, { papel: 'macuxierp_worker', tenant: null })).toEqual({ n: 0 });
  });

  // a matriz de privilégios por tabela e por coluna: integracao-fdv.db.test.ts (PRIVILEGIOS e COLUNAS)
  it('grants: app e leitura leem sem o payload (SELECT * falha)', () => {
    expect(um(`SELECT razao_social, documento_mascarado FROM integracao_fdv.cliente_recebido WHERE codigo_fdv = '00001'`, APP_A)).toEqual({
      razao_social: 'Pré-cadastro pre-cadastro-0057-a',
      documento_mascarado: '11.444.777/****-**',
    });
    for (const ctx of [APP_A, LEITURA_A]) {
      for (const sql of ['SELECT payload FROM integracao_fdv.cliente_recebido', 'SELECT * FROM integracao_fdv.cliente_recebido']) {
        expect({ papel: ctx.papel, sql, erro: falha(() => executar(banco.conexao, `${sql};`, ctx)) }).toMatchObject({
          erro: expect.stringMatching(/permission denied/),
        });
      }
    }
  });

  it('reenvio: a mesma revisão cai na mesma linha (só soma tentativas); a revisão nova vira a linha do BKO como reenviado', () => {
    const u = randomUUID();
    executar(banco.conexao, pre(A.id, { uuid: u }), WORKER_A);
    const linha1 = `SELECT id, tentativas_fdv AS n, situacao FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = '${u}' AND revisao = 1`;
    const id1 = um<{ id: string }>(linha1, WORKER_A).id;
    // decisão: recusado, com o retorno na mesma transação
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cliente_recebido SET situacao = 'recusado', motivo = 'Documento inválido.', erros = '${ERROS}',
         decidido_em = now(), ultima_recusa_em = now() WHERE cliente_uuid = '${u}' AND revisao = 1;
       INSERT INTO integracao_fdv.cliente_retorno (tenant_id, cliente_uuid, revisao, status, corpo, hash)
         VALUES ('${A.id}', '${u}', 1, 'rejeitado_erp', '{"status": "rejeitado_erp"}', repeat('4', 64));`,
      WORKER_A,
    );
    // o FDV entrega de novo a revisão 1 (não viu o retorno): mesma linha, tentativas + 1, sem revalidar
    executar(
      banco.conexao,
      `${pre(A.id, { uuid: u }).replace(/;$/, '')}
      ON CONFLICT (tenant_id, cliente_uuid, revisao) DO UPDATE SET tentativas_fdv = integracao_fdv.cliente_recebido.tentativas_fdv + 1;`,
      WORKER_A,
    );
    expect(um(linha1, WORKER_A)).toEqual({ id: id1, n: 2, situacao: 'recusado' });
    // o mesmo retorno não vira dois
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO integracao_fdv.cliente_retorno (tenant_id, cliente_uuid, revisao, status, corpo, hash)
         VALUES ('${A.id}', '${u}', 1, 'rejeitado_erp', '{"status": "rejeitado_erp"}', repeat('4', 64));`,
      '23505',
      /cliente_retorno_uq/,
      WORKER_A,
    );
    // reenvio corrigido: revisão 2 no mesmo cliente_uuid
    executar(banco.conexao, pre(A.id, { uuid: u, revisao: 2, situacao: 'reenviado' }), WORKER_A);
    const linhaDoBko = `SELECT DISTINCT ON (cliente_uuid) id, revisao, situacao FROM integracao_fdv.cliente_recebido
      WHERE cliente_uuid = '${u}' ORDER BY cliente_uuid, revisao DESC`;
    const l2 = consultar<{ id: string; revisao: number; situacao: string }>(banco.conexao, linhaDoBko, APP_A);
    expect(l2).toHaveLength(1);
    expect(l2[0]).toMatchObject({ revisao: 2, situacao: 'reenviado' });
    // a decisão da revisão 2 atualiza a mesma linha (aceito: payload nulo, cliente_id)
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cliente_recebido SET situacao = 'aceito', payload = NULL, cliente_id = gen_random_uuid(),
         decidido_em = now() WHERE cliente_uuid = '${u}' AND revisao = 2;
       INSERT INTO integracao_fdv.cliente_retorno (tenant_id, cliente_uuid, revisao, status, corpo, hash)
         VALUES ('${A.id}', '${u}', 2, 'vinculado', '{"status": "vinculado", "external_id": "x"}', repeat('5', 64));`,
      WORKER_A,
    );
    expect(consultar(banco.conexao, linhaDoBko, APP_A)).toEqual([{ id: l2[0]?.id, revisao: 2, situacao: 'aceito' }]);
    // a revisão 1 continua no histórico, recusada
    expect(
      consultar(banco.conexao, `SELECT id, revisao, situacao FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = '${u}' ORDER BY revisao`, APP_A),
    ).toEqual([
      { id: id1, revisao: 1, situacao: 'recusado' },
      { id: l2[0]?.id, revisao: 2, situacao: 'aceito' },
    ]);
    // retorno de revisão desconhecida: FK
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO integracao_fdv.cliente_retorno (tenant_id, cliente_uuid, revisao, status, corpo, hash)
         VALUES ('${A.id}', '${u}', 3, 'vinculado', '{}', repeat('6', 64));`,
      '23503',
      /cliente_retorno_recebido_fk/,
      WORKER_A,
    );
  });

  it('CHECKs: reenviado só a partir da revisão 2; aceito sem payload e com cliente_id; recusado com motivo; payload do recusado só sai pelo expurgo', () => {
    const casos: [string, string, RegExp][] = [
      ['reenviado na revisão 1', pre(A.id, { uuid: randomUUID(), situacao: 'reenviado' }), /cliente_recebido_reenviado/],
      ['recebido sem payload', pre(A.id, { uuid: randomUUID(), payload: false }), /cliente_recebido_payload/],
      [
        'aceito com payload',
        pre(A.id, { uuid: randomUUID(), situacao: 'aceito' }).replace("NULL, '2026-11-24", `'{"a": 1}', '2026-11-24`),
        /cliente_recebido_payload/,
      ],
      [
        'recusado sem motivo',
        pre(A.id, { uuid: randomUUID(), situacao: 'recusado' }).replace("'Documento inválido.'", 'NULL'),
        /cliente_recebido_recusado/,
      ],
      [
        'documento inteiro',
        pre(A.id, { uuid: randomUUID() }).replace("'11.444.777/****-**'", "'11444777000161'"),
        /cliente_recebido_documento_mascarado/,
      ],
    ];
    for (const [nome, sql, padrao] of casos) {
      expect({ nome, erro: falha(() => executar(banco.conexao, sql, WORKER_A)) }).toMatchObject({ nome, erro: expect.stringMatching(padrao) });
    }
    const u = randomUUID();
    executar(banco.conexao, pre(A.id, { uuid: u, situacao: 'recusado' }), WORKER_A);
    expect(
      falha(() => executar(banco.conexao, `UPDATE integracao_fdv.cliente_recebido SET payload = NULL WHERE cliente_uuid = '${u}';`, WORKER_A)),
    ).toMatch(/cliente_recebido_payload/);
    // vendedor nulo é válido (CPF mascarado também)
    executar(
      banco.conexao,
      pre(A.id, { uuid: randomUUID() }).replace("'11.444.777/****-**'", "'***.456.789-**'"),
      WORKER_A,
    );
  });

  it('aguarda_vinculo: falso no legado; o worker retém e libera; a fila livre ignora o retido; o app não mexe', () => {
    expect(
      um(`SELECT count(*)::int AS n, bool_or(aguarda_vinculo) AS algum FROM integracao_fdv.registro_publicado`, WORKER_A),
    ).toEqual({ n: 1, algum: false });
    const fila = `SELECT count(*)::int AS n FROM integracao_fdv.registro_publicado WHERE pendente AND NOT aguarda_vinculo`;
    executar(banco.conexao, `UPDATE integracao_fdv.registro_publicado SET pendente = true, aguarda_vinculo = true;`, WORKER_A);
    expect(um(fila, WORKER_A)).toEqual({ n: 0 });
    expect(falha(() => executar(banco.conexao, `UPDATE integracao_fdv.registro_publicado SET aguarda_vinculo = false;`, APP_A))).toMatch(
      /permission denied/,
    );
    executar(banco.conexao, `UPDATE integracao_fdv.registro_publicado SET aguarda_vinculo = false;`, WORKER_A);
    expect(um(fila, WORKER_A)).toEqual({ n: 1 });
    executar(banco.conexao, `UPDATE integracao_fdv.registro_publicado SET pendente = false;`, WORKER_A);
  });

  it('agenda no sinal e vinculo_divergente no conflito_chave', () => {
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.sinal SET proxima_busca_clientes_em = now(), proximo_retorno_clientes_em = now();
       INSERT INTO integracao_fdv.conflito_chave (tenant_id, entidade, erp_id, chave, codigo)
         VALUES ('${A.id}', 'cliente', gen_random_uuid(), 'CLI-1', 'vinculo_divergente');`,
      WORKER_A,
    );
    expect(um(`SELECT count(*)::int AS n FROM integracao_fdv.conflito_chave WHERE codigo = 'vinculo_divergente'`, APP_A)).toEqual({ n: 1 });
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO integracao_fdv.conflito_chave (tenant_id, entidade, erp_id, chave, codigo)
             VALUES ('${A.id}', 'cliente', gen_random_uuid(), 'CLI-2', 'outro_codigo');`,
          WORKER_A,
        ),
      ),
    ).toMatch(/conflito_chave_codigo/);
  });

  describe('expurgo da RN-INF-06', () => {
    const velho = randomUUID(); // recusado há 200 dias: sai
    const recente = randomUUID(); // recusado há 10 dias: fica
    const aceito = randomUUID(); // aceito há 200 dias: não é tocado
    const reRecusado = randomUUID(); // rev 1 recusada há 300 dias, rev 2 recusada há 20: a última recusa é recente, fica tudo
    const reenviado = randomUUID(); // rev 1 recusada há 200 dias, rev 2 em validação: sai só a rev 1
    const deB = randomUUID(); // tenant B, recusado há 200 dias: não é tocado
    const retrato = (u: string, ctx = WORKER_A): unknown =>
      consultar(
        banco.conexao,
        `SELECT revisao, situacao, payload IS NOT NULL AS payload, razao_social IS NOT NULL AS razao,
           documento_mascarado IS NOT NULL AS doc, payload_expurgado_em IS NOT NULL AS expurgado, codigo_fdv, hash,
           tentativas_fdv, motivo, erros, ultima_recusa_em IS NOT NULL AS recusa
         FROM integracao_fdv.cliente_recebido WHERE cliente_uuid = '${u}' ORDER BY revisao`,
        ctx,
      );
    const auditorias = (t: string): unknown =>
      consultar(
        banco.conexao,
        `SELECT acao, entidade, entidade_id, usuario_id, antes, depois FROM plataforma.auditoria
          WHERE tenant_id = '${t}' AND acao = 'integracao-fdv.pre-cadastro.expurgar' ORDER BY ocorrido_em`,
      );

    beforeAll(() => {
      executar(
        banco.conexao,
        [
          pre(A.id, { uuid: velho, situacao: 'recusado', dias: 200 }),
          pre(A.id, { uuid: recente, situacao: 'recusado', dias: 10 }),
          pre(A.id, { uuid: aceito, situacao: 'aceito', dias: 200 }),
          pre(A.id, { uuid: reRecusado, situacao: 'recusado', dias: 300 }),
          pre(A.id, { uuid: reRecusado, revisao: 2, situacao: 'recusado', dias: 20 }),
          pre(A.id, { uuid: reenviado, situacao: 'recusado', dias: 200 }),
          pre(A.id, { uuid: reenviado, revisao: 2, situacao: 'reenviado' }),
        ].join('\n'),
        WORKER_A,
      );
      executar(banco.conexao, pre(B.id, { uuid: deB, situacao: 'recusado', dias: 200 }), WORKER_B);
    });

    it('apaga só o payload (e a razão social e o documento) das recusas com mais de 180 dias; mantém códigos, erros e contagens', () => {
      const antes = { recente: retrato(recente), aceito: retrato(aceito), reRecusado: retrato(reRecusado), deB: retrato(deB, WORKER_B) };
      const antesVelho = retrato(velho) as Record<string, unknown>[];
      expect(um(`SELECT integracao_fdv.expurgar_pre_cadastro(${CORTE}) AS r`, WORKER_A)).toEqual(expurgoDoRecusado(2, 2));
      const depoisVelho = retrato(velho) as Record<string, unknown>[];
      expect(depoisVelho).toEqual([{ ...antesVelho[0], payload: false, razao: false, doc: false, expurgado: true }]);
      expect(depoisVelho[0]).toMatchObject({ codigo_fdv: '12345', hash: '1'.repeat(64), tentativas_fdv: 1, motivo: 'Documento inválido.', recusa: true });
      expect((depoisVelho[0]?.erros as unknown[]).length).toBe(1);
      expect(retrato(reenviado)).toMatchObject([
        { revisao: 1, payload: false, razao: false, expurgado: true },
        { revisao: 2, situacao: 'reenviado', payload: true, razao: true, expurgado: false },
      ]);
      expect({ recente: retrato(recente), aceito: retrato(aceito), reRecusado: retrato(reRecusado), deB: retrato(deB, WORKER_B) }).toEqual(antes);
      // a auditoria leva só as contagens (nenhum id, nome ou documento)
      expect(auditorias(A.id)).toEqual([
        {
          acao: 'integracao-fdv.pre-cadastro.expurgar',
          entidade: 'cliente_recebido',
          entidade_id: null,
          usuario_id: null,
          antes: null,
          depois: { regra: 'RN-INF-06', ...expurgoDoRecusado(2, 2).r },
        },
      ]);
      expect(auditorias(B.id)).toEqual([]);
    });
  });

  it('a 0057 é reexecutável: rodar de novo não dá erro nem muda dado, índice ou privilégio', () => {
    const r = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM integracao_fdv.cliente_recebido c) AS recebidos,
                (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM integracao_fdv.cliente_retorno c) AS retornos,
                (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'integracao_fdv') AS ix,
                (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE 'cliente\\_re%' OR conname = 'conflito_chave_codigo') AS ck,
                (SELECT relacl::text FROM pg_class WHERE oid = 'integracao_fdv.cliente_recebido'::regclass) AS acl_tabela`,
      );
    const antes = r();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(r()).toEqual(antes);
  });
});
