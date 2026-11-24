/**
 * T-0050 (E2), migração 0033: superadmin de plataforma e portal /config (ADR 0012, seções 1, 4 e 6; RN-CORE-01 e
 * RN-CORE-09). Papel macuxierp_config, tabelas sem GRANT, funções SECURITY DEFINER de lista fechada, auditoria com
 * superadmin_id e o perfil analista_implantacao.
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
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
  tabelasDos,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0033_plataforma_superadmin.sql', import.meta.url));
const MIGRACAO_0037 = fileURLToPath(new URL('../migrations/0037_plataforma_slug_codigo_fdv.sql', import.meta.url));
const MIGRACAO_0048 = fileURLToPath(new URL('../migrations/0048_senha_temporaria.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const PAPEIS = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
const A = novoTenant('sa-0033-a');
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const HASH_NOVO = '$argon2id$v=19$m=65536,t=3,p=4$b3V0cm9zYWw$b3V0cm9oYXNo';

// Superadmins da massa (dados fictícios).
const SA = '5a000000-0000-4000-8000-000000000001';
const SA_TROCA = '5a000000-0000-4000-8000-000000000002';
const SA_INATIVO = '5a000000-0000-4000-8000-000000000003';

/** Funções do portal: EXECUTE só do macuxierp_config. */
const PORTAL = [
  'plataforma.superadmin_para_login(text)',
  'plataforma.superadmin_registrar_falha(uuid, integer, timestamptz)',
  'plataforma.superadmin_abrir_sessao(uuid, plataforma.sha256_hex, timestamptz)',
  'plataforma.superadmin_sessao_por_token(plataforma.sha256_hex)',
  'plataforma.superadmin_sair(uuid)',
  'plataforma.superadmin_senha_atual()',
  'plataforma.superadmin_trocar_senha(text, text)',
  'plataforma.empresas_listar(text, uuid, integer)',
  'plataforma.empresa_ler(uuid)',
  'plataforma.empresa_criar(text, text, text, text, text)', // 0037: + p_uf DEFAULT NULL
  'plataforma.empresa_situacao(uuid, text, text, text)',
  'plataforma.empresa_modulos(uuid, jsonb, text)',
  'plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text)',
  'plataforma.empresa_primeiro_admin_senha(uuid, text, text)',
  'plataforma.empresa_primeiro_admin_email(uuid, text)', // 0035
  'plataforma.idem_plataforma_reservar(text, text, plataforma.sha256_hex)',
  'plataforma.idem_plataforma_concluir(text, text, integer, jsonb)',
] as const;
/** Internas: EXECUTE de ninguém (só as funções do portal, como donas). */
const INTERNAS = [
  'plataforma.instante_iso(timestamptz)',
  'plataforma.sessao_superadmin_valida(uuid, text, boolean)',
  'plataforma.exigir_superadmin(boolean)',
  'plataforma.auditar_superadmin(uuid, uuid, text, text, uuid, jsonb, jsonb, text)',
  'plataforma.licencas_json(uuid)',
  'plataforma.primeiro_admin(uuid)',
  'plataforma.empresa_json(uuid)',
  'plataforma.empresa_visivel(plataforma.tenant)',
  'plataforma.empresa_alvo(uuid, boolean)',
  'plataforma.exigir_rota_plataforma(text)',
  'plataforma.mascarar_email(text)', // 0035
] as const;
const TODAS = [...PORTAL, ...INTERNAS];
const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao_fdv', 'sefaz_simulador'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface Empresa {
  id: string;
  slug: string;
  nome: string;
  fuso: string;
  situacao: string;
  modulos: { modulo: string; ativo: boolean; valido_ate: string | null }[];
  primeiro_admin: { id: string; ativo: boolean; bloqueado: boolean; email_mascarado: string } | null;
  created_at: string;
  updated_at: string;
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — superadmin e portal /config (T-0050, 0033)', () => {
  let banco: BancoDeTeste;

  /** Roda como macuxierp_config, com a sessão de superadmin na transação; devolve as linhas da saída. */
  const comoConfig = (sessao: string | null, sql: string): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
  const jsonConfig = <T>(sessao: string | null, sql: string): T =>
    JSON.parse(comoConfig(sessao, sql)[0] ?? 'null') as T;
  const recusaConfig = (sessao: string | null, sql: string, codigo: string, padrao: RegExp): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });
  /** Sessão gravada pelo admin (fora das funções), para os casos de borda do exigir_superadmin. */
  const novaSessao = (sa: string, extra = ''): string => {
    const id = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em, revogada_em)
       SELECT '${id}', '${sa}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now(), NULL;
       ${extra.replaceAll(':id', `'${id}'`)}`,
    );
    return id;
  };
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo) VALUES
  ('${SA}', 'sa@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true),
  ('${SA_TROCA}', 'troca@plataforma.teste', 'Superadmin Provisorio', '${HASH}', true, true),
  ('${SA_INATIVO}', 'inativo@plataforma.teste', 'Superadmin Inativo', '${HASH}', false, false);`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) macuxierp_config sem login, sem BYPASSRLS nem superusuário; o app é membro só por SET ROLE (INHERIT false)', () => {
    expect(
      um(`SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
          FROM pg_roles WHERE rolname = '${CONFIG}'`),
    ).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
    expect(
      consultar(
        banco.conexao,
        `SELECT m.member::regrole::text AS membro, m.inherit_option AS herda, m.set_option AS set
         FROM pg_auth_members m WHERE m.roleid = '${CONFIG}'::regrole AND m.member <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
         ORDER BY 1`,
      ),
    ).toEqual([{ membro: 'macuxierp_app', herda: false, set: true }]);
    // Sem herança: o app não ganha nada do config sem SET ROLE.
    expect(
      um(
        `SELECT pg_has_role('macuxierp_app', '${CONFIG}', 'USAGE') AS u, pg_has_role('macuxierp_app', '${CONFIG}', 'SET') AS s`,
      ),
    ).toEqual({
      u: false,
      s: true,
    });
  });

  it('(a) EXECUTE das funções do portal só do config; internas de ninguém; todas SECURITY DEFINER, search_path fixo e comentadas', () => {
    for (const f of TODAS) {
      const r = um<Record<string, unknown>>(
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
        config: (PORTAL as readonly string[]).includes(f),
      });
    }
  });

  it('(b) nenhum papel (app, worker, leitura, config) tem privilégio nas duas tabelas; 42501 ao ler, mesmo com tenant', () => {
    for (const tabela of ['plataforma.superadmin', 'plataforma.sessao_superadmin']) {
      for (const papel of [...PAPEIS, CONFIG]) {
        expect({ tabela, papel, p: privilegiosDe(banco.conexao, papel, tabela) }).toEqual({
          tabela,
          papel,
          p: '-',
        });
        for (const tenant of [REFERENCIA, A.id]) {
          recusaDetalhada(banco.conexao, `SELECT count(*) FROM ${tabela};`, '42501', /permission denied/, {
            papel,
            tenant,
          });
        }
      }
    }
  });

  it('(b) RLS ligada (sem FORCE, premissa), com isolamento_tenant; tenant_id fora do de referência é recusado', () => {
    expect(
      consultar(
        banco.conexao,
        `SELECT k.relname AS t, k.relrowsecurity AS rls, k.relforcerowsecurity AS forcada,
           EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'plataforma' AND p.tablename = k.relname
             AND p.policyname = 'isolamento_tenant') AS politica
         FROM pg_class k WHERE k.oid IN ('plataforma.superadmin'::regclass, 'plataforma.sessao_superadmin'::regclass)
         ORDER BY 1`,
      ),
    ).toEqual([
      { t: 'sessao_superadmin', rls: true, forcada: false, politica: true },
      { t: 'superadmin', rls: true, forcada: false, politica: true },
    ]);
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (tenant_id, email, nome, senha_hash) VALUES ('${A.id}', 'x@y.teste', 'Fulano', '${HASH}');`,
      '23514',
      /superadmin_tenant_referencia/,
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.sessao_superadmin (tenant_id, superadmin_id, token_hash, expira_em)
       VALUES ('${A.id}', '${SA}', repeat('9', 64), now() + interval '1 hour');`,
      '23514',
      /sessao_superadmin_tenant_referencia/,
    );
    // E-mail normalizado e único entre os não excluídos.
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (email, nome, senha_hash) VALUES ('SA@plataforma.teste', 'Fulano', '${HASH}');`,
      '23514',
      /superadmin_email_check/,
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (email, nome, senha_hash) VALUES ('sa@plataforma.teste', 'Fulano', '${HASH}');`,
      '23505',
      /superadmin_email_uq/,
    );
  });

  it('(c) o superadmin não lê dado de negócio: config com sessão válida recebe 42501 nos módulos e em usuario/tenant', () => {
    const sessao = novaSessao(SA);
    const tabelas = MODULOS.map((esquema) => {
      const [t] = tabelasDos(banco.conexao, [esquema]);
      expect(t, `schema ${esquema} sem tabela`).toBeDefined();
      return `${t?.esquema}.${t?.tabela}`;
    });
    for (const tabela of [...tabelas, 'plataforma.usuario', 'plataforma.tenant', 'plataforma.sessao']) {
      recusaConfig(
        sessao,
        `SELECT plataforma.empresa_ler('${A.id}');\nSELECT count(*) FROM ${tabela};`,
        '42501',
        /permission denied/,
      );
    }
    // Nenhuma função de plataforma cita schema de módulo, salvo empresa_json: emenda da ADR 0012 §4
    // (engenheiro-software, T-0050; migração 0035), a única que lê core.empresa e cadastros.filial/municipio, só
    // para exibição no portal.
    const citam = consultar<{ f: string }>(
      banco.conexao,
      `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
       WHERE p.oid = ANY (ARRAY[${TODAS.filter((f) => f !== 'plataforma.empresa_json(uuid)')
         .map((f) => `'${f}'::regprocedure`)
         .join(', ')}]::oid[])
         AND p.prosrc ~ '(^|[^a-z_])(core|cadastros|pedido|faturamento|fiscal|integracao_fdv|sefaz_simulador)\\.'`,
    );
    expect(citam).toEqual([]);
    // A exceção é estreita: empresa_json cita só core.empresa, cadastros.filial e cadastros.municipio.
    const [fonte] = consultar<{ src: string }>(
      banco.conexao,
      `SELECT prosrc AS src FROM pg_proc WHERE oid = 'plataforma.empresa_json(uuid)'::regprocedure`,
    );
    const referencias = new Set(
      [
        ...(fonte?.src ?? '').matchAll(
          /(?<![a-z_])(core|cadastros|pedido|faturamento|fiscal|integracao_fdv|sefaz_simulador)\.\w+/g,
        ),
      ].map((m) => m[0]),
    );
    expect([...referencias].sort()).toEqual(['cadastros.filial', 'cadastros.municipio', 'core.empresa']);
  });

  it('(d) exigir_superadmin: sem sessão, valor não uuid, revogada, vencida, ociosa, superadmin inativo ou troca pendente = MXS01', () => {
    const ler = `SELECT plataforma.empresa_ler('${A.id}');`;
    const invalida = /sessão de superadmin inválida/;
    recusaConfig(null, ler, 'MXS01', invalida);
    recusaConfig('nao-e-uuid', ler, 'MXS01', invalida);
    recusaConfig(randomUUID(), ler, 'MXS01', invalida);
    recusaConfig(
      novaSessao(SA, 'UPDATE plataforma.sessao_superadmin SET revogada_em = now() WHERE id = :id;'),
      ler,
      'MXS01',
      invalida,
    );
    recusaConfig(
      novaSessao(
        SA,
        "UPDATE plataforma.sessao_superadmin SET expira_em = now() - interval '1 minute' WHERE id = :id;",
      ),
      ler,
      'MXS01',
      invalida,
    );
    recusaConfig(
      novaSessao(
        SA,
        "UPDATE plataforma.sessao_superadmin SET ultimo_uso_em = now() - interval '31 minutes' WHERE id = :id;",
      ),
      ler,
      'MXS01',
      invalida,
    );
    recusaConfig(
      novaSessao(SA, 'UPDATE plataforma.sessao_superadmin SET deleted_at = now() WHERE id = :id;'),
      ler,
      'MXS01',
      invalida,
    );
    recusaConfig(novaSessao(SA_INATIVO), ler, 'MXS01', invalida);
    const troca = novaSessao(SA_TROCA);
    recusaConfig(troca, ler, 'MXS01', invalida);
    // A troca pendente ainda deixa ler o hash atual (família superadmin_trocar_senha).
    expect(comoConfig(troca, 'SELECT plataforma.superadmin_senha_atual();')).toEqual([HASH]);
    // Sessão válida: passa e renova o ultimo_uso_em.
    const ok = novaSessao(
      SA,
      "UPDATE plataforma.sessao_superadmin SET ultimo_uso_em = now() - interval '29 minutes' WHERE id = :id;",
    );
    expect(jsonConfig<Empresa>(ok, ler).id).toBe(A.id);
    expect(
      um<{ ok: boolean }>(
        `SELECT ultimo_uso_em > now() - interval '1 minute' AS ok FROM plataforma.sessao_superadmin WHERE id = '${ok}'`,
      ).ok,
    ).toBe(true);
  });

  it('(e) fluxo do portal: login, sessão, empresa, módulos, 1º admin, senha do admin e suspensão, com auditoria sem dado pessoal', () => {
    // Login: busca pelo e-mail normalizado, sem sessão.
    const [login] = consultar<{
      id: string;
      senha_hash: string;
      falhas_login: number;
      deve_trocar_senha: boolean;
    }>(banco.conexao, `SELECT * FROM plataforma.superadmin_para_login('  SA@Plataforma.Teste ')`, {
      papel: CONFIG,
    });
    expect(login).toMatchObject({ id: SA, senha_hash: HASH, falhas_login: 0, deve_trocar_senha: false });
    expect(
      consultar(banco.conexao, `SELECT * FROM plataforma.superadmin_para_login('nao@existe.teste')`, {
        papel: CONFIG,
      }),
    ).toEqual([]);

    // Falha e trava (ADR §6); com trava de pé, abrir_sessao recusa; a falha sem trava não impede.
    comoConfig(
      null,
      `SELECT plataforma.superadmin_registrar_falha('${SA}', 5, now() + interval '15 minutes');`,
    );
    recusaConfig(
      null,
      `SELECT plataforma.superadmin_abrir_sessao('${SA}', repeat('1', 64), now() + interval '1 hour');`,
      'MXS01',
      /inválida/,
    );
    // Só sobe (greatest): p_falhas = 0 não zera a contagem e a trava não recua nem some com NULL.
    const trava = (): unknown =>
      um(
        `SELECT falhas_login, bloqueado_ate > now() + interval '14 minutes' AS de_pe FROM plataforma.superadmin WHERE id = '${SA}'`,
      );
    expect(trava()).toEqual({ falhas_login: 5, de_pe: true });
    comoConfig(null, `SELECT plataforma.superadmin_registrar_falha('${SA}', 0, now() + interval '1 minute');`);
    expect(trava()).toEqual({ falhas_login: 6, de_pe: true });
    comoConfig(null, `SELECT plataforma.superadmin_registrar_falha('${SA}', 2, NULL);`);
    expect(trava()).toEqual({ falhas_login: 7, de_pe: true });
    // A trava vence (relógio simulado pelo admin): o login volta a abrir.
    executar(
      banco.conexao,
      `UPDATE plataforma.superadmin SET bloqueado_ate = now() - interval '1 second' WHERE id = '${SA}';`,
    );
    recusaConfig(
      null,
      `SELECT plataforma.superadmin_abrir_sessao('${SA}', repeat('1', 64), now() + interval '8 hours 1 second');`,
      '23514',
      /8 h/,
    );
    recusaConfig(
      null,
      `SELECT plataforma.superadmin_abrir_sessao('${SA_INATIVO}', repeat('1', 64), now() + interval '1 hour');`,
      'MXS01',
      /inválida/,
    );
    const token = 'ab'.repeat(32);
    const [sessao] = comoConfig(
      null,
      `SELECT plataforma.superadmin_abrir_sessao('${SA}', '${token}', now() + interval '8 hours');`,
    );
    expect(sessao).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      um(
        `SELECT falhas_login, bloqueado_ate, ultimo_acesso_em IS NOT NULL AS acessou FROM plataforma.superadmin WHERE id = '${SA}'`,
      ),
    ).toEqual({
      falhas_login: 0,
      bloqueado_ate: null,
      acessou: true,
    });
    const [porToken] = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT sessao_id, superadmin_id, nome, deve_trocar_senha FROM plataforma.superadmin_sessao_por_token('${token}')`,
      { papel: CONFIG },
    );
    expect(porToken).toEqual({
      sessao_id: sessao,
      superadmin_id: SA,
      nome: 'Superadmin Ficticio',
      deve_trocar_senha: false,
    });
    expect(
      consultar(banco.conexao, `SELECT * FROM plataforma.superadmin_sessao_por_token(repeat('e', 64))`, {
        papel: CONFIG,
      }),
    ).toEqual([]);
    const s = sessao as string;

    // Empresa nova: slug normalizado, ativa, só com o core.
    const criada = jsonConfig<Empresa>(
      s,
      `SELECT plataforma.empresa_criar(' Empresa-Portal ', 'Empresa Portal Ltda', 'America/Manaus', 'req-criar');`,
    );
    expect(criada).toMatchObject({
      slug: 'empresa-portal',
      nome: 'Empresa Portal Ltda',
      fuso: 'America/Manaus',
      situacao: 'ativo',
      modulos: [{ modulo: 'core', ativo: true, valido_ate: null }],
      primeiro_admin: null,
    });
    expect(criada.created_at).toMatch(ISO);
    expect(criada.updated_at).toMatch(ISO);
    const E = criada.id;
    const E2 = jsonConfig<Empresa>(
      s,
      `SELECT plataforma.empresa_criar('empresa-portal-2', 'Outra Empresa', NULL, 'req-criar-2');`,
    ).id;
    recusaConfig(
      s,
      `SELECT plataforma.empresa_criar('config', 'Reservada', NULL, 'r');`,
      '23514',
      /slug reservado/,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_criar('referencia', 'Reservada', NULL, 'r');`,
      '23514',
      /slug reservado/,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_criar('empresa-marte', 'Marte', 'Marte/Base', 'r');`,
      '23514',
      /fuso/,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_criar('empresa-portal', 'Repetida', NULL, 'r');`,
      '23505',
      /duplicate key/,
    );

    // Listar e ler: nunca a referência; ordem e cursor por id (contrato de listas.ts), busca no slug e limite.
    const ids = (sql: string): string[] => comoConfig(s, sql).map((l) => (JSON.parse(l) as Empresa).id);
    const todas = [E, E2, A.id].sort();
    const portal = [E, E2].sort();
    expect(ids(`SELECT plataforma.empresas_listar(NULL, NULL, 201);`)).toEqual(todas);
    const pagina1 = ids(`SELECT plataforma.empresas_listar(NULL, NULL, 2);`);
    expect(pagina1).toEqual(todas.slice(0, 2));
    expect(ids(`SELECT plataforma.empresas_listar(NULL, '${pagina1[1]}', 2);`)).toEqual(todas.slice(2));
    expect(ids(`SELECT plataforma.empresas_listar(NULL, '${todas[2]}', 2);`)).toEqual([]);
    expect(ids(`SELECT plataforma.empresas_listar(' PORTAL ', NULL, 50);`)).toEqual(portal);
    expect(ids(`SELECT plataforma.empresas_listar('portal', '${portal[0]}', 50);`)).toEqual([portal[1]]);
    expect(ids(`SELECT plataforma.empresas_listar(NULL, NULL, 0);`)).toHaveLength(1);
    expect(ids(`SELECT plataforma.empresas_listar(NULL, NULL, 1000);`)).not.toContain(REFERENCIA);
    expect(jsonConfig<Empresa>(s, `SELECT plataforma.empresa_ler('${E}');`)).toEqual(criada);
    expect(comoConfig(s, `SELECT coalesce(plataforma.empresa_ler('${REFERENCIA}')::text, 'NULO');`)).toEqual([
      'NULO',
    ]);
    expect(
      comoConfig(s, `SELECT coalesce(plataforma.empresa_ler(gen_random_uuid())::text, 'NULO');`),
    ).toEqual(['NULO']);

    // Módulos: liga, reativa linha excluída, o core nunca desliga; referência e inexistente = no_data_found.
    const comPedido = jsonConfig<Empresa>(
      s,
      // hora-fixa-ok: validade da licença só gravada e devolvida (formato ISO), nunca comparada ao relógio
      `SELECT plataforma.empresa_modulos('${E}', '[{"modulo":"cadastros","ativo":true,"valido_ate":null},{"modulo":"pedido","ativo":true,"valido_ate":"2027-01-01T00:00:00Z"}]', 'req-mod');`,
    );
    expect(comPedido.modulos).toEqual([
      { modulo: 'cadastros', ativo: true, valido_ate: null },
      { modulo: 'core', ativo: true, valido_ate: null },
      { modulo: 'pedido', ativo: true, valido_ate: '2027-01-01T00:00:00.000Z' }, // hora-fixa-ok: idem
    ]);
    executar(
      banco.conexao,
      `UPDATE plataforma.tenant_modulo SET deleted_at = now() WHERE tenant_id = '${E}' AND modulo = 'pedido';`,
    );
    const reativado = jsonConfig<Empresa>(
      s,
      `SELECT plataforma.empresa_modulos('${E}', '[{"modulo":"pedido","ativo":false,"valido_ate":null}]', 'req-mod-2');`,
    );
    expect(reativado.modulos.find((m) => m.modulo === 'pedido')).toEqual({
      modulo: 'pedido',
      ativo: false,
      valido_ate: null,
    });
    recusaConfig(
      s,
      `SELECT plataforma.empresa_modulos('${E}', '[{"modulo":"core","ativo":false,"valido_ate":null}]', 'r');`,
      '23514',
      /core/,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_modulos('${E}', '[{"modulo":"cadastros","ativo":true},{"modulo":"cadastros","ativo":false}]', 'r');`,
      '23514',
      /repetido/,
    );
    recusaConfig(s, `SELECT plataforma.empresa_modulos('${E}', '[]', 'r');`, '23514', /módulos/);
    recusaConfig(
      s,
      `SELECT plataforma.empresa_modulos('${REFERENCIA}', '[{"modulo":"cadastros","ativo":true}]', 'r');`,
      'P0002',
      /não encontrada/,
    );

    // Empresa encerrada: módulos e 1º admin recusam (só ativo|suspenso), como a situação.
    executar(banco.conexao, `UPDATE plataforma.tenant SET situacao = 'encerrado' WHERE id = '${E2}';`);
    recusaConfig(
      s,
      `SELECT plataforma.empresa_modulos('${E2}', '[{"modulo":"cadastros","ativo":true,"valido_ate":null}]', 'r');`,
      '23514',
      /fora de ativo ou suspenso/,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_primeiro_admin_criar('${E2}', 'x@empresa-portal-2.teste', 'Xis', '${HASH}', 'r');`,
      '23514',
      /fora de ativo ou suspenso/,
    );

    // 1º administrador: cria uma vez; a segunda é unique_violation.
    const [admin] = comoConfig(
      s,
      `SELECT plataforma.empresa_primeiro_admin_criar('${E}', ' Dono@Empresa-Portal.Teste ', 'Dono Ficticio', '${HASH}', 'req-adm');`,
    );
    expect(um(`SELECT email, nome, perfil, ativo FROM plataforma.usuario WHERE id = '${admin}'`)).toEqual({
      email: 'dono@empresa-portal.teste',
      nome: 'Dono Ficticio',
      perfil: 'administrador',
      ativo: true,
    });
    recusaConfig(
      s,
      `SELECT plataforma.empresa_primeiro_admin_criar('${E}', 'outro@empresa-portal.teste', 'Outro', '${HASH}', 'r');`,
      '23505',
      /já tem administrador/,
    );
    expect(jsonConfig<Empresa>(s, `SELECT plataforma.empresa_ler('${E}');`).primeiro_admin).toEqual({
      id: admin,
      ativo: true,
      bloqueado: false,
      email_mascarado: 'do****@empresa-portal.teste', // 0035
    });

    // Senha do 1º admin: troca o hash, zera a trava e revoga as sessões dele.
    executar(
      banco.conexao,
      `UPDATE plataforma.usuario SET falhas_login = 5, bloqueado_ate = now() + interval '1 hour' WHERE id = '${admin}';
       INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em)
       VALUES ('${E}', '${admin}', gen_random_uuid(), repeat('c', 64), now() + interval '1 day');`,
    );
    expect(jsonConfig<Empresa>(s, `SELECT plataforma.empresa_ler('${E}');`).primeiro_admin?.bloqueado).toBe(
      true,
    );
    expect(
      comoConfig(s, `SELECT plataforma.empresa_primeiro_admin_senha('${E}', '${HASH_NOVO}', 'req-senha');`),
    ).toEqual([admin]);
    expect(
      um(`SELECT senha_hash, falhas_login, bloqueado_ate FROM plataforma.usuario WHERE id = '${admin}'`),
    ).toEqual({
      senha_hash: HASH_NOVO,
      falhas_login: 0,
      bloqueado_ate: null,
    });
    expect(
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.sessao WHERE usuario_id = '${admin}' AND revogada_em IS NULL`,
      ).n,
    ).toBe(0);
    recusaConfig(
      s,
      `SELECT plataforma.empresa_primeiro_admin_senha((SELECT gen_random_uuid()), '${HASH_NOVO}', 'r');`,
      'P0002',
      /não encontrada/,
    );

    // Suspensão: revoga as sessões do tenant; mesma situação não audita de novo; só ativo|suspenso; motivo 3..200.
    executar(
      banco.conexao,
      `INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em)
       VALUES ('${E}', '${admin}', gen_random_uuid(), repeat('d', 64), now() + interval '1 day');`,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_situacao('${E}', 'encerrado', 'motivo valido', 'r');`,
      '23514',
      /situação/,
    );
    recusaConfig(s, `SELECT plataforma.empresa_situacao('${E}', 'suspenso', 'ab', 'r');`, '23514', /motivo/);
    recusaConfig(
      s,
      `SELECT plataforma.empresa_situacao('${REFERENCIA}', 'suspenso', 'motivo valido', 'r');`,
      'P0002',
      /não encontrada/,
    );
    expect(
      jsonConfig<Empresa>(
        s,
        `SELECT plataforma.empresa_situacao('${E}', 'suspenso', 'inadimplencia de teste', 'req-sit');`,
      ).situacao,
    ).toBe('suspenso');
    expect(
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.sessao WHERE tenant_id = '${E}' AND revogada_em IS NULL`,
      ).n,
    ).toBe(0);
    jsonConfig<Empresa>(s, `SELECT plataforma.empresa_situacao('${E}', 'suspenso', 'de novo', 'req-sit-2');`);
    // A sessão do tenant A (fixture) continua de pé.
    expect(
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.sessao WHERE tenant_id = '${A.id}' AND revogada_em IS NULL`,
      ).n,
    ).toBe(1);

    // Auditoria da empresa: autor superadmin, usuario_id nulo, sem nome, e-mail nem hash.
    const audit = consultar<{
      acao: string;
      usuario_id: string | null;
      superadmin_id: string;
      request_id: string;
      texto: string;
    }>(
      banco.conexao,
      `SELECT acao, usuario_id, superadmin_id, request_id, coalesce(antes::text, '') || coalesce(depois::text, '') AS texto
       FROM plataforma.auditoria WHERE tenant_id = '${E}' ORDER BY ocorrido_em, created_at, acao`,
    );
    expect(audit.map((a) => [a.acao, a.request_id])).toEqual([
      ['plataforma.empresa.criar', 'req-criar'],
      ['plataforma.modulos.alterar', 'req-mod'],
      ['plataforma.modulos.alterar', 'req-mod-2'],
      ['plataforma.admin.criar', 'req-adm'],
      ['plataforma.admin.redefinir_senha', 'req-senha'],
      ['plataforma.empresa.situacao', 'req-sit'],
    ]);
    for (const a of audit) {
      expect(a).toMatchObject({ usuario_id: null, superadmin_id: SA });
      for (const proibido of ['Empresa Portal', 'Dono', 'dono@', '@', 'argon2', 'Superadmin'])
        expect(a.texto).not.toContain(proibido);
    }
    // Login, falha e entrada vão com o tenant de referência.
    expect(
      consultar<{ acao: string }>(
        banco.conexao,
        `SELECT acao FROM plataforma.auditoria WHERE tenant_id = '${REFERENCIA}' AND superadmin_id = '${SA}' ORDER BY ocorrido_em, created_at`,
      ).map((a) => a.acao),
    ).toEqual(expect.arrayContaining(['plataforma.superadmin.falha', 'plataforma.superadmin.entrar']));

    // Sair: só a própria sessão; depois dela, MXS01.
    recusaConfig(s, `SELECT plataforma.superadmin_sair(gen_random_uuid());`, 'MXS01', /inválida/);
    comoConfig(s, `SELECT plataforma.superadmin_sair('${s}');`);
    recusaConfig(s, `SELECT plataforma.empresa_ler('${E}');`, 'MXS01', /inválida/);
    // Entrar e sair não guardam o id da sessão na auditoria.
    expect(
      um(
        `SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao IN ('plataforma.superadmin.entrar', 'plataforma.superadmin.sair') AND depois IS NOT NULL`,
      ),
    ).toEqual({ n: 0 });
    expect(
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao = 'plataforma.superadmin.sair' AND superadmin_id = '${SA}'`,
      ).n,
    ).toBe(1);
    expect(
      consultar(banco.conexao, `SELECT * FROM plataforma.superadmin_sessao_por_token('${token}')`, {
        papel: CONFIG,
      }),
    ).toEqual([]);
  });

  it('(e) troca de senha do superadmin: confere o hash atual, tira a troca pendente e revoga as outras sessões', () => {
    const outra = novaSessao(SA_TROCA);
    const [s] = comoConfig(
      null,
      `SELECT plataforma.superadmin_abrir_sessao('${SA_TROCA}', repeat('7', 64), now() + interval '1 hour');`,
    );
    const sessao = s as string;
    const [atual] = comoConfig(sessao, 'SELECT plataforma.superadmin_senha_atual();');
    expect(atual).toBe(HASH);
    recusaConfig(
      sessao,
      `SELECT plataforma.superadmin_trocar_senha('${HASH_NOVO}', '${HASH_NOVO}');`,
      '23514',
      /a senha mudou/,
    );
    comoConfig(sessao, `SELECT plataforma.superadmin_trocar_senha('${HASH}', '${HASH_NOVO}');`);
    expect(
      um(
        `SELECT deve_trocar_senha, senha_hash, senha_trocada_em IS NOT NULL AS trocou FROM plataforma.superadmin WHERE id = '${SA_TROCA}'`,
      ),
    ).toEqual({
      deve_trocar_senha: false,
      senha_hash: HASH_NOVO,
      trocou: true,
    });
    expect(
      um(`SELECT revogada_em IS NOT NULL AS r FROM plataforma.sessao_superadmin WHERE id = '${outra}'`),
    ).toEqual({ r: true });
    // A sessão corrente segue e agora já abre o portal.
    expect(
      comoConfig(sessao, `SELECT coalesce(plataforma.empresa_ler('${REFERENCIA}')::text, 'NULO');`),
    ).toEqual(['NULO']);
    const [aud] = consultar<{ texto: string }>(
      banco.conexao,
      `SELECT depois::text AS texto FROM plataforma.auditoria WHERE acao = 'plataforma.superadmin.senha' AND superadmin_id = '${SA_TROCA}'`,
    );
    expect(aud?.texto).not.toContain('argon2');
  });

  it('(f) perfil analista_implantacao aceito e desconhecido recusado; auditoria com dois autores = 23514; app não grava superadmin_id', () => {
    executar(
      banco.conexao,
      `INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil)
       VALUES ('${A.id}', 'analista@sa-0033-a.teste', 'Analista', '${HASH}', 'analista_implantacao');`,
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil) VALUES ('${A.id}', 'xyz@sa-0033-a.teste', 'Xyz', '${HASH}', 'xyz');`,
      '23514',
      /usuario_perfil_check/,
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.auditoria (tenant_id, usuario_id, superadmin_id, acao, entidade) VALUES ('${A.id}', '${A.usuario}', '${SA}', 'x', 'y');`,
      '23514',
      /auditoria_um_autor/,
    );
    const ctx = { papel: 'macuxierp_app', tenant: A.id };
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.auditoria (tenant_id, superadmin_id, acao, entidade) VALUES ('${A.id}', '${SA}', 'x', 'y');`,
      '42501',
      /permission denied/,
      ctx,
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO plataforma.auditoria (tenant_id, superadmin_id, acao, entidade) VALUES ('${A.id}', '${SA}', 'x', 'y');`,
      '42501',
      /permission denied/,
      { papel: 'macuxierp_worker', tenant: A.id },
    );
    // A gravação de sempre (colunas do SDK, pg.ts) continua.
    executar(
      banco.conexao,
      `INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id, ocorrido_em)
       VALUES ('${A.id}', '${A.usuario}', 'criar', 'cliente', NULL, NULL, '{}', 'req', now());`,
      ctx,
    );
  });

  it('(h) Idempotency-Key de /v1/plataforma/*: nova, em andamento, concluída, conflito; tenant de referência; trava de rota e sessão', () => {
    const sessao = novaSessao(SA);
    const chave = 'idem-0033-chave-1';
    const rota = 'POST /v1/plataforma/empresas';
    const h1 = 'a'.repeat(64);
    const h2 = 'b'.repeat(64);
    const reservar = (c: string, r: string, h: string): string =>
      `SELECT row_to_json(x)::text FROM plataforma.idem_plataforma_reservar('${c}', '${r}', '${h}') x;`;
    expect(jsonConfig(sessao, reservar(chave, rota, h1))).toEqual({ situacao: 'nova', status: null, resposta: null });
    expect(jsonConfig(sessao, reservar(chave, rota, h1))).toEqual({
      situacao: 'em_andamento',
      status: null,
      resposta: null,
    });
    comoConfig(sessao, `SELECT plataforma.idem_plataforma_concluir('${chave}', '${rota}', 201, '{"id": "x"}'::jsonb);`);
    expect(jsonConfig(sessao, reservar(chave, rota, h1))).toEqual({
      situacao: 'concluida',
      status: 201,
      resposta: { id: 'x' },
    });
    // Concluída não é regravada.
    comoConfig(sessao, `SELECT plataforma.idem_plataforma_concluir('${chave}', '${rota}', 500, NULL);`);
    expect(jsonConfig(sessao, reservar(chave, rota, h1))).toMatchObject({ situacao: 'concluida', status: 201 });
    expect(jsonConfig(sessao, reservar(chave, rota, h2))).toEqual({ situacao: 'conflito', status: null, resposta: null });
    // Resposta NULL (senha provisória grava só o status, ADR 0012 §5).
    const rotaSenha = 'POST /v1/plataforma/empresas/x/admin/senha';
    expect(jsonConfig(sessao, reservar(chave, rotaSenha, h1))).toMatchObject({ situacao: 'nova' });
    comoConfig(sessao, `SELECT plataforma.idem_plataforma_concluir('${chave}', '${rotaSenha}', 200, NULL);`);
    expect(jsonConfig(sessao, reservar(chave, rotaSenha, h1))).toEqual({
      situacao: 'concluida',
      status: 200,
      resposta: null,
    });
    // A vencida é substituída.
    executar(
      banco.conexao,
      `UPDATE plataforma.idempotencia SET expira_em = now() - interval '1 second' WHERE chave = '${chave}' AND rota = '${rota}';`,
    );
    expect(jsonConfig(sessao, reservar(chave, rota, h2))).toMatchObject({ situacao: 'nova' });
    // Rota `<MÉTODO> /v1/plataforma/...` (idempotencia.ts): sem método, outro método, outro módulo = 23514.
    for (const r of [
      '/v1/plataforma/empresas',
      'GET /v1/plataforma/empresas',
      'POST /v1/clientes',
      'POST /v1/plataformaX/a',
      'post /v1/plataforma/empresas',
    ]) {
      recusaConfig(sessao, reservar(chave, r, h1), '23514', /rota fora de <MÉTODO> \/v1\/plataforma\//);
      recusaConfig(
        sessao,
        `SELECT plataforma.idem_plataforma_concluir('${chave}', '${r}', 200, NULL);`,
        '23514',
        /rota fora/,
      );
    }
    recusaConfig(null, reservar(chave, rota, h1), 'MXS01', /sessão de superadmin inválida/);
    recusaConfig(
      null,
      `SELECT plataforma.idem_plataforma_concluir('${chave}', '${rota}', 200, NULL);`,
      'MXS01',
      /sessão de superadmin inválida/,
    );
    // As linhas ficam no tenant de referência; o app com o tenant A não as vê.
    expect(
      um(`SELECT count(*)::int AS n, bool_and(tenant_id = '${REFERENCIA}') AS ref FROM plataforma.idempotencia WHERE chave = '${chave}'`),
    ).toEqual({ n: 2, ref: true });
    expect(
      consultar(banco.conexao, `SELECT count(*)::int AS n FROM plataforma.idempotencia WHERE chave = '${chave}'`, {
        papel: 'macuxierp_app',
        tenant: A.id,
      }),
    ).toEqual([{ n: 0 }]);
  });

  it('(h) a limpeza de 30 dias no login apaga no máximo 500 sessões por chamada', () => {
    executar(
      banco.conexao,
      `DELETE FROM plataforma.sessao_superadmin WHERE expira_em < now() - interval '30 days';
       INSERT INTO plataforma.sessao_superadmin (superadmin_id, token_hash, expira_em, ultimo_uso_em)
       SELECT '${SA}', encode(sha256(convert_to('velha-' || g, 'UTF8')), 'hex'), now() - interval '40 days', now() - interval '40 days'
       FROM generate_series(1, 502) g;`,
    );
    const velhas = (): number =>
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.sessao_superadmin WHERE expira_em < now() - interval '30 days'`,
      ).n;
    expect(velhas()).toBe(502);
    comoConfig(null, `SELECT plataforma.superadmin_abrir_sessao('${SA}', repeat('8', 64), now() + interval '1 hour');`);
    expect(velhas()).toBe(2);
    comoConfig(null, `SELECT plataforma.superadmin_abrir_sessao('${SA}', repeat('9', 64), now() + interval '1 hour');`);
    expect(velhas()).toBe(0);
  });

  it('(g) a 0033 reexecuta duas vezes sem erro e mantém papel, privilégios e funções', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    // Assinaturas antigas (da sessão de desenvolvimento): a reexecução as remove, sem deixar duas.
    executar(
      banco.conexao,
      `CREATE FUNCTION plataforma.empresas_listar(text, text, integer) RETURNS SETOF jsonb LANGUAGE sql AS 'SELECT NULL::jsonb WHERE false';
       CREATE FUNCTION plataforma.empresa_alvo(uuid) RETURNS plataforma.tenant LANGUAGE sql AS 'SELECT NULL::plataforma.tenant';`,
    );
    // A 0048 mudou o retorno de superadmin_para_login (DROP + CREATE): o CREATE OR REPLACE da 0033 não troca o tipo de
    // retorno, então a reexecução parte da versão da 0033 e a 0048 reaplicada (a ordem do deploy) devolve a dela.
    executar(banco.conexao, 'DROP FUNCTION plataforma.superadmin_para_login(text);');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    // A 0033 recria a empresa_criar de 4 argumentos; reaplicar a 0037 (a ordem do deploy) a tira e fica uma só.
    rodarScript(banco.conexao, readFileSync(MIGRACAO_0037, 'utf8'), { transacao: true });
    rodarScript(banco.conexao, readFileSync(MIGRACAO_0048, 'utf8'), { transacao: true });
    expect(
      um(
        `SELECT pg_get_function_result('plataforma.superadmin_para_login(text)'::regprocedure) LIKE
           '%senha_temporaria_expira_em%' AS da_0048`,
      ),
    ).toEqual({ da_0048: true });
    expect(
      um(
        `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
           AND proname = 'empresa_criar') AS n,
           to_regprocedure('plataforma.empresa_criar(text, text, text, text, text)') IS NOT NULL AS cinco`,
      ),
    ).toEqual({ n: 1, cinco: true });
    expect(
      um(
        `SELECT pg_has_role('macuxierp_app', '${CONFIG}', 'USAGE') AS u, pg_has_role('macuxierp_app', '${CONFIG}', 'SET') AS s`,
      ),
    ).toEqual({
      u: false,
      s: true,
    });
    expect(privilegiosDe(banco.conexao, 'macuxierp_app', 'plataforma.superadmin')).toBe('-');
    expect(
      um(
        `SELECT to_regprocedure('plataforma.empresas_listar(text, text, integer)') IS NULL AS listar,
           to_regprocedure('plataforma.empresa_alvo(uuid)') IS NULL AS alvo,
           (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
              AND proname IN ('empresas_listar', 'empresa_alvo')) AS n`,
      ),
    ).toEqual({ listar: true, alvo: true, n: 2 });
    expect(
      um(`SELECT has_function_privilege('${CONFIG}', 'plataforma.empresa_ler(uuid)', 'EXECUTE') AS c`),
    ).toEqual({ c: true });
    const sessao = novaSessao(SA);
    expect(jsonConfig<Empresa>(sessao, `SELECT plataforma.empresa_ler('${A.id}');`).slug).toBe(A.slug);
  });
});
