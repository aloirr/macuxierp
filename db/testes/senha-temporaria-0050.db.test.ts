/**
 * T-0083 (v0.3.11), migração 0050 (RN-CORE-10, RN-CORE-13): o login certo com a senha atual cancela a temporária
 * pendente do superadmin (plataforma.superadmin_cancelar_temporaria, sem tocar em deve_trocar_senha, com auditoria só
 * quando cancela); a superadmin_emitir_temporaria passa a recusar o superadmin inativo (P0002) e a validade acima de
 * 73 h (23514); o COMMENT da core.ambiente_fiscal_a1_real (0047) descreve o limite da trava em REPEATABLE READ; a
 * superadmin_para_login devolve também o email (no fim, depois das colunas da 0048), destino do e-mail da temporária.
 * Dados fictícios.
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
  linhas,
  PG_DISPONIVEL,
  PAPEIS_APP,
  permitirSetRole,
  recusaCompleta,
  rodarComo,
  rodarScript,
} from './apoio.ts';

const MIGRACAO = fileURLToPath(
  new URL('../migrations/0050_superadmin_cancelar_temporaria.sql', import.meta.url),
);
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const HASH_TEMP = '$argon2id$v=19$m=65536,t=3,p=4$dGVtcHNhbHQ$dGVtcGhhc2g';
const EMAIL_SA = 'sa-0050@plataforma.teste';
const CANCELADA = 'plataforma.superadmin.senha_temporaria_cancelada';

// SA (cancelar), SA_TROCA (cancelar com a troca pendente), SA_INATIVO e SA_EXCLUIDO (recusas da emissão).
const SA = '5a000000-0000-4000-8000-000000000500';
const SA_TROCA = '5a000000-0000-4000-8000-000000000501';
const SA_INATIVO = '5a000000-0000-4000-8000-000000000502';
const SA_EXCLUIDO = '5a000000-0000-4000-8000-000000000503';

const CANCELAR = 'plataforma.superadmin_cancelar_temporaria(uuid)';
const EMITIR = 'plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz)';
const PARA_LOGIN = 'plataforma.superadmin_para_login(text)';
// O retorno da 0048, mais o email no fim (0050).
const RETORNO_0048 =
  'TABLE(id uuid, senha_hash text, nome text, ativo boolean, falhas_login integer, bloqueado_ate timestamp with time zone, deve_trocar_senha boolean, senha_temporaria_hash text, senha_temporaria_expira_em timestamp with time zone';
const RETORNO_0050 = `${RETORNO_0048}, email text)`;

interface Temporaria {
  h: string | null;
  e: string | null;
  senha_hash: string;
  deve: boolean;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — cancelar a temporária no login certo e teto da emissão (T-0083, 0050)',
  () => {
    let banco: BancoDeTeste;

    const comoConfig = (sql: string): string[] => linhas(rodarComo(banco.conexao, sql, { papel: CONFIG }));
    const temporaria = (id: string): Temporaria | undefined =>
      consultar<Temporaria>(
        banco.conexao,
        `SELECT senha_temporaria_hash AS h, senha_temporaria_expira_em::text AS e, senha_hash, deve_trocar_senha AS deve
       FROM plataforma.superadmin WHERE id = '${id}'`,
      )[0];
    const auditorias = (acao: string, sa: string): Record<string, unknown>[] =>
      consultar(
        banco.conexao,
        `SELECT usuario_id, superadmin_id, tenant_id, entidade, entidade_id, antes, depois, row_to_json(a)::text AS txt
       FROM plataforma.auditoria a WHERE acao = '${acao}' AND superadmin_id = '${sa}' ORDER BY ocorrido_em, id`,
      );
    const emitirSql = (sa: string, expira = "now() + interval '72 hours'"): string =>
      `SELECT plataforma.superadmin_emitir_temporaria('${sa}', '${HASH_TEMP}', ${expira});`;
    const emitir = (sa: string, expira?: string): string[] => comoConfig(emitirSql(sa, expira));
    const cancelar = (sa: string): string[] =>
      comoConfig(`SELECT plataforma.superadmin_cancelar_temporaria('${sa}');`);

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo, deleted_at) VALUES
  ('${SA}', '${EMAIL_SA}', 'Superadmin Ficticio', '${HASH}', false, true, NULL),
  ('${SA_TROCA}', 'sa-0050-troca@plataforma.teste', 'Superadmin Troca', '${HASH}', true, true, NULL),
  ('${SA_INATIVO}', 'sa-0050-inativo@plataforma.teste', 'Superadmin Inativo', '${HASH}', false, false, NULL),
  ('${SA_EXCLUIDO}', 'sa-0050-excluido@plataforma.teste', 'Superadmin Excluido', '${HASH}', false, true, now());`,
      );
    });

    afterAll(() => banco?.remover());

    it('(a) cancelar: a 1ª chamada zera as duas colunas e devolve true; a 2ª devolve false', () => {
      emitir(SA);
      expect(temporaria(SA)).toMatchObject({ h: HASH_TEMP, deve: false });
      expect(cancelar(SA)).toEqual(['t']);
      expect(temporaria(SA)).toEqual({ h: null, e: null, senha_hash: HASH, deve: false });
      expect(cancelar(SA)).toEqual(['f']);
      expect(cancelar(randomUUID())).toEqual(['f']);
    });

    it('(b) cancelar não mexe em deve_trocar_senha (ligado fica ligado) e cancela também a temporária vencida', () => {
      emitir(SA_TROCA);
      expect(cancelar(SA_TROCA)).toEqual(['t']);
      expect(temporaria(SA_TROCA)).toEqual({ h: null, e: null, senha_hash: HASH, deve: true });
      emitir(SA_TROCA);
      executar(
        banco.conexao,
        `UPDATE plataforma.superadmin SET senha_temporaria_expira_em = now() - interval '1 second'
         WHERE id = '${SA_TROCA}';`,
      );
      expect(cancelar(SA_TROCA)).toEqual(['t']);
      expect(temporaria(SA_TROCA)).toMatchObject({ h: null, e: null, deve: true });
    });

    it('(c) a auditoria sai só quando cancela, sem e-mail nem hash', () => {
      const aud = auditorias(CANCELADA, SA);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({
        usuario_id: null,
        superadmin_id: SA,
        tenant_id: '00000000-0000-0000-0000-000000000000',
        entidade: 'superadmin',
        entidade_id: SA,
        antes: null,
        depois: null,
      });
      const txt = String(aud[0]?.txt);
      expect(txt).not.toContain(EMAIL_SA);
      expect(txt).not.toContain('argon2');
      expect(auditorias(CANCELADA, SA_TROCA)).toHaveLength(2);
    });

    it('(d) emitir recusa o superadmin inativo (P0002, DETAIL superadmin_inativo) e não grava nem audita', () => {
      recusaCompleta(
        banco.conexao,
        emitirSql(SA_INATIVO),
        { codigo: 'P0002', detalhe: 'superadmin_inativo', mensagem: /superadmin não encontrado/ },
        { papel: CONFIG },
      );
      recusaCompleta(
        banco.conexao,
        emitirSql(SA_EXCLUIDO),
        { codigo: 'P0002', detalhe: 'superadmin_inexistente', mensagem: /superadmin não encontrado/ },
        { papel: CONFIG },
      );
      recusaCompleta(
        banco.conexao,
        emitirSql(randomUUID()),
        { codigo: 'P0002', detalhe: 'superadmin_inexistente', mensagem: /superadmin não encontrado/ },
        { papel: CONFIG },
      );
      expect(temporaria(SA_INATIVO)).toMatchObject({ h: null, e: null });
      expect(temporaria(SA_EXCLUIDO)).toMatchObject({ h: null, e: null });
      expect(auditorias('plataforma.superadmin.senha_esquecida', SA_INATIVO)).toHaveLength(0);
    });

    it('(e) emitir recusa a validade acima de 73 h (23514, DETAIL validade_acima_do_teto) e aceita 72 h', () => {
      for (const expira of ["now() + interval '73 hours 1 second'", "now() + interval '30 days'"]) {
        recusaCompleta(
          banco.conexao,
          emitirSql(SA, expira),
          { codigo: '23514', detalhe: 'validade_acima_do_teto', mensagem: /validade .* 73 horas/ },
          { papel: CONFIG },
        );
      }
      expect(temporaria(SA)).toMatchObject({ h: null, e: null });
      // A recusa da validade passada continua a da 0048 (sem DETAIL).
      recusaCompleta(
        banco.conexao,
        emitirSql(SA, 'now()'),
        { codigo: '23514', detalhe: undefined, mensagem: /validade da senha temporária precisa ser futura/ },
        { papel: CONFIG },
      );
      expect(emitir(SA)).toEqual([]);
      expect(emitir(SA, "now() + interval '73 hours'")).toEqual([]);
      expect(temporaria(SA)).toMatchObject({ h: HASH_TEMP });
    });

    it('(f) cancelar e emitir: SECURITY DEFINER, search_path fixo, comentadas, sem PUBLIC, EXECUTE só do config', () => {
      for (const f of [CANCELAR, EMITIR]) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') LIKE '%T-0083%' AS comentado,
           has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
        );
        expect({ f, ...r }).toEqual({
          f,
          definer: true,
          cfg: 'search_path=pg_catalog, pg_temp',
          comentado: true,
          publico: false,
          config: true,
        });
        for (const papel of PAPEIS_APP) {
          const [p] = consultar<{ pode: boolean }>(
            banco.conexao,
            `SELECT has_function_privilege('${papel}', '${f}', 'EXECUTE') AS pode`,
          );
          expect({ f, papel, ...p }).toEqual({ f, papel, pode: false });
        }
      }
      recusaCompleta(
        banco.conexao,
        `SELECT plataforma.superadmin_cancelar_temporaria('${SA}');`,
        { codigo: '42501', detalhe: undefined, mensagem: /permission denied/ },
        { papel: 'macuxierp_app' },
      );
    });

    it('(g) o COMMENT da core.ambiente_fiscal_a1_real descreve o limite em REPEATABLE READ', () => {
      const [r] = consultar<{ c: string }>(
        banco.conexao,
        `SELECT obj_description('core.ambiente_fiscal_a1_real()'::regprocedure, 'pg_proc') AS c`,
      );
      expect(r?.c).toMatch(/REPEATABLE READ/);
      expect(r?.c).toMatch(/READ COMMITTED \(o padrão da API\)/);
      expect(r?.c).toMatch(/pg_advisory_xact_lock/);
      expect(r?.c).toMatch(/a1_de_teste_em_producao/);
    });

    it('(i) superadmin_para_login devolve o email como está gravado, no fim do retorno da 0048', () => {
      const [l] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT id, email FROM plataforma.superadmin_para_login(' SA-0050@Plataforma.Teste ')`,
        { papel: CONFIG },
      );
      expect(l).toEqual({ id: SA, email: EMAIL_SA });
      const [g] = consultar<{ email: string }>(
        banco.conexao,
        `SELECT email FROM plataforma.superadmin WHERE id = '${SA}'`,
      );
      expect(l?.email).toBe(g?.email);
      // O excluído continua fora; o inativo vem (a API recusa pelo ativo).
      expect(
        consultar(banco.conexao, `SELECT * FROM plataforma.superadmin_para_login('sa-0050-excluido@plataforma.teste')`, {
          papel: CONFIG,
        }),
      ).toEqual([]);
      const [r] = consultar<{ n: number; saida: string }>(
        banco.conexao,
        `SELECT count(*)::int AS n, max(pg_get_function_result(oid)) AS saida FROM pg_proc
       WHERE pronamespace = 'plataforma'::regnamespace AND proname = 'superadmin_para_login'`,
      );
      expect(r).toEqual({ n: 1, saida: RETORNO_0050 });
    });

    it('(j) superadmin_para_login: mesmos privilégios e atributos da 0048 (definer, STABLE, sem PUBLIC, só o config)', () => {
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT p.prosecdef AS definer, p.provolatile AS vol, array_to_string(p.proconfig, ',') AS cfg,
         obj_description(p.oid, 'pg_proc') LIKE '%T-0083%' AS comentado,
         has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
         has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
       FROM pg_proc p WHERE p.oid = '${PARA_LOGIN}'::regprocedure`,
      );
      expect(r).toEqual({
        definer: true,
        vol: 's',
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        config: true,
      });
      for (const papel of PAPEIS_APP) {
        const [p] = consultar<{ pode: boolean }>(
          banco.conexao,
          `SELECT has_function_privilege('${papel}', '${PARA_LOGIN}', 'EXECUTE') AS pode`,
        );
        expect({ papel, ...p }).toEqual({ papel, pode: false });
      }
      recusaCompleta(
        banco.conexao,
        `SELECT * FROM plataforma.superadmin_para_login('${EMAIL_SA}');`,
        { codigo: '42501', detalhe: undefined, mensagem: /permission denied/ },
        { papel: 'macuxierp_app' },
      );
    });

    it('(h) a 0050 reexecuta duas vezes sem erro, sem duplicar função e sem mudar dado nem privilégio', () => {
      const antes = temporaria(SA);
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      expect(temporaria(SA)).toEqual(antes);
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                AND proname IN ('superadmin_cancelar_temporaria', 'superadmin_emitir_temporaria',
                  'superadmin_para_login')) AS n,
              has_function_privilege('${CONFIG}', '${CANCELAR}', 'EXECUTE') AS config,
              has_function_privilege('public', '${CANCELAR}', 'EXECUTE') AS publico,
              has_function_privilege('${CONFIG}', '${PARA_LOGIN}', 'EXECUTE') AS login_config,
              has_function_privilege('public', '${PARA_LOGIN}', 'EXECUTE') AS login_publico,
              pg_get_function_result('${PARA_LOGIN}'::regprocedure) AS saida`,
      );
      expect(r).toEqual({
        n: 3,
        config: true,
        publico: false,
        login_config: true,
        login_publico: false,
        saida: RETORNO_0050,
      });
    });
  },
);
