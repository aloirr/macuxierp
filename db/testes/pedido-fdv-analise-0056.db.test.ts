/**
 * T-0085 (v0.3.12, migração 0056; RN-PED-07 emendada): o pedido do FDV entra em em_analise só com as pendências
 * bloqueantes prazo_incompleto e/ou prazo_acima_do_cliente; vai a recusado só com pendências de prazo (as de em_analise)
 * e a aprovado só sem pendência ou com pendência de prazo não bloqueante (aceita). Os CHECKs pedido_fdv_sem_analise e
 * pedido_fdv_sem_pendencia da 0016 mudam de definição com o mesmo nome. O banco sobe até antes da 0056 com um pedido do
 * FDV aprovado (o legado), depois recebe a 0056 (docs/banco/README.md, 0056).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  executar,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  recusaDetalhada,
  rodarScript,
} from './apoio.ts';
import { fixturePedido, fixturePlataforma, novoTenant, sqlDePedido } from './fixture.ts';

const MIGRACAO = '0056_pedido_fdv_em_analise_prazo.sql';
const CK_ANALISE = 'pedido_fdv_sem_analise';
const CK_PENDENCIA = 'pedido_fdv_sem_pendencia';
const A = novoTenant('fdv-analise-0056-a');
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const { pedidoSql } = sqlDePedido(A.id, 700);

/** O formato do `Pendencia` de modules/pedido/contracts (o que o servico grava em pedido.pendencias). */
const pend = (codigo: string, bloqueante = true): string =>
  `{"codigo": "${codigo}", "bloqueante": ${bloqueante}, "sequencia": null, "produto_id": null}`;
const INCOMPLETO = `[${pend('prazo_incompleto')}]`;
const ACIMA = `[${pend('prazo_acima_do_cliente')}]`;
const AS_DUAS = `[${pend('prazo_incompleto')}, ${pend('prazo_acima_do_cliente')}]`;
const INCOMPLETO_ACEITA = `[${pend('prazo_incompleto', false)}]`;
const ACIMA_ACEITA = `[${pend('prazo_acima_do_cliente', false)}]`;
const AS_DUAS_ACEITAS = `[${pend('prazo_incompleto', false)}, ${pend('prazo_acima_do_cliente', false)}]`;
const CREDITO = `[${pend('credito_excedido', false)}]`;

/** Pedido recebido (origem dada) e, num UPDATE só, o status e as pendências (como o atualizarStatus do servico). */
function levar(origem: 'fdv' | 'bko', status: string, pendencias: string): { id: string; sql: string } {
  const id = randomUUID();
  const externalId = origem === 'fdv' ? randomUUID() : null;
  return {
    id,
    sql: `${pedidoSql({ id, origem, externalId })}
      UPDATE pedido.pedido SET status = '${status}', pendencias = '${pendencias}' WHERE id = '${id}';`,
  };
}

const passa = (origem: 'fdv' | 'bko', status: string, pendencias: string): string => {
  const { id, sql } = levar(origem, status, pendencias);
  executar(banco.conexao, sql, origem === 'fdv' ? WORKER_A : APP_A);
  return id;
};
const cai = (origem: 'fdv' | 'bko', status: string, pendencias: string, nome: string): void =>
  recusaDetalhada(banco.conexao, levar(origem, status, pendencias).sql, '23514', new RegExp(`"${nome}"`), WORKER_A);
/** Pedido do FDV em em_analise com as pendências dadas e, num UPDATE à parte, a saída (status e pendências). */
const sair = (de: string, status: string, pendencias: string): string => {
  const id = passa('fdv', 'em_analise', de);
  return `UPDATE pedido.pedido SET status = '${status}', pendencias = '${pendencias}' WHERE id = '${id}';`;
};
const caiSaida = (de: string, status: string, pendencias: string, nome: string): void =>
  recusaDetalhada(banco.conexao, sair(de, status, pendencias), '23514', new RegExp(`"${nome}"`), WORKER_A);

let banco: BancoDeTeste;
let anteriores: PastaDeMigracoes;
const legado = randomUUID();

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — pedido do FDV em análise, recusado e aprovado com pendência de prazo (T-0085, 0056)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0056');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixturePedido(A));
    // Legado: pedido do FDV aprovado sem pendência, gravado com os CHECKs da 0016.
    executar(
      banco.conexao,
      `${pedidoSql({ id: legado, origem: 'fdv', externalId: randomUUID() })}
       UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${legado}';`,
      WORKER_A,
    );
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('os dois CHECKs ficam com o mesmo nome, validados e citando os dois códigos de prazo; o legado fica igual', () => {
    const cks = consultar<{ nome: string; validada: boolean; def: string; comentario: string }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validada, pg_get_constraintdef(oid) AS def,
              obj_description(oid, 'pg_constraint') AS comentario
       FROM pg_constraint WHERE conrelid = 'pedido.pedido'::regclass AND conname IN ('${CK_ANALISE}', '${CK_PENDENCIA}')
       ORDER BY conname`,
    );
    expect(cks.map(({ nome, validada }) => ({ nome, validada }))).toEqual([
      { nome: CK_ANALISE, validada: true },
      { nome: CK_PENDENCIA, validada: true },
    ]);
    for (const ck of cks) {
      expect(ck.def).toMatch(/prazo_incompleto.*prazo_acima_do_cliente/);
      expect(ck.def).toMatch(/"bloqueante" == false/);
      expect(ck.comentario).toMatch(/RN-PED-07 \(0056\)/);
    }
    expect(
      consultar<{ s: string; p: unknown }>(
        banco.conexao,
        `SELECT status AS s, pendencias AS p FROM pedido.pedido WHERE id = '${legado}'`,
        WORKER_A,
      ),
    ).toEqual([{ s: 'aprovado', p: [] }]);
  });

  it('FDV em em_analise com prazo_incompleto, com prazo_acima_do_cliente ou com as duas passa', () => {
    const ids = [INCOMPLETO, ACIMA, AS_DUAS].map((p) => passa('fdv', 'em_analise', p));
    const r = consultar<{ s: string; n: number }>(
      banco.conexao,
      `SELECT status AS s, jsonb_array_length(pendencias) AS n FROM pedido.pedido
       WHERE id IN (${ids.map((i) => `'${i}'`).join(', ')}) ORDER BY n`,
      WORKER_A,
    );
    expect(r).toEqual([
      { s: 'em_analise', n: 1 },
      { s: 'em_analise', n: 1 },
      { s: 'em_analise', n: 2 },
    ]);
  });

  it('FDV em em_analise sem pendência cai (pedido_fdv_sem_analise)', () => {
    cai('fdv', 'em_analise', '[]', CK_ANALISE);
  });

  it('FDV em em_analise com outra pendência, prazo junto de outra ou prazo não bloqueante cai', () => {
    cai('fdv', 'em_analise', CREDITO, CK_ANALISE);
    cai('fdv', 'em_analise', `[${pend('prazo_incompleto')}, ${pend('credito_excedido', false)}]`, CK_ANALISE);
    cai('fdv', 'em_analise', ACIMA_ACEITA, CK_ANALISE);
    cai('fdv', 'em_analise', '[{"codigo": "prazo_incompleto"}]', CK_ANALISE);
    cai('fdv', 'em_analise', '[{"codigo": 1, "bloqueante": true}]', CK_ANALISE);
    cai('fdv', 'em_analise', '["prazo_incompleto"]', CK_ANALISE);
  });

  it('FDV em em_analise com prazo vai a recusado guardando as pendências de prazo (o recusar do servico)', () => {
    for (const p of [INCOMPLETO, ACIMA, AS_DUAS]) {
      const id = passa('fdv', 'em_analise', p);
      executar(banco.conexao, `UPDATE pedido.pedido SET status = 'recusado' WHERE id = '${id}';`, WORKER_A);
      expect(
        consultar<{ s: string; p: unknown }>(
          banco.conexao,
          `SELECT status AS s, pendencias AS p FROM pedido.pedido WHERE id = '${id}'`,
          WORKER_A,
        ),
      ).toEqual([{ s: 'recusado', p: JSON.parse(p) }]);
    }
    // P não exige bloqueante = true: a pendência de prazo já aceita também passa em recusado.
    executar(banco.conexao, sair(INCOMPLETO, 'recusado', ACIMA_ACEITA), WORKER_A);
  });

  it('FDV em recusado sem pendência, com outra pendência, prazo junto de outra ou prazo malformado cai', () => {
    caiSaida(ACIMA, 'recusado', '[]', CK_ANALISE);
    caiSaida(ACIMA, 'recusado', CREDITO, CK_ANALISE);
    caiSaida(ACIMA, 'recusado', `[${pend('prazo_acima_do_cliente')}, ${pend('credito_excedido')}]`, CK_ANALISE);
    caiSaida(ACIMA, 'recusado', '[{"codigo": "prazo_incompleto"}]', CK_ANALISE);
    caiSaida(ACIMA, 'recusado', '[{"codigo": "prazo_incompleto", "bloqueante": "sim"}]', CK_ANALISE);
    caiSaida(ACIMA, 'recusado', '["prazo_acima_do_cliente"]', CK_ANALISE);
  });

  it('FDV em em_analise vai a aprovado sem pendência ou com a pendência de prazo não bloqueante (aceita)', () => {
    for (const p of [[], JSON.parse(INCOMPLETO_ACEITA), JSON.parse(ACIMA_ACEITA), JSON.parse(AS_DUAS_ACEITAS)]) {
      executar(banco.conexao, sair(AS_DUAS, 'aprovado', JSON.stringify(p)), WORKER_A);
    }
    // Direto do recebido (o servico grava status e pendências num UPDATE só).
    const id = passa('fdv', 'aprovado', ACIMA_ACEITA);
    expect(
      consultar<{ s: string; p: unknown }>(
        banco.conexao,
        `SELECT status AS s, pendencias AS p FROM pedido.pedido WHERE id = '${id}'`,
        WORKER_A,
      ),
    ).toEqual([{ s: 'aprovado', p: JSON.parse(ACIMA_ACEITA) }]);
  });

  it('FDV em aprovado com pendência bloqueante, outra pendência ou prazo junto de outra cai (pedido_fdv_sem_pendencia)', () => {
    caiSaida(ACIMA, 'aprovado', ACIMA, CK_PENDENCIA);
    caiSaida(ACIMA, 'aprovado', `[${pend('prazo_incompleto', false)}, ${pend('prazo_acima_do_cliente')}]`, CK_PENDENCIA);
    caiSaida(ACIMA, 'aprovado', CREDITO, CK_PENDENCIA);
    caiSaida(ACIMA, 'aprovado', `[${pend('prazo_incompleto', false)}, ${pend('credito_excedido', false)}]`, CK_PENDENCIA);
    caiSaida(ACIMA, 'aprovado', '[{"codigo": "prazo_incompleto"}]', CK_PENDENCIA);
    cai('fdv', 'aprovado', ACIMA, CK_PENDENCIA);
  });

  it('FDV nos outros status segue só com pendencias vazia', () => {
    recusaDetalhada(
      banco.conexao,
      pedidoSql({ origem: 'fdv', externalId: randomUUID(), pendencias: INCOMPLETO }),
      '23514',
      new RegExp(`"${CK_PENDENCIA}"`),
      WORKER_A,
    );
    recusaDetalhada(
      banco.conexao,
      pedidoSql({ origem: 'fdv', externalId: randomUUID(), pendencias: INCOMPLETO_ACEITA }),
      '23514',
      new RegExp(`"${CK_PENDENCIA}"`),
      WORKER_A,
    );
    // Aprovado com a pendência aceita não leva a pendência a cancelado (nenhum caso novo além de em_analise, recusado e aprovado).
    const id = passa('fdv', 'aprovado', ACIMA_ACEITA);
    recusaDetalhada(
      banco.conexao,
      `UPDATE pedido.pedido SET status = 'cancelado' WHERE id = '${id}';`,
      '23514',
      new RegExp(`"${CK_PENDENCIA}"`),
      WORKER_A,
    );
  });

  it('o pedido manual segue como antes: em_analise com qualquer pendência, recusado e aprovado com pendência', () => {
    const id = passa('bko', 'em_analise', CREDITO);
    executar(banco.conexao, `UPDATE pedido.pedido SET status = 'recusado' WHERE id = '${id}';`, APP_A);
    passa('bko', 'em_analise', '[]');
    passa('bko', 'em_analise', INCOMPLETO);
    passa('bko', 'aprovado', CREDITO);
    passa('bko', 'aprovado', ACIMA);
  });

  it('a 0056 e a 0016 são reexecutáveis (as definições novas ficam)', () => {
    const antes = consultar<{ def: string }>(
      banco.conexao,
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'pedido.pedido'::regclass AND conname IN ('${CK_ANALISE}', '${CK_PENDENCIA}') ORDER BY conname`,
    );
    for (const m of [MIGRACAO, '0016_pedido_a_vista_e_d_a.sql', MIGRACAO]) {
      rodarScript(banco.conexao, readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'), { transacao: true });
    }
    const depois = consultar<{ def: string }>(
      banco.conexao,
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'pedido.pedido'::regclass AND conname IN ('${CK_ANALISE}', '${CK_PENDENCIA}') ORDER BY conname`,
    );
    expect(depois).toEqual(antes);
    expect(depois).toHaveLength(2);
  });
});
