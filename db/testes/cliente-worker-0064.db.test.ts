/** T-0059, migração 0064: o worker cria o cliente do pré-cadastro do FDV. Motivo em docs/banco/README.md (0064). */
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
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });
const TABELAS = ['cadastros.cliente', 'cadastros.cliente_endereco', 'cadastros.cliente_contato'] as const;

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

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — cliente criado pelo worker (T-0059, 0064)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  const matriz = () => TABELAS.map((t) => privilegiosDe(banco.conexao, 'macuxierp_worker', t));

  it('o worker tem só SELECT e INSERT no cliente, no endereço e no contato (sem UPDATE, DELETE nem TRUNCATE)', () => {
    expect(matriz()).toEqual(['SI', 'SI', 'SI']);
    expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', 'cadastros.cliente')).toBe('S');
  });

  it('sem worker_global: as três tabelas só com a isolamento_tenant (que vale para todos os papéis)', () => {
    expect(
      consultar<{ t: string; p: string; papeis: string }>(
        banco.conexao,
        `SELECT k.relname AS t, p.polname AS p, p.polroles::text AS papeis FROM pg_policy p JOIN pg_class k ON k.oid = p.polrelid
         WHERE k.oid IN (${TABELAS.map((t) => `'${t}'::regclass`).join(', ')}) ORDER BY 1, 2`,
      ),
    ).toEqual(['cliente', 'cliente_contato', 'cliente_endereco'].map((t) => ({ t, p: 'isolamento_tenant', papeis: '{0}' })));
  });

  it('o worker cria o cliente com endereço e contato no próprio tenant, e o B não vê', () => {
    const [id] = linhas(rodarComo(banco.conexao, criarComoPorta('11444777000161'), WORKER(A))).filter((l) => /^[0-9a-f-]{36}$/.test(l));
    expect(id).toBeDefined();
    const n = (tabela: string, col: string) =>
      consultar<{ t: string }>(banco.conexao, `SELECT tenant_id::text AS t FROM ${tabela} WHERE ${col} = '${id}'`).map((r) => r.t);
    expect([n('cadastros.cliente', 'id'), n('cadastros.cliente_endereco', 'cliente_id'), n('cadastros.cliente_contato', 'cliente_id')]).toEqual([
      [A.id],
      [A.id],
      [A.id],
    ]);
    expect(
      consultar<{ n: number }>(banco.conexao, `SELECT count(*)::int AS n FROM cadastros.cliente WHERE id = '${id}'`, WORKER(B)),
    ).toEqual([{ n: 0 }]);
  });

  it('RLS: o worker não lê o cliente do B nem cria cliente, endereço ou contato no B', () => {
    expect(
      consultar<{ n: number }>(banco.conexao, `SELECT count(*)::int AS n FROM cadastros.cliente WHERE tenant_id = '${B.id}'`, WORKER(A)),
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
  });

  it('UPDATE e DELETE continuam negados ao worker (42501) nas três tabelas', () => {
    for (const t of TABELAS) {
      recusaDetalhada(banco.conexao, `UPDATE ${t} SET deleted_at = now();`, '42501', /permission denied/, WORKER(A));
      recusaDetalhada(banco.conexao, `DELETE FROM ${t};`, '42501', /permission denied/, WORKER(A));
    }
  });

  it('a 0064 roda de novo sem erro e sem ampliar nada', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(matriz()).toEqual(['SI', 'SI', 'SI']);
  });
});
