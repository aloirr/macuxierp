/**
 * T-0058 (v0.3.6), migração 0042 (decisão R-20261123-150400: ligar cadastro um por um na primeira credencial): a
 * credencial nova nasce vazia (DEFAULT '{}' da coluna e de p_entidades do portal_credencial_definir); na troca de chave a
 * configuração é copiada da ativa e p_entidades (inclusive NULL) é ignorado; portal_configurar ganha
 * p_evento_carga_inicial jsonb DEFAULT NULL (5º argumento), que grava integracao-fdv.carga_inicial.solicitada@1 na outbox
 * com a próxima versão livre do agregado (a credencial ativa).
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
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(
  new URL('../migrations/0042_integracao_fdv_credencial_vazia.sql', import.meta.url),
);
const CONFIG = 'macuxierp_config';
const A = novoTenant('ifdv-0042-a');
const B = novoTenant('ifdv-0042-b');
const SA = '5a000000-0000-4000-8000-000000000421';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const CIFRADA = `decode(repeat('ab', 40), 'hex')`;
const EVENTO = 'integracao-fdv.carga_inicial.solicitada@1';
const CONFIGURAR_5 = 'integracao_fdv.portal_configurar(uuid, text[], integer, text, jsonb)';

interface Estado {
  credencial: { id: string } | null;
  entidades_habilitadas: string[];
  limite_registros_lote: number | null;
  cadastros: { entidade: string; habilitada: boolean; ligada: boolean }[];
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — credencial nova vazia e evento no configurar (T-0058, 0042)',
  () => {
    let banco: BancoDeTeste;
    let sessao: string;

    const jsonConfig = <T>(sql: string): T =>
      JSON.parse(
        linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }))[0] ?? 'null',
      ) as T;
    const recusaConfig = (sql: string, codigo: string, padrao: RegExp): void =>
      recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });
    const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
    const definir = (t: string, anterior: string | null, extra = ''): string =>
      `SELECT integracao_fdv.portal_credencial_definir('${t}', ${anterior ? `'${anterior}'` : 'NULL'}, 'conector-0042',
       'teste', ${CIFRADA}, 'pfx0042', 1, false, NULL, 'req-0042'${extra});`;
    const eventos = (t: string): { agregado_id: string; versao: number; payload: unknown }[] =>
      consultar(
        banco.conexao,
        `SELECT agregado_id, versao::int AS versao, payload FROM plataforma.evento
        WHERE tenant_id = '${t}' AND nome = '${EVENTO}' ORDER BY versao`,
      );

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      sessao = randomUUID();
      executar(
        banco.conexao,
        `${fixturePlataforma(A)}${fixturePlataforma(B)}
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${A.id}', 'integracao-fdv'), ('${B.id}', 'integracao-fdv');
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0042@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
    });

    afterAll(() => banco?.remover());

    it('DEFAULT da coluna é vazio; o configurar de 4 argumentos não existe mais e o de 5 só é do config', () => {
      expect(
        um<{ d: string }>(
          `SELECT column_default AS d FROM information_schema.columns
          WHERE table_schema = 'integracao_fdv' AND table_name = 'credencial' AND column_name = 'entidades_habilitadas'`,
        ).d,
      ).toBe(`'{}'::integracao_fdv.entidade_hub[]`);
      expect(
        um(`SELECT to_regprocedure('integracao_fdv.portal_configurar(uuid, text[], integer, text)') AS f`),
      ).toEqual({ f: null });
      expect(
        um(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'integracao_fdv' AND p.proname = 'portal_configurar'`),
      ).toEqual({ n: 1 });
      expect(
        um(`SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
             obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
             EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
             has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
             has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker,
             has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
             has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config,
             pg_get_function_arguments(p.oid) AS args
           FROM pg_proc p WHERE p.oid = '${CONFIGURAR_5}'::regprocedure`),
      ).toEqual({
        definer: true,
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        app: false,
        worker: false,
        leitura: false,
        config: true,
        args: 'p_tenant uuid, p_entidades text[], p_limite integer, p_request_id text, p_evento_carga_inicial jsonb DEFAULT NULL::jsonb',
      });
    });

    it('primeira credencial sem p_entidades nasce vazia (nenhum cadastro ligado); NULL na primeira também', () => {
      const r = jsonConfig<Estado>(definir(A.id, null));
      expect(r.entidades_habilitadas).toEqual([]);
      expect(r.limite_registros_lote).toBe(5000);
      expect(r.cadastros.some((c) => c.habilitada || c.ligada)).toBe(false);
      const rb = jsonConfig<Estado>(definir(B.id, null, ', NULL'));
      expect(rb.entidades_habilitadas).toEqual([]);
    });

    it('configurar com 4 argumentos igual a hoje: liga um por um, sem evento', () => {
      const r = jsonConfig<Estado>(
        `SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['filial'], 300, 'req-c4');`,
      );
      expect(r.entidades_habilitadas).toEqual(['filial']);
      const r2 = jsonConfig<Estado>(
        `SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['filial', 'produto'], 300, 'req-c4b', NULL);`,
      );
      expect(r2.cadastros.filter((c) => c.ligada).map((c) => c.entidade)).toEqual(['filial', 'produto']);
      expect(eventos(A.id)).toEqual([]);
      expect(
        um(
          `SELECT count(*)::int AS n FROM plataforma.auditoria WHERE tenant_id = '${A.id}' AND acao = 'integracao-fdv.configuracao.alterar'`,
        ),
      ).toEqual({ n: 2 });
    });

    it('troca de chave com p_entidades NULL (ou outra lista) copia a configuração da ativa', () => {
      const anterior = jsonConfig<Estado>(`SELECT integracao_fdv.portal_ler('${A.id}');`).credencial!.id;
      const r = jsonConfig<Estado>(definir(A.id, anterior, ', NULL, NULL'));
      expect(r.credencial!.id).not.toBe(anterior);
      expect(r).toMatchObject({ entidades_habilitadas: ['filial', 'produto'], limite_registros_lote: 300 });
      const r2 = jsonConfig<Estado>(definir(A.id, r.credencial!.id, `, ARRAY['titulo'], 1`));
      expect(r2).toMatchObject({ entidades_habilitadas: ['filial', 'produto'], limite_registros_lote: 300 });
    });

    it('configurar com evento grava 1 evento na versão 2 (o definir usaria a 1), depois a 3; agregado = credencial ativa', () => {
      const ativa = jsonConfig<Estado>(`SELECT integracao_fdv.portal_ler('${A.id}');`).credencial!.id;
      // o definir já usou a versão 1 deste agregado (carga inicial pedida na criação)
      executar(
        banco.conexao,
        `INSERT INTO plataforma.evento (tenant_id, nome, agregado_id, versao, payload)
       VALUES ('${A.id}', '${EVENTO}', '${ativa}', 1, '{"ator": "sistema", "request_id": "r0", "payload": {"entidades": ["filial"]}}');`,
      );
      jsonConfig(
        `SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['filial', 'produto', 'cliente'], 300, 'req-ev2', '{"entidades": ["cliente"]}');`,
      );
      expect(eventos(A.id).slice(1)).toEqual([
        {
          agregado_id: ativa,
          versao: 2,
          payload: { ator: 'sistema', request_id: 'req-ev2', payload: { entidades: ['cliente'] } },
        },
      ]);
      jsonConfig(
        `SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['filial'], 300, 'req-ev3', '{"entidades": ["filial", "produto"]}');`,
      );
      expect(eventos(A.id).map((e) => e.versao)).toEqual([1, 2, 3]);
      expect(eventos(A.id)[2]).toMatchObject({ agregado_id: ativa, payload: { request_id: 'req-ev3' } });
      // sem evento (NULL) nada é gravado na outbox
      jsonConfig(
        `SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['filial'], 300, 'req-sem', NULL);`,
      );
      expect(eventos(A.id)).toHaveLength(3);
      // na outra empresa nada
      expect(eventos(B.id)).toEqual([]);
    });

    it('evento fora do formato = 23514, sem gravar nada (nem a configuração)', () => {
      const antes = um<{ e: string[] }>(
        `SELECT entidades_habilitadas::text[] AS e FROM integracao_fdv.credencial WHERE tenant_id = '${A.id}' AND substituida_em IS NULL`,
      );
      for (const ev of [
        '[]',
        '{"entidades": []}',
        '{"entidades": [1]}',
        '{"entidades": "filial"}',
        '{}',
        '"x"',
      ]) {
        recusaConfig(
          `SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['produto'], 10, 'req-ruim', '${ev}');`,
          '23514',
          /evento de carga inicial fora do formato/,
        );
      }
      expect(eventos(A.id)).toHaveLength(3);
      expect(
        um(
          `SELECT entidades_habilitadas::text[] AS e FROM integracao_fdv.credencial WHERE tenant_id = '${A.id}' AND substituida_em IS NULL`,
        ),
      ).toEqual(antes);
      expect(um(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE request_id = 'req-ruim'`)).toEqual(
        { n: 0 },
      );
    });

    it('reexecutar a 0042 não muda dado nem privilégio e não cria sobrecarga', () => {
      const retrato = (): unknown =>
        consultar(
          banco.conexao,
          `SELECT p.oid::regprocedure::text AS f, p.proacl::text AS acl, pg_get_function_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'integracao_fdv' AND p.proname IN ('portal_configurar', 'portal_credencial_definir') ORDER BY 1`,
        );
      const dados = (): unknown =>
        consultar(
          banco.conexao,
          `SELECT to_jsonb(c) - 'chave_cifrada' AS c FROM integracao_fdv.credencial c ORDER BY c.id`,
        );
      const [r, d] = [retrato(), dados()];
      rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
      expect([retrato(), dados()]).toEqual([r, d]);
    });
  },
);
