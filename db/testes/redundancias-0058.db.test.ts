/** T-0086, migração 0058: as funções e o CHECK reescritos sem redundância dão o mesmo resultado na mesma massa. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  definicoesDe,
  executar,
  linhas,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = '0058_redundancias_0053_a_0057.sql';
const CAMINHO = fileURLToPath(new URL(`../migrations/${MIGRACAO}`, import.meta.url));
const A = novoTenant('redundancias-0058-a');
const SA = '5a000000-0000-4000-8000-000000000581';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const CIFRADA = `decode(repeat('ab', 40), 'hex')`;

/** Status do domínio pedido.status (0012) e pendências: vazia, só prazo (bloqueante, aceita, misto), outra e malformadas. */
const STATUS = ['recebido', 'em_analise', 'aprovado', 'recusado', 'faturado_parcial', 'faturado', 'cancelado'];
const pend = (codigo: string, bloqueante: boolean | string = true): string =>
  `{"codigo": "${codigo}", "bloqueante": ${bloqueante}, "sequencia": null, "produto_id": null}`;
const PENDENCIAS = [
  '[]',
  '{}',
  `[${pend('prazo_incompleto')}]`,
  `[${pend('prazo_acima_do_cliente', false)}]`,
  `[${pend('prazo_incompleto')}, ${pend('prazo_acima_do_cliente', false)}]`,
  `[${pend('prazo_incompleto', false)}, ${pend('prazo_acima_do_cliente', false)}]`,
  `[${pend('credito_excedido', false)}]`,
  `[${pend('prazo_incompleto')}, ${pend('credito_excedido')}]`,
  `[${pend('prazo_incompleto', '"sim"')}]`,
  '[{"codigo": "prazo_incompleto"}]',
  '["prazo_incompleto"]',
];

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — redundâncias das 0053 a 0057 com o mesmo resultado (T-0086, 0058)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  const sessao = randomUUID();

  /** Roda numa transação e desfaz: o efeito das funções de escrita fica só no retrato devolvido. */
  const desfazendo = (sql: string): string[] =>
    linhas(rodarComo(banco.conexao, `SAVEPOINT s;\n${sql}\nROLLBACK TO SAVEPOINT s;`));
  const comoConfig = (chamada: string): string =>
    `${sessaoSql(sessao)}SET LOCAL ROLE macuxierp_config;\nSELECT ${chamada};\nRESET ROLE;`;
  const espelho = `SELECT coalesce(jsonb_agg(jsonb_build_object('x', registro_external_id, 'e', entidade, 'payload', payload, 'hash', hash,
      'ativo', ativo, 'pendente', pendente, 'refs', fonte_refs, 'erp', erp_id, 'excluido', deleted_at IS NOT NULL,
      'avancou', alterado_em > now() - interval '1 day' AND fonte_ocorrido_em > now() - interval '1 day') ORDER BY registro_external_id), '[]')
    FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}';`;

  /** O que as funções da 0058 devolvem e gravam sobre a massa, com o instante do pedido fora. */
  const resultados = (): Record<string, string[]> => ({
    log: desfazendo(comoConfig(`integracao_fdv.portal_log('${A.id}', 'produto')`)),
    reprocessar: desfazendo(
      `${comoConfig(`integracao_fdv.portal_reprocessar('${A.id}', 'produto', 'req-0058') - 'pedido_em'`)}
SELECT proximo_em < now() + interval '1 hour' FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}';
${espelho}`,
    ),
    inativar: desfazendo(
      `SELECT integracao_fdv.portal_inativar_linhas('${A.id}',
         ARRAY(SELECT id FROM integracao_fdv.registro_publicado
                WHERE tenant_id = '${A.id}' AND ativo AND deleted_at IS NULL AND payload IS NOT NULL ORDER BY registro_external_id));
${espelho}`,
    ),
  });

  const checks = (): { def: string }[] =>
    definicoesDe(banco.conexao, 'pedido.pedido', ['pedido_fdv_sem_analise', 'pedido_fdv_sem_pendencia']);
  /** Para cada (origem, status, pendências): a linha passa nos dois CHECKs da D-A juntos? E só no sem_pendencia? */
  const grade = (): string[] =>
    linhas(
      rodarComo(
        banco.conexao,
        `CREATE TEMP TABLE grade ON COMMIT DROP AS
           SELECT o AS origem, s AS status, p::jsonb AS pendencias
             FROM unnest(ARRAY['fdv', 'bko']) o, unnest(ARRAY[${STATUS.map((s) => `'${s}'`).join(', ')}]) s,
                  unnest(ARRAY[${PENDENCIAS.map((p) => `'${p}'`).join(', ')}]) p;
DO $$
DECLARE
  v_a text := (SELECT substring(pg_get_constraintdef(oid) FROM '^CHECK \\((.*)\\)$') FROM pg_constraint
                WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_analise');
  v_p text := (SELECT substring(pg_get_constraintdef(oid) FROM '^CHECK \\((.*)\\)$') FROM pg_constraint
                WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_pendencia');
BEGIN
  EXECUTE format('CREATE TEMP TABLE resultado ON COMMIT DROP AS SELECT origem, status, pendencias::text AS p,
                    coalesce((%s) AND (%s), true) AS juntos FROM grade', v_a, v_p);
END $$;
SELECT origem || ' ' || status || ' ' || p || ' ' || juntos FROM resultado ORDER BY 1;`,
      ),
    );

  let antes: { funcoes: Record<string, string[]>; grade: string[] };

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0058');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${A.id}', 'integracao-fdv');
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0058@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    rodarComo(
      banco.conexao,
      comoConfig(
        `integracao_fdv.portal_credencial_definir('${A.id}', NULL, 'conector-0058', 'teste', ${CIFRADA}, 'pfx0058', 1, false, NULL, 'req-def', ARRAY['produto']::text[])`,
      ),
    );
    const cred = consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM integracao_fdv.credencial WHERE tenant_id = '${A.id}' AND substituida_em IS NULL`,
    )[0]?.id;
    // Massa (dados fictícios): integrado, pendente, hash mudado, falhas, anulado com erro, nunca publicado, excluído e
    // outro cadastro; erros abertos em grupos com empate, campo nulo, erro resolvido e erro sem registro.
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em,
  fonte_ocorrido_em, fonte_refs, ativo, pendente, hash_confirmado, confirmado_em, ultimo_lote_envio_id, erp_id, deleted_at) VALUES
  ('${A.id}', 'produto', 'INT', '{"sku": "S1", "ativo": true}', repeat('1', 64), now() - interval '2 days', now() - interval '2 days','{"produto_id": "x"}', true, false, repeat('1', 64), now(), NULL, gen_random_uuid(), NULL),
  ('${A.id}', 'produto', 'PEN', '{"sku": "S2", "ativo": true}', repeat('2', 64), now() - interval '2 days', now() - interval '2 days','{}', true, true, NULL, NULL, NULL, gen_random_uuid(), NULL),
  ('${A.id}', 'produto', 'MUD', '{"sku": "S3", "ativo": true}', repeat('3', 64), now() - interval '2 days', now() - interval '2 days','{}', true, false, repeat('9', 64), now(), NULL, gen_random_uuid(), NULL),
  ('${A.id}', 'produto', 'F1', '{"sku": "S4", "ativo": true}', repeat('4', 64), now() - interval '2 days', now() - interval '2 days','{}', true, false, repeat('4', 64), now(), NULL, gen_random_uuid(), NULL),
  ('${A.id}', 'produto', 'F2', '{"sku": "S5", "ativo": true}', repeat('5', 64), now() - interval '2 days', now() - interval '2 days','{}', true, true, NULL, NULL, NULL, gen_random_uuid(), NULL),
  ('${A.id}', 'produto', 'F3', '{"sku": "S6", "ativo": true}', repeat('6', 64), now() - interval '2 days', now() - interval '2 days','{}', true, false, repeat('6', 64), now(), NULL, gen_random_uuid(), NULL),
  ('${A.id}', 'produto', 'ANU', NULL, repeat('7', 64), now() - interval '2 days', now() - interval '2 days','{}', false, false, repeat('7', 64), now(), NULL, NULL, NULL),
  ('${A.id}', 'produto', 'EXC', '{"sku": "S8"}', repeat('8', 64), now() - interval '2 days', now() - interval '2 days','{}', true, true, NULL, NULL, NULL, NULL, now()),
  ('${A.id}', 'cliente', 'CLI', '{"nome": "Fulano Ficticio"}', repeat('a', 64), now() - interval '2 days', now() - interval '2 days','{}', true, true, NULL, NULL, NULL, gen_random_uuid(), NULL);
WITH l AS (
  INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, hub_lote_id,
    contagens, enviado_em, concluido_em, created_at) VALUES
    ('${A.id}', 'produto', '${cred}', 'delta', repeat('c1', 32), 'concluido_com_erros', gen_random_uuid(),
     '{"registros": 3, "invalidas": 1, "origem": "reprocessar"}', '2026-11-20T10:00:00Z', '2026-11-20T10:01:00Z', '2026-11-20T09:59:00Z'),
    ('${A.id}', 'produto', '${cred}', 'delta', repeat('c2', 32), 'concluido', gen_random_uuid(),
     '{"registros": 2, "origem": "outra"}', '2026-11-19T10:00:00Z', '2026-11-19T10:01:00Z', '2026-11-19T09:59:00Z')
  RETURNING id, chave_idempotencia)
INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo, resolvido_em)
SELECT '${A.id}', l.id, v.i, 'hub', 'produto', v.x, v.codigo, v.campo, v.resolvido
  FROM l JOIN (VALUES
    (repeat('c1', 32), 0, 'F1', 'campo_invalido', 'nome', NULL::timestamptz),
    (repeat('c1', 32), 1, 'F2', 'campo_invalido', 'nome', NULL),
    (repeat('c1', 32), 2, 'F2', 'referencia_ausente', NULL, NULL),
    (repeat('c1', 32), 3, 'F3', 'referencia_ausente', NULL, NULL),
    (repeat('c1', 32), 4, 'ANU', 'campo_invalido', 'preco', NULL),
    (repeat('c1', 32), 5, NULL, 'lote_invalido', NULL, NULL),
    (repeat('c2', 32), 0, 'F1', 'campo_invalido', 'nome', NULL),
    (repeat('c2', 32), 1, 'INT', 'campo_invalido', 'sku', now())
  ) AS v(chave, i, x, codigo, campo, resolvido) ON v.chave = l.chave_idempotencia;
INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em) VALUES ('${A.id}', 'produto', now() + interval '1 day');`,
    );
    antes = { funcoes: resultados(), grade: grade() };
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('a massa exercita as três funções (log com grupos, reprocessar com falha e pendente, inativação pendente)', () => {
    const log = JSON.parse(antes.funcoes.log?.[0] ?? 'null') as { erros: unknown[]; total_erros: number };
    expect(log.erros.length).toBeGreaterThan(1);
    expect(log.total_erros).toBeGreaterThan(log.erros.length);
    expect(JSON.parse(antes.funcoes.reprocessar?.[0] ?? 'null')).toEqual({ falhas: 3, pendentes: 2 });
    expect(antes.funcoes.inativar?.[0]).toMatch(/produto/);
  });

  it('portal_log, portal_reprocessar e portal_inativar_linhas devolvem e gravam o mesmo antes e depois da 0058', () => {
    expect(resultados()).toEqual(antes.funcoes);
  });

  it('os CHECKs pedido_fdv_sem_analise e pedido_fdv_sem_pendencia juntos aceitam e recusam as mesmas linhas', () => {
    expect(antes.grade.length).toBe(2 * STATUS.length * PENDENCIAS.length);
    expect(grade()).toEqual(antes.grade);
    expect(definicoesDe(banco.conexao, 'pedido.pedido', ['pedido_fdv_sem_pendencia'])[0]?.def).toMatch(/= ANY \(ARRAY\['em_analise'::text, 'recusado'::text\]\)/);
  });

  it('a 0058 é reexecutável: o CHECK, as funções e o resultado ficam iguais', () => {
    const definicao = checks();
    rodarScript(banco.conexao, readFileSync(CAMINHO, 'utf8'), { transacao: true });
    expect(checks()).toEqual(definicao);
    expect(resultados()).toEqual(antes.funcoes);
    expect(grade()).toEqual(antes.grade);
  });
});
