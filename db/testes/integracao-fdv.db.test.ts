/**
 * T-0010: schema integracao_fdv (migração 0007, desenho T-0009 seção 8) — vazamento entre tenants em todas as tabelas,
 * matriz de privilégios (tabela e coluna), worker_global só na agenda (cursor_entidade e sinal), credencial cifrada,
 * idempotência (chave_idempotencia, pedido_uuid, registro_external_id), um lote em voo por entidade, FK de credencial
 * entre tenants e estado terminal fora das filas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  numeros,
  PAPEIS_APP,
  permitirSetRole,
  PG_DISPONIVEL,
  privilegiosDe,
  rodarScript,
} from './apoio.ts';
import { fixtureIntegracao, fixturePlataforma, novoTenant } from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const A = novoTenant('integracao-a');
const B = novoTenant('integracao-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };

const TABELAS = [
  'conflito_chave',
  'credencial',
  'cursor_entidade',
  'lote_envio',
  'lote_erro',
  'pedido_recebido',
  'reconciliacao',
  'referencia',
  'registro_publicado',
  'retorno_enviado',
  'sinal',
] as const;
type TabelaIntegracao = (typeof TABELAS)[number];

/** Privilégios de tabela esperados (S, I, U, D, T; "-" = nenhum). Os de coluna têm teste próprio. */
const PRIVILEGIOS: Record<TabelaIntegracao, Record<(typeof PAPEIS_APP)[number], string>> = {
  conflito_chave: { macuxierp_app: 'S', macuxierp_worker: 'SI', macuxierp_leitura: 'S' },
  credencial: { macuxierp_app: 'I', macuxierp_worker: 'S', macuxierp_leitura: '-' },
  cursor_entidade: { macuxierp_app: 'SI', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  lote_envio: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  lote_erro: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  pedido_recebido: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  reconciliacao: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  referencia: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  registro_publicado: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  retorno_enviado: { macuxierp_app: 'S', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
  sinal: { macuxierp_app: 'SI', macuxierp_worker: 'SIU', macuxierp_leitura: 'S' },
};

/** Colunas com privilégio só de coluna (sem o de tabela): o que cada papel pode além da matriz acima. */
const COLUNAS: { papel: string; tabela: TabelaIntegracao; acao: string; colunas: string[] }[] = [
  { papel: 'macuxierp_app', tabela: 'conflito_chave', acao: 'UPDATE', colunas: ['resolvido_em'] },
  {
    papel: 'macuxierp_app',
    tabela: 'credencial',
    acao: 'SELECT',
    colunas: [
      'chave_mestra_versao',
      'chave_prefixo',
      'conector_id',
      'ambiente',
      'created_at',
      'criada_por',
      'deleted_at',
      'entidades_habilitadas',
      'external_id',
      'id',
      'limite_registros_lote',
      'substituida_em',
      'tenant_id',
      'ultimo_uso_em',
      'updated_at',
    ].sort(),
  },
  {
    papel: 'macuxierp_app',
    tabela: 'credencial',
    acao: 'UPDATE',
    colunas: ['deleted_at', 'entidades_habilitadas', 'limite_registros_lote', 'substituida_em'],
  },
  {
    papel: 'macuxierp_app',
    tabela: 'cursor_entidade',
    acao: 'UPDATE',
    colunas: [
      'credencial_id',
      'cursor_alterado_em',
      'cursor_external_id',
      'deleted_at',
      'pausada_em',
      'pausada_motivo',
      'proximo_em',
      'sessao_aberta_id',
    ],
  },
  {
    papel: 'macuxierp_app',
    tabela: 'registro_publicado',
    acao: 'UPDATE',
    colunas: ['confirmado_em', 'hash_confirmado', 'pendente'],
  },
  {
    papel: 'macuxierp_worker',
    tabela: 'credencial',
    acao: 'UPDATE',
    colunas: ['chave_cifrada', 'ultimo_uso_em'],
  },
  {
    papel: 'macuxierp_worker',
    tabela: 'conflito_chave',
    acao: 'UPDATE',
    colunas: ['deleted_at', 'resolvido_em'],
  },
];

const credencialDo = (tenant: string): string =>
  `(SELECT id FROM integracao_fdv.credencial WHERE tenant_id = '${tenant}' AND substituida_em IS NULL)`;

/** Lote delta montado (em voo) da entidade, com a chave dada (64 hex). */
const loteSql = (
  tenant: string,
  chave: string,
  entidade = 'produto',
  credencial = credencialDo(tenant),
): string =>
  `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, corpo)
   VALUES ('${tenant}', '${entidade}', ${credencial}, 'delta', '${chave}', '{"registros": []}')`;

const hex = (c: string): string => c.repeat(64);

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — integracao_fdv (T-0010)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureIntegracao(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('tem exatamente as onze tabelas da seção 8 (dez da 0007 e conflito_chave da 0015)', () => {
    const linhas = consultar<{ t: string }>(
      banco.conexao,
      `SELECT k.relname AS t FROM pg_class k JOIN pg_namespace n ON n.oid = k.relnamespace
       WHERE n.nspname = 'integracao_fdv' AND k.relkind IN ('r', 'p') ORDER BY 1`,
    );
    expect(linhas.map((l) => l.t)).toEqual([...TABELAS]);
  });

  it('não vaza entre tenants em nenhuma tabela de integracao_fdv, para nenhum papel', () => {
    expect(verificarVazamento(banco.conexao, ['integracao_fdv'], A.id, B.id)).toEqual([]);
  });

  it('worker_global só em cursor_entidade e sinal, e só para o worker', () => {
    const politicas = consultar<{ t: string; papeis: string }>(
      banco.conexao,
      `SELECT tablename AS t, array_to_string(roles, ',') AS papeis FROM pg_policies
       WHERE schemaname = 'integracao_fdv' AND policyname = 'worker_global' ORDER BY 1`,
    );
    expect(politicas).toEqual([
      { t: 'cursor_entidade', papeis: 'macuxierp_worker' },
      { t: 'sinal', papeis: 'macuxierp_worker' },
    ]);
    const semTenant = { papel: 'macuxierp_worker', tenant: null };
    for (const t of TABELAS.filter((x) => x !== 'cursor_entidade' && x !== 'sinal')) {
      const [r] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM integracao_fdv.${t}`,
        semTenant,
      );
      expect({ t, n: r?.n }).toEqual({ t, n: 0 });
    }
    for (const papel of ['macuxierp_app', 'macuxierp_leitura']) {
      for (const t of ['cursor_entidade', 'sinal']) {
        const [r] = consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM integracao_fdv.${t}`,
          { papel, tenant: null },
        );
        expect({ papel, t, n: r?.n }).toEqual({ papel, t, n: 0 });
      }
    }
  });

  it('agenda: a reserva sem tenant vê os vencidos de todos os tenants, pula os pausados e adia o proximo_em', () => {
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em, pausada_motivo, pausada_em)
       VALUES ('${A.id}', 'nota', now() - interval '1 minute', 'versao', now());`,
      WORKER_A,
    );
    const reservar = `SELECT tenant_id::text AS t, entidade AS e FROM integracao_fdv.cursor_entidade
      WHERE proximo_em <= now() AND pausada_motivo IS NULL ORDER BY proximo_em FOR NO KEY UPDATE SKIP LOCKED`;
    const semTenant = { papel: 'macuxierp_worker', tenant: null };
    const vencidos = consultar<{ t: string; e: string }>(banco.conexao, reservar, semTenant);
    expect(vencidos.map((v) => `${v.t === A.id ? 'A' : 'B'}:${v.e}`).sort()).toEqual([
      'A:cliente',
      'B:cliente',
    ]);
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cursor_entidade SET proximo_em = now() + interval '2 minutes'
       WHERE proximo_em <= now() AND pausada_motivo IS NULL;
       UPDATE integracao_fdv.sinal SET proximo_sinal_em = now() + interval '1 minute' WHERE proximo_sinal_em <= now();`,
      semTenant,
    );
    expect(consultar(banco.conexao, reservar, semTenant)).toEqual([]);
    const [s] = consultar<{ n: number }>(
      banco.conexao,
      'SELECT count(*)::int AS n FROM integracao_fdv.sinal WHERE proximo_sinal_em > now()',
      semTenant,
    );
    expect(s?.n).toBe(2);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'manual', pausada_em = now()
           WHERE entidade = 'nota';`,
          WORKER_A,
        ),
      ),
    ).toMatch(/check constraint/);
  });

  it('privilégios por tabela: o esperado em cada uma e nenhum DELETE nem TRUNCATE', () => {
    const obtido: Record<string, Record<string, string>> = {};
    for (const t of TABELAS) {
      obtido[t] = {};
      for (const papel of PAPEIS_APP) {
        obtido[t][papel] = privilegiosDe(banco.conexao, papel, `integracao_fdv.${t}`);
      }
    }
    expect(obtido).toEqual(PRIVILEGIOS);
  });

  it('privilégios por coluna: o app só nas ações do BKO; o worker na credencial só uso e anulação', () => {
    for (const { papel, tabela, acao, colunas } of COLUNAS) {
      const obtidas = consultar<{ c: string }>(
        banco.conexao,
        `SELECT attname AS c FROM pg_attribute WHERE attrelid = 'integracao_fdv.${tabela}'::regclass
           AND attnum > 0 AND NOT attisdropped AND has_column_privilege('${papel}', attrelid, attnum, '${acao}')
         ORDER BY 1`,
      ).map((l) => l.c);
      expect({ papel, tabela, acao, colunas: obtidas }).toEqual({ papel, tabela, acao, colunas });
    }
    // Nenhuma outra coluna gravável pelo app fora da matriz (referencia, lote, erro, pedido, retorno, sinal, etc.).
    const [r] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = k.relnamespace
       WHERE n.nspname = 'integracao_fdv' AND k.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
         AND k.relname NOT IN ('conflito_chave', 'credencial', 'cursor_entidade', 'registro_publicado')
         AND has_column_privilege('macuxierp_app', a.attrelid, a.attnum, 'UPDATE')`,
    );
    expect(r?.n).toBe(0);
  });

  it('credencial: o app lê só o resumo; o worker lê o cifrado; a leitura não vê a tabela', () => {
    expect(
      consultar(
        banco.conexao,
        'SELECT conector_id, ambiente, chave_prefixo FROM integracao_fdv.credencial',
        APP_A,
      ),
    ).toEqual([{ conector_id: 'conector-integracao-a', ambiente: 'teste', chave_prefixo: 'mxf_abcd' }]);
    for (const coluna of ['chave_cifrada', '*']) {
      expect(
        falha(() => consultar(banco.conexao, `SELECT ${coluna} FROM integracao_fdv.credencial`, APP_A)),
      ).toMatch(/permission denied/);
    }
    expect(
      falha(() => consultar(banco.conexao, 'SELECT id FROM integracao_fdv.credencial', LEITURA_A)),
    ).toMatch(/permission denied/);
    const [cifrado] = consultar<{ n: number }>(
      banco.conexao,
      'SELECT length(chave_cifrada) AS n FROM integracao_fdv.credencial',
      WORKER_A,
    );
    expect(cifrado?.n).toBe(40);
  });

  it('credencial: a chave nunca é regravada (troca = linha nova); só a da substituída é anulada', () => {
    for (const ctx of [WORKER_A, {}]) {
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE integracao_fdv.credencial SET chave_cifrada = decode(repeat('bb', 40), 'hex');`,
            ctx,
          ),
        ),
      ).toMatch(/só pode ser anulada/);
    }
    expect(
      falha(() =>
        executar(banco.conexao, 'UPDATE integracao_fdv.credencial SET chave_cifrada = NULL;', WORKER_A),
      ),
    ).toMatch(/credencial_chave_so_da_substituida/);
    for (const set of ['conector_id = conector_id', 'ambiente = ambiente', 'substituida_em = now()']) {
      expect(
        falha(() => executar(banco.conexao, `UPDATE integracao_fdv.credencial SET ${set};`, WORKER_A)),
      ).toMatch(/permission denied/);
    }
    executar(banco.conexao, 'UPDATE integracao_fdv.credencial SET ultimo_uso_em = now();', WORKER_A);
  });

  it('credencial: uma ativa por tenant, ambiente teste|producao, cifrado com nonce e tag, prefixo até 8', () => {
    const nova = (ambiente = 'producao', cifra = "decode(repeat('cc', 40), 'hex')", prefixo = 'mxf_novo') =>
      `INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo)
       VALUES ('${A.id}', 'conector-novo', '${ambiente}', ${cifra}, '${prefixo}');`;
    expect(falha(() => executar(banco.conexao, nova(), APP_A))).toMatch(/credencial_uma_ativa_por_tenant/);
    expect(falha(() => executar(banco.conexao, nova('homologacao'), APP_A))).toMatch(/check constraint/);
    expect(falha(() => executar(banco.conexao, nova(undefined, "'\\x01'"), APP_A))).toMatch(
      /check constraint/,
    );
    expect(falha(() => executar(banco.conexao, nova(undefined, undefined, 'mxf_123456'), APP_A))).toMatch(
      /check constraint/,
    );
    // Troca: marca a anterior como substituída e grava a nova na mesma transação.
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.credencial SET substituida_em = now() WHERE substituida_em IS NULL;\n${nova()}`,
      APP_A,
    );
    const ativas = consultar<{ conector_id: string }>(
      banco.conexao,
      'SELECT conector_id FROM integracao_fdv.credencial WHERE substituida_em IS NULL AND deleted_at IS NULL',
      APP_A,
    );
    expect(ativas).toEqual([{ conector_id: 'conector-novo' }]);
    // Retenção: a substituída tem a chave anulada (worker); a ativa não.
    executar(
      banco.conexao,
      'UPDATE integracao_fdv.credencial SET chave_cifrada = NULL WHERE substituida_em IS NOT NULL;',
      WORKER_A,
    );
  });

  it('FK de credencial entre tenants: lote e cursor só apontam para a credencial do próprio tenant', () => {
    const [credB] = consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM integracao_fdv.credencial WHERE tenant_id = '${B.id}'`,
    );
    expect(
      falha(() =>
        executar(banco.conexao, loteSql(A.id, hex('7'), 'vendedor', `'${credB?.id}'`) + ';', WORKER_A),
      ),
    ).toMatch(/foreign key/);
    expect(
      falha(() => executar(banco.conexao, loteSql(A.id, hex('7'), 'vendedor', 'NULL') + ';', WORKER_A)),
    ).toMatch(/null value in column "credencial_id"/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.cursor_entidade SET credencial_id = '${credB?.id}' WHERE entidade = 'cliente';`,
          APP_A,
        ),
      ),
    ).toMatch(/foreign key/);
    // O app troca o conector: aponta para a credencial nova, zera o cursor e agenda já (carga completa).
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cursor_entidade SET credencial_id = ${credencialDo(A.id)}, cursor_alterado_em = NULL,
         cursor_external_id = NULL, sessao_aberta_id = NULL, proximo_em = now() WHERE entidade = 'cliente';
       UPDATE integracao_fdv.registro_publicado SET hash_confirmado = NULL, confirmado_em = NULL, pendente = true;`,
      APP_A,
    );
  });

  it('lote: a mesma chave_idempotencia não vira dois lotes no tenant; em outro tenant, pode', () => {
    executar(banco.conexao, loteSql(A.id, hex('a')) + ';', WORKER_A);
    expect(falha(() => executar(banco.conexao, loteSql(A.id, hex('a'), 'filial') + ';', WORKER_A))).toMatch(
      /lote_envio_chave_idempotencia_uq/,
    );
    const replay = rodarScript(
      banco.conexao,
      `SET ROLE macuxierp_worker; SET app.tenant_id = '${A.id}';
       ${loteSql(A.id, hex('a'), 'filial')} ON CONFLICT (tenant_id, chave_idempotencia) DO NOTHING RETURNING 1;`,
      { transacao: true },
    );
    expect(numeros(replay)).toEqual([]);
    executar(banco.conexao, loteSql(B.id, hex('a')) + ';', WORKER_B);
    expect(
      falha(() => executar(banco.conexao, loteSql(A.id, 'A'.repeat(64), 'filial') + ';', WORKER_A)),
    ).toMatch(/sha256_hex/);
  });

  it('lote: no máximo um em voo por entidade; no estado final sai do voo e libera o próximo', () => {
    // "produto" já tem um montado (teste anterior).
    expect(falha(() => executar(banco.conexao, loteSql(A.id, hex('b')) + ';', WORKER_A))).toMatch(
      /lote_envio_um_em_voo/,
    );
    const onde = `WHERE chave_idempotencia = '${hex('a')}'`;
    for (const estado of ['enviando', 'aceito']) {
      const sets =
        estado === 'aceito' ? `estado = 'aceito', hub_lote_id = gen_random_uuid()` : `estado = '${estado}'`;
      executar(banco.conexao, `UPDATE integracao_fdv.lote_envio SET ${sets} ${onde};`, WORKER_A);
      expect(falha(() => executar(banco.conexao, loteSql(A.id, hex('b')) + ';', WORKER_A))).toMatch(
        /lote_envio_um_em_voo/,
      );
    }
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.lote_envio SET estado = 'concluido' ${onde};`,
          WORKER_A,
        ),
      ),
    ).toMatch(/lote_envio_final/);
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.lote_envio SET estado = 'concluido', concluido_em = now(),
         contagens = '{"aceitos": 3}' ${onde};
       ${loteSql(A.id, hex('b'))};`,
      WORKER_A,
    );
    // Outra entidade não disputa o voo; outro tenant também não.
    executar(banco.conexao, loteSql(A.id, hex('c'), 'filial') + ';', WORKER_A);
  });

  it('lote: corpo obrigatório em voo e anulável no final; sessão só na carga completa; erro só por código', () => {
    const onde = `WHERE chave_idempotencia = '${hex('c')}'`;
    expect(
      falha(() =>
        executar(banco.conexao, `UPDATE integracao_fdv.lote_envio SET corpo = NULL ${onde};`, WORKER_A),
      ),
    ).toMatch(/lote_envio_corpo_em_voo/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.lote_envio SET estado = 'recusado', concluido_em = now() ${onde};`,
          WORKER_A,
        ),
      ),
    ).toMatch(/lote_envio_final_com_erro/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.lote_envio SET ultimo_erro_codigo = 'CPF 123 inválido' ${onde};`,
          WORKER_A,
        ),
      ),
    ).toMatch(/codigo/);
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.lote_envio SET estado = 'recusado', concluido_em = now(),
         ultimo_erro_codigo = 'entidade_de_outro_conector' ${onde};
       UPDATE integracao_fdv.lote_envio SET corpo = NULL ${onde};`,
      WORKER_A,
    );
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, corpo)
           VALUES ('${A.id}', 'vendedor', ${credencialDo(A.id)}, 'completo', '${hex('9')}', '{}');`,
          WORKER_A,
        ),
      ),
    ).toMatch(/lote_envio_sessao/);
    expect(falha(() => executar(banco.conexao, loteSql(A.id, hex('9'), 'carteira') + ';', WORKER_A))).toMatch(
      /entidade_hub/,
    );
  });

  it('erro de lote: único por (lote, origem, índice), sem texto livre, e nunca em lote de outro tenant', () => {
    const erro = (origem: string, indice: number, codigo = 'referencia_ausente') =>
      `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, codigo, campo,
         reprocessavel)
       SELECT '${A.id}', id, ${indice}, '${origem}', 'cliente', '${codigo}', 'vendedor_external_id', true
       FROM integracao_fdv.lote_envio WHERE chave_idempotencia = '${hex('d')}'`;
    expect(falha(() => executar(banco.conexao, erro('hub', 1) + ';', WORKER_A))).toMatch(
      /lote_erro_linha_uq/,
    );
    const saida = rodarScript(
      banco.conexao,
      `SET ROLE macuxierp_worker; SET app.tenant_id = '${A.id}';
       ${erro('hub', 1)} ON CONFLICT DO NOTHING RETURNING 1;`,
      { transacao: true },
    );
    expect(numeros(saida)).toEqual([]);
    executar(banco.conexao, erro('erp', 1) + ';', WORKER_A);
    expect(falha(() => executar(banco.conexao, erro('erp', 2, 'Fulano de Tal') + ';', WORKER_A))).toMatch(
      /codigo/,
    );
    const [loteB] = consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM integracao_fdv.lote_envio WHERE tenant_id = '${B.id}' AND estado = 'concluido_com_erros'`,
    );
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, codigo)
           VALUES ('${A.id}', '${loteB?.id}', 0, 'hub', 'cliente', 'campo_invalido');`,
          WORKER_A,
        ),
      ),
    ).toMatch(/foreign key/);
    // Resolvido no lote que aceitou o registro.
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.lote_erro SET resolvido_em = now(), resolvido_no_lote_envio_id =
         (SELECT id FROM integracao_fdv.lote_envio WHERE chave_idempotencia = '${hex('a')}') WHERE origem = 'erp';`,
      WORKER_A,
    );
  });

  it('espelho: idempotente por (entidade, registro_external_id); sem custo; ordem do Hub em COLLATE "C"', () => {
    const gravar = (externo: string, alterado: string, payload = '{"nome": "x"}') =>
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash,
         alterado_em, fonte_ocorrido_em, ativo)
       VALUES ('${A.id}', 'produto', '${externo}', '${payload}', '${hex('2')}', '${alterado}', '${alterado}', true)
       ON CONFLICT (tenant_id, entidade, registro_external_id) DO UPDATE SET payload = excluded.payload,
         hash = excluded.hash, alterado_em = excluded.alterado_em, pendente = true RETURNING 1;`;
    const ctx = `SET ROLE macuxierp_worker; SET app.tenant_id = '${A.id}';`;
    for (const externo of ['b-2', 'B-1', 'a-3']) {
      rodarScript(banco.conexao, `${ctx}\n${gravar(externo, '2026-11-21T12:00:00.001Z')}`, {
        transacao: true,
      });
    }
    rodarScript(banco.conexao, `${ctx}\n${gravar('b-2', '2026-11-21T12:00:00.001Z')}`, { transacao: true });
    const fila = consultar<{ r: string }>(
      banco.conexao,
      `SELECT registro_external_id AS r FROM integracao_fdv.registro_publicado
       WHERE entidade = 'produto' AND pendente ORDER BY alterado_em, registro_external_id`,
      WORKER_A,
    );
    expect(fila.map((f) => f.r)).toEqual(['B-1', 'a-3', 'b-2']);
    expect(
      falha(() =>
        rodarScript(banco.conexao, `${ctx}\n${gravar('c-1', '2026-11-21T12:00:00Z', '{"custo_cents": 1}')}`, {
          transacao: true,
        }),
      ),
    ).toMatch(/registro_publicado_sem_custo/);
    // Payload anulado só no inativo já confirmado (retenção de 30 dias).
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.registro_publicado SET payload = NULL WHERE registro_external_id = 'a-3';`,
          WORKER_A,
        ),
      ),
    ).toMatch(/registro_publicado_payload_anulado/);
    const indices = consultar<{ d: string }>(
      banco.conexao,
      `SELECT indexdef AS d FROM pg_indexes WHERE schemaname = 'integracao_fdv'
         AND indexname IN ('registro_publicado_fila_idx', 'registro_publicado_carga_idx') ORDER BY indexname`,
    );
    expect(indices.map((i) => i.d.replace(/.*WHERE /, ''))).toEqual(['ativo', 'pendente']);
    const colacoes = consultar<{ c: string; k: string }>(
      banco.conexao,
      `SELECT a.attrelid::regclass::text || '.' || a.attname AS c, k.collname AS k FROM pg_attribute a
         JOIN pg_collation k ON k.oid = a.attcollation
       WHERE (a.attrelid, a.attname) IN (('integracao_fdv.registro_publicado'::regclass, 'registro_external_id'),
         ('integracao_fdv.cursor_entidade'::regclass, 'cursor_external_id')) ORDER BY 1`,
    );
    expect(colacoes).toEqual([
      { c: 'integracao_fdv.cursor_entidade.cursor_external_id', k: 'C' },
      { c: 'integracao_fdv.registro_publicado.registro_external_id', k: 'C' },
    ]);
  });

  it('referência: uma por (tipo, erp_id) e dados só com as chaves permitidas (sem dado pessoal)', () => {
    const ref = (dados: string) =>
      `INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, dados, fonte_ocorrido_em)
       VALUES ('${A.id}', 'filial_padrao', '${A.filial}', '${dados}', now());`;
    executar(banco.conexao, ref(`{"filial_id": "${A.filial}"}`), WORKER_A);
    expect(falha(() => executar(banco.conexao, ref('{}'), WORKER_A))).toMatch(/referencia_uq/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, dados, fonte_ocorrido_em)
           VALUES ('${A.id}', 'tabela_preco', gen_random_uuid(), '{"nome": "T", "email": "x@y"}', now());`,
          WORKER_A,
        ),
      ),
    ).toMatch(/check constraint/);
    expect(
      falha(() => executar(banco.conexao, `UPDATE integracao_fdv.referencia SET dados = '{}';`, APP_A)),
    ).toMatch(/permission denied/);
  });

  it('cursor: um por entidade; pausa só com os motivos do desenho e com data; par do cursor completo', () => {
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade) VALUES ('${A.id}', 'cliente');`,
          APP_A,
        ),
      ),
    ).toMatch(/cursor_entidade_uq/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'credencial' WHERE entidade = 'cliente';`,
          APP_A,
        ),
      ),
    ).toMatch(/cursor_entidade_pausa/);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.cursor_entidade SET cursor_alterado_em = now(), cursor_external_id = NULL
           WHERE entidade = 'cliente';`,
          APP_A,
        ),
      ),
    ).toMatch(/cursor_entidade_par/);
    // Retomar (BKO): tira a pausa e agenda já. O último envio é do worker.
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = NULL, pausada_em = NULL, proximo_em = now()
       WHERE entidade = 'nota';`,
      APP_A,
    );
    expect(
      falha(() =>
        executar(banco.conexao, 'UPDATE integracao_fdv.cursor_entidade SET ultimo_envio_em = now();', APP_A),
      ),
    ).toMatch(/permission denied/);
  });

  it('pedido recebido: idempotente pelo pedido_uuid do FDV (RN-PED-01); rejeitado exige o código', () => {
    const receber = (tenant: string) =>
      `INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash)
       VALUES ('${tenant}', '${A.pedidoFdv}', '{"itens": []}', '${hex('e')}')`;
    expect(falha(() => executar(banco.conexao, receber(A.id) + ';', WORKER_A))).toMatch(
      /pedido_recebido_pedido_uuid_uq/,
    );
    // O Hub reenvia o pedido sem retorno: a mesma linha, só atualiza recebido_em.
    executar(
      banco.conexao,
      `${receber(A.id)} ON CONFLICT (tenant_id, pedido_uuid) DO UPDATE SET recebido_em = now();`,
      WORKER_A,
    );
    const [n] = consultar<{ n: number }>(
      banco.conexao,
      'SELECT count(*)::int AS n FROM integracao_fdv.pedido_recebido',
      WORKER_A,
    );
    expect(n?.n).toBe(1);
    // Outro tenant pode ter o mesmo UUID (o banco não confia que o FDV nunca repete entre empresas).
    executar(banco.conexao, receber(B.id) + ';', WORKER_B);
    expect(
      falha(() =>
        executar(banco.conexao, `UPDATE integracao_fdv.pedido_recebido SET estado = 'rejeitado';`, WORKER_A),
      ),
    ).toMatch(/pedido_recebido_rejeitado/);
    expect(
      falha(() =>
        executar(banco.conexao, 'UPDATE integracao_fdv.pedido_recebido SET payload = NULL;', WORKER_A),
      ),
    ).toMatch(/pedido_recebido_payload/);
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.pedido_recebido SET estado = 'entregue', pedido_id = gen_random_uuid();
       UPDATE integracao_fdv.pedido_recebido SET payload = NULL;`,
      WORKER_A,
    );
  });

  it('retorno: único por (pedido_uuid, status, hash) e só de pedido recebido do próprio tenant', () => {
    const retorno = (pedido: string, status: string, h: string) =>
      `INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, corpo, hash)
       VALUES ('${A.id}', '${pedido}', '${status}', '{"status": "${status}"}', '${hex(h)}');`;
    expect(falha(() => executar(banco.conexao, retorno(A.pedidoFdv, 'integrado', 'f'), WORKER_A))).toMatch(
      /retorno_enviado_uq/,
    );
    executar(banco.conexao, retorno(A.pedidoFdv, 'faturado_parcial', 'f'), WORKER_A);
    executar(banco.conexao, retorno(A.pedidoFdv, 'faturado_parcial', '3'), WORKER_A);
    expect(falha(() => executar(banco.conexao, retorno(B.pedidoFdv, 'integrado', '4'), WORKER_A))).toMatch(
      /foreign key/,
    );
    expect(
      falha(() =>
        executar(banco.conexao, `UPDATE integracao_fdv.retorno_enviado SET estado = 'enviado';`, WORKER_A),
      ),
    ).toMatch(/retorno_enviado_enviado/);
  });

  it('estado terminal fora das filas: lote (falhou, recusado), pedido (rejeitado) e retorno (falhou)', () => {
    const predicados = consultar<{ i: string; p: string }>(
      banco.conexao,
      `SELECT k.relname AS i, pg_get_expr(x.indpred, x.indrelid) AS p FROM pg_index x
         JOIN pg_class k ON k.oid = x.indexrelid JOIN pg_namespace n ON n.oid = k.relnamespace
       WHERE n.nspname = 'integracao_fdv' AND k.relname IN ('lote_envio_um_em_voo', 'pedido_recebido_fila_idx',
         'retorno_enviado_fila_idx', 'cursor_entidade_agenda_idx') ORDER BY 1`,
    );
    expect(predicados.map((p) => p.i)).toEqual([
      'cursor_entidade_agenda_idx',
      'lote_envio_um_em_voo',
      'pedido_recebido_fila_idx',
      'retorno_enviado_fila_idx',
    ]);
    for (const terminal of ['falhou', 'recusado', 'rejeitado', 'concluido']) {
      expect(predicados.filter((p) => p.p.includes(`'${terminal}'`))).toEqual([]);
    }
    // O lote recusado (teste anterior) não segura o voo da entidade.
    executar(banco.conexao, loteSql(A.id, hex('5'), 'filial') + ';', WORKER_A);
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.retorno_enviado SET estado = 'falhou', resposta_http = 422
       WHERE hash = '${hex('3')}';`,
      WORKER_A,
    );
    const [pend] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM integracao_fdv.retorno_enviado WHERE estado = 'pendente'`,
      WORKER_A,
    );
    expect(pend?.n).toBe(2);
  });

  it('sinal: um por tenant; o app só cria; reconciliação uma por entidade e dia', () => {
    expect(
      falha(() =>
        executar(banco.conexao, `INSERT INTO integracao_fdv.sinal (tenant_id) VALUES ('${A.id}');`, APP_A),
      ),
    ).toMatch(/sinal_um_por_tenant/);
    expect(
      falha(() => executar(banco.conexao, 'UPDATE integracao_fdv.sinal SET ultimo_http = 200;', APP_A)),
    ).toMatch(/permission denied/);
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.sinal SET ultimo_http = 426, parado_por_versao = true,
         politica_versao = '{"minima": "1.4.0"}', proxima_busca_pedidos_em = now();`,
      WORKER_A,
    );
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `INSERT INTO integracao_fdv.reconciliacao (tenant_id, entidade, data_referencia, contagem)
           VALUES ('${A.id}', 'cliente', '2026-11-21', 2);`,
          WORKER_A,
        ),
      ),
    ).toMatch(/reconciliacao_uq/);
  });
});
