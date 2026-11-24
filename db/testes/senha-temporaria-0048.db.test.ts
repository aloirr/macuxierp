/**
 * T-0076, migração 0048: "esqueci a senha" com senha temporária (RN-CORE-10: a temporária obriga a troca no próximo
 * login). plataforma.usuario e plataforma.superadmin ganham senha_temporaria_hash e senha_temporaria_expira_em (as duas
 * nulas ou as duas preenchidas); a temporária vale em paralelo à senha atual, com a validade vinda da API, e é de uso
 * único. Usuário da empresa: UPDATE direto do macuxierp_app no próprio tenant. Superadmin: funções SECURITY DEFINER
 * do macuxierp_config (molde da 0033). Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { rodarScriptAssincrono } from '../src/psql.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0048_senha_temporaria.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const HASH_NOVO = '$argon2id$v=19$m=65536,t=3,p=4$bm92b3NhbHQ$bm92b2hhc2g';
const HASH_TEMP = '$argon2id$v=19$m=65536,t=3,p=4$dGVtcHNhbHQ$dGVtcGhhc2g';
const EMAIL_SA = 'sa-0048@plataforma.teste';

// Superadmins da massa: SA (emitir e consumir), SA_CORRIDA (duas conexões), SA_TROCA (trocar_senha).
const SA = '5a000000-0000-4000-8000-000000000048';
const SA_CORRIDA = '5a000000-0000-4000-8000-000000000049';
const SA_TROCA = '5a000000-0000-4000-8000-00000000004a';

const EMITIR = 'plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz)';
const CONSUMIR = 'plataforma.superadmin_consumir_temporaria(uuid)';
const PARA_LOGIN = 'plataforma.superadmin_para_login(text)';
const TROCAR = 'plataforma.superadmin_trocar_senha(text, text)';
const FUNCOES = [EMITIR, CONSUMIR, PARA_LOGIN, TROCAR] as const;

const A = novoTenant('senha-0048-a');
const B = novoTenant('senha-0048-b');

interface Temporaria {
  h: string | null;
  e: string | null;
  senha_hash: string;
  deve: boolean;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — senha temporária do "esqueci a senha" (T-0076, 0048)',
  () => {
    let banco: BancoDeTeste;

    const comoConfig = (sql: string, sessao: string | null = null): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
    const novaSessao = (sa: string): string => {
      const id = randomUUID();
      executar(
        banco.conexao,
        `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ('${id}', '${sa}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
      return id;
    };
    const temporaria = (tabela: 'superadmin' | 'usuario', id: string): Temporaria | undefined =>
      consultar<Temporaria>(
        banco.conexao,
        `SELECT senha_temporaria_hash AS h, senha_temporaria_expira_em::text AS e, senha_hash, deve_trocar_senha AS deve
       FROM plataforma.${tabela} WHERE id = '${id}'`,
      )[0];
    const auditorias = (acao: string, sa: string): Record<string, unknown>[] =>
      consultar(
        banco.conexao,
        `SELECT usuario_id, superadmin_id, tenant_id, entidade, entidade_id, antes, depois, row_to_json(a)::text AS txt
       FROM plataforma.auditoria a WHERE acao = '${acao}' AND superadmin_id = '${sa}' ORDER BY ocorrido_em, id`,
      );
    const emitir = (sa: string, expira = "now() + interval '72 hours'"): string[] =>
      comoConfig(`SELECT plataforma.superadmin_emitir_temporaria('${sa}', '${HASH_TEMP}', ${expira});`);
    const consumir = (sa: string): string[] =>
      comoConfig(`SELECT plataforma.superadmin_consumir_temporaria('${sa}');`);

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        `${fixturePlataforma(A)}${fixturePlataforma(B)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo) VALUES
  ('${SA}', '${EMAIL_SA}', 'Superadmin Ficticio', '${HASH}', false, true),
  ('${SA_CORRIDA}', 'sa-0048-corrida@plataforma.teste', 'Superadmin Corrida', '${HASH}', false, true),
  ('${SA_TROCA}', 'sa-0048-troca@plataforma.teste', 'Superadmin Troca', '${HASH}', false, true);`,
      );
    });

    afterAll(() => banco?.remover());

    it('(a) as duas colunas nas duas tabelas: text e timestamptz, anuláveis, comentadas; linhas antigas nulas', () => {
      for (const tabela of ['usuario', 'superadmin']) {
        const cols = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT column_name AS c, data_type AS t, is_nullable AS n, column_default AS d,
           col_description('plataforma.${tabela}'::regclass, ordinal_position::int) IS NOT NULL AS comentada
         FROM information_schema.columns
         WHERE table_schema = 'plataforma' AND table_name = '${tabela}' AND column_name LIKE 'senha\\_temporaria\\_%'
         ORDER BY column_name`,
        );
        expect({ tabela, cols }).toEqual({
          tabela,
          cols: [
            {
              c: 'senha_temporaria_expira_em',
              t: 'timestamp with time zone',
              n: 'YES',
              d: null,
              comentada: true,
            },
            { c: 'senha_temporaria_hash', t: 'text', n: 'YES', d: null, comentada: true },
          ],
        });
      }
      expect(temporaria('usuario', A.usuario)).toMatchObject({ h: null, e: null });
      expect(temporaria('superadmin', SA)).toMatchObject({ h: null, e: null });
    });

    it('(b) CHECK nomeado "as duas nulas ou as duas preenchidas" e o formato argon2id, nas duas tabelas', () => {
      const nomes = consultar<{ t: string; n: string }>(
        banco.conexao,
        `SELECT conrelid::regclass::text AS t, conname AS n FROM pg_constraint
       WHERE contype = 'c' AND conname LIKE '%senha\\_temporaria%' ORDER BY 1, 2`,
      );
      expect(nomes).toEqual([
        { t: 'plataforma.superadmin', n: 'superadmin_senha_temporaria_formato' },
        { t: 'plataforma.superadmin', n: 'superadmin_senha_temporaria_par' },
        { t: 'plataforma.usuario', n: 'usuario_senha_temporaria_formato' },
        { t: 'plataforma.usuario', n: 'usuario_senha_temporaria_par' },
      ]);
      for (const [tabela, id] of [
        ['usuario', A.usuario],
        ['superadmin', SA],
      ] as const) {
        recusaDetalhada(
          banco.conexao,
          `UPDATE plataforma.${tabela} SET senha_temporaria_hash = '${HASH_TEMP}' WHERE id = '${id}';`,
          '23514',
          new RegExp(`${tabela}_senha_temporaria_par`),
        );
        recusaDetalhada(
          banco.conexao,
          `UPDATE plataforma.${tabela} SET senha_temporaria_expira_em = now() + interval '1 hour' WHERE id = '${id}';`,
          '23514',
          new RegExp(`${tabela}_senha_temporaria_par`),
        );
        recusaDetalhada(
          banco.conexao,
          `UPDATE plataforma.${tabela} SET senha_temporaria_hash = 'texto-puro',
           senha_temporaria_expira_em = now() + interval '1 hour' WHERE id = '${id}';`,
          '23514',
          new RegExp(`${tabela}_senha_temporaria_formato`),
        );
      }
    });

    it('(c) emitir grava as duas colunas sem tocar em senha_hash nem na troca pendente; audita sem e-mail nem hash', () => {
      expect(emitir(SA)).toEqual([]);
      const t = temporaria('superadmin', SA);
      expect(t).toMatchObject({ h: HASH_TEMP, senha_hash: HASH, deve: false });
      expect(t?.e).not.toBeNull();
      const [r] = consultar<{ ok: boolean }>(
        banco.conexao,
        `SELECT senha_temporaria_expira_em BETWEEN now() + interval '71 hours' AND now() + interval '73 hours' AS ok
       FROM plataforma.superadmin WHERE id = '${SA}'`,
      );
      expect(r).toEqual({ ok: true });
      const aud = auditorias('plataforma.superadmin.senha_esquecida', SA);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({
        usuario_id: null,
        superadmin_id: SA,
        tenant_id: '00000000-0000-0000-0000-000000000000',
        entidade: 'superadmin',
        entidade_id: SA,
        antes: null,
      });
      const txt = String(aud[0]?.txt);
      expect(txt).not.toContain(EMAIL_SA);
      expect(txt).not.toContain('argon2');
    });

    it('(d) emitir recusa validade passada, igual a agora ou nula (23514) e superadmin inexistente (P0002)', () => {
      for (const expira of ["now() - interval '1 second'", 'now()', 'NULL']) {
        recusaDetalhada(
          banco.conexao,
          `SELECT plataforma.superadmin_emitir_temporaria('${SA_TROCA}', '${HASH_TEMP}', ${expira});`,
          '23514',
          /validade/,
          { papel: CONFIG },
        );
      }
      recusaDetalhada(
        banco.conexao,
        `SELECT plataforma.superadmin_emitir_temporaria('${randomUUID()}', '${HASH_TEMP}', now() + interval '1 hour');`,
        'P0002',
        /não encontrado/,
        { papel: CONFIG },
      );
      expect(temporaria('superadmin', SA_TROCA)).toMatchObject({ h: null, e: null });
    });

    it('(e) consumir: a 1ª chamada consome (zera e liga a troca) e audita; a 2ª devolve falso e não audita', () => {
      expect(consumir(SA)).toEqual(['t']);
      expect(temporaria('superadmin', SA)).toEqual({ h: null, e: null, senha_hash: HASH, deve: true });
      expect(consumir(SA)).toEqual(['f']);
      const aud = auditorias('plataforma.superadmin.senha_temporaria_usada', SA);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({
        usuario_id: null,
        superadmin_id: SA,
        entidade: 'superadmin',
        entidade_id: SA,
      });
      expect(String(aud[0]?.txt)).not.toContain(EMAIL_SA);
      expect(consumir(randomUUID())).toEqual(['f']);
    });

    it('(f) consumir a temporária vencida devolve falso, não a zera e não audita', () => {
      emitir(SA);
      executar(
        banco.conexao,
        `UPDATE plataforma.superadmin SET senha_temporaria_expira_em = now() - interval '1 second',
         deve_trocar_senha = false WHERE id = '${SA}';`,
      );
      expect(consumir(SA)).toEqual(['f']);
      expect(temporaria('superadmin', SA)).toMatchObject({ h: HASH_TEMP, deve: false });
      expect(auditorias('plataforma.superadmin.senha_temporaria_usada', SA)).toHaveLength(1);
    });

    it('(g) duas conexões ao mesmo tempo: só uma consome', async () => {
      emitir(SA_CORRIDA);
      const sessao = (sql: string) =>
        rodarScriptAssincrono(banco.conexao, `SET ROLE ${CONFIG};\nBEGIN;\n${sql}\nCOMMIT;\n`);
      const p1 = sessao(
        `SELECT plataforma.superadmin_consumir_temporaria('${SA_CORRIDA}');\nSELECT pg_sleep(1);`,
      );
      await new Promise((r) => setTimeout(r, 300));
      const p2 = sessao(`SELECT plataforma.superadmin_consumir_temporaria('${SA_CORRIDA}');`);
      const [r1, r2] = await Promise.all([p1, p2]);
      // A 1ª trava a linha e segura 1 s; a 2ª espera a trava e, reavaliado o WHERE, não acha mais a temporária.
      expect([...linhas(r1), ...linhas(r2)].filter((l) => l === 't' || l === 'f')).toEqual(['t', 'f']);
      expect(temporaria('superadmin', SA_CORRIDA)).toMatchObject({ h: null, e: null, deve: true });
      expect(auditorias('plataforma.superadmin.senha_temporaria_usada', SA_CORRIDA)).toHaveLength(1);
    });

    it('(h) superadmin_para_login devolve também as duas colunas (uma assinatura só)', () => {
      const [l] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT id, senha_temporaria_hash, senha_temporaria_expira_em IS NOT NULL AS tem_expira
       FROM plataforma.superadmin_para_login(' SA-0048@Plataforma.Teste ')`,
        { papel: CONFIG },
      );
      expect(l).toEqual({ id: SA, senha_temporaria_hash: HASH_TEMP, tem_expira: true });
      const [r] = consultar<{ n: number; saida: string }>(
        banco.conexao,
        `SELECT count(*)::int AS n, max(pg_get_function_result(oid)) AS saida FROM pg_proc
       WHERE pronamespace = 'plataforma'::regnamespace AND proname = 'superadmin_para_login'`,
      );
      // As colunas da 0048 ficam no começo; a 0050 acrescenta o email no fim.
      expect(r?.n).toBe(1);
      expect(r?.saida).toMatch(
        /^TABLE\(id uuid, senha_hash text, nome text, ativo boolean, falhas_login integer, bloqueado_ate timestamp with time zone, deve_trocar_senha boolean, senha_temporaria_hash text, senha_temporaria_expira_em timestamp with time zone[,)]/,
      );
    });

    it('(i) superadmin_trocar_senha zera as duas colunas', () => {
      emitir(SA_TROCA);
      expect(temporaria('superadmin', SA_TROCA)).toMatchObject({ h: HASH_TEMP });
      comoConfig(
        `SELECT plataforma.superadmin_trocar_senha('${HASH}', '${HASH_NOVO}');`,
        novaSessao(SA_TROCA),
      );
      expect(temporaria('superadmin', SA_TROCA)).toEqual({
        h: null,
        e: null,
        senha_hash: HASH_NOVO,
        deve: false,
      });
    });

    it('(j) o app grava e zera a temporária do usuário no próprio tenant; o de outro tenant não é alcançado', () => {
      const emitirUsuario = (id: string) =>
        `UPDATE plataforma.usuario SET senha_temporaria_hash = '${HASH_TEMP}',
         senha_temporaria_expira_em = now() + interval '72 hours' WHERE id = '${id}' RETURNING id;`;
      const saida = linhas(
        rodarComo(banco.conexao, `${emitirUsuario(A.usuario)}\n${emitirUsuario(B.usuario)}`, {
          papel: 'macuxierp_app',
          tenant: A.id,
        }),
      ).filter((l) => /^[0-9a-f-]{36}$/.test(l));
      expect(saida).toEqual([A.usuario]);
      expect(temporaria('usuario', A.usuario)).toMatchObject({ h: HASH_TEMP, senha_hash: HASH, deve: false });
      expect(temporaria('usuario', B.usuario)).toMatchObject({ h: null, e: null });
      // Consumo atômico de uso único pela API (o mesmo UPDATE ... WHERE ... RETURNING da função do superadmin).
      const consumirUsuario = `UPDATE plataforma.usuario SET senha_temporaria_hash = NULL,
         senha_temporaria_expira_em = NULL, deve_trocar_senha = true
       WHERE id = '${A.usuario}' AND senha_temporaria_hash IS NOT NULL AND senha_temporaria_expira_em > now()
       RETURNING id;`;
      const ctxA = { papel: 'macuxierp_app', tenant: A.id };
      expect(linhas(rodarComo(banco.conexao, consumirUsuario, ctxA))).toEqual([A.usuario]);
      expect(linhas(rodarComo(banco.conexao, consumirUsuario, ctxA))).toEqual([]);
      expect(temporaria('usuario', A.usuario)).toMatchObject({ h: null, e: null, deve: true });
      // O CHECK vale também para o app.
      recusaDetalhada(
        banco.conexao,
        `UPDATE plataforma.usuario SET senha_temporaria_hash = '${HASH_TEMP}' WHERE id = '${A.usuario}';`,
        '23514',
        /usuario_senha_temporaria_par/,
        ctxA,
      );
    });

    it('(k) privilégios de coluna: o app lê e grava; worker e leitura não leem a temporária (nem o hash)', () => {
      for (const coluna of ['senha_temporaria_hash', 'senha_temporaria_expira_em']) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT has_column_privilege('macuxierp_app', 'plataforma.usuario', '${coluna}', 'SELECT') AS app_le,
           has_column_privilege('macuxierp_app', 'plataforma.usuario', '${coluna}', 'UPDATE') AS app_grava,
           has_column_privilege('macuxierp_worker', 'plataforma.usuario', '${coluna}', 'SELECT') AS worker,
           has_column_privilege('macuxierp_leitura', 'plataforma.usuario', '${coluna}', 'SELECT') AS leitura,
           has_column_privilege('${CONFIG}', 'plataforma.superadmin', '${coluna}', 'SELECT') AS config_sa`,
        );
        expect({ coluna, ...r }).toEqual({
          coluna,
          app_le: true,
          app_grava: true,
          worker: false,
          leitura: false,
          config_sa: false,
        });
      }
    });

    it('(l) as 4 funções: SECURITY DEFINER, search_path fixo, comentadas, sem PUBLIC, EXECUTE só do config', () => {
      for (const f of FUNCOES) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
           has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
           has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker,
           has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
        );
        expect({ f, ...r }).toEqual({
          f,
          definer: true,
          cfg: 'search_path=pg_catalog, pg_temp',
          comentado: true,
          publico: false,
          app: false,
          worker: false,
          leitura: false,
          config: true,
        });
      }
      recusaDetalhada(
        banco.conexao,
        `SELECT plataforma.superadmin_consumir_temporaria('${SA}');`,
        '42501',
        /permission denied/,
        {
          papel: 'macuxierp_app',
        },
      );
    });

    it('(m) a 0048 reexecuta duas vezes sem erro, sem duplicar função e sem mudar dado nem privilégio', () => {
      emitir(SA_TROCA);
      const antes = temporaria('superadmin', SA_TROCA);
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      expect(temporaria('superadmin', SA_TROCA)).toEqual(antes);
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                AND proname IN ('superadmin_para_login', 'superadmin_trocar_senha', 'superadmin_emitir_temporaria',
                  'superadmin_consumir_temporaria')) AS n,
              has_function_privilege('${CONFIG}', '${PARA_LOGIN}', 'EXECUTE') AS config,
              has_function_privilege('macuxierp_app', '${PARA_LOGIN}', 'EXECUTE') AS app`,
      );
      expect(r).toEqual({ n: 4, config: true, app: false });
    });
  },
);
