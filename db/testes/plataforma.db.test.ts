/**
 * T-0003, lote 1: papéis, schemas, colunas comuns, RLS e vazamento entre tenants no schema plataforma; travas de
 * auditoria (só inserção), arquivo imutável, licença só leitura (D12) e login pelo slug (T-0004).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEMAS } from '../src/index.ts';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  falha,
  executar,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
  SEM_SUPERUSUARIO,
  tabelasDos,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const A = novoTenant('empresa-a');
const B = novoTenant('empresa-b');

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — plataforma (T-0003, lote 1)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixturePlataforma(B));
  });

  afterAll(() => banco?.remover());

  it('roda com o admin esperado (o passo sem superusuário imita o DBaaS)', () => {
    const [eu] = consultar<{ rolsuper: boolean }>(
      banco.conexao,
      'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    expect(eu?.rolsuper).toBe(!SEM_SUPERUSUARIO);
  });

  it('cria os três papéis sem superusuário, sem BYPASSRLS e sem CREATEROLE', () => {
    const papeis = consultar<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      banco.conexao,
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles
       WHERE rolname IN ('macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura') ORDER BY 1`,
    );
    expect(papeis.map((p) => p.rolname)).toEqual(['macuxierp_app', 'macuxierp_leitura', 'macuxierp_worker']);
    for (const p of papeis)
      expect([p.rolsuper, p.rolbypassrls, p.rolcreaterole, p.rolcreatedb]).toEqual([
        false,
        false,
        false,
        false,
      ]);
  });

  it('tem um schema por módulo, mais plataforma, e nenhum papel da aplicação é dono de nada', () => {
    const esquemas = consultar<{ nspname: string }>(
      banco.conexao,
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY ('{${SCHEMAS.join(',')}}') ORDER BY 1`,
    ).map((e) => e.nspname);
    expect(esquemas).toEqual([...SCHEMAS].sort());
    const donos = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM pg_class k JOIN pg_roles r ON r.oid = k.relowner
       WHERE r.rolname IN ('macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura')`,
    );
    expect(donos[0]?.n).toBe(0);
  });

  it('toda tabela tem id, tenant_id, created_at, updated_at, deleted_at e external_id, com RLS ligada e política e external_id único por tenant', () => {
    const tabelas = tabelasDos(banco.conexao, SCHEMAS);
    expect(tabelas.length).toBeGreaterThan(0);
    const problemas = consultar<{ t: string; problema: string }>(
      banco.conexao,
      `WITH t AS (
         SELECT k.oid, n.nspname || '.' || k.relname AS t, k.relrowsecurity FROM pg_class k
         JOIN pg_namespace n ON n.oid = k.relnamespace
         WHERE k.relkind IN ('r', 'p') AND n.nspname = ANY ('{${SCHEMAS.join(',')}}')
       ), esperado(coluna, tipo) AS (VALUES ('id', 'uuid'), ('tenant_id', 'uuid'), ('created_at', 'timestamp with time zone'),
         ('updated_at', 'timestamp with time zone'), ('deleted_at', 'timestamp with time zone'), ('external_id', 'text'))
       SELECT t.t, 'sem coluna ' || e.coluna || ' ' || e.tipo AS problema FROM t CROSS JOIN esperado e
       WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attname = e.coluna
         AND NOT a.attisdropped AND format_type(a.atttypid, a.atttypmod) = e.tipo)
       UNION ALL SELECT t.t, 'RLS desligada' FROM t WHERE NOT t.relrowsecurity
       UNION ALL SELECT t.t, 'sem política isolamento_tenant' FROM t
         WHERE NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = t.oid AND p.polname = 'isolamento_tenant')
       UNION ALL SELECT t.t, 'sem trigger de updated_at' FROM t
         WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = t.oid AND g.tgname = 'tocar_updated_at')
       UNION ALL SELECT t.t, 'tenant_id ou id sem NOT NULL' FROM t
         WHERE EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attname IN ('id', 'tenant_id') AND NOT a.attnotnull)
       UNION ALL SELECT t.t, 'sem índice único (tenant_id, external_id)' FROM t WHERE NOT EXISTS (SELECT 1 FROM pg_index i
         WHERE i.indrelid = t.oid AND i.indisunique
           AND pg_get_indexdef(i.indexrelid) ~ '\\(tenant_id, external_id\\) WHERE \\(external_id IS NOT NULL\\)')`,
    );
    expect(problemas).toEqual([]);
  });

  it('sem float nem numeric: dinheiro em centavos (bigint) e quantidade em escala 4', () => {
    const colunas = consultar<{ coluna: string; tipo: string }>(
      banco.conexao,
      `SELECT table_schema || '.' || table_name || '.' || column_name AS coluna, data_type AS tipo
       FROM information_schema.columns WHERE table_schema = ANY ('{${SCHEMAS.join(',')}}')
         AND (data_type IN ('real', 'double precision', 'numeric', 'money')
           OR (column_name LIKE '%centavos' AND data_type <> 'bigint'))`,
    );
    expect(colunas).toEqual([]);
  });

  it('não vaza entre tenants em nenhuma tabela da plataforma, para nenhum papel', () => {
    expect(verificarVazamento(banco.conexao, ['plataforma'], A.id, B.id)).toEqual([]);
  });

  it('o teste de vazamento acusa tabela sem RLS e política aberta (prova do próprio teste)', () => {
    rodarScript(banco.conexao, 'ALTER TABLE plataforma.trabalho DISABLE ROW LEVEL SECURITY;');
    rodarScript(banco.conexao, 'CREATE POLICY aberta ON plataforma.sessao USING (true);');
    try {
      const problemas = verificarVazamento(banco.conexao, ['plataforma'], A.id, B.id);
      expect(problemas).toContain('plataforma.trabalho (macuxierp_app): VAZOU 1 linha(s) de outro tenant');
      expect(problemas).toContain('plataforma.sessao (macuxierp_app): VAZOU 1 linha(s) de outro tenant');
      expect(problemas.some((p) => p.startsWith('plataforma.trabalho: o app moveu linha'))).toBe(true);
    } finally {
      rodarScript(banco.conexao, 'ALTER TABLE plataforma.trabalho ENABLE ROW LEVEL SECURITY;');
      rodarScript(banco.conexao, 'DROP POLICY aberta ON plataforma.sessao;');
    }
  });

  it('o app não grava linha em nome de outro tenant', () => {
    const erro = falha(() =>
      executar(
        banco.conexao,
        `INSERT INTO plataforma.trabalho (tenant_id, tipo) VALUES ('${B.id}', 'teste');`,
        {
          papel: 'macuxierp_app',
          tenant: A.id,
        },
      ),
    );
    expect(erro).toMatch(/row-level security/);
  });

  it('licença e tenant: o app só lê (D12)', () => {
    const ctx = { papel: 'macuxierp_app', tenant: A.id };
    expect(consultar(banco.conexao, 'SELECT modulo FROM plataforma.tenant_modulo ORDER BY 1', ctx)).toEqual([
      { modulo: 'cadastros' },
      { modulo: 'core' },
    ]);
    expect(
      falha(() => executar(banco.conexao, `UPDATE plataforma.tenant_modulo SET ativo = false;`, ctx)),
    ).toMatch(/permission denied/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${A.id}', 'fiscal');`,
          ctx,
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      falha(() => executar(banco.conexao, `UPDATE plataforma.tenant SET situacao = 'ativo';`, ctx)),
    ).toMatch(/permission denied/);
  });

  it('login: o app acha o tenant pelo slug antes de ter tenant na sessão, e só o id', () => {
    const [r] = consultar<{ id: string | null }>(
      banco.conexao,
      `SELECT plataforma.tenant_por_slug(' Empresa-A ') AS id`,
      {
        papel: 'macuxierp_app',
      },
    );
    expect(r?.id).toBe(A.id);
    const [ref] = consultar<{ id: string | null }>(
      banco.conexao,
      `SELECT plataforma.tenant_por_slug('referencia') AS id`,
      {
        papel: 'macuxierp_app',
      },
    );
    expect(ref?.id).toBeNull();
    expect(
      falha(() =>
        consultar(banco.conexao, `SELECT plataforma.tenant_por_slug('empresa-a')`, {
          papel: 'macuxierp_leitura',
        }),
      ),
    ).toMatch(/permission denied/);
  });

  it('com o tenant na sessão, o app lê a própria linha de plataforma.tenant (adaptador do login, T-0004)', () => {
    expect(
      consultar(banco.conexao, 'SELECT id, slug, nome, fuso, situacao FROM plataforma.tenant', {
        papel: 'macuxierp_app',
        tenant: A.id,
      }),
    ).toEqual([
      { id: A.id, slug: 'empresa-a', nome: 'Empresa empresa-a', fuso: 'America/Manaus', situacao: 'ativo' },
    ]);
  });

  it('plataforma.tenant não tem a chave (tenant_id, id), que repetiria a PK', () => {
    const indices = consultar<{ i: string }>(
      banco.conexao,
      `SELECT indexname AS i FROM pg_indexes WHERE schemaname = 'plataforma' AND tablename = 'tenant' ORDER BY 1`,
    ).map((r) => r.i);
    expect(indices).not.toContain('tenant_tenant_id_uq');
    expect(indices).toContain('tenant_pkey');
  });

  it('CNPJ e SHA-256 usam os tipos comuns plataforma.cnpj e plataforma.sha256_hex', () => {
    const colunas = consultar<{ c: string; d: string }>(
      banco.conexao,
      `SELECT c.table_schema || '.' || c.table_name || '.' || c.column_name AS c, c.domain_name AS d
       FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.domain_schema = 'plataforma' AND t.table_type = 'BASE TABLE' ORDER BY 2, 1`,
    );
    expect(colunas).toEqual([
      { c: 'cadastros.filial.cnpj', d: 'cnpj' },
      { c: 'core.certificado.cnpj', d: 'cnpj' },
      { c: 'core.empresa.cnpj', d: 'cnpj' },
      { c: 'sefaz_simulador.inutilizacao.cnpj', d: 'cnpj' },
      { c: 'sefaz_simulador.nota.cnpj', d: 'cnpj' },
      { c: 'cadastros.tabela_oficial_versao.sha256', d: 'sha256_hex' },
      { c: 'core.certificado.impressao_digital', d: 'sha256_hex' },
      { c: 'faturamento.nota_xml.sha256', d: 'sha256_hex' },
      // T-0059 (0057): o hash do pré-cadastro recebido e o do corpo do retorno.
      { c: 'integracao_fdv.cliente_recebido.hash', d: 'sha256_hex' },
      { c: 'integracao_fdv.cliente_retorno.hash', d: 'sha256_hex' },
      { c: 'integracao_fdv.lote_envio.chave_idempotencia', d: 'sha256_hex' },
      { c: 'integracao_fdv.pedido_recebido.hash', d: 'sha256_hex' },
      { c: 'integracao_fdv.registro_publicado.hash', d: 'sha256_hex' },
      { c: 'integracao_fdv.registro_publicado.hash_confirmado', d: 'sha256_hex' },
      { c: 'integracao_fdv.retorno_enviado.hash', d: 'sha256_hex' },
      { c: 'plataforma.arquivo.sha256', d: 'sha256_hex' },
      { c: 'plataforma.idempotencia.hash_corpo', d: 'sha256_hex' },
      { c: 'plataforma.sessao.refresh_hash', d: 'sha256_hex' },
      // T-0050 (0033): token da sessão do superadmin (portal /config), só o SHA-256.
      { c: 'plataforma.sessao_superadmin.token_hash', d: 'sha256_hex' },
    ]);
    expect(
      falha(() =>
        executar(banco.conexao, `UPDATE plataforma.idempotencia SET hash_corpo = repeat('A', 64);`, {
          papel: 'macuxierp_app',
          tenant: A.id,
        }),
      ),
    ).toMatch(/sha256_hex/);
  });

  it('a leitura não vê a resposta guardada da idempotência (pode trazer dado pessoal)', () => {
    const ctx = { papel: 'macuxierp_leitura', tenant: A.id };
    expect(consultar(banco.conexao, 'SELECT chave FROM plataforma.idempotencia', ctx)).toEqual([
      { chave: 'chave-0001' },
    ]);
    expect(
      falha(() => consultar(banco.conexao, 'SELECT resposta FROM plataforma.idempotencia', ctx)),
    ).toMatch(/permission denied/);
  });

  it('auditoria é só de inserção, até para o dono', () => {
    expect(falha(() => executar(banco.conexao, 'UPDATE plataforma.auditoria SET acao = acao;'))).toMatch(
      /só de inserção/,
    );
    expect(falha(() => executar(banco.conexao, 'DELETE FROM plataforma.auditoria;'))).toMatch(
      /só de inserção/,
    );
    expect(falha(() => executar(banco.conexao, 'TRUNCATE plataforma.auditoria;'))).toMatch(/só de inserção/);
    expect(
      falha(() =>
        executar(banco.conexao, 'UPDATE plataforma.auditoria SET acao = acao;', {
          papel: 'macuxierp_app',
          tenant: A.id,
        }),
      ),
    ).toMatch(/permission denied/);
  });

  it('arquivo imutável não muda nem sai (XML autorizado, regra 7)', () => {
    const ctx = { papel: 'macuxierp_app', tenant: A.id };
    executar(
      banco.conexao,
      `INSERT INTO plataforma.arquivo (tenant_id, chave_s3, tipo, sha256, tamanho, imutavel, guarda_ate)
       VALUES ('${A.id}', 'macuxierp/${A.id}/nfe/1.xml', 'nfe_xml', repeat('d', 64), 100, true, '2031-12-31');`,
      ctx,
    );
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE plataforma.arquivo SET sha256 = repeat('e', 64) WHERE imutavel;`,
          ctx,
        ),
      ),
    ).toMatch(/imutável/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE plataforma.arquivo SET guarda_ate = '2027-01-01' WHERE imutavel;`,
          ctx,
        ),
      ),
    ).toMatch(/imutável/);
    expect(falha(() => executar(banco.conexao, `DELETE FROM plataforma.arquivo WHERE imutavel;`))).toMatch(
      /imutável/,
    );
    executar(banco.conexao, `UPDATE plataforma.arquivo SET guarda_ate = '2035-12-31' WHERE imutavel;`, ctx);
  });

  it('o worker despacha a outbox de todos os tenants, mas só nas colunas de controle', () => {
    const ctx = { papel: 'macuxierp_worker' };
    const pendentes = consultar<{ tenant_id: string }>(
      banco.conexao,
      'SELECT tenant_id FROM plataforma.evento WHERE publicado_em IS NULL ORDER BY ocorrido_em',
      ctx,
    );
    expect(new Set(pendentes.map((p) => p.tenant_id))).toEqual(new Set([A.id, B.id]));
    executar(
      banco.conexao,
      `UPDATE plataforma.evento SET publicado_em = now(), tentativas = tentativas + 1 WHERE id = '${B.evento}';`,
      ctx,
    );
    expect(falha(() => executar(banco.conexao, `UPDATE plataforma.evento SET payload = '{}';`, ctx))).toMatch(
      /permission denied/,
    );
    expect(falha(() => consultar(banco.conexao, 'SELECT count(*) FROM plataforma.sessao', ctx))).toMatch(
      /permission denied/,
    );
  });

  it('a leitura não vê sessão nem o hash da senha', () => {
    const ctx = { papel: 'macuxierp_leitura', tenant: A.id };
    expect(consultar(banco.conexao, 'SELECT email FROM plataforma.usuario', ctx)).toEqual([
      { email: 'adm@empresa-a.teste' },
    ]);
    expect(falha(() => consultar(banco.conexao, 'SELECT senha_hash FROM plataforma.usuario', ctx))).toMatch(
      /permission denied/,
    );
    expect(falha(() => consultar(banco.conexao, 'SELECT count(*) FROM plataforma.sessao', ctx))).toMatch(
      /permission denied/,
    );
  });

  it('nenhum papel da aplicação enxerga o schema controle', () => {
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      expect(
        falha(() => consultar(banco.conexao, 'SELECT count(*) FROM controle.migracao', { papel })),
      ).toMatch(/permission denied/);
    }
  });

  it('e-mail gravado normalizado e único por tenant (D2)', () => {
    const ctx = { papel: 'macuxierp_app', tenant: A.id };
    const inserir = (email: string) =>
      `INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil)
       VALUES ('${A.id}', '${email}', 'Outro', '$argon2id$x', 'leitura');`;
    expect(falha(() => executar(banco.conexao, inserir('Adm@Empresa-A.teste'), ctx))).toMatch(
      /check constraint/,
    );
    expect(falha(() => executar(banco.conexao, inserir('adm@empresa-a.teste'), ctx))).toMatch(
      /duplicate key/,
    );
    executar(
      banco.conexao,
      inserir('adm@empresa-a.teste').replace(`'${A.id}'`, `'${B.id}'`).replace('adm@', 'outro@'),
      {
        papel: 'macuxierp_app',
        tenant: B.id,
      },
    );
  });

  it('reaplicar não faz nada, e migração aplicada que mudou é recusada', () => {
    expect(migrar(banco.conexao, { oficiais: false })).toEqual([]);
    const [primeira] = listarMigracoes();
    rodarScript(
      banco.conexao,
      `UPDATE controle.migracao SET sha256 = repeat('0', 64) WHERE nome = '${primeira?.nome}';`,
    );
    expect(() => migrar(banco.conexao, { oficiais: false })).toThrow(/mudou depois de aplicada/);
    rodarScript(
      banco.conexao,
      `UPDATE controle.migracao SET sha256 = '${primeira?.sha256}' WHERE nome = '${primeira?.nome}';`,
    );
  });
});
