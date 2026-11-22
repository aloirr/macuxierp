/**
 * T-0015 (lote 4b), migração 0027: recuo por nota cancelada; regras em docs/banco/README.md (0027).
 * Roda com o superusuário (5432) e com o admin sem superusuário (5433).
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
  falhaDetalhada,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixturePedido, fixturePlataforma, novoTenant, sqlDePedido } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0027_pedido_recuo_nota.sql', import.meta.url));
const A = novoTenant('recuo-0027-a');
const WORKER = { papel: 'macuxierp_worker', tenant: A.id };
const APP = { papel: 'macuxierp_app', tenant: A.id };
const GUC = `SELECT set_config('macuxierp.recuo_nota', 'on', true);`;
/** Dois itens de 1,0000 a R$ 1,00 (itemSql da fixture; Qtd4 e centavos): total 200. */
const QTD = 10000;
const TOTAL = 200;
const { pedidoSql, itemSql } = sqlDePedido(A.id, 500);

type Status = 'faturado' | 'faturado_parcial' | 'cancelado' | 'recusado' | 'aprovado';

/** Pedido novo (pelo worker) com dois itens, levado pelas transições da RN-PED-02 até o status pedido. */
function montar(status: Status): string {
  const id = randomUUID();
  const passos: string[] = [pedidoSql({ id, total: TOTAL }), itemSql(id, 1), itemSql(id, 2)];
  if (status === 'recusado') {
    passos.push(paraStatus(id, 'em_analise'), paraStatus(id, 'recusado'));
  } else {
    passos.push(paraStatus(id, 'aprovado'));
  }
  if (status === 'cancelado') passos.push(paraStatus(id, 'cancelado'));
  // Como o consumidor da nota autorizada: itens e valor antes do status.
  if (status === 'faturado') passos.push(ajustar(id, QTD, QTD, TOTAL), paraStatus(id, 'faturado'));
  if (status === 'faturado_parcial') passos.push(ajustar(id, QTD, 0, 100), paraStatus(id, 'faturado_parcial'));
  executar(banco.conexao, passos.join('\n'), WORKER);
  return id;
}

/** Itens e valor depois da nota cancelada (sem mexer no status). */
function ajustar(id: string, item1: number, item2: number, valor: number): string {
  return `UPDATE pedido.pedido_item SET quantidade_faturada = CASE sequencia WHEN 1 THEN ${item1} ELSE ${item2} END
     WHERE pedido_id = '${id}';
   UPDATE pedido.pedido SET valor_faturado_centavos = ${valor} WHERE id = '${id}';`;
}

function paraStatus(id: string, status: string): string {
  return `UPDATE pedido.pedido SET status = '${status}' WHERE id = '${id}';`;
}

/** Recuo como o consumidor da nota cancelada: GUC, itens [item1, item2, valor] e, num comando separado, o status. */
const recuo = (id: string, [i1, i2, v]: readonly [number, number, number], para: string): string =>
  `${GUC}\n${ajustar(id, i1, i2, v)}\n${paraStatus(id, para)}`;

function statusDe(id: string): { status: string; alterado: string } {
  const [r] = consultar<{ status: string; alterado: string }>(
    banco.conexao,
    `SELECT status, to_char(status_alterado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS alterado
     FROM pedido.pedido WHERE id = '${id}'`,
  );
  if (!r) throw new Error(`pedido ${id} não encontrado`);
  return r;
}

const MXP02 = /MXP02: RN-PED-02: transição de/;

interface Caso {
  de: Status;
  itens: readonly [number, number, number];
  para: string;
}

let banco: BancoDeTeste;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — recuo do pedido por nota cancelada (T-0015, 0027)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixturePedido(A));
  });

  afterAll(() => banco?.remover());

  describe('worker com o GUC: recuo coerente passa', () => {
    it.each<Caso>([
      { de: 'faturado', itens: [0, 0, 0], para: 'aprovado' },
      { de: 'faturado', itens: [QTD, 0, 100], para: 'faturado_parcial' },
      { de: 'faturado', itens: [QTD, 4000, 140], para: 'faturado_parcial' },
      { de: 'faturado_parcial', itens: [0, 0, 0], para: 'aprovado' },
    ])('$de → $para com [item1, item2, valor] = $itens', ({ de, itens, para }) => {
      const id = montar(de);
      rodarComo(banco.conexao, recuo(id, itens, para), WORKER);
      expect(statusDe(id).status).toBe(para);
    });

    it('faturado → faturado_parcial com status e valor no mesmo UPDATE', () => {
      const id = montar('faturado');
      rodarComo(
        banco.conexao,
        `${GUC}
         UPDATE pedido.pedido_item SET quantidade_faturada = 0 WHERE pedido_id = '${id}' AND sequencia = 2;
         UPDATE pedido.pedido SET valor_faturado_centavos = 100, status = 'faturado_parcial' WHERE id = '${id}';`,
        WORKER,
      );
      expect(statusDe(id).status).toBe('faturado_parcial');
    });

    it('item excluído (deleted_at) não conta na coerência', () => {
      const id = montar('faturado');
      rodarComo(
        banco.conexao,
        `${GUC}
         UPDATE pedido.pedido_item SET quantidade_faturada = 0 WHERE pedido_id = '${id}' AND sequencia = 1;
         UPDATE pedido.pedido_item SET deleted_at = now() WHERE pedido_id = '${id}' AND sequencia = 2;
         UPDATE pedido.pedido SET valor_faturado_centavos = 0 WHERE id = '${id}';
         ${paraStatus(id, 'aprovado')}`,
        WORKER,
      );
      expect(statusDe(id).status).toBe('aprovado');
    });

    it('status_alterado_em é atualizado', () => {
      const id = montar('faturado');
      const antes = statusDe(id).alterado;
      rodarComo(banco.conexao, recuo(id, [0, 0, 0], 'aprovado'), WORKER);
      expect(statusDe(id).alterado > antes).toBe(true);
    });
  });

  describe('fora das condições: MXP02', () => {
    it.each<Caso>([
      { de: 'faturado', itens: [0, 0, 1], para: 'aprovado' },
      { de: 'faturado', itens: [0, 1, 0], para: 'aprovado' },
      { de: 'faturado_parcial', itens: [QTD, 0, 0], para: 'aprovado' },
      { de: 'faturado', itens: [QTD, QTD, TOTAL], para: 'faturado_parcial' },
      { de: 'faturado', itens: [0, 0, 0], para: 'faturado_parcial' },
    ])('$de → $para com [item1, item2, valor] = $itens', ({ de, itens, para }) => {
      const id = montar(de);
      recusaDetalhada(banco.conexao, recuo(id, itens, para), 'MXP02', MXP02, WORKER);
    });

    it('GUC com outro valor que não on', () => {
      const id = montar('faturado');
      recusaDetalhada(
        banco.conexao,
        `SELECT set_config('macuxierp.recuo_nota', 'true', true);\n${ajustar(id, 0, 0, 0)}\n${paraStatus(id, 'aprovado')}`,
        'MXP02',
        MXP02,
        WORKER,
      );
    });

    it('app com o GUC (itens e valor já zerados pelo worker)', () => {
      const id = montar('faturado');
      executar(banco.conexao, ajustar(id, 0, 0, 0), WORKER);
      recusaDetalhada(banco.conexao, `${GUC}\n${paraStatus(id, 'aprovado')}`, 'MXP02', MXP02, APP);
    });

    it('admin sem SET ROLE com o GUC', () => {
      const id = montar('faturado');
      executar(banco.conexao, ajustar(id, 0, 0, 0), WORKER);
      recusaDetalhada(banco.conexao, `${GUC}\n${paraStatus(id, 'aprovado')}`, 'MXP02', MXP02);
      expect(statusDe(id).status).toBe('faturado');
    });

    it('cancelado e recusado nunca recuam, nem com worker e GUC', () => {
      for (const de of ['cancelado', 'recusado'] as const) {
        const id = montar(de);
        const e = falhaDetalhada(() =>
          executar(banco.conexao, verboso(`${GUC}\n${paraStatus(id, 'aprovado')}`), WORKER),
        );
        expect(e.saida).toContain('MXP02');
      }
    });

    it('recebido e em_analise não vão a faturado_parcial nem a aprovado por recuo', () => {
      const id = randomUUID();
      executar(banco.conexao, pedidoSql({ id, total: TOTAL }), WORKER);
      recusaDetalhada(banco.conexao, `${GUC}\n${paraStatus(id, 'faturado_parcial')}`, 'MXP02', MXP02, WORKER);
      executar(banco.conexao, paraStatus(id, 'em_analise'), WORKER);
      recusaDetalhada(banco.conexao, `${GUC}\n${paraStatus(id, 'faturado_parcial')}`, 'MXP02', MXP02, WORKER);
    });

    it('itens num CTE do mesmo comando do status: mesmo snapshot, o recuo cai em MXP02', () => {
      const id = montar('faturado');
      recusaDetalhada(
        banco.conexao,
        `${GUC}
         UPDATE pedido.pedido SET valor_faturado_centavos = 0 WHERE id = '${id}';
         WITH i AS (UPDATE pedido.pedido_item SET quantidade_faturada = 0 WHERE pedido_id = '${id}' RETURNING 1)
         UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${id}' AND EXISTS (SELECT 1 FROM i);`,
        'MXP02',
        MXP02,
        WORKER,
      );
      expect(statusDe(id).status).toBe('faturado');
      // Controle: os mesmos itens num comando separado, antes do status, passam.
      rodarComo(banco.conexao, recuo(id, [0, 0, 0], 'aprovado'), WORKER);
      expect(statusDe(id).status).toBe('aprovado');
    });

    it('o GUC de set_config(..., true) não vaza para a transação seguinte', () => {
      const id = montar('faturado');
      const e = falhaDetalhada(() =>
        rodarScript(
          banco.conexao,
          verboso(`SET ROLE macuxierp_worker;
SET app.tenant_id = '${A.id}';
BEGIN;
${GUC}
COMMIT;
BEGIN;
${ajustar(id, 0, 0, 0)}
${paraStatus(id, 'aprovado')}
COMMIT;`),
        ),
      );
      expect(e.saida).toContain('MXP02');
      expect(statusDe(id).status).toBe('faturado');
      // Controle: o mesmo recuo com o GUC na própria transação passa.
      rodarComo(banco.conexao, recuo(id, [0, 0, 0], 'aprovado'), WORKER);
      expect(statusDe(id).status).toBe('aprovado');
    });
  });

  it('recuo_coerente é STABLE e com search_path fixo', () => {
    const [f] = consultar<{ vol: string; cfg: string[] | null }>(
      banco.conexao,
      `SELECT provolatile::text AS vol, proconfig AS cfg FROM pg_proc
       WHERE oid = 'pedido.recuo_coerente(pedido.pedido)'::regprocedure`,
    );
    expect(f).toEqual({ vol: 's', cfg: ['search_path=pg_catalog, pg_temp'] });
  });

  it('a 0027 reexecuta sem erro e mantém o recuo', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    expect(sql).toContain(`SET LOCAL lock_timeout = '5s';`);
    rodarScript(banco.conexao, `BEGIN;\n${sql}\nCOMMIT;`);
    rodarScript(banco.conexao, `BEGIN;\n${sql}\nCOMMIT;`);
    const id = montar('faturado');
    rodarComo(banco.conexao, recuo(id, [0, 0, 0], 'aprovado'), WORKER);
    expect(statusDe(id).status).toBe('aprovado');
  });
});
