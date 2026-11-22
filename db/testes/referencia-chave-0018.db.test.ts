/** T-0011, migração 0018: CHECK referencia_dados_ck. Motivo em docs/banco/README.md. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  erroDetalhadoDe,
  executar,
  falhaDetalhada,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixtureIntegracao, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0018_referencia_dados_chave.sql', import.meta.url));
const A = novoTenant('ref-chave-a');
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };

/** Referência de tabela de preço com os dados dados (JSON em texto), como o worker grava. */
const refSql = (dados: string): string =>
  `INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, dados, fonte_ocorrido_em)
   VALUES (plataforma.tenant_atual(), 'tabela_preco', gen_random_uuid(), '${dados.replace(/'/g, "''")}', now());`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — chave do Hub em referencia.dados (T-0011, 0018)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixtureIntegracao(A));
  });

  afterAll(() => banco?.remover());

  const constraints = () =>
    consultar<{ nome: string; validado: boolean; comentario: string | null }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validado, obj_description(oid, 'pg_constraint') AS comentario
       FROM pg_constraint WHERE conrelid = 'integracao_fdv.referencia'::regclass
         AND conname IN ('referencia_dados_check', 'referencia_dados_ck') ORDER BY 1`,
    );

  /** Falha esperada: 23514 e o nome do CHECK novo. */
  const recusa = (dados: string) => {
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(refSql(dados)), WORKER_A));
    expect({ dados, saida: e.saida }).toMatchObject({ dados, saida: expect.stringMatching(/23514/) });
    expect({ dados, mensagem: e.mensagem }).toMatchObject({
      dados,
      mensagem: expect.stringMatching(/referencia_dados_ck/),
    });
  };

  it('o CHECK antigo saiu e o novo existe, validado e comentado', () => {
    const r = constraints();
    expect(r.map(({ nome, validado }) => ({ nome, validado }))).toEqual([
      { nome: 'referencia_dados_ck', validado: true },
    ]);
    expect(r[0]?.comentario).toMatch(/external_id \?\? id/);
  });

  it('chave de 1 e de 200 caracteres passa (inclusive multibyte), com as outras chaves permitidas', () => {
    for (const chave of ['T', 'x'.repeat(200), 'á'.repeat(200)]) {
      expect({
        chave,
        erro: erroDetalhadoDe(() => executar(banco.conexao, refSql(JSON.stringify({ chave })), WORKER_A)),
      }).toEqual({ chave, erro: null });
    }
    executar(
      banco.conexao,
      refSql(
        JSON.stringify({
          nome: 'Padrão',
          vigencia_inicio: '2026-01-01',
          vigencia_fim: null,
          inativo: false,
          chave: 'TP-1',
        }),
      ),
      WORKER_A,
    );
    executar(banco.conexao, refSql('{}'), WORKER_A);
  });

  it('chave vazia, com 201 caracteres, numérica, nula, objeto ou lista falha com 23514 e o nome do CHECK', () => {
    for (const valor of ['""', JSON.stringify('x'.repeat(201)), '123', 'null', '{"a": 1}', '["TP-1"]']) {
      recusa(`{"chave": ${valor}}`);
    }
  });

  it('chave desconhecida continua falhando; dados que não são objeto também', () => {
    recusa('{"Chave": "TP-1"}');
    recusa('["chave"]');
  });

  it('o worker grava a chave e atualiza dados com ela (INSERT e UPDATE sob RLS)', () => {
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, dados, fonte_ocorrido_em)
       VALUES (plataforma.tenant_atual(), 'tabela_preco', '${A.produto}', '{"nome": "Atacado"}', now());
       UPDATE integracao_fdv.referencia SET dados = dados || '{"chave": "TAB-ATACADO"}', updated_at = now()
       WHERE tipo = 'tabela_preco' AND erp_id = '${A.produto}';`,
      WORKER_A,
    );
    const [r] = consultar<{ chave: string }>(
      banco.conexao,
      `SELECT dados ->> 'chave' AS chave FROM integracao_fdv.referencia
       WHERE tipo = 'tabela_preco' AND erp_id = '${A.produto}'`,
      WORKER_A,
    );
    expect(r?.chave).toBe('TAB-ATACADO');
  });

  it('a 0018 roda de novo sem erro, sem duplicar o CHECK e sem trazer o antigo de volta', () => {
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(constraints().map(({ nome, validado }) => ({ nome, validado }))).toEqual([
      { nome: 'referencia_dados_ck', validado: true },
    ]);
  });
});
