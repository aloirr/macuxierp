/**
 * T-0008 (b) e (c) no banco: a API real com o `montarModulos` de produção e os mesmos adaptadores do main.ts
 * (`tests/apoio/api-pg.ts`: RepositorioCoreSql, repositoriosSql, LeitorPfxTls e o A1 do cadastros pela porta do core),
 * `BancoPg` no papel macuxierp_app — a RLS valendo de verdade.
 * Prova pelo HTTP: o tenant B não lê, não altera e não inativa o cadastro do tenant A (404, como se não existisse);
 * as listas não se misturam; a licença vem de plataforma.tenant_modulo (403 MODULO_INATIVO); o external_id é
 * idempotente no banco (RN-CORE-05); o cadastros vê o A1 da filial pela porta do core no Postgres (RN-CORE-06); a versão
 * do evento é por agregado (D-01 e D-04, #39); o ambiente fiscal só volta para homologação pela API (RN-CORE-08, #45 a #47).
 * Sem Postgres, pula; com MACUXI_PG_EXIGIR=1, falha.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { CNPJ_A, CNPJ_B, clienteValido, filialValida, produtoValido } from '../../../modules/cadastros/api/fixtures-teste';
import { CNPJ_EMPRESA_PG, montarApiPg, type Metodo } from '../../apoio/api-pg';

/** `.pfx` fictício gerado na hora pelo openssl (titular "NOME:CNPJ", como o ICP-Brasil grava); nada fica no disco. */
function gerarPfx(senha: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 't0008-pfx-'));
  try {
    const openssl = (args: string[]) => {
      const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`openssl ${args[0]} falhou: ${r.stderr}`);
    };
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '365', '-subj', `/CN=EMPRESA FICTICIA LTDA:${CNPJ_EMPRESA_PG}`]);
    openssl(['pkcs12', '-export', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'a.pfx', '-passout', `pass:${senha}`]);
    return readFileSync(join(dir, 'a.pfx'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!PG_DISPONIVEL)('API + SQL: isolamento entre tenants pelo HTTP (papel macuxierp_app)', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'A' | 'B' | 'C'>>>;
  const chamar = (quem: 'A' | 'B' | 'C', method: Metodo, url: string, payload?: object) => api.chamar(quem, method, url, payload);

  beforeAll(async () => {
    api = await montarApiPg({ A: ['cadastros'], B: ['cadastros'], C: [] }); // C sem a licença do cadastros
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('RN-CORE-02 e RLS: o cliente do tenant A some para o tenant B (GET, PATCH e DELETE = 404) e as listas não se misturam', async () => {
    const fA = await chamar('A', 'POST', '/v1/cadastros/filiais', filialValida());
    expect(fA.statusCode).toBe(201);
    const fB = await chamar('B', 'POST', '/v1/cadastros/filiais', filialValida()); // mesmo CNPJ: a unicidade é por tenant
    expect(fB.statusCode).toBe(201);
    const cA = await chamar('A', 'POST', '/v1/cadastros/clientes', clienteValido(fA.json().id));
    expect(cA.statusCode).toBe(201);
    const id = cA.json().id as string;

    expect((await chamar('B', 'GET', `/v1/cadastros/clientes/${id}`)).statusCode).toBe(404);
    expect((await chamar('B', 'PATCH', `/v1/cadastros/clientes/${id}`, { razao_social: 'Invadido Ltda' })).statusCode).toBe(404);
    expect((await chamar('B', 'DELETE', `/v1/cadastros/clientes/${id}`)).statusCode).toBe(404);
    expect((await chamar('B', 'GET', '/v1/cadastros/clientes')).json()).toEqual({ itens: [], proximo_cursor: null });

    const deA = await chamar('A', 'GET', `/v1/cadastros/clientes/${id}`);
    expect(deA.json()).toMatchObject({ razao_social: 'Cliente Exemplo Ltda', inativo: false });
    const linhas = await api.b.admin.query('SELECT tenant_id, razao_social, deleted_at FROM cadastros.cliente WHERE id = $1', [id]);
    expect(linhas.rows).toEqual([{ tenant_id: api.t.A, razao_social: 'Cliente Exemplo Ltda', deleted_at: null }]);
  });

  it('RLS: o tenant B não usa a filial do tenant A como referência (o cadastro aponta só para o próprio tenant)', async () => {
    const filialA = (await chamar('A', 'GET', '/v1/cadastros/filiais')).json().itens[0].id as string;
    const r = await chamar('B', 'POST', '/v1/cadastros/clientes', clienteValido(filialA, { documento: CNPJ_A }));
    expect(r.statusCode).toBe(400); // referência inexistente (para B, a filial de A não existe) = VALIDACAO, D*
    expect(r.json()).toMatchObject({ codigo: 'VALIDACAO', campos: { filial_id: expect.any(String) } });
  });

  it('RN-CORE-02: a licença vem de plataforma.tenant_modulo: tenant sem cadastros = 403 MODULO_INATIVO; o core segue liberado', async () => {
    const r = await chamar('C', 'GET', '/v1/cadastros/clientes');
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    const e = await chamar('C', 'GET', '/v1/core/empresa');
    expect(e.statusCode).toBe(200);
    expect(e.json().razao_social).toBe('Empresa C');
  });

  it('RLS no core: cada tenant lê só a própria empresa e os próprios usuários', async () => {
    expect((await chamar('A', 'GET', '/v1/core/empresa')).json().razao_social).toBe('Empresa A');
    expect((await chamar('B', 'GET', '/v1/core/empresa')).json().razao_social).toBe('Empresa B');
    const us = (await chamar('B', 'GET', '/v1/core/usuarios')).json().itens.map((u: { id: string }) => u.id);
    expect(us).toEqual([api.adm.B]);
    expect((await chamar('B', 'GET', `/v1/core/usuarios/${api.adm.A}`)).statusCode).toBe(404);
  });

  it('RN-CORE-05: o reenvio do produto com o mesmo external_id não duplica no banco', async () => {
    const corpo = produtoValido({ codigo: 'EXT-1', cest: '0300700', external_id: 'fdv-prod-1' }) // 2202.10.00 tem ST na tabela oficial: CEST obrigatório (RN-CAD-04);
    const r1 = await chamar('A', 'POST', '/v1/cadastros/produtos', corpo);
    const r2 = await chamar('A', 'POST', '/v1/cadastros/produtos', corpo);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(200);
    expect(r2.json().id).toBe(r1.json().id);
    const n = await api.b.admin.query("SELECT count(*)::int AS n FROM cadastros.produto WHERE external_id = 'fdv-prod-1'");
    expect(n.rows[0].n).toBe(1);
    // O mesmo external_id em outro tenant é outro cadastro (a unicidade é por tenant).
    expect((await chamar('B', 'POST', '/v1/cadastros/produtos', corpo)).statusCode).toBe(201);
  });

  /*
   * D-01 (corrigido no #39, 02d8311): o cadastros publicava todo evento com `versao: 1` e a UNIQUE
   * (tenant_id, nome, agregado_id, versao) de plataforma.evento dava 23505 → 500 na 2ª alteração. Desde o #39 a outbox
   * (`OutboxPg.gravar`) dá a versão por (tenant_id, agregado_id): max + 1 na transação, ignorando a `versao` recebida.
   */
  it('RN-CAD-08 [D-01, corrigido no #39]: PATCH e DELETE do próprio cadastro = 200, com deleted_at gravado e um evento por alteração, versões 1, 2 e 3', async () => {
    const f = (await chamar('A', 'GET', '/v1/cadastros/filiais')).json().itens[0].id as string;
    const c = await chamar('A', 'POST', '/v1/cadastros/clientes', clienteValido(f, { documento: '12ABC34501DE35', razao_social: 'Para Inativar Ltda' }));
    expect(c.statusCode).toBe(201);
    const id = c.json().id as string;
    expect((await chamar('A', 'PATCH', `/v1/cadastros/clientes/${id}`, { nome_fantasia: 'Nova Fantasia' })).statusCode).toBe(200);
    expect((await chamar('A', 'DELETE', `/v1/cadastros/clientes/${id}`)).statusCode).toBe(200);
    const l = await api.b.admin.query('SELECT deleted_at IS NOT NULL AS inativo FROM cadastros.cliente WHERE id = $1', [id]);
    expect(l.rows).toEqual([{ inativo: true }]);
    const ev = await api.b.admin.query("SELECT versao::int AS versao, payload->'payload'->>'inativo' AS inativo FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'cadastros.cliente.alterado@1' ORDER BY versao", [id]);
    expect(ev.rows.map((x) => [x.versao, x.inativo])).toEqual([[1, 'false'], [2, 'false'], [3, 'true']]);
  });

  /*
   * D-04 (corrigido no #39): o core publica com `versao: c.agora.getTime()` (modules/core/api/rotas.ts), e duas
   * alterações no mesmo milissegundo colidiam na mesma UNIQUE. A outbox ignora a versão recebida (`@deprecated`) e grava
   * 1, 2, ... por agregado: o ms do relógio não chega ao banco.
   */
  it('[D-04, corrigido no #39] core: duas alterações da empresa gravam as versões 1 e 2 do agregado, não o instante em ms', async () => {
    const corpo = { razao_social: 'Empresa B', nome_fantasia: null, ie: null, fuso: 'America/Manaus' };
    const antes = await api.b.admin.query("SELECT coalesce(max(versao), 0)::int AS v FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'core.empresa.alterada@1'", [api.t.B]);
    expect((await chamar('B', 'PATCH', '/v1/core/empresa', { ...corpo, nome_fantasia: 'Um' })).statusCode).toBe(200);
    expect((await chamar('B', 'PATCH', '/v1/core/empresa', { ...corpo, nome_fantasia: 'Dois' })).statusCode).toBe(200);
    const ev = await api.b.admin.query("SELECT versao::int AS v FROM plataforma.evento WHERE tenant_id = $1 AND nome = 'core.empresa.alterada@1' ORDER BY versao", [api.t.B]);
    const v0 = antes.rows[0].v as number;
    expect(ev.rows.map((x) => x.v).slice(-2)).toEqual([v0 + 1, v0 + 2]);
  });

  /*
   * O caminho novo do #19 no main.ts: o cadastros pergunta ao core (criarPortaA1, na transação da rota) se a filial tem
   * A1 válido, com o LeitorPfxTls e o RepositorioCoreSql de produção. Os testes do dono usam dublês dos dois lados.
   */
  it('RN-CORE-06 (main.ts): A1 enviado pelo core libera a consulta de IE do cadastros (202); sem A1 ou com A1 vencido, 422 RN-CORE-06', async () => {
    const ie = (quem: 'A' | 'B', filial_id: string) => chamar(quem, 'POST', '/v1/cadastros/consultas/ie', { filial_id, uf: 'AM', documento: CNPJ_B });
    const filialA = (await chamar('A', 'GET', '/v1/cadastros/filiais')).json().itens[0].id as string;
    const filialB = (await chamar('B', 'GET', '/v1/cadastros/filiais')).json().itens[0].id as string;
    const antes = await ie('A', filialA);
    expect([antes.statusCode, antes.json().codigo]).toEqual([422, 'RN-CORE-06']);

    const senha = `t0008-${Date.now()}`;
    const envio = await chamar('A', 'POST', '/v1/core/certificados', { filial_id: filialA, senha, arquivo_base64: gerarPfx(senha).toString('base64') });
    expect(envio.statusCode).toBe(201);
    expect(envio.json()).toMatchObject({ filial_id: filialA, cnpj: CNPJ_EMPRESA_PG });
    expect(JSON.stringify(envio.json())).not.toContain(senha);
    const ok = await ie('A', filialA);
    expect([ok.statusCode, ok.json().estado]).toEqual([202, 'pendente']);
    const trabalho = await api.b.admin.query('SELECT tenant_id, tipo FROM plataforma.trabalho WHERE id = $1', [ok.json().id]);
    expect(trabalho.rows).toEqual([{ tenant_id: api.t.A, tipo: 'cadastros.consultar_ie' }]);

    // O A1 de A não vale para a filial de B (RLS na tabela core.certificado).
    expect((await ie('B', filialB)).statusCode).toBe(422);

    await api.b.admin.query("UPDATE core.certificado SET valido_de = now() - interval '2 years', valido_ate = now() - interval '1 day' WHERE filial_id = $1", [filialA]);
    const vencido = await ie('A', filialA);
    expect([vencido.statusCode, vencido.json().codigo]).toEqual([422, 'RN-CORE-06']);
  });

  /*
   * #45 a #47 (T-0030, ADR 0006): a API só volta para homologação; produção só pelo operador (dono da tabela, com o
   * recado de aprovação). Nenhuma rota nova (o `autorizacao-rotas.test.ts` já cobre o PUT); aqui, a rota contra a
   * política 0008 no Postgres, no papel macuxierp_app. A política em si é testada pelo banco-dados.
   */
  const RECADO_APROVACAO = 'R-20261121-120000-alexandre'; // formato exigido pelo CHECK ambiente_producao_aprovada (0003)

  it('RN-CORE-08 (#45/#46): PUT produção pela API = 422 RN-CORE-08, sem linha e sem evento; o GET segue em homologação', async () => {
    const filial = '0f000000-0000-4000-8000-0000000000a1';
    const r = await chamar('A', 'PUT', `/v1/core/ambientes-fiscais/${filial}`, { ambiente: 'producao' });
    expect([r.statusCode, r.json().codigo]).toEqual([422, 'RN-CORE-08']);
    const conta = async (sql: string) => (await api.b.admin.query(sql, [filial])).rows[0].n as number;
    expect(await conta('SELECT count(*)::int AS n FROM core.ambiente_fiscal WHERE filial_id = $1')).toBe(0);
    expect(await conta('SELECT count(*)::int AS n FROM plataforma.evento WHERE agregado_id = $1')).toBe(0);
    const g = await chamar('A', 'GET', `/v1/core/ambientes-fiscais?filial_id=${filial}`);
    expect(g.json().itens).toEqual([{ filial_id: filial, ambiente: 'homologacao', recado_aprovacao: null }]);
  });

  it('RN-CORE-08 (#45/#46/#47): produção gravada pelo operador; o tenant só volta para homologação pela API (200, recado limpo, evento)', async () => {
    const filial = '0f000000-0000-4000-8000-0000000000a2';
    // O operador (scripts/plataforma/ambiente-fiscal.mjs) grava como dono da tabela; aqui, a conexão admin do banco efêmero.
    await api.b.admin.query(
      "INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao) VALUES ($1, $2, 'producao', $3)",
      [api.t.A, filial, RECADO_APROVACAO],
    );
    const g = await chamar('A', 'GET', `/v1/core/ambientes-fiscais?filial_id=${filial}`);
    expect(g.json().itens).toEqual([{ filial_id: filial, ambiente: 'producao', recado_aprovacao: RECADO_APROVACAO }]);
    const r = await chamar('A', 'PUT', `/v1/core/ambientes-fiscais/${filial}`, { ambiente: 'homologacao' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ filial_id: filial, ambiente: 'homologacao', recado_aprovacao: null });
    const l = await api.b.admin.query('SELECT ambiente, recado_aprovacao FROM core.ambiente_fiscal WHERE filial_id = $1', [filial]);
    expect(l.rows).toEqual([{ ambiente: 'homologacao', recado_aprovacao: null }]);
    const ev = await api.b.admin.query("SELECT versao::int AS v FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'core.ambiente_fiscal.alterado@1'", [filial]);
    expect(ev.rows).toEqual([{ v: 1 }]);
    // De volta a produção, só o operador: a API recusa de novo.
    expect((await chamar('A', 'PUT', `/v1/core/ambientes-fiscais/${filial}`, { ambiente: 'producao' })).statusCode).toBe(422);
  });
});
