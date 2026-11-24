/**
 * Hotfix 0051 (RN-CORE-10): "Quando eu clicar em esqueci a senha, é para desbloquear o usuario. para eu tentar com a
 * senha temporaria" (Alexandre). plataforma.superadmin_consumir_temporaria passa a zerar também falhas_login e
 * bloqueado_ate, no mesmo UPDATE atômico que zera a temporária e liga deve_trocar_senha; a superadmin_abrir_sessao
 * (0033) não muda, e sem consumo a trava continua de pé. Assinatura, retorno, DEFINER, search_path e privilégios
 * iguais aos da 0048. Dados fictícios.
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
  new URL('../migrations/0051_superadmin_temporaria_destrava.sql', import.meta.url),
);
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const HASH_TEMP = '$argon2id$v=19$m=65536,t=3,p=4$dGVtcHNhbHQ$dGVtcGhhc2g';

// SA_SO (consumir sozinho), SA_SESSAO (consumir + abrir sessão), SA_SEM (sem temporária), SA_VENCIDA (vencida).
const SA_SO = '5a000000-0000-4000-8000-000000000510';
const SA_SESSAO = '5a000000-0000-4000-8000-000000000511';
const SA_SEM = '5a000000-0000-4000-8000-000000000512';
const SA_VENCIDA = '5a000000-0000-4000-8000-000000000513';

const CONSUMIR = 'plataforma.superadmin_consumir_temporaria(uuid)';

interface Estado {
  h: string | null;
  e: string | null;
  deve: boolean;
  falhas: number;
  travado: boolean;
  bloqueado: string | null;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — consumir a temporária destrava o superadmin (hotfix 0051, RN-CORE-10)',
  () => {
    let banco: BancoDeTeste;

    const comoConfig = (sql: string): string[] => linhas(rodarComo(banco.conexao, sql, { papel: CONFIG }));
    const estado = (id: string): Estado | undefined =>
      consultar<Estado>(
        banco.conexao,
        `SELECT senha_temporaria_hash AS h, senha_temporaria_expira_em::text AS e, deve_trocar_senha AS deve,
           falhas_login AS falhas, coalesce(bloqueado_ate > now(), false) AS travado, bloqueado_ate::text AS bloqueado
         FROM plataforma.superadmin WHERE id = '${id}'`,
      )[0];
    const consumirSql = (sa: string): string => `SELECT plataforma.superadmin_consumir_temporaria('${sa}');`;
    const abrirSql = (sa: string): string =>
      `SELECT plataforma.superadmin_abrir_sessao('${sa}', encode(sha256(convert_to('${randomUUID()}', 'UTF8')), 'hex'),
         now() + interval '1 hour') IS NOT NULL;`;
    const sessoes = (sa: string): number =>
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM plataforma.sessao_superadmin WHERE superadmin_id = '${sa}'`,
      )[0]?.n ?? -1;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      // Todos travados pela §6 (5 falhas, trava de 15 min no futuro).
      executar(
        banco.conexao,
        `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo, falhas_login,
           bloqueado_ate, senha_temporaria_hash, senha_temporaria_expira_em) VALUES
  ('${SA_SO}', 'sa-0051-so@plataforma.teste', 'Superadmin So', '${HASH}', false, true, 5,
     now() + interval '15 minutes', '${HASH_TEMP}', now() + interval '72 hours'),
  ('${SA_SESSAO}', 'sa-0051-sessao@plataforma.teste', 'Superadmin Sessao', '${HASH}', false, true, 5,
     now() + interval '15 minutes', '${HASH_TEMP}', now() + interval '72 hours'),
  ('${SA_SEM}', 'sa-0051-sem@plataforma.teste', 'Superadmin Sem', '${HASH}', false, true, 5,
     now() + interval '15 minutes', NULL, NULL),
  ('${SA_VENCIDA}', 'sa-0051-vencida@plataforma.teste', 'Superadmin Vencida', '${HASH}', false, true, 5,
     now() + interval '15 minutes', '${HASH_TEMP}', now() - interval '1 second');`,
      );
    });

    afterAll(() => banco?.remover());

    it('(a) travado com temporária válida: consumir devolve true e zera falhas, trava e temporária; liga a troca', () => {
      expect(estado(SA_SO)).toMatchObject({ falhas: 5, travado: true, h: HASH_TEMP });
      // Sem consumo, a trava continua barrando a sessão (0033 não muda).
      recusaCompleta(
        banco.conexao,
        abrirSql(SA_SO),
        { codigo: 'MXS01', detalhe: undefined, mensagem: /sessão de superadmin inválida/ },
        { papel: CONFIG },
      );
      expect(comoConfig(consumirSql(SA_SO))).toEqual(['t']);
      expect(estado(SA_SO)).toEqual({ h: null, e: null, deve: true, falhas: 0, travado: false, bloqueado: null });
      // Uso único: a segunda chamada não acha a temporária.
      expect(comoConfig(consumirSql(SA_SO))).toEqual(['f']);
    });

    it('(a) consumir e, na mesma transação, superadmin_abrir_sessao abre a sessão do travado', () => {
      expect(sessoes(SA_SESSAO)).toBe(0);
      expect(comoConfig(`${consumirSql(SA_SESSAO)}\n${abrirSql(SA_SESSAO)}`)).toEqual(['t', 't']);
      expect(sessoes(SA_SESSAO)).toBe(1);
      expect(estado(SA_SESSAO)).toEqual({ h: null, e: null, deve: true, falhas: 0, travado: false, bloqueado: null });
    });

    it('(b) travado sem temporária: consumir devolve false e falhas e trava ficam como estavam', () => {
      const antes = estado(SA_SEM);
      expect(antes).toMatchObject({ falhas: 5, travado: true, h: null, deve: false });
      expect(comoConfig(consumirSql(SA_SEM))).toEqual(['f']);
      expect(estado(SA_SEM)).toEqual(antes);
    });

    it('(c) travado com temporária vencida: consumir devolve false e nada muda', () => {
      const antes = estado(SA_VENCIDA);
      expect(antes).toMatchObject({ falhas: 5, travado: true, h: HASH_TEMP, deve: false });
      expect(comoConfig(consumirSql(SA_VENCIDA))).toEqual(['f']);
      expect(estado(SA_VENCIDA)).toEqual(antes);
    });

    it('(d) assinatura, retorno, DEFINER, search_path, COMMENT e privilégios iguais (só o config executa)', () => {
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                  AND proname = 'superadmin_consumir_temporaria') AS n,
           pg_get_function_identity_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS saida,
           p.prosecdef AS definer, p.provolatile AS vol, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') LIKE '%0051%' AS comentado,
           has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${CONSUMIR}'::regprocedure`,
      );
      expect(r).toEqual({
        n: 1,
        args: 'p_id uuid',
        saida: 'boolean',
        definer: true,
        vol: 'v',
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        config: true,
      });
      for (const papel of PAPEIS_APP) {
        const [p] = consultar<{ pode: boolean }>(
          banco.conexao,
          `SELECT has_function_privilege('${papel}', '${CONSUMIR}', 'EXECUTE') AS pode`,
        );
        expect({ papel, ...p }).toEqual({ papel, pode: false });
      }
      recusaCompleta(
        banco.conexao,
        consumirSql(SA_SEM),
        { codigo: '42501', detalhe: undefined, mensagem: /permission denied/ },
        { papel: 'macuxierp_app' },
      );
    });

    it('(e) a 0051 reexecuta duas vezes sem erro, sem duplicar função e sem mudar dado nem privilégio', () => {
      const antes = estado(SA_VENCIDA);
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      expect(estado(SA_VENCIDA)).toEqual(antes);
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                  AND proname = 'superadmin_consumir_temporaria') AS n,
           has_function_privilege('${CONFIG}', '${CONSUMIR}', 'EXECUTE') AS config,
           has_function_privilege('public', '${CONSUMIR}', 'EXECUTE') AS publico`,
      );
      expect(r).toEqual({ n: 1, config: true, publico: false });
    });
  },
);
