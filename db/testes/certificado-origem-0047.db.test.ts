/**
 * T-0080 (v0.3.10), migração 0047 (RN-CORE-08, ADR 0006; RN-CORE-06, ADR 0005): core.certificado.origem ('upload' ou
 * 'teste', padrão 'upload') e o gatilho core.ambiente_fiscal_a1_real: a filial não vai para produção com o A1 vigente
 * de origem 'teste' (MXA01, DETAIL a1_de_teste), para todos os papéis e para o dono (o operador). A volta para
 * homologação nunca é barrada. A mesma função, no gatilho certificado_a1_real de core.certificado, recusa o A1 de
 * teste vigente numa filial já em produção (MXA01, DETAIL a1_de_teste_em_producao).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  falhaDetalhada,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  verboso,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = '0047_core_certificado_origem.sql';
const A = novoTenant('cert-origem-0047-a');
const B = novoTenant('cert-origem-0047-b');
const C = novoTenant('cert-origem-0047-c');
const RECADO = 'R-20261123-120000-alexandre';
const MXA01 = /MXA01: certificado A1 de teste não pode ir para produção; envie o certificado real$/;
const MXA01_EM_PRODUCAO =
  /MXA01: certificado A1 de teste não pode ser usado em filial em produção; envie o certificado real$/;
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const PAPEIS = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
const TABELAS = ['core.certificado', 'core.ambiente_fiscal'] as const;

/** INSERT de um A1 (como dono); `origem` omitida = a coluna fica de fora do INSERT. */
const sqlCertificado = (tenant: string, filial: string, origem?: string): string =>
  `INSERT INTO core.certificado (tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital,
     pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce${origem === undefined ? '' : ', origem'})
   VALUES ('${tenant}', '${filial}', 'TITULAR FICTICIO', '12345678000195', now(), now() + interval '1 year',
     repeat('d', 64), '\\x00', decode(repeat('03', 12), 'hex'), '\\x00', decode(repeat('04', 12), 'hex')
     ${origem === undefined ? '' : `, '${origem}'`});`;
const paraProducao = (tenant: string, filial: string): string =>
  `UPDATE core.ambiente_fiscal SET ambiente = 'producao', recado_aprovacao = '${RECADO}'
   WHERE tenant_id = '${tenant}' AND filial_id = '${filial}';`;
const homologacao = (tenant: string, filial: string): string =>
  `INSERT INTO core.ambiente_fiscal (tenant_id, filial_id) VALUES ('${tenant}', '${filial}');`;

/** Privilégios por tabela e por coluna de interesse (resumo do certificado e as cifradas). */
function retrato(b: BancoDeTeste): Record<string, string> {
  const r: Record<string, string> = {};
  for (const p of PAPEIS) for (const t of TABELAS) r[`${p} ${t}`] = privilegiosDe(b.conexao, p, t);
  const [col] = consultar<Record<string, boolean>>(
    b.conexao,
    `SELECT ${PAPEIS.flatMap((p) =>
      ['pfx_cifrado', 'senha_cifrada', 'ativo', 'titular'].flatMap((c) =>
        ['SELECT', 'UPDATE'].map(
          (v) => `has_column_privilege('${p}', 'core.certificado', '${c}', '${v}') AS "${p} ${c} ${v}"`,
        ),
      ),
    ).join(', ')}`,
  );
  for (const [k, v] of Object.entries(col ?? {})) r[k] = String(v);
  return r;
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — origem do A1 e produção fiscal (T-0080, 0047)', () => {
  let banco: BancoDeTeste;
  const ambiente = (tenant: string, filial: string): string | undefined =>
    consultar<{ ambiente: string }>(
      banco.conexao,
      `SELECT ambiente FROM core.ambiente_fiscal WHERE tenant_id = '${tenant}' AND filial_id = '${filial}'`,
    )[0]?.ambiente;
  const origem = (tenant: string, filial: string): string | undefined =>
    consultar<{ origem: string }>(
      banco.conexao,
      `SELECT origem FROM core.certificado WHERE tenant_id = '${tenant}' AND filial_id = '${filial}' AND ativo`,
    )[0]?.origem;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      fixturePlataforma(A) + fixtureModulos(A) + fixturePlataforma(B) + fixtureModulos(B),
    );
  });

  afterAll(() => banco?.remover());

  it('(a) A1 novo sem origem fica upload; o app também grava sem a coluna', () => {
    const f = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, f));
    expect(origem(A.id, f)).toBe('upload');
    const g = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, g).replace(`'${A.id}'`, 'plataforma.tenant_atual()'), APP_A);
    expect(origem(A.id, g)).toBe('upload');
    expect(origem(A.id, A.filial)).toBe('upload');
  });

  it('(b) origem fora de upload e teste é recusada (certificado_origem_ck, 23514); nula também', () => {
    recusaDetalhada(
      banco.conexao,
      sqlCertificado(A.id, randomUUID(), 'real'),
      '23514',
      /certificado_origem_ck/,
    );
    recusaDetalhada(
      banco.conexao,
      sqlCertificado(A.id, randomUUID(), 'Teste'),
      '23514',
      /certificado_origem_ck/,
    );
    recusaDetalhada(
      banco.conexao,
      `UPDATE core.certificado SET origem = NULL WHERE tenant_id = '${A.id}' AND filial_id = '${A.filial}';`,
      '23502',
      /origem/,
    );
    executar(banco.conexao, sqlCertificado(A.id, randomUUID(), 'teste'));
  });

  it('(c) a ida para produção com o A1 vigente de teste é recusada (MXA01), no UPDATE e no INSERT, pelo dono', () => {
    const f = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, f, 'teste') + homologacao(A.id, f));
    recusaDetalhada(banco.conexao, paraProducao(A.id, f), 'MXA01', MXA01);
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(paraProducao(A.id, f))));
    expect(e.saida).toMatch(/DETAIL:\s+a1_de_teste/);
    // Sem dado do certificado nem do titular na saída (LGPD, RN-CORE-07).
    expect(e.saida).not.toMatch(/TITULAR|12345678000195|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(ambiente(A.id, f)).toBe('homologacao');

    const g = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, g, 'teste'));
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao)
       VALUES ('${A.id}', '${g}', 'producao', '${RECADO}');`,
      'MXA01',
      MXA01,
    );
    expect(ambiente(A.id, g)).toBeUndefined();

    // Reativar (tirar o deleted_at) uma linha em produção com A1 de teste também é ida para produção.
    const h = randomUUID();
    executar(
      banco.conexao,
      `${sqlCertificado(A.id, h, 'teste')}
       INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao, deleted_at)
       VALUES ('${A.id}', '${h}', 'producao', '${RECADO}', now());`,
    );
    recusaDetalhada(
      banco.conexao,
      `UPDATE core.ambiente_fiscal SET deleted_at = NULL WHERE tenant_id = '${A.id}' AND filial_id = '${h}';`,
      'MXA01',
      MXA01,
    );
  });

  it('(d) com o A1 vigente de upload a troca passa; trocar o de teste pelo real libera a filial', () => {
    const f = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, f, 'upload') + homologacao(A.id, f));
    executar(banco.conexao, paraProducao(A.id, f));
    expect(ambiente(A.id, f)).toBe('producao');

    const g = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, g, 'teste') + homologacao(A.id, g));
    executar(
      banco.conexao,
      `UPDATE core.certificado SET ativo = false, substituido_em = now()
       WHERE tenant_id = '${A.id}' AND filial_id = '${g}' AND ativo;
       ${sqlCertificado(A.id, g)}
       ${paraProducao(A.id, g)}`,
    );
    expect(ambiente(A.id, g)).toBe('producao');

    // Filial sem A1 vigente não é barrada aqui (a emissão já para por falta de certificado).
    const h = randomUUID();
    executar(banco.conexao, homologacao(A.id, h) + paraProducao(A.id, h));
    expect(ambiente(A.id, h)).toBe('producao');

    // O A1 de teste de outro tenant, na mesma filial, não conta.
    const x = randomUUID();
    executar(
      banco.conexao,
      sqlCertificado(B.id, x, 'teste') + sqlCertificado(A.id, x) + homologacao(A.id, x),
    );
    executar(banco.conexao, paraProducao(A.id, x));
    expect(ambiente(A.id, x)).toBe('producao');
  });

  it('(e) a volta para homologação não é barrada, nem com o A1 de teste vigente (dono e app)', () => {
    const f = randomUUID();
    const g = randomUUID();
    // O estado "produção com A1 de teste vigente" não se forma mais (gatilho certificado_a1_real): o dono o força aqui
    // com o gatilho desligado, só para provar que a volta passa.
    executar(
      banco.conexao,
      `${sqlCertificado(A.id, f)}${homologacao(A.id, f)}${paraProducao(A.id, f)}
       ${sqlCertificado(A.id, g)}${homologacao(A.id, g)}${paraProducao(A.id, g)}
       UPDATE core.certificado SET ativo = false, substituido_em = now()
       WHERE tenant_id = '${A.id}' AND filial_id IN ('${f}', '${g}') AND ativo;
       BEGIN;
       ALTER TABLE core.certificado DISABLE TRIGGER certificado_a1_real;
       ${sqlCertificado(A.id, f, 'teste')}${sqlCertificado(A.id, g, 'teste')}
       ALTER TABLE core.certificado ENABLE TRIGGER certificado_a1_real;
       COMMIT;`,
    );
    executar(
      banco.conexao,
      `UPDATE core.ambiente_fiscal SET ambiente = 'homologacao' WHERE tenant_id = '${A.id}' AND filial_id = '${f}';`,
    );
    expect(ambiente(A.id, f)).toBe('homologacao');
    executar(
      banco.conexao,
      `UPDATE core.ambiente_fiscal SET ambiente = 'homologacao', alterado_por = '${randomUUID()}'
       WHERE filial_id = '${g}';`,
      APP_A,
    );
    expect(ambiente(A.id, g)).toBe('homologacao');
  });

  it('(g) A1 de teste vigente numa filial já em produção é recusado (MXA01), no INSERT e no UPDATE, pelo dono', () => {
    const f = randomUUID();
    executar(
      banco.conexao,
      `${sqlCertificado(A.id, f)}${homologacao(A.id, f)}${paraProducao(A.id, f)}
       UPDATE core.certificado SET ativo = false, substituido_em = now()
       WHERE tenant_id = '${A.id}' AND filial_id = '${f}' AND ativo;`,
    );
    recusaDetalhada(banco.conexao, sqlCertificado(A.id, f, 'teste'), 'MXA01', MXA01_EM_PRODUCAO);
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(sqlCertificado(A.id, f, 'teste'))));
    expect(e.saida).toMatch(/DETAIL:\s+a1_de_teste_em_producao/);
    expect(e.saida).not.toMatch(/TITULAR|12345678000195|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(origem(A.id, f)).toBeUndefined();
    // O A1 real (upload) entra na filial em produção.
    executar(banco.conexao, sqlCertificado(A.id, f, 'upload'));
    expect(origem(A.id, f)).toBe('upload');

    // UPDATE: reativar, tirar o deleted_at ou mudar de filial ou de tenant um A1 de teste para uma filial em produção.
    const g = randomUUID();
    executar(
      banco.conexao,
      `${homologacao(A.id, g)}${sqlCertificado(A.id, g, 'teste')}
       UPDATE core.certificado SET ativo = false, substituido_em = now()
       WHERE tenant_id = '${A.id}' AND filial_id = '${g}' AND ativo;
       ${sqlCertificado(A.id, g, 'teste')}
       UPDATE core.certificado SET deleted_at = now()
       WHERE tenant_id = '${A.id}' AND filial_id = '${g}' AND ativo;
       ${paraProducao(A.id, g)}`,
    );
    expect(ambiente(A.id, g)).toBe('producao');
    recusaDetalhada(
      banco.conexao,
      `UPDATE core.certificado SET ativo = true
       WHERE tenant_id = '${A.id}' AND filial_id = '${g}' AND NOT ativo AND deleted_at IS NULL;`,
      'MXA01',
      MXA01_EM_PRODUCAO,
    );
    recusaDetalhada(
      banco.conexao,
      `UPDATE core.certificado SET deleted_at = NULL
       WHERE tenant_id = '${A.id}' AND filial_id = '${g}' AND deleted_at IS NOT NULL;`,
      'MXA01',
      MXA01_EM_PRODUCAO,
    );
    const h = randomUUID();
    executar(banco.conexao, sqlCertificado(A.id, h, 'teste'));
    recusaDetalhada(
      banco.conexao,
      `UPDATE core.certificado SET filial_id = '${g}' WHERE tenant_id = '${A.id}' AND filial_id = '${h}';`,
      'MXA01',
      MXA01_EM_PRODUCAO,
    );
    executar(banco.conexao, sqlCertificado(B.id, g, 'teste'));
    recusaDetalhada(
      banco.conexao,
      `UPDATE core.certificado SET tenant_id = '${A.id}' WHERE tenant_id = '${B.id}' AND filial_id = '${g}';`,
      'MXA01',
      MXA01_EM_PRODUCAO,
    );
    expect(origem(A.id, h)).toBe('teste');
  });

  it('(h) A1 de teste em homologação é aceito; produção apagada ou de outro tenant não conta', () => {
    const f = randomUUID();
    executar(banco.conexao, homologacao(A.id, f) + sqlCertificado(A.id, f, 'teste'));
    expect(origem(A.id, f)).toBe('teste');

    // Filial com a linha de produção apagada (deleted_at) não está em produção.
    const g = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao, deleted_at)
       VALUES ('${A.id}', '${g}', 'producao', '${RECADO}', now());
       ${sqlCertificado(A.id, g, 'teste')}`,
    );
    expect(origem(A.id, g)).toBe('teste');

    // A produção de outro tenant, na mesma filial, não conta; nem o A1 de teste inativo ou apagado.
    const x = randomUUID();
    executar(banco.conexao, homologacao(B.id, x) + paraProducao(B.id, x) + sqlCertificado(A.id, x, 'teste'));
    expect(origem(A.id, x)).toBe('teste');
    const inativo = sqlCertificado(B.id, x, 'teste')
      .replace(', origem)', ', origem, ativo)')
      .replace(", 'teste')", ", 'teste', false)");
    executar(banco.conexao, inativo);
    expect(
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM core.certificado
         WHERE tenant_id = '${B.id}' AND filial_id = '${x}' AND origem = 'teste' AND NOT ativo`,
      )[0]?.n,
    ).toBe(1);
  });

  it('(f) os gatilhos e a função única: DEFINER, search_path fixo, sem EXECUTE para PUBLIC; origem fora do UPDATE', () => {
    const [r] = consultar<{
      definer: boolean;
      config: string[];
      publico: boolean;
      gatilhos: string;
      comentario: boolean;
    }>(
      banco.conexao,
      `SELECT p.prosecdef AS definer, p.proconfig AS config,
              has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
              (SELECT string_agg(t.tgrelid::regclass || '.' || t.tgname, ' ' ORDER BY t.tgname) FROM pg_trigger t
                 WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS gatilhos,
              obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentario
       FROM pg_proc p WHERE p.oid = 'core.ambiente_fiscal_a1_real()'::regprocedure`,
    );
    expect(r).toEqual({
      definer: true,
      config: ['search_path=pg_catalog, pg_temp'],
      publico: false,
      gatilhos: 'core.ambiente_fiscal.ambiente_fiscal_a1_real core.certificado.certificado_a1_real',
      comentario: true,
    });
    const [c] = consultar<Record<string, boolean>>(
      banco.conexao,
      `SELECT has_column_privilege('macuxierp_app', 'core.certificado', 'origem', 'SELECT') AS app_le,
              has_column_privilege('macuxierp_app', 'core.certificado', 'origem', 'UPDATE') AS app_altera,
              has_column_privilege('macuxierp_worker', 'core.certificado', 'origem', 'UPDATE') AS worker_altera,
              has_column_privilege('macuxierp_leitura', 'core.certificado', 'origem', 'SELECT') AS leitura_le,
              col_description('core.certificado'::regclass,
                (SELECT attnum FROM pg_attribute WHERE attrelid = 'core.certificado'::regclass AND attname = 'origem'))
                IS NOT NULL AS comentada`,
    );
    expect(c).toEqual({
      app_le: true,
      app_altera: false,
      worker_altera: false,
      leitura_le: false,
      comentada: true,
    });
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE core.certificado SET origem = 'upload' WHERE filial_id = '${A.filial}';`,
          APP_A,
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — 0047 sobre linhas e privilégios anteriores (T-0080)',
  () => {
    let banco: BancoDeTeste;
    let anteriores: PastaDeMigracoes;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      anteriores = pastaComMigracoesAntesDe('0047');
    });

    afterAll(() => {
      banco?.remover();
      anteriores?.remover();
    });

    it('(a) as linhas existentes ficam upload; (f) os privilégios por tabela e das colunas antigas não mudam', () => {
      expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
      permitirSetRole(banco.conexao);
      executar(banco.conexao, fixturePlataforma(C) + fixtureModulos(C) + sqlCertificado(C.id, randomUUID()));
      const antes = retrato(banco);

      expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
      const linhasA1 = consultar<{ origem: string }>(
        banco.conexao,
        `SELECT origem FROM core.certificado WHERE tenant_id = '${C.id}'`,
      );
      expect(linhasA1.map((l) => l.origem)).toEqual(['upload', 'upload']);
      expect(retrato(banco)).toEqual(antes);
      expect(antes['macuxierp_app pfx_cifrado SELECT']).toBe('false');
      expect(antes['macuxierp_leitura core.certificado']).toBe('-');
    });
  },
);
