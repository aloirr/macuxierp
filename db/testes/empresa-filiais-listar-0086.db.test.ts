/**
 * v0.3.32, migração 0086 (T-0130): plataforma.empresa_filiais_listar devolve as filiais da empresa no formato
 * FilialConfig do core ({id, nome, padrao}), para o campo "Filiais" do cadastro de usuário no /config. Sem CNPJ, IE,
 * endereço nem NF-e; sem vazar entre tenants; só o macuxierp_config com sessão de superadmin. Dados fictícios.
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

const SQL_0086 = readFileSync(
  fileURLToPath(new URL('../migrations/0086_plataforma_empresa_filiais_listar.sql', import.meta.url)),
  'utf8',
);
const CONFIG = 'macuxierp_config';
const FUNCAO = 'plataforma.empresa_filiais_listar(uuid)';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000086';

/** A: três filiais (padrão, com nome fantasia e sem ele) e uma excluída; B: uma filial; C: nenhuma; D: excluída. */
const A = novoTenant('filiais-0086-a');
const B = novoTenant('filiais-0086-b');
const C = novoTenant('filiais-0086-c');
const D = novoTenant('filiais-0086-d');
const F = {
  aMatriz: '0f000000-0000-4000-8000-0000000086a1',
  aLoja: '0f000000-0000-4000-8000-0000000086a2',
  aDeposito: '0f000000-0000-4000-8000-0000000086a3',
  aExcluida: '0f000000-0000-4000-8000-0000000086a4',
  bUnica: '0f000000-0000-4000-8000-0000000086b1',
  dUnica: '0f000000-0000-4000-8000-0000000086d1',
};

const filial = (
  id: string,
  tenant: string,
  cnpj: string,
  razao: string,
  fantasia: string | null,
  padrao: boolean,
  excluida = false,
): string => `
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, nome_fantasia, crt, logradouro, numero, bairro,
  municipio_ibge, uf, cep, padrao, emissora, deleted_at)
  VALUES ('${id}', '${tenant}', '${cnpj}', '${razao}', ${fantasia === null ? 'NULL' : `'${fantasia}'`}, '3',
    'Rua Ficticia', '1', 'Centro', '1302603', 'AM', '69000000', ${padrao}, false, ${excluida ? 'now()' : 'NULL'});`;

interface FilialConfig {
  id: string;
  nome: string;
  padrao: boolean;
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — filiais da empresa no /config (0086, T-0130)', () => {
  let banco: BancoDeTeste;
  let s: string;

  const comoConfig = (sql: string, sessao: string | null = s): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
  const listar = (id: string): FilialConfig[] =>
    JSON.parse(
      comoConfig(`SELECT plataforma.empresa_filiais_listar('${id}');`)[0] ?? 'null',
    ) as FilialConfig[];
  const recusa = (sql: string, codigo: string, padrao: RegExp, sessao: string | null = s): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, padrao, { papel: CONFIG });

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    s = randomUUID();
    executar(
      banco.conexao,
      `${[A, B, C, D].map(fixturePlataforma).join('')}
UPDATE plataforma.tenant SET deleted_at = now() WHERE id = '${D.id}';
${filial(F.aMatriz, A.id, '12345678000195', 'Comercial Tucuma Ltda', null, true)}
${filial(F.aLoja, A.id, '12312312300008', 'Comercial Tucuma Ltda', 'Loja Centro', false)}
${filial(F.aDeposito, A.id, '32132132100036', 'Comercial Tucuma Ltda', '  ', false)}
${filial(F.aExcluida, A.id, '55566677700088', 'Comercial Tucuma Ltda', 'Loja Fechada', false, true)}
${filial(F.bUnica, B.id, '12345678000195', 'Atacado Pirarucu Ltda', 'Pirarucu Matriz', true)}
${filial(F.dUnica, D.id, '12345678000195', 'Empresa Excluida Ltda', null, true)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0086@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${s}', '${SA}', encode(sha256(convert_to('${s}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('FilialConfig: só id, nome e padrao; a padrão primeiro, depois por nome; sem a excluída', () => {
    expect(listar(A.id)).toEqual([
      { id: F.aMatriz, nome: 'Comercial Tucuma Ltda', padrao: true },
      // Nome fantasia em branco cai na razão social da filial.
      { id: F.aDeposito, nome: 'Comercial Tucuma Ltda', padrao: false },
      { id: F.aLoja, nome: 'Loja Centro', padrao: false },
    ]);
    for (const f of listar(A.id)) expect(Object.keys(f).sort()).toEqual(['id', 'nome', 'padrao']);
    expect(JSON.stringify(listar(A.id))).not.toMatch(/12345678000195|Rua Ficticia|69000000|1302603/);
  });

  it('sem vazar entre tenants: cada empresa vê só as próprias filiais; sem filial = lista vazia', () => {
    expect(listar(B.id)).toEqual([{ id: F.bUnica, nome: 'Pirarucu Matriz', padrao: true }]);
    expect(listar(C.id)).toEqual([]);
    const ids = new Set(listar(A.id).map((f) => f.id));
    expect(ids.has(F.bUnica)).toBe(false);
  });

  it('sessão inválida = MXS01; empresa inexistente, excluída ou de referência = P0002', () => {
    recusa(`SELECT plataforma.empresa_filiais_listar('${A.id}');`, 'MXS01', /inválida/, null);
    recusa(`SELECT plataforma.empresa_filiais_listar('${randomUUID()}');`, 'P0002', /não encontrada/);
    recusa(`SELECT plataforma.empresa_filiais_listar('${D.id}');`, 'P0002', /não encontrada/);
    recusa(
      `SELECT plataforma.empresa_filiais_listar(plataforma.tenant_referencia());`,
      'P0002',
      /não encontrada/,
    );
  });

  it('privilégios e definição: só o config executa; SECURITY DEFINER, search_path fixo; lê só cadastros.filial', () => {
    const [r] = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT has_function_privilege('${CONFIG}', '${FUNCAO}', 'EXECUTE') AS config,
       has_function_privilege('macuxierp_app', '${FUNCAO}', 'EXECUTE') AS app,
       has_function_privilege('macuxierp_leitura', '${FUNCAO}', 'EXECUTE') AS leitura,
       has_function_privilege('macuxierp_worker', '${FUNCAO}', 'EXECUTE') AS worker,
       has_function_privilege('public', '${FUNCAO}', 'EXECUTE') AS publico,
       (SELECT p.prosecdef AND array_to_string(p.proconfig, ',') = 'search_path=pg_catalog, pg_temp'
               AND obj_description(p.oid, 'pg_proc') LIKE '%0086%'
          FROM pg_proc p WHERE p.oid = '${FUNCAO}'::regprocedure) AS definicao`,
    );
    expect(r).toEqual({
      config: true,
      app: false,
      leitura: false,
      worker: false,
      publico: false,
      definicao: true,
    });
    const [fonte] = consultar<{ src: string }>(
      banco.conexao,
      `SELECT prosrc AS src FROM pg_proc WHERE oid = '${FUNCAO}'::regprocedure`,
    );
    const referencias = new Set(
      [
        ...(fonte?.src ?? '').matchAll(
          /(?<![a-z_])(core|cadastros|pedido|faturamento|fiscal|integracao_fdv|sefaz_simulador)\.\w+/g,
        ),
      ].map((m) => m[0]),
    );
    expect([...referencias]).toEqual(['cadastros.filial']);
  });

  it('a 0086 reexecuta sem erro e mantém a lista', () => {
    rodarScript(banco.conexao, SQL_0086, { transacao: true });
    rodarScript(banco.conexao, SQL_0086, { transacao: true });
    expect(listar(B.id)).toEqual([{ id: F.bUnica, nome: 'Pirarucu Matriz', padrao: true }]);
  });
});
