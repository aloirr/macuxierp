/** Migração 0064: o worker cria o cliente do pré-cadastro do FDV (T-0059) e a empresa da filial padrão (T-0100). Motivo em docs/banco/README.md (0064). */
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
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0064_cadastros_cliente_worker.sql', import.meta.url));
const A = novoTenant('cliente-0064-a');
const B = novoTenant('cliente-0064-b');
/** Sem core.empresa: o tenant novo, antes do consumidor core.empresa-da-filial-padrao (T-0100). */
const C = novoTenant('cliente-0064-c');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });
const TABELAS = ['cadastros.cliente', 'cadastros.cliente_endereco', 'cadastros.cliente_contato', 'core.empresa'] as const;
const UUID = /^[0-9a-f-]{36}$/;

/** O que a porta faz (modules/cadastros/api/criador-cliente-fdv.ts → sql.ts): SAVEPOINT, os três INSERT com RETURNING e a releitura. */
const criarComoPorta = (documento: string): string => `
SAVEPOINT carga_linha;
WITH c AS (
  INSERT INTO cadastros.cliente (tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, filial_id, limite_credito_centavos)
  VALUES (plataforma.tenant_atual(), 'PJ', '${documento}', '9', 'Cliente FDV', (SELECT id FROM cadastros.filial LIMIT 1), 0)
  RETURNING id
), e AS (
  INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
  SELECT plataforma.tenant_atual(), c.id, 'principal', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000' FROM c RETURNING id
), k AS (
  INSERT INTO cadastros.cliente_contato (tenant_id, cliente_id, nome) SELECT plataforma.tenant_atual(), c.id, 'Telefone' FROM c RETURNING id
)
SELECT c.id FROM c, e, k;
RELEASE SAVEPOINT carga_linha;`;

/** O que o consumidor core.empresa-da-filial-padrao faz (docs/desenho/T-0100.md §3): INSERT idempotente na empresa. */
const EMPRESA_DA_FILIAL = `INSERT INTO core.empresa (tenant_id, razao_social, cnpj)
  VALUES (plataforma.tenant_atual(), 'Empresa da Filial', '11222333000181') ON CONFLICT (tenant_id) DO NOTHING RETURNING id;`;
/** A auditoria e a outbox que o core grava na mesma transação (AuditoriaPg e a outbox do platform-sdk, pg.ts). */
const AUDITORIA_E_OUTBOX = `
INSERT INTO plataforma.auditoria (tenant_id, acao, entidade, depois)
  VALUES (plataforma.tenant_atual(), 'core.empresa.criada', 'empresa', '{"origem": "filial_padrao"}');
INSERT INTO plataforma.evento (tenant_id, nome, agregado_id, versao, payload)
  VALUES (plataforma.tenant_atual(), 'core.empresa.alterada@1', plataforma.tenant_atual(), 1, '{}');`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — cliente e empresa criados pelo worker (T-0059 e T-0100, 0064)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n') + fixturePlataforma(C));
  });

  afterAll(() => banco?.remover());

  const matriz = () => TABELAS.map((t) => privilegiosDe(banco.conexao, 'macuxierp_worker', t));

  it('o worker tem só SELECT e INSERT no cliente, no endereço, no contato e na empresa (sem UPDATE, DELETE nem TRUNCATE)', () => {
    expect(matriz()).toEqual(['SI', 'SI', 'SI', 'SI']);
    expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', 'cadastros.cliente')).toBe('S');
  });

  it('sem worker_global: as quatro tabelas só com a isolamento_tenant (que vale para todos os papéis)', () => {
    expect(
      consultar<{ t: string; p: string; papeis: string }>(
        banco.conexao,
        `SELECT k.relname AS t, p.polname AS p, p.polroles::text AS papeis FROM pg_policy p JOIN pg_class k ON k.oid = p.polrelid
         WHERE k.oid IN (${TABELAS.map((t) => `'${t}'::regclass`).join(', ')}) ORDER BY 1, 2`,
      ),
    ).toEqual(['cliente', 'cliente_contato', 'cliente_endereco', 'empresa'].map((t) => ({ t, p: 'isolamento_tenant', papeis: '{0}' })));
  });

  it('o worker cria o cliente com endereço e contato no próprio tenant', () => {
    const [id] = linhas(rodarComo(banco.conexao, criarComoPorta('11444777000161'), WORKER(A))).filter((l) => UUID.test(l));
    expect(id).toBeDefined();
    const n = (tabela: string, col: string) =>
      consultar<{ t: string }>(banco.conexao, `SELECT tenant_id::text AS t FROM ${tabela} WHERE ${col} = '${id}'`).map((r) => r.t);
    expect([n('cadastros.cliente', 'id'), n('cadastros.cliente_endereco', 'cliente_id'), n('cadastros.cliente_contato', 'cliente_id')]).toEqual([
      [A.id],
      [A.id],
      [A.id],
    ]);
  });

  it('T-0100: o worker cria a empresa do próprio tenant, com auditoria e outbox, e o ON CONFLICT não duplica', () => {
    const ids = (sql: string) => linhas(rodarComo(banco.conexao, sql, WORKER(C))).filter((l) => UUID.test(l));
    expect(ids(EMPRESA_DA_FILIAL + AUDITORIA_E_OUTBOX)).toHaveLength(1);
    expect(ids(EMPRESA_DA_FILIAL)).toEqual([]);
    expect(consultar<{ n: number }>(banco.conexao, `SELECT count(*)::int AS n FROM core.empresa WHERE tenant_id = '${C.id}'`)).toEqual([
      { n: 1 },
    ]);
  });

  it('RLS: o worker não lê o cliente nem a empresa do B, nem cria cliente, endereço, contato ou empresa em outro tenant', () => {
    expect(
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT (SELECT count(*) FROM cadastros.cliente WHERE tenant_id = '${B.id}')::int
           + (SELECT count(*) FROM core.empresa WHERE tenant_id = '${B.id}')::int AS n`,
        WORKER(A),
      ),
    ).toEqual([{ n: 0 }]);
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.cliente (tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, filial_id)
         VALUES ('${B.id}', 'PJ', '11444777000161', '9', 'Cruzado', '${B.filial}');`,
      '42501',
      /row-level security/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
         VALUES ('${B.id}', '${B.cliente}', 'entrega', 'Rua X', '1', 'Centro', '1302603', 'AM', '69000000');`,
      '42501',
      /row-level security/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.cliente_contato (tenant_id, cliente_id, nome) VALUES ('${B.id}', '${B.cliente}', 'X');`,
      '42501',
      /row-level security/,
      WORKER(A),
    );
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ('${C.id}', 'Cruzada', '11222333000181')
         ON CONFLICT (tenant_id) DO NOTHING;`,
      '42501',
      /row-level security/,
      WORKER(A),
    );
  });

  it('UPDATE e DELETE na empresa continuam negados ao worker (42501)', () => {
    recusaDetalhada(banco.conexao, 'UPDATE core.empresa SET deleted_at = now();', '42501', /permission denied/, WORKER(A));
    recusaDetalhada(banco.conexao, 'DELETE FROM core.empresa;', '42501', /permission denied/, WORKER(A));
  });

  it('a 0064 roda de novo sem erro e sem ampliar nada', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(matriz()).toEqual(['SI', 'SI', 'SI', 'SI']);
  });
});
