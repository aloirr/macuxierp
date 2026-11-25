/**
 * T-0060 (testes, v0.3.5): carga de cadastros pelo portal `/config`, sobre o contrato
 * `packages/platform-sdk/src/portal-cargas.ts`, a migração 0040 e as rotas de produção (#412, #415). Dados fictícios.
 *
 * O 1º describe fica no NÍVEL DO BANCO só no que a rota não mostra: o Adicionar (tx1 `portal_carga_iniciar` como
 * `macuxierp_config`, tx2 pelo `POST /cargas` do BKO como `macuxierp_app`, tx3 `portal_carga_concluir`) reativa pelo
 * `external_id` sem duplicar; nenhum dos três papéis tem DELETE nas tabelas da carga; o `iniciar` não recebe a frase
 * (4 argumentos). MXS01, MXC01, MXC04, privilégios, situação e auditoria da função ficam no
 * db/testes/carga-portal-0040.db.test.ts (banco-dados); o `macuxierp_config` sem sessão no rls-superadmin.db.test.ts.
 *
 * O 2º describe sobe a API REAL (`criarApp` + `montarDependenciasProducao`) com as ROTAS DE PRODUÇÃO do `pluginsPlataforma`
 * (`criarPluginPlataformaCadastros`, #415), sem plugin de teste: 400 VALIDACAO e 422 RN-CAD-10 com o campo, tradução
 * MXS01/MXC01/MXC04 em HTTP (erros.ts do #408), nenhuma carga depende de outra (0044: sem o MXC03, a referência ausente
 * é erro de linha e a carga fica 'falhou' com 2 auditorias), Substituir tudo (`inativarEmLote`, estoque intacto), reenvio sem
 * Idempotency-Key guardada e isolamento pela rota. 401 sem sessão e com o JWT do tenant, 403 ORIGEM_RECUSADA, 403
 * TROCAR_SENHA e os nomes das rotas de carga ficam na matriz do isolamento.db.test.ts. O único gancho de teste é o do
 * MXS01: o banco de plataforma revoga a sessão logo antes da transação do `portal_carga_iniciar`.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CABECALHO_CSRF_CONFIG,
  CABECALHO_REPETIDA,
  CAMINHOS_CARGAS_PLATAFORMA,
  CAMPO_ARQUIVO_CARGA_PORTAL,
  COOKIE_CONFIG,
  FRASE_SUBSTITUIR_TUDO,
  MENSAGENS_CARGA_PORTAL,
} from '../../../packages/platform-sdk/src/index';
import type { BancoPg } from '../../../packages/platform-sdk/src/pg';
import {
  criarBancoEfemero,
  criarTenant,
  PG_DISPONIVEL,
  type BancoEfemero,
} from '../../../packages/platform-sdk/src/pg-testes';
import { criarAmbiente, sessaoDe } from '../../../modules/cadastros/api/apoio-teste';
import { criarPluginCadastros, fontesHttp, repositoriosSql } from '../../../modules/cadastros/api/index';
import type { RelatorioCarga } from '../../../modules/cadastros/contracts';
import { formulario } from '../../../apps/api/src/apoio-multipart';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { criarApp } from '../../../apps/api/src/app';
import { montarDependenciasProducao } from '../../../apps/api/src/modulos';
import {
  atalhosPortal,
  comoPapel,
  inserirSuperadmin,
  PAPEL_CONFIG as CONFIG,
  sha256 as sha,
  type AppPortal,
  type ClientePg,
  type RespostaPortal,
} from '../../apoio/portal-pg';
import { comNcmOficial } from '../../apoio/fixture-carga';

const PASTA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'modules',
  'cadastros',
  'domain',
  'carga',
  '__fixtures__',
);
/** Os 8 arquivos da carga (T-0058): a forma vem no condicoes_pagamento.csv e o endereço no cliente.csv. */
const ARQUIVOS = [
  'filial',
  'vendedor',
  'condicoes_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
];
const csv = (nome: string): string => comNcmOficial(`${nome}.csv`, readFileSync(join(PASTA, `${nome}.csv`), 'utf8'));
/** Tabelas que a carga toca (por tenant), mais a execução do portal e a auditoria. */
const TABELAS = [
  'filial',
  'vendedor',
  'condicao_pagamento',
  'produto',
  'produto_unidade',
  'tabela_preco',
  'tabela_preco_item',
  'estoque_saldo',
  'estoque_movimento',
  'cliente',
  'cliente_endereco',
  'carga_portal',
];

const SQL_INICIAR = 'SELECT cadastros.portal_carga_iniciar($1::uuid, $2, $3, $4) AS id';
const SQL_CONCLUIR = 'SELECT cadastros.portal_carga_concluir($1::uuid, $2::uuid, $3, $4, $5, $6, $7)';

/** Linhas por tabela do tenant (com as excluídas) e o conteúdo de cada uma (to_jsonb), mais a auditoria: o antes/depois. */
const retrato = async (b: BancoEfemero, t: string) => {
  const linhas = async (sql: string) => (await b.admin.query<{ l: string }>(sql, [t])).rows.map((l) => l.l);
  const r: Record<string, string[]> = {};
  for (const tab of TABELAS)
    r[tab] = await linhas(
      `SELECT to_jsonb(x)::text AS l FROM cadastros.${tab} x WHERE tenant_id = $1 ORDER BY 1`,
    );
  const auditoria = await linhas(
    'SELECT to_jsonb(a)::text AS l FROM plataforma.auditoria a WHERE tenant_id = $1 ORDER BY 1',
  );
  return Object.assign(r, { auditoria });
};

/** Abre (e confirma) uma sessão do superadmin `sa` pela função do banco, no papel do portal. Devolve o id da sessão. */
const abrirSessao = (b: BancoEfemero, sa: string): Promise<string> =>
  comoPapel(
    b,
    CONFIG,
    { confirmar: true },
    async (c) =>
      (
        await c.query(
          // hora-fixa-ok: validade da sessão, nunca comparada
          "SELECT plataforma.superadmin_abrir_sessao($1::uuid, $2, now() + interval '1 hour') AS id",
          [sa, sha(randomUUID())],
        )
      ).rows[0].id as string,
  );

describe.skipIf(!PG_DISPONIVEL)(
  'carga de cadastros pelo portal /config no banco: reativação pelo Adicionar, sem DELETE e iniciar sem a frase (T-0060, 0040)',
  () => {
    let b: BancoEfemero;
    let app: BancoPg;
    let sessao = '';
    let A = '';
    let B = '';
    const plugin = criarPluginCadastros({
      repositorios: repositoriosSql,
      fontes: fontesHttp(),
      certificados: { filialTemA1Valido: async () => true },
    });

    const config = <T>(fn: (c: ClientePg) => Promise<T>): Promise<T> =>
      comoPapel(b, CONFIG, { sessao, confirmar: true }, fn);
    const concluir = (t: string, id: string, gravadas: number, comErro: number, resultado = 'concluida') =>
      config((c) =>
        c.query(SQL_CONCLUIR, [t, id, resultado, gravadas, comErro, null, `req-${randomUUID()}`]),
      );
    /** tx2: o POST /cargas do BKO (o mesmo executarCarga), no papel app e na RLS do tenant. */
    const bko = (t: string, nomes: readonly string[]) =>
      app.comTenant(t, async (tx) => {
        const r = await criarAmbiente(plugin, new Date('2026-11-23T15:00:00Z'), tx).chamar(
          'POST',
          '/cargas',
          {
            sessao: sessaoDe('administrador'),
            corpo: { modo: 'gravar' },
            arquivos: nomes.map((n) => ({ nome: `${n}.csv`, conteudo: csv(n) })),
          },
        );
        expect(r.status).toBe(200);
        return r.corpo as RelatorioCarga;
      });
    /** As três transações do Gravar (Adicionar), como o contrato descreve. */
    const gravar = async (t: string, cadastro: string) => {
      const id = await config(
        async (c) =>
          (await c.query(SQL_INICIAR, [t, cadastro, 'adicionar', `req-${randomUUID()}`])).rows[0]
            .id as string,
      );
      const rel = await bko(t, [cadastro]).catch(async (e: unknown) => {
        await concluir(t, id, 0, 0, 'falhou');
        throw e;
      });
      const e = rel.entidades.find((x) => x.entidade === cadastro)!;
      await concluir(t, id, e.inseridas + e.atualizadas + e.sem_mudanca, e.recusadas);
      return e;
    };
    const admin = async (sql: string, p: unknown[] = []) =>
      (await b.admin.query(sql, p)).rows as Record<string, unknown>[];

    beforeAll(async () => {
      b = await criarBancoEfemero();
      app = b.banco('macuxierp_app');
      A = await criarTenant(b.admin, 't0060-carga-a', ['cadastros']);
      B = await criarTenant(b.admin, 't0060-carga-b', ['cadastros']);
      sessao = await abrirSessao(b, await inserirSuperadmin(b, 'sa-t0060-carga@exemplo.invalid'));
      // A e B com a mesma massa (os MESMOS external_id), carregada pelo BKO: o isolamento vale com chaves iguais.
      for (const t of [A, B]) {
        const rel = await bko(t, ARQUIVOS);
        expect(rel.erros).toEqual([]);
      }
    }, 180_000);
    afterAll(async () => {
      await b?.remover();
    });

    it('frase do Substituir tudo: o banco não a recebe (iniciar tem 4 argumentos)', async () => {
      const args = (
        await admin(
          "SELECT pronargs FROM pg_proc WHERE oid = 'cadastros.portal_carga_iniciar(uuid, text, text, text)'::regprocedure",
        )
      )[0]!.pronargs;
      expect(args).toBe(4);
    });

    it('nenhum dos três papéis (app, worker, config) tem DELETE nas tabelas da carga', async () => {
      const comDelete = await admin(
        `SELECT p.papel || ' ' || t.tab AS x FROM unnest(ARRAY['macuxierp_app', 'macuxierp_worker', 'macuxierp_config']) p(papel),
              unnest($1::text[]) t(tab) WHERE has_table_privilege(p.papel, 'cadastros.' || t.tab, 'DELETE')`,
        [TABELAS],
      );
      expect(comDelete.map((l) => l.x)).toEqual([]);
    });

    it('Adicionar reativa o registro excluído pelo external_id (deleted_at volta a nulo) em vez de duplicar', async () => {
      await admin(
        // hora-fixa-ok: só marca excluído, o teste confere deleted_at nulo
        "UPDATE cadastros.vendedor SET deleted_at = now() WHERE tenant_id = $1 AND external_id = 'V-EX-01'",
        [A],
      );
      const e = await gravar(A, 'vendedor');
      expect(e.recusadas).toBe(0);
      const l = await admin(
        "SELECT deleted_at FROM cadastros.vendedor WHERE tenant_id = $1 AND external_id = 'V-EX-01'",
        [A],
      );
      expect(l).toHaveLength(1);
      expect(l[0]!.deleted_at).toBeNull();
      // B, com o mesmo external_id, segue intacto
      expect(
        (
          await admin(
            "SELECT count(*)::int AS n FROM cadastros.vendedor WHERE tenant_id = $1 AND external_id = 'V-EX-01' AND deleted_at IS NULL",
            [B],
          )
        )[0]!.n,
      ).toBe(1);
    });
  },
);

describe.skipIf(!PG_DISPONIVEL)(
  'carga pelo portal /config na API real (rotas do pluginsPlataforma): Zod, SQLSTATE → HTTP, substituir, reenvio e isolamento pela rota (T-0060)',
  () => {
    const EMAIL_OK = 'sa-t0060-api@exemplo.invalid';
    const EMAIL_REVOGA = 'sa-t0060-revoga@exemplo.invalid';
    let b: BancoEfemero;
    let app: AppPortal;
    let p: ReturnType<typeof atalhosPortal>;
    let token = '';
    let saRevoga = '';
    /** Liga a revogação da sessão do EMAIL_REVOGA na próxima transação de plataforma que chamar o `portal_carga_iniciar`. */
    let revogarNoIniciar = false;
    let A = '';
    let B = '';
    let V = '';
    let SUSP = '';
    let SEMLIC = '';

    const admin = async (sql: string, prm: unknown[] = []) =>
      (await b.admin.query(sql, prm)).rows as Record<string, unknown>[];
    const url = (t: string, cadastro: string, modo?: string, rota: 'gravar' | 'validar' = 'gravar') =>
      `/v1/plataforma${CAMINHOS_CARGAS_PLATAFORMA[rota].replace(':id', t).replace(':cadastro', cadastro)}${modo ? `?modo=${modo}` : ''}`;
    const gravar = (
      t: string,
      cadastro: string,
      o: {
        modo?: string;
        frase?: string;
        conteudo?: string;
        token?: string;
        chave?: string;
        rota?: 'gravar' | 'validar';
      } = {},
    ): Promise<RespostaPortal> => {
      const f = formulario(o.frase === undefined ? {} : { frase: o.frase }, [
        {
          campo: CAMPO_ARQUIVO_CARGA_PORTAL,
          conteudo: o.conteudo ?? csv(cadastro),
          nome: `${cadastro}.csv`,
          tipo: 'text/csv',
        },
      ]);
      return app.inject({
        method: 'POST',
        url: url(t, cadastro, o.modo, o.rota),
        payload: f.payload,
        headers: {
          ...f.headers,
          [CABECALHO_CSRF_CONFIG]: '1',
          ...(o.chave ? { 'idempotency-key': o.chave } : {}),
        },
        cookies: { [COOKIE_CONFIG]: o.token ?? token },
      });
    };
    const todos = () => Promise.all([A, B, V, SUSP, SEMLIC].map((t) => retrato(b, t)));
    const erro = (r: RespostaPortal) =>
      r.json<{
        codigo: string;
        mensagem: string;
        campos?: Record<string, string>;
        detalhes?: Record<string, unknown>;
      }>();

    beforeAll(async () => {
      b = await criarBancoEfemero();
      A = await criarTenant(b.admin, 't0060-api-a', ['core', 'cadastros']);
      B = await criarTenant(b.admin, 't0060-api-b', ['core', 'cadastros']);
      V = await criarTenant(b.admin, 't0060-api-v', ['core', 'cadastros']);
      SUSP = await criarTenant(b.admin, 't0060-api-s', ['core', 'cadastros']);
      SEMLIC = await criarTenant(b.admin, 't0060-api-l', ['core', 'pedido']);
      await admin("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [SUSP]);
      await inserirSuperadmin(b, EMAIL_OK);
      saRevoga = await inserirSuperadmin(b, EMAIL_REVOGA);
      const producao = montarDependenciasProducao({
        banco: b.banco('macuxierp_app'),
        chaveA1: Buffer.alloc(32, 1),
        config: { versao: 'teste', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
      });
      // As rotas são as de produção (`pluginsPlataforma` → `criarPluginPlataformaCadastros`, #415). Só o banco de plataforma
      // ganha um gancho de teste: com `revogarNoIniciar`, revoga a sessão do EMAIL_REVOGA logo antes da 1ª transação da
      // rota (a do `portal_carga_iniciar`), depois da leitura da sessão pela API (`antesDaSessao`): o MXS01 sai da função.
      const plataforma = producao.plataforma!;
      const real = plataforma.banco;
      const banco: typeof real = {
        antesDaSessao: (fn) => real.antesDaSessao(fn),
        comPlataforma: async (s, fn) => {
          if (revogarNoIniciar) {
            revogarNoIniciar = false;
            await admin(
              // hora-fixa-ok: revogação da sessão de teste, só o banco compara
              'UPDATE plataforma.sessao_superadmin SET revogada_em = now() WHERE superadmin_id = $1',
              [saRevoga],
            );
          }
          return real.comPlataforma(s, fn);
        },
      };
      app = await criarApp({
        ...producao,
        auth: { ...producao.auth, argon2: ARGON2_RAPIDO },
        plataforma: { ...plataforma, banco },
        logger: false,
      });
      p = atalhosPortal(app);
      token = await p.sessao(EMAIL_OK);
      // B com a filial da fixture (os MESMOS external_id que A vai receber), gravada pela própria rota.
      const r = await gravar(B, 'filial');
      expect(r.statusCode, r.body).toBe(200);
    }, 180_000);
    afterAll(async () => {
      await app?.close();
      await b?.remover();
    });

    it('400 VALIDACAO (cadastro fora, modo fora, frase no Adicionar, Substituir no estoque) e 422 RN-CAD-10 (frase errada ou ausente); nada muda', async () => {
      const antes = await todos();
      const casos: [string, Parameters<typeof gravar>[2], number, string, string][] = [
        ['nao_existe', { conteudo: 'a;b\n' }, 400, 'VALIDACAO', 'cadastro'],
        ['filial', { modo: 'apagar' }, 400, 'VALIDACAO', 'modo'],
        ['filial', { modo: 'substituir_tudo' }, 422, 'RN-CAD-10', 'frase'],
        [
          'filial',
          { modo: 'substituir_tudo', frase: 'autorizo substituir tudo!' },
          422,
          'RN-CAD-10',
          'frase',
        ],
        ['filial', { modo: 'substituir_tudo', frase: 'autorizo zerar os dados' }, 422, 'RN-CAD-10', 'frase'],
        ['filial', { modo: 'adicionar', frase: FRASE_SUBSTITUIR_TUDO }, 400, 'VALIDACAO', 'frase'],
        ['estoque', { modo: 'substituir_tudo', frase: FRASE_SUBSTITUIR_TUDO }, 400, 'VALIDACAO', 'modo'],
      ];
      for (const [cadastro, o, status, codigo, campo] of casos) {
        const r = await gravar(A, cadastro, o);
        const nome = `${cadastro} ${JSON.stringify(o)}`;
        expect([r.statusCode, erro(r).codigo], nome).toEqual([status, codigo]);
        expect(Object.keys(erro(r).campos ?? {}), nome).toContain(campo);
      }
      expect(await todos()).toEqual(antes);
    });

    it('SQLSTATE → HTTP (erros.ts do #408): MXC04 = 422 RN-CORE-02 com detalhes.codigo; MXC01 = 409 CONFLITO com o código do contrato; MXS01 = 401', async () => {
      const antes = await todos();
      const susp = await gravar(SUSP, 'filial');
      expect([susp.statusCode, erro(susp)]).toEqual([
        422,
        {
          codigo: 'RN-CORE-02',
          mensagem: MENSAGENS_CARGA_PORTAL.semLicenca,
          detalhes: { codigo: 'empresa_inativa' },
        },
      ]);
      const semLic = await gravar(SEMLIC, 'filial');
      expect([semLic.statusCode, erro(semLic)]).toEqual([
        422,
        {
          codigo: 'RN-CORE-02',
          mensagem: MENSAGENS_CARGA_PORTAL.semLicenca,
          detalhes: { codigo: 'modulo_desligado' },
        },
      ]);
      const tokenRevoga = await p.sessao(EMAIL_REVOGA);
      revogarNoIniciar = true;
      const revoga = await gravar(A, 'filial', { token: tokenRevoga });
      expect(revogarNoIniciar).toBe(false);
      expect(revoga.statusCode).toBe(401);
      expect(revoga.body).not.toMatch(/MXS01|exigir_superadmin/);
      expect(await todos()).toEqual(antes);
      // MXC01: execução aberta em A (tx1 sem tx3) barra o gravar pela rota; B segue livre.
      const saOk = (await admin('SELECT id FROM plataforma.superadmin WHERE email = $1', [EMAIL_OK]))[0]!
        .id as string;
      const sessaoSql = await abrirSessao(b, saOk);
      const aberta = await comoPapel(
        b,
        CONFIG,
        { sessao: sessaoSql, confirmar: true },
        async (c) =>
          (await c.query(SQL_INICIAR, [A, 'produto', 'adicionar', 'req-t0060-aberta'])).rows[0].id as string,
      );
      const antesA = await retrato(b, A);
      const andamento = await gravar(A, 'filial');
      expect([andamento.statusCode, erro(andamento)]).toEqual([
        409,
        {
          codigo: 'CONFLITO',
          mensagem: MENSAGENS_CARGA_PORTAL.cargaEmAndamento,
          detalhes: { codigo: 'carga_em_andamento' },
        },
      ]);
      expect(await retrato(b, A)).toEqual(antesA);
      await comoPapel(b, CONFIG, { sessao: sessaoSql, confirmar: true }, (c) =>
        c.query(SQL_CONCLUIR, [A, aberta, 'falhou', 0, 0, null, 'req-t0060-aberta']),
      );
    });

    it('nenhuma carga depende de outra (0044, sem MXC03): vendedor sem filial em V = referência ausente como erro de linha; o gravar dá 409 nada_a_gravar, a carga fica falhou com 2 auditorias e nenhum cadastro muda', async () => {
      const antes = await retrato(b, V);
      const outras = await Promise.all([A, B, SUSP, SEMLIC].map((t) => retrato(b, t)));
      // validar: a referência ausente sai como erro da linha (motivo e ação, sem o valor da célula), nunca como 409
      const val = await gravar(V, 'vendedor', { rota: 'validar' });
      expect(val.statusCode, val.body).toBe(200);
      const v = val.json<{
        prontas: number;
        com_erro: number;
        linhas: { linha: number | null; motivo: string; acao: string }[];
        linhas_omitidas: number;
      }>();
      expect(v).toMatchObject({ prontas: 0, com_erro: 1, linhas_omitidas: 0 });
      expect(v.linhas).toHaveLength(1);
      expect(v.linhas[0]!.linha).toEqual(expect.any(Number));
      expect(v.linhas[0]!.motivo).toMatch(
        /filial_external_id não encontrado: carregue o cadastro de filiais/,
      );
      expect(val.body).not.toMatch(/F-EX-01|MXC03|dependencia_pendente/);
      // gravar: o banco abre a execução (sem MXC03); nenhuma linha pronta = 409 nada_a_gravar e a execução fecha como falhou
      const g = await gravar(V, 'vendedor');
      expect([g.statusCode, erro(g)]).toEqual([
        409,
        {
          codigo: 'CONFLITO',
          mensagem: MENSAGENS_CARGA_PORTAL.nadaAGravar,
          detalhes: { codigo: 'nada_a_gravar' },
        },
      ]);
      expect(g.body).not.toMatch(/MXC03|dependencia_pendente/);
      const execucoes = await admin(
        'SELECT cadastro, modo, resultado, gravadas, com_erro, inativadas, concluida_em IS NOT NULL AS fechada FROM cadastros.carga_portal WHERE tenant_id = $1',
        [V],
      );
      expect(execucoes).toEqual([
        {
          cadastro: 'vendedor',
          modo: 'adicionar',
          resultado: 'falhou',
          gravadas: 0,
          com_erro: 0,
          inativadas: null,
          fechada: true,
        },
      ]);
      const depois = await retrato(b, V);
      const acoes = (
        await admin('SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 ORDER BY created_at, acao', [
          V,
        ])
      ).map((x) => x.acao);
      expect(depois.auditoria.length - antes.auditoria.length).toBe(2);
      expect(acoes.slice(-2).sort()).toEqual(['cadastros.carga.concluir', 'cadastros.carga.iniciar']);
      for (const tab of TABELAS.filter((x) => x !== 'carga_portal'))
        expect(depois[tab], tab).toEqual(antes[tab]);
      expect(await Promise.all([A, B, SUSP, SEMLIC].map((t) => retrato(b, t)))).toEqual(outras);
    });

    it('P-16 (#582, RN-CAD-09): condição com 366 dias e com 25 parcelas recusadas com a linha e o motivo; a linha válida é gravada', async () => {
      const P = await criarTenant(b.admin, 't0060-api-p16', ['core', 'cadastros']);
      const [cab, valida] = csv('condicoes_pagamento').split('\n');
      const parcelas = (n: number, dias: number) => Array.from({ length: n }, () => dias).join('/');
      const conteudo = [
        cab,
        valida, // linha 2: PZ-EX-01, 30 dias
        `PZ-P16-366;D366;${parcelas(1, 366)};BOLETO;Boleto Exemplo;;sim;Boleto 366 dias;FP-EX-01;;30;0;2`,
        `PZ-P16-25;P25;${parcelas(25, 30)};BOLETO;Boleto Exemplo;;sim;Boleto 25 parcelas;FP-EX-01;;30;0;3`,
        '',
      ].join('\n');
      const val = await gravar(P, 'condicao_pagamento', { rota: 'validar', conteudo });
      expect(val.statusCode, val.body).toBe(200);
      const v = val.json<{
        prontas: number;
        com_erro: number;
        linhas: { linha: number | null; motivo: string }[];
      }>();
      expect(v).toMatchObject({ prontas: 1, com_erro: 2 });
      // o portal devolve o motivo em texto fixo, sem o valor da célula (hoje não diz qual limite: 365 dias ou 24 parcelas)
      expect(v.linhas).toEqual([
        { linha: 3, motivo: 'Valor fora do formato do contrato', acao: expect.any(String) },
        { linha: 4, motivo: 'Valor fora do formato do contrato', acao: expect.any(String) },
      ]);
      expect(val.body).not.toMatch(/PZ-P16/);
      const g = await gravar(P, 'condicao_pagamento', { conteudo });
      expect(g.statusCode, g.body).toBe(200);
      expect(g.json()).toMatchObject({
        cadastro: 'condicao_pagamento',
        modo: 'adicionar',
        gravadas: 1,
        com_erro: 2,
      });
      expect(
        await admin(
          'SELECT external_id, prazos_dias FROM cadastros.condicao_pagamento WHERE tenant_id = $1',
          [P],
        ),
      ).toEqual([{ external_id: 'PZ-EX-01', prazos_dias: [30] }]);
    });

    it('isolamento pela rota: o gravar em A (mesmos external_id de B) não muda nenhuma linha de B nem das outras empresas', async () => {
      const outras = [B, V, SUSP, SEMLIC];
      const antes = await Promise.all(outras.map((t) => retrato(b, t)));
      const r = await gravar(A, 'filial');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ cadastro: 'filial', modo: 'adicionar', com_erro: 0 });
      expect(r.json<{ gravadas: number }>().gravadas).toBeGreaterThan(0);
      expect(await Promise.all(outras.map((t) => retrato(b, t)))).toEqual(antes);
      const execA = await admin(
        'SELECT tenant_id, resultado FROM cadastros.carga_portal WHERE tenant_id = $1',
        [A],
      );
      expect(execA.filter((l) => l.resultado === 'concluida')).toHaveLength(1);
    });

    it('reenvio com a mesma Idempotency-Key: a rota por etapa não guarda a chave (ADR 0013 A1); os dados não mudam (external_id), mas a execução e a auditoria repetem', async () => {
      const chave = randomUUID();
      const conta = async () => ({
        exec: Number(
          (await admin('SELECT count(*)::int AS n FROM cadastros.carga_portal WHERE tenant_id = $1', [A]))[0]!
            .n,
        ),
        aud: Number(
          (
            await admin(
              "SELECT count(*)::int AS n FROM plataforma.auditoria WHERE tenant_id = $1 AND acao LIKE 'cadastros.carga.%'",
              [A],
            )
          )[0]!.n,
        ),
        filiais: (
          await admin(
            "SELECT to_jsonb(f) - 'updated_at' AS l FROM cadastros.filial f WHERE tenant_id = $1 ORDER BY id",
            [A],
          )
        ).map((l) => JSON.stringify(l.l)),
      });
      const um = await gravar(A, 'filial', { chave });
      expect(um.statusCode, um.body).toBe(200);
      const meio = await conta();
      const dois = await gravar(A, 'filial', { chave });
      expect(dois.statusCode, dois.body).toBe(200);
      expect(dois.headers[CABECALHO_REPETIDA]).toBeUndefined();
      // a resposta do contrato não separa inseridas de sem mudança: é a mesma do 1º envio (a prova são os dados iguais)
      expect(dois.json()).toEqual(um.json());
      expect(dois.json()).toMatchObject({ cadastro: 'filial', modo: 'adicionar', com_erro: 0 });
      const fim = await conta();
      expect(fim.filiais).toEqual(meio.filiais);
      expect(fim.exec).toBe(meio.exec + 1);
      expect(fim.aud).toBe(meio.aud + 2);
      expect(
        Number(
          (
            await admin('SELECT count(*)::int AS n FROM plataforma.idempotencia WHERE chave = $1', [chave])
          )[0]!.n,
        ),
      ).toBe(0);
    });

    it('Substituir tudo pela rota (inativarEmLote): inativa o produto fora do arquivo, sem apagar; o saldo de estoque não muda', async () => {
      for (const cadastro of ['produto', 'estoque']) {
        const r = await gravar(A, cadastro);
        expect(r.statusCode, `${cadastro} ${r.body}`).toBe(200);
      }
      const saldo = () =>
        admin(
          'SELECT id, quantidade, deleted_at, updated_at FROM cadastros.estoque_saldo WHERE tenant_id = $1 ORDER BY id',
          [A],
        );
      const produtos = () =>
        admin(
          'SELECT external_id, deleted_at IS NULL AS ativo FROM cadastros.produto WHERE tenant_id = $1 ORDER BY 1',
          [A],
        );
      const saldoAntes = await saldo();
      expect(saldoAntes.length).toBeGreaterThan(0);
      const nProdutos = (await produtos()).length;
      const outras = await Promise.all([B, V, SUSP, SEMLIC].map((t) => retrato(b, t)));
      // só a 1ª linha de dados: o P-EX-02 sai do arquivo
      const [cab, primeira] = csv('produto').split('\n');
      const r = await gravar(A, 'produto', {
        modo: 'substituir_tudo',
        frase: FRASE_SUBSTITUIR_TUDO,
        conteudo: `${cab}\n${primeira}\n`,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({
        cadastro: 'produto',
        modo: 'substituir_tudo',
        com_erro: 0,
        inativadas: 1,
      });
      const depois = await produtos();
      expect(depois).toHaveLength(nProdutos);
      expect(depois.filter((l) => !l.ativo).map((l) => l.external_id)).toEqual(['P-EX-02']);
      expect(await saldo()).toEqual(saldoAntes);
      expect(await Promise.all([B, V, SUSP, SEMLIC].map((t) => retrato(b, t)))).toEqual(outras);
    });
  },
);
