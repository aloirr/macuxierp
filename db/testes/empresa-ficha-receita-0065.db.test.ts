/**
 * T-0101, migração 0065: ficha da empresa pela Receita (ADR 0012 §4, emenda da ficha). Colunas em core.empresa,
 * empresa_ler com a ficha mascarada, empresa_gravar_receita idempotente e empresa_contato_revelar auditado sem o valor.
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
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0065_core_empresa_ficha_receita.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const PAPEIS = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
const GRAVAR = 'plataforma.empresa_gravar_receita(uuid, jsonb, text)';
const REVELAR = 'plataforma.empresa_contato_revelar(uuid, text, text)';
const PORTAL = ['plataforma.empresa_ler(uuid)', GRAVAR, REVELAR];
const INTERNAS = [
  'plataforma.mascarar_telefone(text)',
  'plataforma.receita_texto(text, integer)',
  'plataforma.receita_data(text)',
  'plataforma.empresa_ficha_json(uuid)',
];
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000065';
const EMAIL = 'contato.ficticio@empresa-a.teste';
const TELEFONE = '92987651234';

/** A e B: core.empresa; C: só plataforma (sem core.empresa). */
const A = novoTenant('ficha-0065-a');
const B = novoTenant('ficha-0065-b');
const C = novoTenant('ficha-0065-c');

const FICHA = {
  razao_social: '  Empresa   Ficticia A  LTDA ',
  nome_fantasia: 'Fantasia A',
  logradouro: 'Rua Ficticia',
  numero: '100',
  complemento: null,
  bairro: 'Centro',
  cep: '69.005-000',
  municipio_ibge: '1302603',
  uf: 'am',
  email: '  Contato.Ficticio@Empresa-A.teste ',
  telefone: '(92) 98765-1234',
  cnae_principal: 111301,
  regime_receita: 'simples',
  situacao_cadastral: 'ATIVA',
  situacao_cadastral_data: '2005-11-03',
  data_abertura: '1990-05-10',
  natureza_juridica: 'Sociedade Empresária Limitada',
  porte: 'DEMAIS',
  cnae_secundarios: ['4713002', 4713002, 111302, 'x'],
  fonte: 'brasilapi',
  consultado_em: '2026-11-24T12:00:00.000Z',
};

const CHAVES_FICHA = [
  'bairro',
  'cep',
  'cnae_principal',
  'cnae_secundarios',
  'complemento',
  'data_abertura',
  'email_mascarado',
  'ie',
  'logradouro',
  'municipio_ibge',
  'natureza_juridica',
  'nome_fantasia',
  'numero',
  'porte',
  'receita_consultada_em',
  'receita_fonte',
  'regime_receita',
  'situacao_cadastral',
  'situacao_cadastral_data',
  'telefone_mascarado',
  'uf',
];

interface Gravacao {
  ficha: Record<string, unknown>;
  alterados: string[];
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — ficha da empresa pela Receita (T-0101, 0065)', () => {
  let banco: BancoDeTeste;

  const comoConfig = (sessao: string | null, sql: string): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
  const json = <T>(sessao: string, sql: string): T => JSON.parse(comoConfig(sessao, sql)[0] ?? 'null') as T;
  const gravar = (sessao: string, tenant: string, ficha: unknown, req: string | null): Gravacao =>
    json<Gravacao>(
      sessao,
      `SELECT plataforma.empresa_gravar_receita('${tenant}', '${JSON.stringify(ficha)}'::jsonb, ${
        req === null ? 'NULL' : `'${req}'`
      });`,
    );
  const recusaConfig = (sessao: string | null, sql: string, codigo: string, padrao: RegExp): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });
  const novaSessao = (): string => {
    const id = randomUUID();
    executar(
      banco.conexao,
      // hora-fixa-ok: a sessão só precisa estar válida agora; o instante fixo é o consultado_em da ficha.
      `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ('${id}', '${SA}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    return id;
  };
  const auditoria = (acao: string): Record<string, unknown>[] =>
    consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT tenant_id, superadmin_id, entidade, request_id, antes, depois FROM plataforma.auditoria
       WHERE acao = '${acao}' ORDER BY ocorrido_em, id`,
    );
  const empresaDe = (tenant: string): Record<string, unknown> =>
    consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT razao_social, email, telefone, cep, uf, cnae_principal, receita_fonte,
         to_char(receita_consultada_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS consultada,
         updated_at::text AS updated_at
       FROM core.empresa WHERE tenant_id = '${tenant}'`,
    )[0] ?? {};

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}${fixtureModulos(A)}${fixturePlataforma(B)}${fixtureModulos(B)}${fixturePlataforma(C)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0065@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
UPDATE core.empresa SET email = 'b.ficticio@empresa-b.teste', telefone = '9532221111' WHERE tenant_id = '${B.id}';`,
    );
  });

  afterAll(() => banco?.remover());

  it('privilégios: gravar, revelar e ler só do config; internas de ninguém; todas SECURITY DEFINER e comentadas', () => {
    for (const f of [...PORTAL, ...INTERNAS]) {
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
        config: PORTAL.includes(f),
      });
    }
  });

  it('RLS: core.empresa com as colunas novas não vaza entre tenants; o config não lê a tabela direto', () => {
    expect(verificarVazamento(banco.conexao, ['core'], A.id, B.id)).toEqual([]);
    for (const papel of PAPEIS) {
      const vistos = consultar<{ email: string | null }>(banco.conexao, `SELECT email FROM core.empresa`, {
        papel,
        tenant: A.id,
      });
      expect({ papel, vistos }).toEqual({ papel, vistos: [{ email: null }] });
    }
    recusaConfig(novaSessao(), `SELECT email FROM core.empresa;`, '42501', /permission denied/);
  });

  it('mascarar_telefone: "(DDD) ****-" + 4 últimos; fora de 10 ou 11 dígitos = "****"; NULL = NULL', () => {
    const [r] = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT plataforma.mascarar_telefone('92987651234') AS celular, plataforma.mascarar_telefone('9232331234') AS fixo,
         plataforma.mascarar_telefone('123') AS curto, plataforma.mascarar_telefone(NULL) AS nulo`,
    );
    expect(r).toEqual({ celular: '(92) ****-1234', fixo: '(92) ****-1234', curto: '****', nulo: null });
  });

  it('gravar: normaliza, grava data e fonte, devolve a ficha mascarada e audita só os nomes dos campos', () => {
    const s = novaSessao();
    const g = gravar(s, A.id, FICHA, 'req-gravar-1');
    expect(g.alterados).toEqual([
      'bairro',
      'cep',
      'cnae_principal',
      'cnae_secundarios',
      'data_abertura',
      'email',
      'logradouro',
      'municipio_ibge',
      'natureza_juridica',
      'nome_fantasia',
      'numero',
      'porte',
      'razao_social',
      'regime_receita',
      'situacao_cadastral',
      'situacao_cadastral_data',
      'telefone',
      'uf',
    ]);
    expect(g.ficha).toEqual({
      nome_fantasia: 'Fantasia A',
      ie: null,
      logradouro: 'Rua Ficticia',
      numero: '100',
      complemento: null,
      bairro: 'Centro',
      cep: '69005000',
      municipio_ibge: '1302603',
      uf: 'AM',
      email_mascarado: 'co****@empresa-a.teste',
      telefone_mascarado: '(92) ****-1234',
      cnae_principal: '0111301',
      regime_receita: 'simples',
      situacao_cadastral: 'ATIVA',
      situacao_cadastral_data: '2005-11-03',
      // Dados públicos de PJ: sem máscara.
      data_abertura: '1990-05-10',
      natureza_juridica: 'Sociedade Empresária Limitada',
      porte: 'DEMAIS',
      cnae_secundarios: ['4713002', '0111302'],
      receita_fonte: 'brasilapi',
      receita_consultada_em: '2026-11-24T12:00:00.000Z',
    });
    expect(empresaDe(A.id)).toMatchObject({
      razao_social: 'Empresa Ficticia A LTDA',
      email: EMAIL,
      telefone: TELEFONE,
      receita_fonte: 'brasilapi',
    });
    const linhasAud = auditoria('plataforma.empresa.atualizar_receita');
    expect(linhasAud).toEqual([
      {
        tenant_id: A.id,
        superadmin_id: SA,
        entidade: 'empresa',
        request_id: 'req-gravar-1',
        antes: null,
        depois: { campos: g.alterados, fonte: 'brasilapi' },
      },
    ]);
    const texto = JSON.stringify(linhasAud);
    for (const valor of ['@', '1234', 'Ficticia', '69005000', '0111301']) expect(texto).not.toContain(valor);
  });

  it('gravar é idempotente: mesmo request_id não muda nada; mesma ficha de novo só renova data e fonte', () => {
    const s = novaSessao();
    const antes = empresaDe(A.id);
    const n = auditoria('plataforma.empresa.atualizar_receita').length;
    const repetida = gravar(s, A.id, { ...FICHA, fonte: 'cache' }, 'req-gravar-1');
    expect(repetida.alterados).toHaveLength(18);
    expect(empresaDe(A.id)).toEqual(antes);
    expect(auditoria('plataforma.empresa.atualizar_receita')).toHaveLength(n);

    const outra = gravar(
      s,
      A.id,
      { ...FICHA, fonte: 'cache', consultado_em: '2026-11-24T13:00:00Z' },
      'req-gravar-2',
    );
    expect(outra.alterados).toEqual([]);
    expect(empresaDe(A.id)).toMatchObject({
      email: EMAIL,
      receita_fonte: 'cache',
      consultada: '2026-11-24T13:00:00',
    });
    expect(auditoria('plataforma.empresa.atualizar_receita').at(-1)).toMatchObject({
      request_id: 'req-gravar-2',
      depois: { campos: [], fonte: 'cache' },
    });
  });

  it('gravar: chave ausente mantém; null apaga; inválido vira NULL; razão social curta não apaga', () => {
    const s = novaSessao();
    const g = gravar(
      s,
      A.id,
      {
        fonte: 'receita-aberta',
        razao_social: 'X',
        telefone: '1234',
        cep: null,
        situacao_cadastral_data: '2026-02-30',
        cnae_secundarios: 'x',
      },
      null,
    );
    expect(g.alterados).toEqual(['cep', 'cnae_secundarios', 'situacao_cadastral_data', 'telefone']);
    expect(g.ficha).toMatchObject({
      cep: null,
      cnae_secundarios: null,
      porte: 'DEMAIS',
      telefone_mascarado: null,
      situacao_cadastral_data: null,
      email_mascarado: 'co****@empresa-a.teste',
      logradouro: 'Rua Ficticia',
    });
    expect(empresaDe(A.id)).toMatchObject({ razao_social: 'Empresa Ficticia A LTDA', email: EMAIL });
    gravar(s, A.id, { ...FICHA, consultado_em: undefined }, null);
    expect(empresaDe(A.id)).toMatchObject({ telefone: TELEFONE, cep: '69005000' });
  });

  it('gravar recusa: 23514 fora da lista, sem fonte ou data inválida; 55000 sem core.empresa; P0002; MXS01', () => {
    const s = novaSessao();
    const n = auditoria('plataforma.empresa.atualizar_receita').length;
    const sql = (tenant: string, ficha: unknown): string =>
      `SELECT plataforma.empresa_gravar_receita('${tenant}', '${JSON.stringify(ficha)}'::jsonb, 'r');`;
    recusaConfig(
      s,
      sql(A.id, { fonte: 'brasilapi', crt: '1' }),
      '23514',
      /fora da lista fechada da ficha: crt/,
    );
    recusaConfig(s, sql(A.id, { email: EMAIL }), '23514', /fonte da consulta inválida/);
    recusaConfig(s, sql(A.id, { fonte: 'outra' }), '23514', /fonte da consulta inválida/);
    recusaConfig(s, sql(A.id, { fonte: 'cache', consultado_em: 'ontem' }), '23514', /consultado_em inválido/);
    recusaConfig(s, sql(A.id, { fonte: 'cache', consultado_em: '2999-01-01T00:00:00Z' }), '23514', /futuro/);
    recusaConfig(s, sql(C.id, { fonte: 'brasilapi' }), '55000', /não tem cadastro/);
    recusaConfig(s, sql(randomUUID(), { fonte: 'brasilapi' }), 'P0002', /não encontrada/);
    recusaConfig(null, sql(A.id, { fonte: 'brasilapi' }), 'MXS01', /inválida/);
    expect(auditoria('plataforma.empresa.atualizar_receita')).toHaveLength(n);
  });

  it('empresa_ler: ficha só com a lista fechada e contato mascarado; ficha null sem core.empresa; lista sem ficha', () => {
    const s = novaSessao();
    const a = json<{ ficha: Record<string, unknown> }>(s, `SELECT plataforma.empresa_ler('${A.id}');`);
    expect(Object.keys(a.ficha).sort()).toEqual(CHAVES_FICHA);
    expect(a.ficha).toMatchObject({
      email_mascarado: 'co****@empresa-a.teste',
      telefone_mascarado: '(92) ****-1234',
      data_abertura: '1990-05-10',
      natureza_juridica: 'Sociedade Empresária Limitada',
      porte: 'DEMAIS',
      cnae_secundarios: ['4713002', '0111302'],
    });
    expect(JSON.stringify(a)).not.toContain(EMAIL);
    expect(JSON.stringify(a)).not.toContain(TELEFONE);
    const b = json<{ ficha: Record<string, unknown> }>(s, `SELECT plataforma.empresa_ler('${B.id}');`);
    expect(b.ficha).toMatchObject({
      email_mascarado: 'b.****@empresa-b.teste',
      telefone_mascarado: '(95) ****-1111',
    });
    expect(json<{ ficha: unknown }>(s, `SELECT plataforma.empresa_ler('${C.id}');`).ficha).toBeNull();
    const lista = comoConfig(s, `SELECT plataforma.empresas_listar('ficha-0065', NULL, 50);`).join('\n');
    expect(lista).not.toContain('"ficha"');
    expect(lista).not.toContain('telefone_mascarado');
    expect(lista).not.toContain(EMAIL);
  });

  it('revelar: devolve o valor e audita só o campo; 23514, P0002 e MXS01 sem auditoria; outros papéis 42501', () => {
    const s = novaSessao();
    for (const papel of PAPEIS) {
      recusaDetalhada(
        banco.conexao,
        `${sessaoSql(s)}SELECT plataforma.empresa_contato_revelar('${A.id}', 'email', 'r');`,
        '42501',
        /permission denied/,
        { papel, tenant: A.id },
      );
    }
    expect(
      comoConfig(s, `SELECT plataforma.empresa_contato_revelar('${A.id}', 'email', 'req-rev-1');`),
    ).toEqual([EMAIL]);
    expect(
      comoConfig(s, `SELECT plataforma.empresa_contato_revelar('${A.id}', 'telefone', 'req-rev-2');`),
    ).toEqual([TELEFONE]);
    const aud = auditoria('plataforma.empresa.revelar_contato');
    expect(aud).toEqual([
      {
        tenant_id: A.id,
        superadmin_id: SA,
        entidade: 'empresa',
        request_id: 'req-rev-1',
        antes: null,
        depois: { campo: 'email' },
      },
      {
        tenant_id: A.id,
        superadmin_id: SA,
        entidade: 'empresa',
        request_id: 'req-rev-2',
        antes: null,
        depois: { campo: 'telefone' },
      },
    ]);
    expect(JSON.stringify(aud)).not.toMatch(/@|1234/);

    const rev = (tenant: string, campo: string): string =>
      `SELECT plataforma.empresa_contato_revelar('${tenant}', '${campo}', 'r');`;
    recusaConfig(s, rev(A.id, 'cnpj'), '23514', /campo de contato inválido/);
    recusaConfig(s, rev(C.id, 'email'), 'P0002', /não tem cadastro/);
    recusaConfig(s, rev(randomUUID(), 'email'), 'P0002', /não encontrada/);
    executar(banco.conexao, `UPDATE core.empresa SET telefone = NULL WHERE tenant_id = '${B.id}';`);
    recusaConfig(s, rev(B.id, 'telefone'), 'P0002', /contato não informado/);
    recusaConfig(null, rev(A.id, 'email'), 'MXS01', /inválida/);
    expect(auditoria('plataforma.empresa.revelar_contato')).toHaveLength(2);
  });

  it('a 0065 reexecuta duas vezes sem erro, sem CHECK duplicado e com os mesmos privilégios', () => {
    const contar = (): Record<string, unknown> | undefined =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'core.empresa'::regclass AND contype = 'c') AS checks,
           has_function_privilege('${CONFIG}', '${GRAVAR}', 'EXECUTE') AS gravar,
           has_function_privilege('${CONFIG}', '${REVELAR}', 'EXECUTE') AS revelar,
           has_function_privilege('macuxierp_app', '${GRAVAR}', 'EXECUTE') AS app`,
      )[0];
    const antes = contar();
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(contar()).toEqual(antes);
    expect(antes).toMatchObject({ gravar: true, revelar: true, app: false });
    expect(empresaDe(A.id)).toMatchObject({ email: EMAIL, telefone: TELEFONE });
  });
});
