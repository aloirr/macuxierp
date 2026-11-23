/**
 * T-0050, migração 0035: dados da empresa no portal /config (ADR 0012 §4, com a emenda do engenheiro-software).
 * mascarar_email, empresa_json com razão social, CNPJ, cidade e UF da filial padrão e o e-mail mascarado do 1º
 * administrador, e a função de revelar o e-mail (só macuxierp_config, auditada sem o e-mail).
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
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0035_plataforma_empresa_dados.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const PAPEIS = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
const REVELAR = 'plataforma.empresa_primeiro_admin_email(uuid, text)';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000035';
const VERSAO = '0f000000-0000-4000-8000-000000000035';

/** A: core.empresa e filial padrão em Manaus; B: só plataforma; C: sem administrador ativo. Dados fictícios. */
const A = novoTenant('dados-0035-a');
const B = novoTenant('dados-0035-b');
const C = novoTenant('dados-0035-c');
const emailDe = (slug: string): string => `adm@${slug}.teste`;

interface Empresa {
  id: string;
  razao_social: string | null;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  primeiro_admin: { id: string; ativo: boolean; bloqueado: boolean; email_mascarado: string } | null;
  [k: string]: unknown;
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — dados da empresa no portal /config (T-0050, 0035)', () => {
  let banco: BancoDeTeste;

  const sessaoSql = (sessao: string | null): string =>
    sessao === null ? '' : `SET LOCAL macuxierp.sessao_superadmin = '${sessao}';\n`;
  const comoConfig = (sessao: string | null, sql: string): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
  const empresa = (sessao: string, id: string): Empresa =>
    JSON.parse(comoConfig(sessao, `SELECT plataforma.empresa_ler('${id}');`)[0] ?? 'null') as Empresa;
  const recusaConfig = (sessao: string | null, sql: string, codigo: string, padrao: RegExp): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });
  const novaSessao = (): string => {
    const id = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ('${id}', '${SA}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    return id;
  };
  const mascara = (valor: string | null): unknown =>
    consultar<{ m: unknown }>(
      banco.conexao,
      `SELECT plataforma.mascarar_email(${valor === null ? 'NULL' : `'${valor}'`}) AS m`,
    )[0]?.m;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}${fixtureModulos(A)}${fixturePlataforma(B)}${fixturePlataforma(C)}
UPDATE plataforma.usuario SET ativo = false WHERE tenant_id = '${C.id}';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0035@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO cadastros.tabela_oficial_versao (id, tabela, carga, versao, fonte, url, data_referencia, arquivo, sha256,
  registros)
  VALUES ('${VERSAO}', 'municipio', 'municipio-teste', 't-0035', 'IBGE (teste)', 'https://exemplo.teste', '2026-01-01',
    'municipio.csv', repeat('d', 64), 2);
INSERT INTO cadastros.municipio (codigo, nome, uf, vigencia_inicio, vigencia_fim, versao_id) VALUES
  ('1302603', 'Nome Antigo', 'AM', '2000-01-01', '2019-12-31', '${VERSAO}'),
  ('1302603', 'Manaus', 'AM', '2020-01-01', NULL, '${VERSAO}');`,
    );
  });

  afterAll(() => banco?.remover());

  it('mascarar_email: 2 caracteres + "****@" + domínio; local de 1 ou 2 caracteres vira "*"; NULL = NULL', () => {
    expect(mascara('douglas@gmail.com')).toBe('do****@gmail.com');
    expect(mascara('a@x.com.br')).toBe('*****@x.com.br');
    expect(mascara('ab@x.com.br')).toBe('*****@x.com.br');
    expect(mascara('abc@x.com.br')).toBe('ab****@x.com.br');
    expect(mascara('joao.silva@mail.empresa.com.br')).toBe('jo****@mail.empresa.com.br');
    expect(mascara('sem-arroba')).toBe('****');
    expect(mascara(null)).toBeNull();
    const [r] = consultar<{ imutavel: boolean }>(
      banco.conexao,
      `SELECT provolatile = 'i' AS imutavel FROM pg_proc WHERE oid = 'plataforma.mascarar_email(text)'::regprocedure`,
    );
    expect(r).toEqual({ imutavel: true });
  });

  it('empresa_json: razão social, CNPJ, cidade (município oficial vigente) e UF da filial padrão; e-mail só mascarado', () => {
    const s = novaSessao();
    const a = empresa(s, A.id);
    expect(a).toMatchObject({
      id: A.id,
      slug: A.slug,
      razao_social: `Empresa ${A.slug}`,
      cnpj: '12345678000195',
      cidade: 'Manaus',
      uf: 'AM',
      primeiro_admin: {
        id: A.usuario,
        ativo: true,
        bloqueado: false,
        email_mascarado: 'ad****@dados-0035-a.teste',
      },
    });
    expect(JSON.stringify(a)).not.toContain(emailDe(A.slug));
    expect(Object.keys(a.primeiro_admin ?? {}).sort()).toEqual([
      'ativo',
      'bloqueado',
      'email_mascarado',
      'id',
    ]);

    // Sem core.empresa nem filial: os quatro campos null; o resto continua.
    const b = empresa(s, B.id);
    expect(b).toMatchObject({ razao_social: null, cnpj: null, cidade: null, uf: null, slug: B.slug });
    expect(b.primeiro_admin?.email_mascarado).toBe('ad****@dados-0035-b.teste');
    expect(JSON.stringify(b)).not.toContain(emailDe(B.slug));
    // Sem administrador ativo: primeiro_admin null.
    expect(empresa(s, C.id).primeiro_admin).toBeNull();
    // A listagem usa o mesmo json.
    const lista = comoConfig(s, `SELECT plataforma.empresas_listar('dados-0035', NULL, 50);`).map(
      (l) => JSON.parse(l) as Empresa,
    );
    expect(lista.find((e) => e.id === A.id)).toMatchObject({ cidade: 'Manaus', uf: 'AM' });
    expect(lista.map((e) => JSON.stringify(e)).join('\n')).not.toMatch(/adm@/);
  });

  it('empresa_json: filial não padrão, padrão excluída ou município fora da tabela oficial; core.empresa excluída', () => {
    const s = novaSessao();
    executar(
      banco.conexao,
      `UPDATE cadastros.filial SET municipio_ibge = '1300000' WHERE id = '${A.filial}';`,
    );
    expect(empresa(s, A.id)).toMatchObject({ cidade: null, uf: 'AM' });
    executar(
      banco.conexao,
      `UPDATE cadastros.filial SET municipio_ibge = '1302603', padrao = false WHERE id = '${A.filial}';`,
    );
    expect(empresa(s, A.id)).toMatchObject({ cidade: null, uf: null });
    executar(
      banco.conexao,
      `UPDATE cadastros.filial SET padrao = true, deleted_at = now() WHERE id = '${A.filial}';
       UPDATE core.empresa SET deleted_at = now() WHERE tenant_id = '${A.id}';`,
    );
    expect(empresa(s, A.id)).toMatchObject({ razao_social: null, cnpj: null, cidade: null, uf: null });
    executar(
      banco.conexao,
      `UPDATE cadastros.filial SET deleted_at = NULL WHERE id = '${A.filial}';
       UPDATE core.empresa SET deleted_at = NULL WHERE tenant_id = '${A.id}';`,
    );
    expect(empresa(s, A.id)).toMatchObject({ razao_social: `Empresa ${A.slug}`, cidade: 'Manaus', uf: 'AM' });
  });

  it('revelar o e-mail: só o config executa; devolve o completo e audita sem o e-mail', () => {
    const s = novaSessao();
    for (const papel of PAPEIS) {
      recusaDetalhada(
        banco.conexao,
        `${sessaoSql(s)}SELECT plataforma.empresa_primeiro_admin_email('${A.id}', 'r');`,
        '42501',
        /permission denied/,
        { papel, tenant: A.id },
      );
    }

    expect(
      comoConfig(s, `SELECT plataforma.empresa_primeiro_admin_email('${A.id}', 'req-revelar');`),
    ).toEqual([emailDe(A.slug)]);
    const auditoria = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT tenant_id, usuario_id, superadmin_id, entidade, entidade_id, request_id, antes, depois
       FROM plataforma.auditoria WHERE acao = 'plataforma.admin.revelar_email'`,
    );
    expect(auditoria).toEqual([
      {
        tenant_id: A.id,
        usuario_id: null,
        superadmin_id: SA,
        entidade: 'usuario',
        entidade_id: A.usuario,
        request_id: 'req-revelar',
        antes: null,
        depois: { campo: 'email' },
      },
    ]);
    const valores = JSON.stringify([auditoria[0]?.antes, auditoria[0]?.depois]);
    expect(valores).not.toContain(emailDe(A.slug));
    expect(valores).not.toContain('@');
  });

  it('revelar o e-mail: MXS01 sem sessão; P0002 sem administrador ou empresa inexistente; nada auditado', () => {
    const antes = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao = 'plataforma.admin.revelar_email'`,
    )[0]?.n;
    recusaConfig(
      null,
      `SELECT plataforma.empresa_primeiro_admin_email('${A.id}', 'r');`,
      'MXS01',
      /inválida/,
    );
    const s = novaSessao();
    recusaConfig(
      s,
      `SELECT plataforma.empresa_primeiro_admin_email('${C.id}', 'r');`,
      'P0002',
      /não tem administrador/,
    );
    recusaConfig(
      s,
      `SELECT plataforma.empresa_primeiro_admin_email('${randomUUID()}', 'r');`,
      'P0002',
      /não encontrada/,
    );
    expect(
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao = 'plataforma.admin.revelar_email'`,
      )[0]?.n,
    ).toBe(antes);
  });

  it('o config continua sem ler core.empresa, cadastros.filial e cadastros.municipio direto (42501)', () => {
    const s = novaSessao();
    for (const tabela of ['core.empresa', 'cadastros.filial', 'cadastros.municipio']) {
      recusaConfig(
        s,
        `SELECT plataforma.empresa_ler('${A.id}');\nSELECT count(*) FROM ${tabela};`,
        '42501',
        /permission denied/,
      );
    }
  });

  it('a 0035 reexecuta duas vezes sem erro e mantém privilégios e o json', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    const [r] = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT has_function_privilege('${CONFIG}', '${REVELAR}', 'EXECUTE') AS revelar,
         has_function_privilege('${CONFIG}', 'plataforma.empresa_json(uuid)', 'EXECUTE') AS json,
         has_function_privilege('macuxierp_app', '${REVELAR}', 'EXECUTE') AS app,
         (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
            AND proname IN ('mascarar_email', 'empresa_json', 'empresa_primeiro_admin_email')) AS n`,
    );
    expect(r).toEqual({ revelar: true, json: false, app: false, n: 3 });
    expect(empresa(novaSessao(), A.id)).toMatchObject({ cidade: 'Manaus', uf: 'AM' });
  });
});
