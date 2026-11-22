/**
 * T-0014: schema pedido (migração 0012, desenho T-0013 seções 2 e 7) — vazamento entre tenants nas 5 tabelas, matriz
 * de privilégios (tabela e coluna, sem DELETE para ninguém), idempotência do pedido do FDV (RN-PED-01), transições de
 * status (RN-PED-02, gatilho com SQLSTATE MXP02), histórico e decisão só de inserção, CHECKs e FKs compostas.
 * Roda com o superusuário (5432) e com o admin sem superusuário (5433), sempre pelos papéis da aplicação.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  erroDetalhadoDe,
  executar,
  falha,
  falhaDetalhada,
  numeros,
  PAPEIS_APP,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
} from './apoio.ts';
import { fixturePedido, fixturePlataforma, novoTenant } from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const A = novoTenant('pedido-a');
const B = novoTenant('pedido-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };

const TABELAS = ['aprovacao', 'numeracao', 'pedido', 'pedido_evento', 'pedido_item'] as const;
type TabelaPedido = (typeof TABELAS)[number];

/** Privilégios de tabela (S, I, U, D, T; "-" = nenhum). UPDATE é só por coluna (teste próprio). */
const PRIVILEGIOS: Record<TabelaPedido, Record<(typeof PAPEIS_APP)[number], string>> = {
  aprovacao: { macuxierp_app: 'SI', macuxierp_worker: 'SI', macuxierp_leitura: 'S' },
  numeracao: { macuxierp_app: 'SI', macuxierp_worker: 'SI', macuxierp_leitura: 'S' },
  pedido: { macuxierp_app: 'SI', macuxierp_worker: 'SI', macuxierp_leitura: 'S' },
  pedido_evento: { macuxierp_app: 'SI', macuxierp_worker: 'SI', macuxierp_leitura: 'S' },
  pedido_item: { macuxierp_app: 'SI', macuxierp_worker: 'SI', macuxierp_leitura: 'S' },
};

const CABECALHO = [
  'cliente_id',
  'cliente_retrato',
  'condicao_pagamento_id',
  'deleted_at',
  'endereco_entrega',
  'filial_id',
  'frete',
  'observacao',
  'pendencias',
  'status',
  'tabela_preco_id',
  'total_centavos',
  'validado_em',
  'vendedor_id',
];
const ITEM = [
  'aplicacao',
  'deleted_at',
  'desconto_centavos',
  'desconto_maximo_bp',
  'fator_venda',
  'preco_tabela_centavos',
  'preco_unitario_centavos',
  'quantidade',
  'quantidade_venda',
  'total_centavos',
  'unidade_venda',
];

/** Colunas que cada papel pode atualizar (UPDATE por coluna, seção 7). */
const UPDATE_POR_COLUNA: { papel: string; tabela: TabelaPedido; colunas: string[] }[] = [
  { papel: 'macuxierp_app', tabela: 'numeracao', colunas: ['proximo'] },
  { papel: 'macuxierp_app', tabela: 'pedido', colunas: CABECALHO },
  { papel: 'macuxierp_app', tabela: 'pedido_item', colunas: ITEM },
  { papel: 'macuxierp_app', tabela: 'pedido_evento', colunas: [] },
  { papel: 'macuxierp_app', tabela: 'aprovacao', colunas: [] },
  { papel: 'macuxierp_worker', tabela: 'numeracao', colunas: ['proximo'] },
  { papel: 'macuxierp_worker', tabela: 'pedido', colunas: [...CABECALHO, 'valor_faturado_centavos'].sort() },
  { papel: 'macuxierp_worker', tabela: 'pedido_item', colunas: [...ITEM, 'quantidade_faturada'].sort() },
  { papel: 'macuxierp_worker', tabela: 'pedido_evento', colunas: [] },
  { papel: 'macuxierp_worker', tabela: 'aprovacao', colunas: [] },
  ...TABELAS.map((tabela) => ({ papel: 'macuxierp_leitura', tabela, colunas: [] as string[] })),
];

/** Transições da seção 2 (RN-PED-02). */
const TRANSICOES: Record<string, string[]> = {
  recebido: ['aprovado', 'em_analise'],
  em_analise: ['aprovado', 'recusado'],
  aprovado: ['cancelado', 'faturado', 'faturado_parcial'],
  recusado: [],
  faturado_parcial: ['cancelado', 'faturado'],
  faturado: [],
  cancelado: [],
};
const STATUS = Object.keys(TRANSICOES);
/** Caminho válido a partir de recebido até cada status. */
const CAMINHO: Record<string, string[]> = {
  recebido: [],
  em_analise: ['em_analise'],
  aprovado: ['aprovado'],
  recusado: ['em_analise', 'recusado'],
  faturado_parcial: ['aprovado', 'faturado_parcial'],
  faturado: ['aprovado', 'faturado'],
  cancelado: ['aprovado', 'cancelado'],
};

let proximoNumero = 100;

interface NovoPedido {
  id?: string;
  tenant?: string;
  origem?: 'fdv' | 'bko';
  externalId?: string | null;
  status?: string;
  total?: number;
  pendencias?: string;
}

/** INSERT de um pedido com número novo (valores fictícios, sem dado pessoal real). */
function pedidoSql(p: NovoPedido = {}): string {
  const tenant = p.tenant ?? A.id;
  const ext = p.externalId === undefined || p.externalId === null ? 'NULL' : `'${p.externalId}'`;
  const colStatus = p.status === undefined ? '' : ', status';
  const valStatus = p.status === undefined ? '' : `, '${p.status}'`;
  const colPend = p.pendencias === undefined ? '' : ', pendencias';
  const valPend = p.pendencias === undefined ? '' : `, '${p.pendencias}'`;
  return `INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, cliente_retrato, emitido_em,
      total_centavos, external_id${colStatus}${colPend})
    VALUES ('${p.id ?? randomUUID()}', '${tenant}', ${proximoNumero++}, '${p.origem ?? 'bko'}', gen_random_uuid(),
      gen_random_uuid(), '{"tipo_pessoa": "PJ"}', now(), ${p.total ?? 1000}, ${ext}${valStatus}${valPend});`;
}

function itemSql(
  pedido: string,
  sequencia: number,
  extra: { retrato?: string; faturada?: number } = {},
): string {
  return `INSERT INTO pedido.pedido_item (tenant_id, pedido_id, sequencia, produto_id, produto_retrato, quantidade,
      preco_unitario_centavos, total_centavos, quantidade_faturada)
    VALUES ('${A.id}', '${pedido}', ${sequencia}, gen_random_uuid(), '${extra.retrato ?? '{"codigo": "P1"}'}', 10000,
      100, 100, ${extra.faturada ?? 0});`;
}

const verboso = (sql: string): string => `\\set VERBOSITY verbose\n${sql}`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — pedido (T-0014)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixturePedido(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('tem exatamente as cinco tabelas da seção 7', () => {
    const linhas = consultar<{ t: string }>(
      banco.conexao,
      `SELECT k.relname AS t FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
       WHERE n.nspname = 'pedido' AND k.relkind IN ('r', 'p') ORDER BY 1`,
    );
    expect(linhas.map((l) => l.t)).toEqual([...TABELAS]);
  });

  it('não vaza entre tenants em nenhuma tabela de pedido, para nenhum papel', () => {
    expect(verificarVazamento(banco.conexao, ['pedido'], A.id, B.id)).toEqual([]);
  });

  it('sem FK para outro schema (só plataforma.tenant), sem worker_global e sem SECURITY DEFINER', () => {
    const fks = consultar<{ t: string; alvo: string }>(
      banco.conexao,
      `SELECT c.conrelid::regclass::text AS t, c.confrelid::regclass::text AS alvo FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'pedido' AND c.contype = 'f' AND c.confrelid::regclass::text NOT LIKE 'pedido.%'
         AND c.confrelid <> 'plataforma.tenant'::regclass`,
    );
    expect(fks).toEqual([]);
    const compostas = consultar<{ t: string }>(
      banco.conexao,
      `SELECT c.conrelid::regclass::text AS t FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'pedido' AND c.contype = 'f' AND c.confrelid = 'pedido.pedido'::regclass
         AND array_length(c.conkey, 1) = 2 ORDER BY 1`,
    );
    expect(compostas.map((c) => c.t)).toEqual([
      'pedido.aprovacao',
      'pedido.pedido_evento',
      'pedido.pedido_item',
    ]);
    const [p] = consultar<{ n: number }>(
      banco.conexao,
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'pedido' AND policyname <> 'isolamento_tenant'",
    );
    expect(p?.n).toBe(0);
    const [d] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
       WHERE n.nspname = 'pedido' AND f.prosecdef`,
    );
    expect(d?.n).toBe(0);
  });

  it('privilégios por tabela: o esperado e nenhum DELETE nem TRUNCATE para ninguém', () => {
    const obtido: Record<string, Record<string, string>> = {};
    for (const t of TABELAS) {
      obtido[t] = {};
      for (const papel of PAPEIS_APP) {
        const [r] = consultar<{ p: string }>(
          banco.conexao,
          `SELECT concat(
             CASE WHEN has_table_privilege('${papel}', 'pedido.${t}', 'SELECT') THEN 'S' END,
             CASE WHEN has_table_privilege('${papel}', 'pedido.${t}', 'INSERT') THEN 'I' END,
             CASE WHEN has_table_privilege('${papel}', 'pedido.${t}', 'UPDATE') THEN 'U' END,
             CASE WHEN has_table_privilege('${papel}', 'pedido.${t}', 'DELETE') THEN 'D' END,
             CASE WHEN has_table_privilege('${papel}', 'pedido.${t}', 'TRUNCATE') THEN 'T' END) AS p`,
        );
        obtido[t][papel] = r?.p || '-';
      }
    }
    expect(obtido).toEqual(PRIVILEGIOS);
  });

  it('UPDATE por coluna: app no cabeçalho e nos itens do manual; worker também no faturado; histórico e decisão sem UPDATE', () => {
    for (const { papel, tabela, colunas } of UPDATE_POR_COLUNA) {
      const obtidas = consultar<{ c: string }>(
        banco.conexao,
        `SELECT attname AS c FROM pg_attribute WHERE attrelid = 'pedido.${tabela}'::regclass
           AND attnum > 0 AND NOT attisdropped AND has_column_privilege('${papel}', attrelid, attnum, 'UPDATE')
         ORDER BY 1`,
      ).map((l) => l.c);
      expect({ papel, tabela, colunas: obtidas }).toEqual({ papel, tabela, colunas });
    }
  });

  it('amostra no comportamento: o app não apaga pedido (a matriz completa está no catálogo acima)', () => {
    expect(
      falha(() => executar(banco.conexao, `DELETE FROM pedido.pedido WHERE id = '${A.pedido}';`, APP_A)),
    ).toMatch(/permission denied/);
  });

  it('pedido_evento e aprovacao: só INSERT (a trava recusa UPDATE e DELETE até ao dono)', () => {
    for (const t of ['pedido_evento', 'aprovacao']) {
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE pedido.${t} SET deleted_at = now() WHERE tenant_id = '${A.id}';`),
        ),
      ).toMatch(/só de inserção/);
      expect(
        falha(() => executar(banco.conexao, `DELETE FROM pedido.${t} WHERE tenant_id = '${A.id}';`)),
      ).toMatch(/só de inserção/);
    }
    const id = randomUUID();
    executar(
      banco.conexao,
      `${pedidoSql({ id })}
       INSERT INTO pedido.pedido_evento (tenant_id, pedido_id, para, ator_tipo, ator_id)
         VALUES ('${A.id}', '${id}', 'recebido', 'usuario', '${A.usuario}');`,
      APP_A,
    );
  });

  it('amostra no comportamento: o app não grava o faturado; o worker grava', () => {
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE pedido.pedido SET valor_faturado_centavos = 0 WHERE id = '${A.pedido}';`,
          APP_A,
        ),
      ),
    ).toMatch(/permission denied/);
    executar(
      banco.conexao,
      `UPDATE pedido.pedido_item SET quantidade_faturada = 10000 WHERE pedido_id = '${A.pedido}';
       UPDATE pedido.pedido SET valor_faturado_centavos = 1990 WHERE id = '${A.pedido}';`,
      WORKER_A,
    );
    expect(
      consultar(
        banco.conexao,
        `SELECT p.valor_faturado_centavos AS v, i.quantidade_faturada AS qtd FROM pedido.pedido p
         JOIN pedido.pedido_item i ON i.tenant_id = p.tenant_id AND i.pedido_id = p.id WHERE p.id = '${A.pedido}'`,
        WORKER_A,
      ),
    ).toEqual([{ v: 1990, qtd: 10000 }]);
  });

  it('numeracao: uma por tenant; o número sai do UPDATE ... RETURNING, independente em cada tenant', () => {
    const proximo = 'UPDATE pedido.numeracao SET proximo = proximo + 1 RETURNING proximo - 1;';
    expect(
      numeros(
        rodarScript(
          banco.conexao,
          `SET ROLE macuxierp_worker; SET app.tenant_id = '${A.id}';\n${proximo}${proximo}`,
          { transacao: true },
        ),
      ),
    ).toEqual([2, 3]);
    expect(
      numeros(
        rodarScript(banco.conexao, `SET ROLE macuxierp_app; SET app.tenant_id = '${B.id}';\n${proximo}`, {
          transacao: true,
        }),
      ),
    ).toEqual([2]);
    expect(
      falha(() =>
        executar(banco.conexao, `INSERT INTO pedido.numeracao (tenant_id) VALUES ('${A.id}');`, APP_A),
      ),
    ).toMatch(/numeracao_um_por_tenant/);
    expect(falha(() => executar(banco.conexao, 'UPDATE pedido.numeracao SET proximo = 0;', APP_A))).toMatch(
      /check constraint/,
    );
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO pedido.pedido (tenant_id, numero, origem, filial_id, cliente_id, cliente_retrato, emitido_em,
             total_centavos) VALUES ('${A.id}', 1, 'bko', gen_random_uuid(), gen_random_uuid(), '{}', now(), 0);`,
          APP_A,
        ),
      ),
    ).toMatch(/pedido_numero_uq/);
  });

  describe('RN-PED-01: idempotência do pedido do FDV', () => {
    it('reenvio do mesmo external_id fdv no mesmo tenant falha pelo índice único; ON CONFLICT não cria outro', () => {
      expect(
        falha(() => executar(banco.conexao, pedidoSql({ origem: 'fdv', externalId: A.pedidoFdv }), WORKER_A)),
      ).toMatch(/duplicate key value violates unique constraint "pedido_external_id_uq"/);
      const conflito = pedidoSql({ origem: 'fdv', externalId: A.pedidoFdv }).replace(
        /;$/,
        ' ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING 1;',
      );
      expect(
        numeros(
          rodarScript(
            banco.conexao,
            `SET ROLE macuxierp_worker; SET app.tenant_id = '${A.id}';\n${conflito}`,
            { transacao: true },
          ),
        ),
      ).toEqual([]);
      const [r] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM pedido.pedido WHERE external_id = '${A.pedidoFdv}'`,
        WORKER_A,
      );
      expect(r?.n).toBe(1);
    });

    it('a unicidade é por tenant, não por origem: o BKO não repete o UUID de um pedido do FDV', () => {
      expect(
        falha(() => executar(banco.conexao, pedidoSql({ origem: 'bko', externalId: A.pedidoFdv }), APP_A)),
      ).toMatch(/"pedido_external_id_uq"/);
    });

    it('um só índice único no external_id do pedido (o da preparar_tabela)', () => {
      const indices = consultar<{ i: string }>(
        banco.conexao,
        `SELECT indexrelid::regclass::text AS i FROM pg_index WHERE indrelid = 'pedido.pedido'::regclass
           AND indisunique AND pg_get_indexdef(indexrelid) LIKE '%external_id%' ORDER BY 1`,
      );
      expect(indices.map((l) => l.i)).toEqual(['pedido.pedido_external_id_uq']);
    });

    it('o mesmo external_id em outro tenant passa', () => {
      const uuid = randomUUID();
      executar(banco.conexao, pedidoSql({ origem: 'fdv', externalId: uuid }), WORKER_A);
      executar(banco.conexao, pedidoSql({ tenant: B.id, origem: 'fdv', externalId: uuid }), WORKER_B);
    });

    it('o pedido excluído (deleted_at) continua bloqueando o reenvio', () => {
      const uuid = randomUUID();
      const id = randomUUID();
      executar(banco.conexao, pedidoSql({ id, origem: 'fdv', externalId: uuid }), WORKER_A);
      executar(banco.conexao, `UPDATE pedido.pedido SET deleted_at = now() WHERE id = '${id}';`, APP_A);
      expect(
        falha(() => executar(banco.conexao, pedidoSql({ origem: 'fdv', externalId: uuid }), WORKER_A)),
      ).toMatch(/duplicate key/);
    });

    it('pedido do FDV exige external_id em UUID canônico; o do BKO aceita texto livre ou nulo', () => {
      for (const ext of [null, 'PED-123', randomUUID().toUpperCase(), `${randomUUID()}x`]) {
        expect(
          falha(() => executar(banco.conexao, pedidoSql({ origem: 'fdv', externalId: ext }), WORKER_A)),
        ).toMatch(/pedido_fdv_external_id_uuid/);
      }
      executar(banco.conexao, pedidoSql({ externalId: 'PED-123' }) + pedidoSql(), APP_A);
      expect(falha(() => executar(banco.conexao, pedidoSql({ origem: 'manual' as 'bko' }), APP_A))).toMatch(
        /check constraint/,
      );
    });
  });

  describe('RN-PED-02: máquina de estados', () => {
    it('o pedido nasce recebido: criação com outro status é recusada com MXP02', () => {
      for (const status of STATUS.filter((s) => s !== 'recebido')) {
        const e = falhaDetalhada(() => executar(banco.conexao, verboso(pedidoSql({ status })), APP_A));
        expect(e.mensagem).toMatch(/MXP02: RN-PED-02: o pedido nasce recebido/);
        expect(e.saida).toMatch(/DETAIL:\s+possiveis=recebido\s/);
      }
      expect(falha(() => executar(banco.conexao, pedidoSql({ status: 'pendente' }), APP_A))).toMatch(
        /pedido\.status|check constraint/,
      );
    });

    it('aceita exatamente as transições da seção 2 (todos os pares de status)', () => {
      const aceitas: Record<string, string[]> = {};
      for (const de of STATUS) {
        aceitas[de] = [];
        for (const para of STATUS) {
          if (para === de) continue;
          const id = randomUUID();
          const caminho = CAMINHO[de]!.map(
            (s) => `UPDATE pedido.pedido SET status = '${s}' WHERE id = '${id}';`,
          );
          const erro = erroDetalhadoDe(() =>
            executar(
              banco.conexao,
              verboso(
                [
                  pedidoSql({ id }),
                  ...caminho,
                  `UPDATE pedido.pedido SET status = '${para}' WHERE id = '${id}';`,
                ].join('\n'),
              ),
              WORKER_A,
            ),
          );
          if (erro === null) aceitas[de].push(para);
          else {
            expect(erro.mensagem).toContain(`MXP02: RN-PED-02: transição de ${de} para ${para} recusada`);
            const possiveis = [...TRANSICOES[de]!].sort();
            expect(erro.saida).toMatch(new RegExp(`DETAIL:\\s+possiveis=([a-z_,]*)`));
            const detalhe = /possiveis=([a-z_,]*)/.exec(erro.saida)?.[1] ?? '';
            expect(detalhe.split(',').filter(Boolean).sort()).toEqual(possiveis);
          }
        }
        aceitas[de].sort();
      }
      expect(aceitas).toEqual(TRANSICOES);
    });

    it('status final cita "nenhuma"; status igual não é transição e não mexe em status_alterado_em', () => {
      const id = randomUUID();
      executar(
        banco.conexao,
        `${pedidoSql({ id })}\nUPDATE pedido.pedido SET status = 'em_analise' WHERE id = '${id}';`,
        APP_A,
      );
      const [antes] = consultar<{ s: string }>(
        banco.conexao,
        `SELECT status_alterado_em::text AS s FROM pedido.pedido WHERE id = '${id}'`,
        APP_A,
      );
      executar(
        banco.conexao,
        `UPDATE pedido.pedido SET status = 'em_analise', pendencias = '[{"codigo": "credito_excedido", "bloqueante": false}]'
         WHERE id = '${id}';`,
        APP_A,
      );
      const [depois] = consultar<{ s: string; p: number }>(
        banco.conexao,
        `SELECT status_alterado_em::text AS s, jsonb_array_length(pendencias) AS p FROM pedido.pedido WHERE id = '${id}'`,
        APP_A,
      );
      expect(depois).toEqual({ s: antes?.s, p: 1 });
      executar(banco.conexao, `UPDATE pedido.pedido SET status = 'recusado' WHERE id = '${id}';`, APP_A);
      const [final] = consultar<{ s: string; st: string }>(
        banco.conexao,
        `SELECT status_alterado_em::text AS s, status AS st FROM pedido.pedido WHERE id = '${id}'`,
        APP_A,
      );
      expect(final?.st).toBe('recusado');
      expect(final?.s).not.toBe(antes?.s);
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${id}';`, APP_A),
        ),
      ).toMatch(/possíveis a partir de recusado: nenhuma \(status final\)/);
    });

    it('vale também para o dono (sem SET ROLE)', () => {
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE pedido.pedido SET status = 'recebido' WHERE id = '${A.pedido}';`),
        ),
      ).toMatch(/RN-PED-02: transição de aprovado para recebido recusada/);
    });
  });

  describe('CHECKs principais', () => {
    it('pendencias é array; total e faturado não negativos; faturado até o total', () => {
      expect(falha(() => executar(banco.conexao, pedidoSql({ pendencias: '{}' }), APP_A))).toMatch(
        /pedido_pendencias_array/,
      );
      expect(falha(() => executar(banco.conexao, pedidoSql({ total: -1 }), APP_A))).toMatch(
        /check constraint/,
      );
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE pedido.pedido SET valor_faturado_centavos = 3981 WHERE id = '${A.pedido}';`,
            WORKER_A,
          ),
        ),
      ).toMatch(/pedido_valor_faturado_ate_total/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE pedido.pedido SET total_centavos = 1000 WHERE id = '${A.pedido}';`,
            APP_A,
          ),
        ),
      ).toMatch(/pedido_valor_faturado_ate_total/);
    });

    it('item: retrato sem custo, quantidade faturada até a quantidade, sequência única, FK no mesmo tenant', () => {
      const id = randomUUID();
      executar(banco.conexao, pedidoSql({ id }) + itemSql(id, 1), APP_A);
      for (const retrato of [
        '{"codigo": "P1", "custo_centavos": 499}',
        '{"codigo": "P1", "custo_cents": 499}',
      ]) {
        expect(falha(() => executar(banco.conexao, itemSql(id, 2, { retrato }), APP_A))).toMatch(
          /pedido_item_retrato_sem_custo/,
        );
      }
      expect(falha(() => executar(banco.conexao, itemSql(id, 2, { faturada: 10001 }), WORKER_A))).toMatch(
        /pedido_item_quantidade_faturada/,
      );
      expect(falha(() => executar(banco.conexao, itemSql(id, 1), APP_A))).toMatch(/pedido_item_sequencia_uq/);
      expect(falha(() => executar(banco.conexao, itemSql(B.pedido, 1), APP_A))).toMatch(/foreign key/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE pedido.pedido_item SET quantidade = 0 WHERE pedido_id = '${id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/check constraint/);
    });

    it('evento: ator sistema sem ator_id e usuário com ator_id; status e código de motivo válidos', () => {
      const ev = (ator: string, atorId: string, extra = "'recebido', NULL") =>
        `INSERT INTO pedido.pedido_evento (tenant_id, pedido_id, para, motivo_codigo, ator_tipo, ator_id)
         VALUES ('${A.id}', '${A.pedido}', ${extra}, '${ator}', ${atorId});`;
      expect(falha(() => executar(banco.conexao, ev('sistema', `'${A.usuario}'`), APP_A))).toMatch(
        /pedido_evento_ator/,
      );
      expect(falha(() => executar(banco.conexao, ev('usuario', 'NULL'), APP_A))).toMatch(
        /pedido_evento_ator/,
      );
      expect(falha(() => executar(banco.conexao, ev('sistema', 'NULL', "'pendente', NULL"), APP_A))).toMatch(
        /pedido\.status|check constraint/,
      );
      expect(
        falha(() => executar(banco.conexao, ev('sistema', 'NULL', "'cancelado', 'Texto Livre'"), APP_A)),
      ).toMatch(/pedido\.codigo|check constraint/);
      executar(banco.conexao, ev('sistema', 'NULL', "'cancelado', 'solicitacao_cliente'"), APP_A);
    });

    it('aprovação: automática × decidido_por, automática só aprova, recusa com motivo, pendência aceita com justificativa, uma por pedido', () => {
      const novo = (): string => {
        const id = randomUUID();
        executar(banco.conexao, pedidoSql({ id }), APP_A);
        return id;
      };
      const ap = (pedido: string, campos: string, valores: string) =>
        `INSERT INTO pedido.aprovacao (tenant_id, pedido_id, ${campos}) VALUES ('${A.id}', '${pedido}', ${valores});`;
      const p = novo();
      const casos: [string, string, RegExp][] = [
        [
          'decisao, automatica, decidido_por',
          `'aprovado', true, '${A.usuario}'`,
          /aprovacao_automatica_sem_usuario/,
        ],
        ['decisao, automatica', `'aprovado', false`, /aprovacao_automatica_sem_usuario/],
        ['decisao, automatica, motivo_codigo', `'recusado', true, 'outro'`, /aprovacao_automatica_so_aprova/],
        [
          'decisao, automatica, decidido_por, perfil',
          `'recusado', false, '${A.usuario}', 'gerente'`,
          /aprovacao_recusa_com_motivo/,
        ],
        [
          'decisao, automatica, decidido_por, perfil, pendencias_aceitas',
          `'aprovado', false, '${A.usuario}', 'gerente', '[{"codigo": "credito_excedido", "bloqueante": false}]'`,
          /aprovacao_pendencia_com_justificativa/,
        ],
        ['decisao, automatica, pendencias_aceitas', `'aprovado', true, '{}'`, /check constraint/],
        [
          'decisao, automatica, decidido_por, perfil',
          `'aprovado', false, '${A.usuario}', 'dono'`,
          /check constraint/,
        ],
      ];
      for (const [campos, valores, erro] of casos) {
        expect(falha(() => executar(banco.conexao, ap(p, campos, valores), APP_A))).toMatch(erro);
      }
      executar(
        banco.conexao,
        ap(
          p,
          'decisao, automatica, decidido_por, perfil, pendencias_aceitas, justificativa',
          `'aprovado', false, '${A.usuario}', 'gerente', '[{"codigo": "credito_excedido", "bloqueante": false}]', 'cliente antigo'`,
        ),
        APP_A,
      );
      expect(
        falha(() => executar(banco.conexao, ap(p, 'decisao, automatica', `'aprovado', true`), APP_A)),
      ).toMatch(/aprovacao_uma_por_pedido/);
      executar(
        banco.conexao,
        ap(
          novo(),
          'decisao, automatica, decidido_por, perfil, motivo_codigo',
          `'recusado', false, '${A.usuario}', 'gerente', 'credito_insuficiente'`,
        ),
        APP_A,
      );
    });
  });
});
