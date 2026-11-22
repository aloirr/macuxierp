/**
 * T-0019 (F4), alinhado à T-0021: schema faturamento (migração 0013) — vazamento entre tenants, numeração sem buraco
 * sob concorrência e auditoria de buracos (RN-FAT-01, A2, Q9), nota autorizada nunca editada (RN-FAT-02), XML
 * imutável da nota, dos eventos e da inutilização com guarda pendente (RN-FAT-03), ambiente da nota vindo do
 * core.ambiente_fiscal (RN-FAT-04, A3, ADR 0006), contingência (RN-FAT-05, A5), títulos com saldo e baixa (RN-FAT-06)
 * e rejeitada reenviada com o mesmo número (RN-FAT-07).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { type Contexto, rodarScriptAssincrono } from '../src/psql.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  linhas,
  numeros,
  PAPEIS_APP,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import {
  chaveAcesso,
  cnfDe,
  fixtureConfiguracaoFilial,
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  hashSql,
  novoTenant,
} from './fixture.ts';
import { verificarVazamento } from './vazamento.ts';

const A = novoTenant('faturamento-a');
const B = novoTenant('faturamento-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };
const RECADO_OK = 'R-20261121-120000-alexandre';

const TABELAS = [
  'configuracao_filial',
  'configuracao_filial_historico',
  'contingencia',
  'inutilizacao',
  'nota',
  'nota_evento',
  'nota_item',
  'nota_xml',
  'pedido_a_faturar',
  'serie_numeracao',
  'titulo',
  'titulo_baixa',
  'transmissao',
] as const;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — faturamento (T-0019, T-0021)', () => {
  let banco: BancoDeTeste;

  /** Roda o script no papel e no tenant pedidos, numa transação, e devolve o stdout. */
  const como = (ctx: Contexto, sql: string): string => rodarComo(banco.conexao, sql, ctx);

  /** Reserva o número (A2) e grava a nota em rascunho com ele, na mesma transação (o caminho da API). */
  const sqlNota = (
    filial: string,
    serie: number,
    idem: string,
    ambienteReserva = 'homologacao',
    ambienteNota = '',
  ): string =>
    `SELECT faturamento.reservar_numero('${filial}', '${ambienteReserva}', ${serie}::smallint, 1) AS n \\gset
INSERT INTO faturamento.nota (tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id, natureza_operacao${ambienteNota ? ', ambiente' : ''})
  VALUES (plataforma.tenant_atual(), '${filial}', ${serie}, :n, '${idem}', '${A.cliente}', 'Venda'${ambienteNota ? `, '${ambienteNota}'` : ''})
  RETURNING id || ' ' || numero || ' ' || ambiente;`;

  let cnf = 1000;
  type Nota = { id: string; numero: number; ambiente: string; serie: number; cnf: number; chave: string };
  const criarNota = (filial: string, serie = 1, ambiente = 'homologacao', ctx: Contexto = APP_A): Nota => {
    const linha =
      como(ctx, sqlNota(filial, serie, randomUUID(), ambiente))
        .trim()
        .split('\n')
        .pop() ?? '';
    const [id = '', numero = '0', amb = ''] = linha.split(' ');
    const c = ++cnf;
    return {
      id,
      numero: Number(numero),
      ambiente: amb,
      serie,
      cnf: c,
      chave: chaveAcesso(serie, Number(numero), c),
    };
  };

  /** Envia (app): rascunho → em_autorizacao, com chave e cNF. */
  const sqlEnviar = (n: Nota) =>
    `UPDATE faturamento.nota SET status = 'em_autorizacao', chave_acesso = '${n.chave}', c_nf = '${cnfDe(n.cnf)}'
       WHERE id = '${n.id}';`;

  /** Envia e recebe a autorização (worker): fica "autorizada, guarda pendente". */
  // hora-fixa-ok: data de gravação, nunca comparada com o instante fixo
  const autorizarSemGuarda = (n: Nota, protocolo: string, em = 'now()') => {
    executar(banco.conexao, sqlEnviar(n), APP_A);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'autorizada_guarda_pendente', protocolo = '${protocolo}',
         autorizada_em = ${em}, c_stat = 100 WHERE id = '${n.id}';`,
      WORKER_A,
    );
  };

  /** Envia (app) e recebe a rejeição (worker). */
  const rejeitar = (n: Nota) => {
    executar(banco.conexao, sqlEnviar(n), APP_A);
    executar(
      banco.conexao,
      `UPDATE faturamento.nota SET status = 'rejeitada', c_stat = 225 WHERE id = '${n.id}';`,
      WORKER_A,
    );
  };

  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Duas sessões: a primeira começa, trava e segura 1 s; a segunda entra depois de 300 ms e espera a trava. */
  const corrida = async (primeira: string, segunda: string) => {
    const sessao = (ctx: Contexto, sql: string) =>
      rodarScriptAssincrono(
        banco.conexao,
        `SET ROLE ${ctx.papel};\nSET app.tenant_id = '${ctx.tenant}';\nBEGIN;\n${sql}\n`,
      );
    const p1 = sessao(WORKER_A, `${primeira}\nSELECT pg_sleep(1);\nCOMMIT;`);
    await esperar(300);
    const p2 = sessao(APP_A, `${segunda}\nCOMMIT;`);
    return Promise.allSettled([p1, p2]);
  };
  const motivo = (r: PromiseSettledResult<string>): string =>
    r.status === 'rejected' ? String((r.reason as Error).message) : 'ok';

  const sqlXml = (n: Nota, protocolo: string, xml = `<nfeProc>${n.id}</nfeProc>`) =>
    `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256)
     VALUES (plataforma.tenant_atual(), 'nfe_autorizada', '${n.id}', '${n.chave}', '${protocolo}', '${xml}',
       ${hashSql(xml)});`;

  const autorizar = (n: Nota, protocolo: string) => {
    autorizarSemGuarda(n, protocolo);
    executar(banco.conexao, sqlXml(n, protocolo), WORKER_A);
  };

  const sqlEvento = (
    nota: string,
    tipo: string,
    seq: number,
    texto = 'Texto do evento com mais de quinze letras',
  ) =>
    `INSERT INTO faturamento.nota_evento (tenant_id, nota_id, tipo, n_seq_evento, texto)
     VALUES (plataforma.tenant_atual(), '${nota}', '${tipo}', ${seq}, '${texto}');`;

  /** Guarda o XML do evento (tipo, sequência) da nota: o evento passa a registrado. */
  const sqlXmlEvento = (nota: string, tipo: string, seq: number, protocolo = '113260000000099') => {
    const xml = `<procEventoNFe>${nota}-${tipo}-${seq}</procEventoNFe>`;
    return `INSERT INTO faturamento.nota_xml (tenant_id, tipo, evento_id, protocolo, xml, sha256)
     SELECT plataforma.tenant_atual(), 'evento_${tipo}', e.id, '${protocolo}', '${xml}', ${hashSql(xml)}
     FROM faturamento.nota_evento e WHERE e.nota_id = '${nota}' AND e.tipo = '${tipo}' AND e.n_seq_evento = ${seq};`;
  };

  const sqlTitulo = (nota: string, parcela: number, valor = 1000, total = 3) =>
    `INSERT INTO faturamento.titulo (tenant_id, nota_id, parcela, total_parcelas, vencimento, valor_centavos,
       conta_como_real) VALUES (plataforma.tenant_atual(), '${nota}', ${parcela}, ${total}, '2026-12-31', ${valor}, false);`;

  const sqlInutilizacao = (filial: string, ini: number, fim: number) =>
    `INSERT INTO faturamento.inutilizacao (tenant_id, filial_id, serie, ano, numero_inicial, numero_final,
       justificativa) VALUES (plataforma.tenant_atual(), '${filial}', 1, 2026, ${ini}, ${fim},
       'Nota rejeitada e abandonada');`;

  const sqlXmlInutilizacao = (filial: string, ini: number, protocolo = '113260000000050') => {
    const xml = `<procInutNFe>${filial}-${ini}</procInutNFe>`;
    return `INSERT INTO faturamento.nota_xml (tenant_id, tipo, inutilizacao_id, protocolo, xml, sha256)
     SELECT plataforma.tenant_atual(), 'inutilizacao', i.id, '${protocolo}', '${xml}', ${hashSql(xml)}
     FROM faturamento.inutilizacao i WHERE i.filial_id = '${filial}' AND i.numero_inicial = ${ini}
       AND i.status = 'pendente';`;
  };

  const status = (tabela: string, id: string): string =>
    consultar<{ s: string }>(
      banco.conexao,
      `SELECT status AS s FROM faturamento.${tabela} WHERE id = '${id}'`,
    )[0]?.s ?? '';

  const buracos = (filial: string, ctx: Contexto = APP_A) =>
    consultar<{ ini: number; fim: number }>(
      banco.conexao,
      `SELECT numero_inicial AS ini, numero_final AS fim FROM faturamento.buracos_numeracao('${filial}')`,
      ctx,
    );

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B]
        .map(
          (t) =>
            fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t) + fixtureConfiguracaoFilial(t),
        )
        .join('\n'),
    );
  });

  afterAll(() => banco?.remover());

  describe('RLS e privilégios', () => {
    it('não vaza entre tenants em nenhuma tabela do faturamento, para nenhum papel', () => {
      expect(verificarVazamento(banco.conexao, ['faturamento'], A.id, B.id)).toEqual([]);
    });

    it('o app do tenant A não grava no tenant B; o dono (sem FORCE) vê os dois', () => {
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.serie_numeracao (tenant_id, filial_id, ambiente, serie, numero_inicial, proximo)
               VALUES ('${B.id}', '${B.filial}', 'homologacao', 9, 1, 1);`,
            APP_A,
          ),
        ),
      ).toMatch(/row-level security/);
      // Na nota, a trigger nem acha a numeração do B (a RLS a esconde) e recusa antes da política.
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
               natureza_operacao) VALUES ('${B.id}', '${B.filial}', 1, 1, 'x', '${B.cliente}', 'Venda');`,
            APP_A,
          ),
        ),
      ).toMatch(/row-level security|não foi reservado/);
      expect(falha(() => executar(banco.conexao, sqlTitulo(B.nota, 9), APP_A))).toMatch(
        /RN-FAT-03|foreign key/,
      );
      expect(
        consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM faturamento.nota WHERE id IN ('${A.nota}', '${B.nota}')`,
        ),
      ).toEqual([{ n: 2 }]);
      const [dono] = consultar<{ rls: boolean; forca: boolean }>(
        banco.conexao,
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forca FROM pg_class WHERE oid = 'faturamento.nota'::regclass`,
      );
      expect(dono).toEqual({ rls: true, forca: false });
    });

    it('nenhum papel tem DELETE ou TRUNCATE; a leitura não vê XML, destinatário nem transporte; transmissão sem XML', () => {
      for (const papel of PAPEIS_APP) {
        for (const tabela of TABELAS) {
          const p = privilegiosDe(banco.conexao, papel, `faturamento.${tabela}`);
          expect({ papel, tabela, d: p.includes('D'), t: p.includes('T') }).toEqual({
            papel,
            tabela,
            d: false,
            t: false,
          });
        }
      }
      for (const sql of [
        'SELECT xml FROM faturamento.nota_xml',
        'SELECT destinatario_retrato FROM faturamento.nota',
        'SELECT transporte FROM faturamento.nota',
        'SELECT payload FROM faturamento.pedido_a_faturar',
      ]) {
        expect(falha(() => consultar(banco.conexao, sql, LEITURA_A))).toMatch(/permission denied/);
      }
      expect(
        consultar(banco.conexao, 'SELECT tipo FROM faturamento.nota_xml ORDER BY tipo', LEITURA_A),
      ).toEqual([{ tipo: 'evento_cce' }, { tipo: 'inutilizacao' }, { tipo: 'nfe_autorizada' }]);
      expect(
        consultar(banco.conexao, 'SELECT pedido_id, status FROM faturamento.pedido_a_faturar', LEITURA_A),
      ).toEqual([{ pedido_id: A.pedido, status: 'a_faturar' }]);
      const colunas = consultar<{ c: string }>(
        banco.conexao,
        `SELECT column_name AS c FROM information_schema.columns
         WHERE table_schema = 'faturamento' AND table_name = 'transmissao'
           AND (column_name LIKE '%xml%' OR column_name LIKE '%retrato%' OR column_name LIKE '%documento%')`,
      );
      expect(colunas).toEqual([]);
      expect(
        falha(() => executar(banco.conexao, `UPDATE faturamento.transmissao SET servico = 'status';`, APP_A)),
      ).toMatch(/permission denied/);
    });
  });

  describe('RN-FAT-01: numeração sem buraco (A2, Q9)', () => {
    it('a massa: número 1 em nota, 2 inutilizado (registrado pelo XML), próximo 3, sem buraco', () => {
      expect(
        consultar(
          banco.conexao,
          `SELECT ambiente, modelo, serie, numero_inicial, proximo FROM faturamento.serie_numeracao`,
          APP_A,
        ),
      ).toEqual([{ ambiente: 'homologacao', modelo: 55, serie: 1, numero_inicial: 1, proximo: 3 }]);
      expect(
        consultar(banco.conexao, `SELECT status, protocolo FROM faturamento.inutilizacao`, APP_A),
      ).toEqual([{ status: 'registrado', protocolo: '113260000000003' }]);
      expect(consultar(banco.conexao, 'SELECT * FROM faturamento.buracos_numeracao()', LEITURA_A)).toEqual(
        [],
      );
    });

    it('conexões paralelas, algumas com ROLLBACK: a sequência final é 1..k, sem buraco nem repetição', async () => {
      const filial = randomUUID();
      const N = 12;
      const desfeitas = new Set([1, 4, 5, 9]);
      const prefixo = `SET ROLE macuxierp_app;\nSET app.tenant_id = '${A.id}';\nBEGIN;\n`;
      const resultados = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          rodarScriptAssincrono(
            banco.conexao,
            `${prefixo}${sqlNota(filial, 1, `conc-${i}`)}\nSELECT pg_sleep(0.02);\n${desfeitas.has(i) ? 'ROLLBACK' : 'COMMIT'};\n`,
          ),
        ),
      );
      expect(resultados.filter((r) => r.status === 'rejected')).toEqual([]);
      const gravados = consultar<{ numero: number }>(
        banco.conexao,
        `SELECT numero FROM faturamento.nota WHERE filial_id = '${filial}' AND serie = 1 ORDER BY numero`,
        APP_A,
      ).map((r) => r.numero);
      const k = N - desfeitas.size;
      expect(gravados).toEqual(Array.from({ length: k }, (_, i) => i + 1));
      expect(
        consultar(
          banco.conexao,
          `SELECT proximo FROM faturamento.serie_numeracao WHERE filial_id = '${filial}'`,
          APP_A,
        ),
      ).toEqual([{ proximo: k + 1 }]);
      expect(buracos(filial)).toEqual([]);
    });

    it('séries e filiais diferentes têm contadores independentes (também em paralelo)', async () => {
      const f1 = randomUUID();
      const f2 = randomUUID();
      const alvos: [string, number][] = [
        [f1, 1],
        [f1, 2],
        [f2, 1],
        [f1, 1],
        [f1, 2],
        [f2, 1],
        [f1, 1],
      ];
      const prefixo = `SET ROLE macuxierp_app;\nSET app.tenant_id = '${A.id}';\nBEGIN;\n`;
      await Promise.all(
        alvos.map(([f, s], i) =>
          rodarScriptAssincrono(banco.conexao, `${prefixo}${sqlNota(f, s, `ind-${i}`)}\nCOMMIT;\n`),
        ),
      );
      const porSerie = consultar<{ filial: string; serie: number; numeros: number[] }>(
        banco.conexao,
        `SELECT filial_id AS filial, serie, array_agg(numero ORDER BY numero) AS numeros FROM faturamento.nota
         WHERE filial_id IN ('${f1}', '${f2}') GROUP BY 1, 2 ORDER BY filial_id = '${f1}' DESC, 2`,
        APP_A,
      );
      expect(porSerie).toEqual([
        { filial: f1, serie: 1, numeros: [1, 2, 3] },
        { filial: f1, serie: 2, numeros: [1, 2] },
        { filial: f2, serie: 1, numeros: [1, 2] },
      ]);
    });

    it('reservar e confirmar sem gravar a nota cai na confirmação e o número volta', () => {
      const filial = randomUUID();
      criarNota(filial);
      expect(
        falha(() =>
          como(APP_A, `SELECT faturamento.reservar_numero('${filial}', 'homologacao', 1::smallint, 1);`),
        ),
      ).toMatch(/RN-FAT-01: número 2 da série 1 reservado sem nota nem inutilização/);
      expect(criarNota(filial).numero).toBe(2);
    });

    it('rascunho nasce sem número e o recebe na reserva (mesma transação); depois o número não muda', () => {
      const filial = randomUUID();
      const [id = ''] = linhas(
        como(
          APP_A,
          `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, idempotencia_chave, cliente_id, natureza_operacao)
           VALUES (plataforma.tenant_atual(), '${filial}', 1, '${randomUUID()}', '${A.cliente}', 'Venda') RETURNING id;`,
        ),
      );
      expect(status('nota', id)).toBe('rascunho');
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/nota_numerada/);
      executar(
        banco.conexao,
        `UPDATE faturamento.nota SET numero = faturamento.reservar_numero('${filial}', 'homologacao', 1::smallint, 1)
         WHERE id = '${id}';`,
        APP_A,
      );
      expect(
        consultar(banco.conexao, `SELECT numero FROM faturamento.nota WHERE id = '${id}'`, APP_A),
      ).toEqual([{ numero: 1 }]);
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE faturamento.nota SET numero = 2 WHERE id = '${id}';`, APP_A),
        ),
      ).toMatch(/numero da nota não muda/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET deleted_at = now() WHERE id = '${id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/só o rascunho sem número é excluído/);
      const [sem = ''] = linhas(
        como(
          APP_A,
          `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, idempotencia_chave, cliente_id, natureza_operacao)
           VALUES (plataforma.tenant_atual(), '${filial}', 1, '${randomUUID()}', '${A.cliente}', 'Venda') RETURNING id;`,
        ),
      );
      executar(banco.conexao, `UPDATE faturamento.nota SET deleted_at = now() WHERE id = '${sem}';`, APP_A);
    });

    it('nota com número não reservado, repetido ou com o contador recuado é recusada', () => {
      const filial = randomUUID();
      const n1 = criarNota(filial);
      const inserir = (numero: number) =>
        `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
           natureza_operacao) VALUES (plataforma.tenant_atual(), '${filial}', 1, ${numero}, '${randomUUID()}',
           '${A.cliente}', 'Venda');`;
      expect(falha(() => executar(banco.conexao, inserir(2), APP_A))).toMatch(/não foi reservado/);
      expect(falha(() => executar(banco.conexao, inserir(n1.numero), APP_A))).toMatch(/nota_numero_uq/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.serie_numeracao SET proximo = 1 WHERE filial_id = '${filial}';`,
            APP_A,
          ),
        ),
      ).toMatch(/só avança/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.serie_numeracao SET serie = 7 WHERE filial_id = '${filial}';`,
            APP_A,
          ),
        ),
      ).toMatch(/permission denied/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.serie_numeracao SET proximo = proximo + 5 WHERE filial_id = '${filial}';`,
            APP_A,
          ),
        ),
      ).toMatch(/buraco/);
    });

    it('idempotência: a mesma chave não grava duas notas', () => {
      const filial = randomUUID();
      const idem = randomUUID();
      como(APP_A, sqlNota(filial, 1, idem));
      expect(falha(() => como(APP_A, sqlNota(filial, 1, idem)))).toMatch(/nota_idempotencia_uq/);
      expect(criarNota(filial).numero).toBe(2);
    });

    it('rejeitada reenvia com o mesmo número (RN-FAT-07); abandonada, sai por inutilização registrada pelo XML', () => {
      const filial = randomUUID();
      const n = criarNota(filial);
      executar(banco.conexao, sqlEnviar(n), APP_A);
      executar(
        banco.conexao,
        `UPDATE faturamento.nota SET status = 'rejeitada', c_stat = 225, x_motivo = 'Falha no schema'
           WHERE id = '${n.id}';`,
        WORKER_A,
      );
      executar(
        banco.conexao,
        `UPDATE faturamento.nota SET natureza_operacao = 'Venda corrigida', total_nota_centavos = 100
           WHERE id = '${n.id}';
         UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`,
        APP_A,
      );
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE faturamento.nota SET numero = 2 WHERE id = '${n.id}';`, APP_A),
        ),
      ).toMatch(/numero da nota não muda/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET total_nota_centavos = 1 WHERE id = '${n.id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/em autorização só recebe o retorno/);
      executar(
        banco.conexao,
        `UPDATE faturamento.nota SET status = 'rejeitada' WHERE id = '${n.id}';`,
        WORKER_A,
      );

      const n2 = criarNota(filial);
      executar(banco.conexao, sqlEnviar(n2), APP_A);
      expect(
        falha(() => executar(banco.conexao, sqlInutilizacao(filial, n.numero, n2.numero), WORKER_A)),
      ).toMatch(/tem nota que não está rejeitada nem em rascunho/);
      expect(
        falha(() => executar(banco.conexao, sqlInutilizacao(filial, n2.numero + 2, n2.numero + 3), WORKER_A)),
      ).toMatch(/começa no máximo no próximo número/);
      // Pendente: a nota ainda é rejeitada, mas não volta a ser enviada.
      executar(banco.conexao, sqlInutilizacao(filial, n.numero, n.numero), WORKER_A);
      expect(status('nota', n.id)).toBe('rejeitada');
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/está em inutilização/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.inutilizacao SET status = 'registrado', protocolo = '113260000000050',
               registrado_em = now() WHERE filial_id = '${filial}';`,
            WORKER_A,
          ),
        ),
      ).toMatch(/só fica registrada com o XML guardado/);
      executar(banco.conexao, sqlXmlInutilizacao(filial, n.numero), WORKER_A);
      expect(status('nota', n.id)).toBe('inutilizada');
      // A faixa pula 3 e 4 à frente da 2: a numeração avança junto.
      executar(banco.conexao, sqlInutilizacao(filial, n2.numero + 1, n2.numero + 2), WORKER_A);
      expect(criarNota(filial).numero).toBe(n2.numero + 3);
      expect(
        falha(() => executar(banco.conexao, sqlInutilizacao(filial, n2.numero + 2, n2.numero + 2), WORKER_A)),
      ).toMatch(/faixa já inutilizada/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.inutilizacao SET justificativa = 'Outra justificativa qualquer'
               WHERE filial_id = '${filial}' AND status = 'pendente';`,
            WORKER_A,
          ),
        ),
      ).toMatch(/justificativa da inutilização não muda/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.inutilizacao SET c_stat = 102 WHERE filial_id = '${filial}' AND status = 'registrado';`,
          ),
        ),
      ).toMatch(/inutilização registrado não muda/);
      expect(buracos(filial)).toEqual([]);
    });

    it('corrida inutilização × reenvio: a inutilização primeiro, o reenvio da rejeitada cai', async () => {
      const filial = randomUUID();
      const n = criarNota(filial);
      rejeitar(n);
      // A inutilização (worker) trava as notas da faixa; o reenvio (app) espera e vê a faixa confirmada.
      const [inut, reenvio] = await corrida(
        sqlInutilizacao(filial, n.numero, n.numero),
        `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`,
      );
      expect(motivo(inut!)).toBe('ok');
      expect(motivo(reenvio!)).toMatch(/RN-FAT-07: o número 1 está em inutilização/);
      expect(status('nota', n.id)).toBe('rejeitada');
    });

    it('corrida reenvio × inutilização: o reenvio primeiro, a inutilização cai', async () => {
      const filial = randomUUID();
      const n = criarNota(filial);
      rejeitar(n);
      const sessao = (ctx: Contexto, sql: string) =>
        rodarScriptAssincrono(
          banco.conexao,
          `SET ROLE ${ctx.papel};\nSET app.tenant_id = '${ctx.tenant}';\nBEGIN;\n${sql}\n`,
        );
      const reenvio = sessao(
        APP_A,
        `UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';\nSELECT pg_sleep(1);\nCOMMIT;`,
      );
      await esperar(300);
      const inut = sessao(WORKER_A, `${sqlInutilizacao(filial, n.numero, n.numero)}\nCOMMIT;`);
      const [r1, r2] = await Promise.allSettled([reenvio, inut]);
      expect(motivo(r1!)).toBe('ok');
      expect(motivo(r2!)).toMatch(/a faixa tem nota que não está rejeitada nem em rascunho/);
      expect(status('nota', n.id)).toBe('em_autorizacao');
      expect(
        consultar(
          banco.conexao,
          `SELECT count(*)::int AS n FROM faturamento.inutilizacao WHERE filial_id = '${filial}'`,
          APP_A,
        ),
      ).toEqual([{ n: 0 }]);
    });

    it('corrida inutilização × nota no buraco de inutilização rejeitada: a inutilização primeiro, a nota cai', async () => {
      const filial = randomUUID();
      for (let i = 0; i < 3; i++) criarNota(filial);
      // A faixa 4–5 rejeitada vira buraco (o próximo fica em 6); 4 e 5 já estão abaixo do próximo.
      executar(banco.conexao, sqlInutilizacao(filial, 4, 5), WORKER_A);
      executar(
        banco.conexao,
        `UPDATE faturamento.inutilizacao SET status = 'rejeitado', c_stat = 241 WHERE filial_id = '${filial}';`,
        WORKER_A,
      );
      // O worker inutiliza 4–4 e segura; o app grava a nota nº 4 direto no buraco e a envia. A nota espera a
      // linha da série (FOR SHARE × FOR UPDATE) e, com a inutilização confirmada, é recusada.
      const [inut, nota] = await corrida(
        sqlInutilizacao(filial, 4, 4),
        `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
           natureza_operacao, chave_acesso, c_nf)
         VALUES (plataforma.tenant_atual(), '${filial}', 1, 4, '${randomUUID()}', '${A.cliente}', 'Venda',
           '${chaveAcesso(1, 4, 77)}', '${cnfDe(77)}') RETURNING id \\gset
UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = :'id';`,
      );
      expect(motivo(inut!)).toBe('ok');
      expect(motivo(nota!)).toMatch(/RN-FAT-01: o número 4 da série 1 está em inutilização/);
      expect(
        consultar(
          banco.conexao,
          `SELECT count(*)::int AS n FROM faturamento.nota WHERE filial_id = '${filial}' AND numero = 4`,
          APP_A,
        ),
      ).toEqual([{ n: 0 }]);
      expect(
        consultar(
          banco.conexao,
          `SELECT numero_inicial AS ini, numero_final AS fim, status AS s FROM faturamento.inutilizacao
           WHERE filial_id = '${filial}' ORDER BY created_at, numero_final`,
          APP_A,
        ),
      ).toEqual([
        { ini: 4, fim: 5, s: 'rejeitado' },
        { ini: 4, fim: 4, s: 'pendente' },
      ]);
    });

    it('nota com número dentro de faixa inutilizada (pendente ou registrada) é recusada', () => {
      const filial = randomUUID();
      criarNota(filial);
      // Faixa 2 e 3 à frente do próximo: a numeração vai a 4; 2 e 3 ficam "reservados" pela inutilização.
      executar(banco.conexao, sqlInutilizacao(filial, 2, 3), WORKER_A);
      const inserir = (numero: number) =>
        `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, numero, idempotencia_chave, cliente_id,
           natureza_operacao) VALUES (plataforma.tenant_atual(), '${filial}', 1, ${numero}, '${randomUUID()}',
           '${A.cliente}', 'Venda');`;
      expect(falha(() => executar(banco.conexao, inserir(3), APP_A))).toMatch(
        /RN-FAT-01: o número 3 da série 1 está em inutilização/,
      );
      const [sem = ''] = linhas(
        como(
          APP_A,
          `INSERT INTO faturamento.nota (tenant_id, filial_id, serie, idempotencia_chave, cliente_id, natureza_operacao)
           VALUES (plataforma.tenant_atual(), '${filial}', 1, '${randomUUID()}', '${A.cliente}', 'Venda') RETURNING id;`,
        ),
      );
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE faturamento.nota SET numero = 2 WHERE id = '${sem}';`, APP_A),
        ),
      ).toMatch(/está em inutilização/);
      executar(banco.conexao, sqlXmlInutilizacao(filial, 2), WORKER_A);
      expect(falha(() => executar(banco.conexao, inserir(2), APP_A))).toMatch(/está em inutilização/);
      expect(criarNota(filial).numero).toBe(4);
    });

    it('inutilização além de 100 números a partir do próximo: recusada para app e worker; o dono pode', () => {
      const filial = randomUUID();
      criarNota(filial);
      for (const ctx of [APP_A, WORKER_A]) {
        expect(falha(() => executar(banco.conexao, sqlInutilizacao(filial, 2, 102), ctx))).toMatch(
          /RN-FAT-01: a inutilização vai no máximo até o número 101/,
        );
      }
      executar(banco.conexao, sqlInutilizacao(filial, 2, 101), APP_A);
      const saida = rodarScript(
        banco.conexao,
        `BEGIN;
SELECT set_config('app.tenant_id', '${A.id}', true);
${sqlInutilizacao(filial, 102, 5000)}
SELECT proximo FROM faturamento.serie_numeracao WHERE filial_id = '${filial}';
ROLLBACK;
`,
      );
      expect(numeros(saida)).toEqual([5001]);
    });

    it('rascunho numerado e abandonado vai a inutilizada pela inutilização registrada; pendente, não é enviado', () => {
      const filial = randomUUID();
      const n = criarNota(filial);
      executar(banco.conexao, sqlInutilizacao(filial, n.numero, n.numero), WORKER_A);
      expect(status('nota', n.id)).toBe('rascunho');
      expect(falha(() => executar(banco.conexao, sqlEnviar(n), APP_A))).toMatch(/está em inutilização/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET status = 'inutilizada' WHERE id = '${n.id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/inutilizada só com a inutilização registrada/);
      executar(banco.conexao, sqlXmlInutilizacao(filial, n.numero), WORKER_A);
      expect(status('nota', n.id)).toBe('inutilizada');
      expect(buracos(filial)).toEqual([]);
    });

    it('Q9: buracos vazios no fluxo normal; inutilização rejeitada e intervenção do dono aparecem', () => {
      const filial = randomUUID();
      for (let i = 0; i < 3; i++) criarNota(filial);
      expect(buracos(filial)).toEqual([]);
      // Inutilização de 4 e 5 rejeitada pela SEFAZ: os números ficam sem nota nem inutilização.
      executar(banco.conexao, sqlInutilizacao(filial, 4, 5), WORKER_A);
      expect(buracos(filial)).toEqual([]);
      executar(
        banco.conexao,
        `UPDATE faturamento.inutilizacao SET status = 'rejeitado', c_stat = 241, x_motivo = 'Rejeição'
           WHERE filial_id = '${filial}';`,
        WORKER_A,
      );
      expect(buracos(filial)).toEqual([{ ini: 4, fim: 5 }]);
      expect(buracos(filial, LEITURA_A)).toEqual([{ ini: 4, fim: 5 }]);
      // A faixa rejeitada não bloqueia a nova inutilização dela.
      executar(banco.conexao, sqlInutilizacao(filial, 4, 5), WORKER_A);
      expect(buracos(filial)).toEqual([]);
      // O dono força um buraco (gatilho desligado só nesta transação, desfeita no fim).
      const saida = rodarScript(
        banco.conexao,
        `BEGIN;
ALTER TABLE faturamento.serie_numeracao DISABLE TRIGGER serie_numeracao_sem_buraco;
UPDATE faturamento.serie_numeracao SET proximo = proximo + 2 WHERE filial_id = '${filial}';
ALTER TABLE faturamento.serie_numeracao ENABLE TRIGGER serie_numeracao_sem_buraco;
SELECT numero_inicial * 1000 + numero_final FROM faturamento.buracos_numeracao('${filial}');
ROLLBACK;
`,
      );
      expect(numeros(saida)).toEqual([6007]);
      expect(buracos(filial)).toEqual([]);
    });
  });

  describe('RN-FAT-04: ambiente pela filial (core.ambiente_fiscal, A3)', () => {
    it('sem linha em core.ambiente_fiscal a nota é de homologação', () => {
      const filial = randomUUID();
      expect(criarNota(filial).ambiente).toBe('homologacao');
      expect(criarNota(A.filial).ambiente).toBe('homologacao');
    });

    it('a reserva com ambiente informado diferente do da filial é recusada', () => {
      const filial = randomUUID();
      expect(
        falha(() =>
          como(APP_A, `SELECT faturamento.reservar_numero('${filial}', 'producao', 1::smallint, 1);`),
        ),
      ).toMatch(/RN-FAT-04: ambiente informado \(producao\) diferente do da filial/);
      expect(
        falha(() => como(APP_A, `SELECT faturamento.reservar_numero('${filial}', NULL, 1::smallint, 1);`)),
      ).toMatch(/RN-FAT-04: informe o ambiente/);
      expect(
        consultar(
          banco.conexao,
          `SELECT count(*)::int AS n FROM faturamento.serie_numeracao WHERE filial_id = '${filial}'`,
          APP_A,
        ),
      ).toEqual([{ n: 0 }]);
    });

    it('o app não grava produção (nota, numeração e contingência)', () => {
      const filial = randomUUID();
      expect(falha(() => como(APP_A, sqlNota(filial, 1, randomUUID(), 'homologacao', 'producao')))).toMatch(
        /RN-FAT-04/,
      );
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.serie_numeracao (tenant_id, filial_id, serie, ambiente, numero_inicial, proximo)
             VALUES (plataforma.tenant_atual(), '${randomUUID()}', 1, 'producao', 1, 1);`,
            APP_A,
          ),
        ),
      ).toMatch(/RN-FAT-04/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.contingencia (tenant_id, filial_id, ambiente, modalidade, motivo)
             VALUES (plataforma.tenant_atual(), '${filial}', 'producao', 'svc_an', 'Motivo com mais de quinze');`,
            APP_A,
          ),
        ),
      ).toMatch(/RN-FAT-04/);
    });

    it('com a filial em produção (pelo dono, ADR 0006), a nota vai para produção, com numeração própria', () => {
      const filial = randomUUID();
      criarNota(filial);
      criarNota(filial);
      executar(
        banco.conexao,
        `INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao)
         VALUES ('${A.id}', '${filial}', 'producao', '${RECADO_OK}');`,
      );
      expect(falha(() => criarNota(filial))).toMatch(/RN-FAT-04/);
      // A nota de homologação feita antes da troca não é enviada (nem como contingência).
      const antiga = consultar<{ id: string; numero: number }>(
        banco.conexao,
        `SELECT id, numero FROM faturamento.nota WHERE filial_id = '${filial}' ORDER BY numero LIMIT 1`,
        APP_A,
      )[0]!;
      expect(
        falha(() =>
          executar(
            banco.conexao,
            sqlEnviar({
              ...antiga,
              ambiente: 'homologacao',
              serie: 1,
              cnf: 7,
              chave: chaveAcesso(1, antiga.numero, 7),
            }),
            APP_A,
          ),
        ),
      ).toMatch(/RN-FAT-04: a nota é de homologacao e a filial agora emite em producao/);
      const p = criarNota(filial, 1, 'producao');
      expect(p).toMatchObject({ ambiente: 'producao', numero: 1 });
      executar(
        banco.conexao,
        `UPDATE core.ambiente_fiscal SET ambiente = 'homologacao' WHERE filial_id = '${filial}';`,
      );
      expect(criarNota(filial)).toMatchObject({ ambiente: 'homologacao', numero: 3 });
    });
  });

  describe('RN-FAT-02 e 03: nota autorizada, XML imutável e guarda pendente', () => {
    it('com a guarda pendente, evento, título e o status "autorizada" são recusados; o XML guardado libera', () => {
      const n = criarNota(A.filial);
      autorizarSemGuarda(n, '113260000000010');
      expect(status('nota', n.id)).toBe('autorizada_guarda_pendente');
      expect(falha(() => executar(banco.conexao, sqlTitulo(n.id, 1), APP_A))).toMatch(/RN-FAT-03/);
      expect(falha(() => executar(banco.conexao, sqlEvento(n.id, 'cce', 1), APP_A))).toMatch(/RN-FAT-03/);
      expect(falha(() => executar(banco.conexao, sqlEvento(n.id, 'cancelamento', 1), APP_A))).toMatch(
        /RN-FAT-03/,
      );
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET status = 'autorizada' WHERE id = '${n.id}';`,
            WORKER_A,
          ),
        ),
      ).toMatch(/RN-FAT-03: a nota só fica autorizada com o XML guardado/);
      // Hash errado, chave ou protocolo de outra nota: recusados.
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256)
             VALUES (plataforma.tenant_atual(), 'nfe_autorizada', '${n.id}', '${n.chave}', '113260000000010', '<x/>',
               repeat('0', 64));`,
            WORKER_A,
          ),
        ),
      ).toMatch(/nota_xml_hash/);
      expect(falha(() => executar(banco.conexao, sqlXml(n, '113260000000011'), WORKER_A))).toMatch(
        /chave ou protocolo/,
      );
      // guardado_em informado pela aplicação é trocado pelo relógio do banco.
      const xml = `<nfeProc>${n.id}</nfeProc>`;
      executar(
        banco.conexao,
        `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256, guardado_em)
         VALUES (plataforma.tenant_atual(), 'nfe_autorizada', '${n.id}', '${n.chave}', '113260000000010', '${xml}',
           ${hashSql(xml)}, '2015-01-01T00:00:00Z');`,
        WORKER_A,
      );
      expect(status('nota', n.id)).toBe('autorizada');
      const [guarda] = consultar<{ ok: boolean; agora: boolean; bytes: number }>(
        banco.conexao,
        `SELECT guardar_ate = (date_trunc('year', guardado_em AT TIME ZONE 'UTC') + interval '6 years')::date AS ok,
           guardado_em > now() - interval '1 hour' AS agora, tamanho_bytes AS bytes
         FROM faturamento.nota_xml WHERE nota_id = '${n.id}'`,
        APP_A,
      );
      expect(guarda).toEqual({ ok: true, agora: true, bytes: Buffer.byteLength(xml) });
      expect(falha(() => executar(banco.conexao, sqlXml(n, '113260000000010'), WORKER_A))).toMatch(
        /RN-FAT-03|nota_xml_autorizada_uq/,
      );
      executar(banco.conexao, sqlTitulo(n.id, 1) + sqlTitulo(n.id, 2), APP_A);
      expect(falha(() => executar(banco.conexao, sqlTitulo(n.id, 2), APP_A))).toMatch(/titulo_parcela_uq/);
      expect(falha(() => executar(banco.conexao, sqlTitulo(n.id, 3, 0), APP_A))).toMatch(/check constraint/);
      expect(falha(() => executar(banco.conexao, sqlTitulo(n.id, 4, 100, 3), APP_A))).toMatch(
        /titulo_parcela_no_total/,
      );
    });

    it('tabela temporária pg_class/pg_roles do app não engana sou_dono: guardado_em antigo vira o relógio do banco', () => {
      const n = criarNota(A.filial);
      autorizarSemGuarda(n, '113260000000060');
      const xml = `<nfeProc>${n.id}</nfeProc>`;
      const saida = como(
        WORKER_A,
        `CREATE TEMP TABLE pg_class (oid oid, relowner oid);
CREATE TEMP TABLE pg_roles (oid oid, rolname name);
INSERT INTO pg_temp.pg_class VALUES ('faturamento.nota_xml'::regclass, 1);
INSERT INTO pg_temp.pg_roles VALUES (1, current_user);
SELECT CASE WHEN faturamento.sou_dono('faturamento.nota_xml'::regclass) THEN 'dono' ELSE 'nao_dono' END;
INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256, guardado_em)
  VALUES (plataforma.tenant_atual(), 'nfe_autorizada', '${n.id}', '${n.chave}', '113260000000060', '${xml}',
    ${hashSql(xml)}, '2001-01-01T00:00:00Z');`,
      );
      expect(linhas(saida)).toEqual(['nao_dono']);
      expect(
        consultar(
          banco.conexao,
          `SELECT guardado_em > now() - interval '1 hour' AS agora FROM faturamento.nota_xml WHERE nota_id = '${n.id}'`,
        ),
      ).toEqual([{ agora: true }]);
    });

    it('guardar_ate abaixo de 1º de janeiro do 6º ano depois da guarda é recusado (CTN art. 173)', () => {
      const n = criarNota(A.filial);
      autorizarSemGuarda(n, '113260000000061');
      const xml = `<nfeProc>${n.id}</nfeProc>`;
      const comGuarda = (ate: string) =>
        `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256, guardar_ate)
         VALUES (plataforma.tenant_atual(), 'nfe_autorizada', '${n.id}', '${n.chave}', '113260000000061', '${xml}',
           ${hashSql(xml)}, ${ate});`;
      const minimo = `(date_trunc('year', now() AT TIME ZONE 'UTC') + interval '6 years')::date`;
      expect(falha(() => executar(banco.conexao, comGuarda(`${minimo} - 1`), WORKER_A))).toMatch(
        /nota_xml_guarda_minima/,
      );
      executar(banco.conexao, comGuarda(minimo), WORKER_A);
      expect(status('nota', n.id)).toBe('autorizada');
    });

    it('UPDATE e DELETE do XML: app e worker sem permissão; o dono também é recusado dentro da guarda', () => {
      for (const ctx of [APP_A, WORKER_A]) {
        expect(
          falha(() => executar(banco.conexao, `UPDATE faturamento.nota_xml SET xml = '<y/>';`, ctx)),
        ).toMatch(/permission denied/);
      }
      expect(
        falha(() =>
          executar(banco.conexao, `UPDATE faturamento.nota_xml SET arquivo_id = gen_random_uuid();`),
        ),
      ).toMatch(/RN-FAT-03: o XML guardado é imutável/);
      expect(falha(() => executar(banco.conexao, `DELETE FROM faturamento.nota_xml;`))).toMatch(
        /RN-FAT-03: o XML guardado é imutável/,
      );
      expect(falha(() => executar(banco.conexao, `TRUNCATE faturamento.nota_xml CASCADE;`))).toMatch(
        /só de inserção|não sai do banco/,
      );
    });

    it('o dono importa XML antigo (guardado_em informado) e o apaga só depois do guardar_ate', () => {
      const n = criarNota(A.filial);
      // hora-fixa-ok: autorização antiga, só precisa ficar mais de 5 anos antes do relógio do banco
      autorizarSemGuarda(n, '113150000000001', `'2015-03-10T12:00:00Z'`);
      const xml = `<nfeProc>${n.id}</nfeProc>`;
      executar(
        banco.conexao,
        `SELECT set_config('app.tenant_id', '${A.id}', true);
         INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256, guardado_em)
         VALUES ('${A.id}', 'nfe_autorizada', '${n.id}', '${n.chave}', '113150000000001', '${xml}', ${hashSql(xml)},
           '2015-03-10T12:00:00Z');`,
      );
      const [x] = consultar<{ ate: string }>(
        banco.conexao,
        `SELECT guardar_ate::text AS ate FROM faturamento.nota_xml WHERE nota_id = '${n.id}'`,
      );
      expect(x?.ate).toBe('2021-01-01');
      const saida = rodarScript(
        banco.conexao,
        `BEGIN;\nDELETE FROM faturamento.nota_xml WHERE nota_id = '${n.id}' RETURNING 1;\nROLLBACK;\n`,
      );
      expect(numeros(saida)).toEqual([1]);
    });

    it('nota autorizada nunca é editada, nem pelo dono; não sai do banco; o ambiente não muda', () => {
      for (const ctx of [APP_A, WORKER_A, {}]) {
        expect(
          falha(() =>
            executar(
              banco.conexao,
              `UPDATE faturamento.nota SET total_nota_centavos = 1 WHERE id = '${A.nota}';`,
              ctx,
            ),
          ),
        ).toMatch(/RN-FAT-02: nota autorizada nunca é editada/);
        expect(
          falha(() =>
            executar(
              banco.conexao,
              `UPDATE faturamento.nota SET protocolo = '113260000000077' WHERE id = '${A.nota}';`,
              ctx,
            ),
          ),
        ).toMatch(/RN-FAT-02: nota autorizada nunca é editada/);
      }
      for (const set of [`c_stat = 135`, `x_motivo = 'Outro motivo'`, `recibo = '113260000000555'`]) {
        expect(
          falha(() =>
            executar(banco.conexao, `UPDATE faturamento.nota SET ${set} WHERE id = '${A.nota}';`, WORKER_A),
          ),
        ).toMatch(
          /RN-FAT-02: nota autorizada nunca é editada, só evento \((c_stat|x_motivo|recibo) recusado\)/,
        );
      }
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET status = 'rascunho' WHERE id = '${A.nota}';`,
            APP_A,
          ),
        ),
      ).toMatch(/transição de autorizada para rascunho/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET status = 'cancelada', cancelada_em = now() WHERE id = '${A.nota}';`,
            APP_A,
          ),
        ),
      ).toMatch(/cancelamento só pelo evento/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota_item SET valor_total_centavos = 1 WHERE nota_id = '${A.nota}';`,
            APP_A,
          ),
        ),
      ).toMatch(/item de nota autorizada não muda/);
      expect(
        falha(() => executar(banco.conexao, `DELETE FROM faturamento.nota WHERE id = '${A.nota}';`)),
      ).toMatch(/não sai do banco/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET ambiente = 'producao' WHERE id = '${A.nota}';`,
          ),
        ),
      ).toMatch(/ambiente da nota não muda/);
    });

    it('eventos: XML em nota_xml registra; CC-e em sequência até 20; registrado não muda; cancelamento cancela a nota', () => {
      const n = criarNota(A.filial);
      autorizar(n, '113260000000020');
      executar(banco.conexao, sqlEvento(n.id, 'cce', 1), APP_A);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota_evento SET status = 'registrado', protocolo = '113260000000021',
               registrado_em = now() WHERE nota_id = '${n.id}';`,
            WORKER_A,
          ),
        ),
      ).toMatch(/só fica registrado com o XML guardado/);
      // XML do tipo errado é recusado; o certo registra o evento.
      expect(
        falha(() =>
          executar(
            banco.conexao,
            sqlXmlEvento(n.id, 'cce', 1).replace("'evento_cce'", "'evento_cancelamento'"),
            WORKER_A,
          ),
        ),
      ).toMatch(/evento pendente do mesmo tipo/);
      executar(banco.conexao, sqlXmlEvento(n.id, 'cce', 1, '113260000000021'), WORKER_A);
      expect(
        consultar(
          banco.conexao,
          `SELECT e.status, e.protocolo, x.tipo, x.nota_id = e.nota_id AS mesma_nota, x.chave_acesso
           FROM faturamento.nota_evento e JOIN faturamento.nota_xml x ON x.evento_id = e.id
           WHERE e.nota_id = '${n.id}'`,
          APP_A,
        ),
      ).toEqual([
        {
          status: 'registrado',
          protocolo: '113260000000021',
          tipo: 'evento_cce',
          mesma_nota: true,
          chave_acesso: n.chave,
        },
      ]);
      expect(falha(() => executar(banco.conexao, sqlEvento(n.id, 'cce', 3), APP_A))).toMatch(/sequência 2/);
      // Rejeitada pela SEFAZ, a CC-e volta a pendente com a mesma sequência.
      executar(banco.conexao, sqlEvento(n.id, 'cce', 2), APP_A);
      executar(
        banco.conexao,
        `UPDATE faturamento.nota_evento SET status = 'rejeitado', c_stat = 490 WHERE nota_id = '${n.id}'
           AND n_seq_evento = 2;
         UPDATE faturamento.nota_evento SET status = 'pendente', texto = 'Texto corrigido da carta de correção'
           WHERE nota_id = '${n.id}' AND n_seq_evento = 2;`,
        WORKER_A,
      );
      executar(banco.conexao, sqlXmlEvento(n.id, 'cce', 2), WORKER_A);
      executar(
        banco.conexao,
        Array.from({ length: 18 }, (_, i) => sqlEvento(n.id, 'cce', i + 3)).join('\n'),
        APP_A,
      );
      expect(falha(() => executar(banco.conexao, sqlEvento(n.id, 'cce', 21), APP_A))).toMatch(
        /check constraint/,
      );
      expect(falha(() => executar(banco.conexao, sqlEvento(n.id, 'cancelamento', 2), APP_A))).toMatch(
        /nota_evento_cancelamento_unico/,
      );
      for (const ctx of [APP_A, WORKER_A, {}]) {
        expect(
          falha(() =>
            executar(
              banco.conexao,
              `UPDATE faturamento.nota_evento SET texto = 'Outro texto com mais de quinze'
                 WHERE nota_id = '${n.id}' AND n_seq_evento = 1;`,
              ctx,
            ),
          ),
        ).toMatch(/evento registrado não muda/);
      }
      expect(falha(() => executar(banco.conexao, `DELETE FROM faturamento.nota_evento;`))).toMatch(
        /não sai do banco/,
      );
      // Cancelamento pendente não cancela; o XML registrado cancela a nota.
      executar(
        banco.conexao,
        sqlEvento(n.id, 'cancelamento', 1, 'Cancelamento a pedido do cliente'),
        WORKER_A,
      );
      expect(status('nota', n.id)).toBe('autorizada');
      executar(banco.conexao, sqlXmlEvento(n.id, 'cancelamento', 1, '113260000000030'), WORKER_A);
      expect(
        consultar(
          banco.conexao,
          `SELECT status, cancelada_em IS NOT NULL AS com_data FROM faturamento.nota WHERE id = '${n.id}'`,
          APP_A,
        ),
      ).toEqual([{ status: 'cancelada', com_data: true }]);
      expect(
        consultar(
          banco.conexao,
          `SELECT tipo, count(*)::int AS n FROM faturamento.nota_xml WHERE nota_id = '${n.id}' GROUP BY 1 ORDER BY 1`,
          APP_A,
        ),
      ).toEqual([
        { tipo: 'evento_cancelamento', n: 1 },
        { tipo: 'evento_cce', n: 2 },
        { tipo: 'nfe_autorizada', n: 1 },
      ]);
      expect(falha(() => executar(banco.conexao, sqlEvento(n.id, 'cce', 21), APP_A))).toMatch(
        /status cancelada/,
      );
      expect(falha(() => executar(banco.conexao, sqlTitulo(n.id, 1), APP_A))).toMatch(/RN-FAT-03/);
    });
  });

  describe('RN-FAT-05: contingência (A5)', () => {
    it('uma contingência aberta por filial e ambiente; fechada não muda; nota em contingência só com ela aberta', () => {
      const filial = randomUUID();
      const abrir = (f: string) =>
        `INSERT INTO faturamento.contingencia (tenant_id, filial_id, modalidade, motivo)
         VALUES (plataforma.tenant_atual(), '${f}', 'svc_an', 'SEFAZ-AM sem resposta há 5 min');`;
      const n = criarNota(filial);
      const emContingencia = `UPDATE faturamento.nota SET status = 'emitida_contingencia', tipo_emissao = 6,
          chave_acesso = '${chaveAcesso(1, n.numero, n.cnf, 6)}', c_nf = '${cnfDe(n.cnf)}', contingencia_em = now(),
          contingencia_justificativa = 'SEFAZ-AM sem resposta há 5 min' WHERE id = '${n.id}';`;
      expect(falha(() => executar(banco.conexao, emContingencia, APP_A))).toMatch(
        /só com a contingência aberta/,
      );
      executar(banco.conexao, abrir(filial), APP_A);
      expect(falha(() => executar(banco.conexao, abrir(filial), WORKER_A))).toMatch(
        /contingencia_uma_aberta/,
      );
      executar(banco.conexao, abrir(randomUUID()), APP_A);
      executar(banco.conexao, emContingencia, APP_A);
      expect(status('nota', n.id)).toBe('emitida_contingencia');
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.nota SET total_nota_centavos = 5 WHERE id = '${n.id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/RN-FAT-05: nota emitida em contingência só recebe o retorno/);
      executar(
        banco.conexao,
        `UPDATE faturamento.contingencia SET fim_em = now() WHERE filial_id = '${filial}';
         UPDATE faturamento.nota SET status = 'em_autorizacao' WHERE id = '${n.id}';`,
        WORKER_A,
      );
      expect(status('nota', n.id)).toBe('em_autorizacao');
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.contingencia SET motivo = 'Outro motivo qualquer aqui' WHERE filial_id = '${filial}';`,
            APP_A,
          ),
        ),
      ).toMatch(/só recebe o fim, uma vez/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.contingencia SET fim_em = now() WHERE filial_id = '${filial}';`,
            APP_A,
          ),
        ),
      ).toMatch(/só recebe o fim, uma vez/);
      executar(banco.conexao, abrir(filial), APP_A);
    });
  });

  describe('RN-FAT-06: títulos, saldo e baixa', () => {
    it('saldo nasce igual ao valor, cai com a baixa, zera em baixado, volta com o estorno; nunca negativo', () => {
      const n = criarNota(A.filial);
      autorizar(n, '113260000000040');
      executar(banco.conexao, sqlTitulo(n.id, 1, 1000, 1), APP_A);
      const titulo = () =>
        consultar<{ saldo: number; status: string; cliente: string; ambiente: string }>(
          banco.conexao,
          `SELECT saldo_centavos AS saldo, status, cliente_id AS cliente, ambiente FROM faturamento.titulo
           WHERE nota_id = '${n.id}'`,
          APP_A,
        )[0];
      expect(titulo()).toEqual({
        saldo: 1000,
        status: 'aberto',
        cliente: A.cliente,
        ambiente: 'homologacao',
      });
      const baixa = (valor: number) =>
        `INSERT INTO faturamento.titulo_baixa (tenant_id, titulo_id, valor_centavos, forma)
         SELECT plataforma.tenant_atual(), id, ${valor}, 'pix' FROM faturamento.titulo WHERE nota_id = '${n.id}';`;
      executar(banco.conexao, baixa(400), APP_A);
      expect(titulo()).toMatchObject({ saldo: 600, status: 'aberto' });
      expect(falha(() => executar(banco.conexao, baixa(601), APP_A))).toMatch(/titulo_saldo/);
      for (const ctx of [APP_A, {}]) {
        expect(
          falha(() =>
            executar(
              banco.conexao,
              `UPDATE faturamento.titulo SET saldo_centavos = 1 WHERE nota_id = '${n.id}';`,
              ctx,
            ),
          ),
        ).toMatch(/saldo e baixa do título só por faturamento.titulo_baixa/);
      }
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.titulo SET valor_centavos = 5000 WHERE nota_id = '${n.id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/valor_centavos do título não muda/);
      executar(banco.conexao, baixa(600), APP_A);
      expect(titulo()).toMatchObject({ saldo: 0, status: 'baixado' });
      expect(falha(() => executar(banco.conexao, baixa(1), APP_A))).toMatch(/baixa só em título aberto/);
      executar(
        banco.conexao,
        `UPDATE faturamento.titulo_baixa SET estornada_em = now() WHERE valor_centavos = 600
           AND titulo_id IN (SELECT id FROM faturamento.titulo WHERE nota_id = '${n.id}');`,
        APP_A,
      );
      expect(titulo()).toMatchObject({ saldo: 600, status: 'aberto' });
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.titulo_baixa SET estornada_em = now() WHERE valor_centavos = 600
               AND titulo_id IN (SELECT id FROM faturamento.titulo WHERE nota_id = '${n.id}');`,
            APP_A,
          ),
        ),
      ).toMatch(/só recebe o estorno, uma vez/);
      executar(
        banco.conexao,
        `UPDATE faturamento.titulo SET status = 'cancelado' WHERE nota_id = '${n.id}';`,
        APP_A,
      );
      expect(falha(() => executar(banco.conexao, baixa(1), APP_A))).toMatch(/baixa só em título aberto/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `UPDATE faturamento.titulo SET status = 'aberto' WHERE nota_id = '${n.id}';`,
            APP_A,
          ),
        ),
      ).toMatch(/título cancelado não muda/);
    });

    it('gatilho em tabela temporária (pg_trigger_depth > 1) não baixa o título sem baixa', () => {
      const n = criarNota(A.filial);
      autorizar(n, '113260000000042');
      executar(banco.conexao, sqlTitulo(n.id, 1, 1000, 1), APP_A);
      expect(
        falha(() =>
          como(
            APP_A,
            `CREATE FUNCTION pg_temp.baixar() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE faturamento.titulo SET saldo_centavos = 0, status = 'baixado' WHERE nota_id = '${n.id}';
  RETURN NULL;
END $f$;
CREATE TEMP TABLE disparo (x int);
CREATE TRIGGER disparo AFTER INSERT ON pg_temp.disparo FOR EACH ROW EXECUTE FUNCTION pg_temp.baixar();
INSERT INTO pg_temp.disparo VALUES (1);`,
          ),
        ),
      ).toMatch(/RN-FAT-06: saldo e baixa do título só por faturamento.titulo_baixa/);
      expect(
        consultar(
          banco.conexao,
          `SELECT saldo_centavos AS saldo, status FROM faturamento.titulo WHERE nota_id = '${n.id}'`,
          APP_A,
        ),
      ).toEqual([{ saldo: 1000, status: 'aberto' }]);
    });

    it('o título é do cliente, da filial e do ambiente da nota', () => {
      const n = criarNota(A.filial);
      autorizar(n, '113260000000041');
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.titulo (tenant_id, nota_id, cliente_id, parcela, total_parcelas, vencimento,
               valor_centavos, conta_como_real) VALUES (plataforma.tenant_atual(), '${n.id}', '${randomUUID()}', 1, 1,
               '2026-12-31', 10, false);`,
            APP_A,
          ),
        ),
      ).toMatch(/do cliente, da filial e do ambiente da nota/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO faturamento.titulo (tenant_id, nota_id, ambiente, parcela, total_parcelas, vencimento,
               valor_centavos, conta_como_real) VALUES (plataforma.tenant_atual(), '${n.id}', 'producao', 1, 1, '2026-12-31',
               10, false);`,
            APP_A,
          ),
        ),
      ).toMatch(/do cliente, da filial e do ambiente da nota/);
    });
  });
});
