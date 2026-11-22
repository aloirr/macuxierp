/**
 * T-0015 (migração 0017): condicao_pagamento.parcelas_cartao e o CHECK permissivo e validado
 * condicao_parcelas_cartao_ck. A invariante estrita fica para a 0019 (docs/banco/README.md): aqui o banco para antes
 * dela (pastaComMigracoesAntesDe('0019')); o comportamento com a 0019 está em condicao-parcelas-0019.db.test.ts.
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

const MIGRACAO = '0017_condicao_parcelas_cartao.sql';
const CK = 'condicao_parcelas_cartao_ck';
const A = novoTenant('parcelas-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — parcelas do cartão na condição (T-0015, 0017)', () => {
  let banco: BancoDeTeste;
  let ate0018: PastaDeMigracoes;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    ate0018 = pastaComMigracoesAntesDe('0019');
    migrar(banco.conexao, { pasta: ate0018.pasta, oficiais: false });
    permitirSetRole(banco.conexao);
    // A massa comum (condição AV, forma '01', sem parcelas) passa pelo CHECK.
    executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A));
  });

  afterAll(() => {
    banco?.remover();
    ate0018?.remover();
  });

  it('parcelas_cartao é smallint anulável, sem padrão', () => {
    const colunas = consultar<{ tipo: string; nula: string; padrao: string | null }>(
      banco.conexao,
      `SELECT data_type AS tipo, is_nullable AS nula, column_default AS padrao FROM information_schema.columns
       WHERE table_schema = 'cadastros' AND table_name = 'condicao_pagamento' AND column_name = 'parcelas_cartao'`,
    );
    expect(colunas).toEqual([{ tipo: 'smallint', nula: 'YES', padrao: null }]);
  });

  it('o CHECK existe e já nasce validado (convalidated = true)', () => {
    const [r] = consultar<{ tipo: string; validada: boolean }>(
      banco.conexao,
      `SELECT contype AS tipo, convalidated AS validada FROM pg_constraint
       WHERE conrelid = 'cadastros.condicao_pagamento'::regclass AND conname = '${CK}'`,
    );
    expect(r).toEqual({ tipo: 'c', validada: true });
  });

  it('a 0017 é reexecutável: rodar o arquivo de novo não muda nada', () => {
    const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
    rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
    const [r] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM pg_constraint
       WHERE conrelid = 'cadastros.condicao_pagamento'::regclass AND conname = '${CK}'`,
    );
    expect(r).toEqual({ n: 1 });
  });

  it('forma 03: nulo, 1 e 12 passam; 0 e 13 falham com 23514 e o nome do CHECK', () => {
    executar(
      banco.conexao,
      inserirCondicao(A.id, 'CN', '03', 'NULL') +
        inserirCondicao(A.id, 'C1', '03', '1') +
        inserirCondicao(A.id, 'C12', '03', '12'),
      APP_A,
    );
    for (const valor of ['0', '13']) {
      const e = falhaDetalhada(() =>
        executar(banco.conexao, verboso(inserirCondicao(A.id, `C${valor}`, '03', valor)), APP_A),
      );
      expect({ valor, saida: e.saida }).toMatchObject({ valor, saida: expect.stringMatching(/23514/) });
      expect(e.mensagem).toMatch(new RegExp(CK));
    }
  });

  it('outra forma: com parcelas falha; com nulo passa', () => {
    const e = falhaDetalhada(() =>
      executar(banco.conexao, verboso(inserirCondicao(A.id, 'D3', '01', '3')), APP_A),
    );
    expect(e.saida).toMatch(/23514/);
    expect(e.mensagem).toMatch(new RegExp(CK));
    executar(banco.conexao, inserirCondicao(A.id, 'D0', '01', 'NULL'), APP_A);
  });

  it('o app atualiza parcelas_cartao (com o CHECK valendo no UPDATE); a leitura só lê', () => {
    executar(banco.conexao, "UPDATE cadastros.condicao_pagamento SET parcelas_cartao = 6 WHERE codigo = 'C1';", APP_A);
    const ruim = falhaDetalhada(() =>
      executar(
        banco.conexao,
        verboso("UPDATE cadastros.condicao_pagamento SET parcelas_cartao = 13 WHERE codigo = 'C1';"),
        APP_A,
      ),
    );
    expect(ruim.saida).toMatch(/23514/);

    const lidas = consultar<{ p: number }>(
      banco.conexao,
      "SELECT parcelas_cartao AS p FROM cadastros.condicao_pagamento WHERE codigo IN ('C1', 'C12') ORDER BY codigo",
      LEITURA_A,
    );
    expect(lidas).toEqual([{ p: 6 }, { p: 12 }]);

    const negado = erroDetalhadoDe(() =>
      executar(
        banco.conexao,
        verboso("UPDATE cadastros.condicao_pagamento SET parcelas_cartao = 2 WHERE codigo = 'C1';"),
        LEITURA_A,
      ),
    );
    expect(negado?.saida).toMatch(/42501/);
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0017 sobre condição de cartão antiga sem parcelas (T-0015)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  let ate0018: PastaDeMigracoes;
  const B = novoTenant('parcelas-b');

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0017');
    ate0018 = pastaComMigracoesAntesDe('0019');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
    ate0018?.remover();
  });

  it('o cartão sem parcelas gravado antes não impede a 0017 e segue aceitando UPDATE; a reexecução não aplica de novo', () => {
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    executar(
      banco.conexao,
      `${fixturePlataforma(B)}
       INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias)
         VALUES ('${B.id}', 'CARTAO', 'Cartão antigo', '03', '{30}');`,
    );

    expect(migrar(banco.conexao, { pasta: ate0018.pasta, oficiais: false })).toContain(MIGRACAO);
    expect(migrar(banco.conexao, { pasta: ate0018.pasta, oficiais: false })).not.toContain(MIGRACAO);

    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      `UPDATE cadastros.condicao_pagamento SET descricao = 'Cartão antigo (editado)', deleted_at = now()
       WHERE codigo = 'CARTAO';`,
      { papel: 'macuxierp_app', tenant: B.id },
    );

    const [r] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM cadastros.condicao_pagamento
       WHERE tenant_id = '${B.id}' AND forma_tpag = '03' AND parcelas_cartao IS NULL`,
    );
    expect(r).toEqual({ n: 1 });
  });
});
