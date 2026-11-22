/**
 * T-0015 (migração 0019): CHECK estrito condicao_parcelas_cartao_forma_ck, NOT VALID, em cadastros.condicao_pagamento
 * (cartão ativo com parcelas, outra forma sem; a linha inativa fica de fora) e o novo COMMENT de pedido.pedido.a_vista (docs/banco/README.md).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  erroDetalhadoDe,
  executar,
  falhaDetalhada,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, inserirCondicao, novoTenant } from './fixture.ts';

const MIGRACAO = '0019_condicao_parcelas_estrita.sql';
const CK = 'condicao_parcelas_cartao_forma_ck';
const CK_0017 = 'condicao_parcelas_cartao_ck';
const COMENTARIO = 'pedido fora do crédito do cliente (à vista ou cartão), gravado na criação, na edição e na aprovação';
const A = novoTenant('estrita-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — parcelas do cartão estritas na condição (T-0015, 0019)',
  () => {
    let banco: BancoDeTeste;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      // A massa comum (condição AV, forma '01', sem parcelas) passa pelo CHECK novo.
      executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A));
    });

    afterAll(() => banco?.remover());

    it('o CHECK novo existe e nasce NOT VALID (convalidated = false); o da 0017 segue validado e vem antes na ordem de nome', () => {
      const r = consultar<{ nome: string; validada: boolean }>(
        banco.conexao,
        `SELECT conname AS nome, convalidated AS validada FROM pg_constraint
       WHERE conrelid = 'cadastros.condicao_pagamento'::regclass AND conname IN ('${CK}', '${CK_0017}')
       ORDER BY conname`,
      );
      expect(r).toEqual([
        { nome: CK_0017, validada: true },
        { nome: CK, validada: false },
      ]);
    });

    it('forma 03 sem parcelas falha com 23514 e o nome do CHECK novo', () => {
      const e = falhaDetalhada(() =>
        executar(banco.conexao, verboso(inserirCondicao(A.id, 'CN', '03', 'NULL')), APP_A),
      );
      expect(e.saida).toMatch(/23514/);
      expect(e.mensagem).toMatch(new RegExp(CK));
    });

    it('forma 03 com parcelas e forma 01 sem parcelas passam no CHECK novo', () => {
      executar(
        banco.conexao,
        inserirCondicao(A.id, 'C1', '03', '1') + inserirCondicao(A.id, 'D0', '01', 'NULL'),
        APP_A,
      );
      const [r] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM cadastros.condicao_pagamento WHERE codigo IN ('C1', 'D0')`,
        APP_A,
      );
      expect(r).toEqual({ n: 2 });
    });

    it('o COMMENT de pedido.pedido.a_vista é o texto novo', () => {
      const [r] = consultar<{ c: string }>(
        banco.conexao,
        `SELECT col_description('pedido.pedido'::regclass, a.attnum) AS c FROM pg_attribute a
       WHERE a.attrelid = 'pedido.pedido'::regclass AND a.attname = 'a_vista'`,
      );
      expect(r).toEqual({ c: COMENTARIO });
    });

    it('a 0019 é reexecutável: rodar o arquivo de novo não dá erro nem duplica o CHECK', () => {
      const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
      rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
      const [r] = consultar<{ n: number; validada: boolean }>(
        banco.conexao,
        `SELECT count(*)::int AS n, bool_and(convalidated) AS validada FROM pg_constraint
       WHERE conrelid = 'cadastros.condicao_pagamento'::regclass AND conname = '${CK}'`,
      );
      expect(r).toEqual({ n: 1, validada: false });
    });
  },
);

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — 0019 sobre condição de cartão antiga sem parcelas (T-0015)',
  () => {
    let banco: BancoDeTeste;
    let anteriores: PastaDeMigracoes;
    const B = novoTenant('estrita-b');
    const APP_B = { papel: 'macuxierp_app', tenant: B.id };

    beforeAll(() => {
      banco = criarBancoDeTeste();
      anteriores = pastaComMigracoesAntesDe('0019');
    });

    afterAll(() => {
      banco?.remover();
      anteriores?.remover();
    });

    it('a linha antiga não impede a 0019; depois, só o UPDATE que preenche parcelas passa', () => {
      expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
      executar(
        banco.conexao,
        `${fixturePlataforma(B)}
       INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias)
         VALUES ('${B.id}', 'CARTAO', 'Cartão antigo', '03', '{30}'),
                ('${B.id}', 'CARTAO2', 'Cartão antigo 2', '03', '{30}');`,
      );

      expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
      expect(migrar(banco.conexao, { oficiais: false })).not.toContain(MIGRACAO);
      permitirSetRole(banco.conexao);

      // UPDATE só da descrição (ou desativar) numa linha antiga cai no CHECK novo até a limpeza.
      const e = falhaDetalhada(() =>
        executar(
          banco.conexao,
          verboso(
            "UPDATE cadastros.condicao_pagamento SET descricao = 'Cartão (editado)' WHERE codigo = 'CARTAO';",
          ),
          APP_B,
        ),
      );
      expect(e.saida).toMatch(/23514/);
      expect(e.mensagem).toMatch(new RegExp(CK));

      // A limpeza preenche as parcelas no mesmo UPDATE, ou desativa (como inativar do cadastros: só deleted_at).
      executar(
        banco.conexao,
        `UPDATE cadastros.condicao_pagamento SET parcelas_cartao = 1, descricao = 'Cartão (limpo)'
       WHERE codigo = 'CARTAO';
       UPDATE cadastros.condicao_pagamento SET deleted_at = now() WHERE codigo = 'CARTAO2';`,
        APP_B,
      );

      // Reativar o cartão sem parcelas volta a exigir as parcelas.
      const reativar = falhaDetalhada(() =>
        executar(
          banco.conexao,
          verboso("UPDATE cadastros.condicao_pagamento SET deleted_at = NULL WHERE codigo = 'CARTAO2';"),
          APP_B,
        ),
      );
      expect(reativar.saida).toMatch(/23514/);
      expect(reativar.mensagem).toMatch(new RegExp(CK));

      const linhas = consultar<{ codigo: string; forma: string; p: number | null }>(
        banco.conexao,
        `SELECT codigo, forma_tpag AS forma, parcelas_cartao AS p FROM cadastros.condicao_pagamento
       WHERE tenant_id = '${B.id}' ORDER BY codigo`,
      );
      expect(linhas).toEqual([
        { codigo: 'CARTAO', forma: '03', p: 1 },
        { codigo: 'CARTAO2', forma: '03', p: null },
      ]);

      // Sem linha antiga violando, a validação futura já passaria.
      expect(
        erroDetalhadoDe(() =>
          rodarScript(banco.conexao, `ALTER TABLE cadastros.condicao_pagamento VALIDATE CONSTRAINT ${CK};`),
        ),
      ).toBeNull();
    });
  },
);
