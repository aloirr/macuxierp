/**
 * T-0093 (v0.3.14), RN-CAD-10: "Zerar pedidos não faturados" do portal /config pela API de produção (`appPgDeTeste` com
 * `modulos: 'producao'`, o plugin religado na apps/api com a porta `aposZerarPedidos` da 0065), sobre o PostgreSQL migrado.
 * Casos: 1) apaga os pedidos sem nota e sem título e cancela o a faturar; 2) o pedido com nota, título ou faturado fica
 * intacto, com a nota e o XML iguais; 4) a porta falha (a faturar já faturado, MXC03) e o zerar inteiro é desfeito (409);
 * 5) auditoria só com contagens; 6) só o superadmin do /config, com CSRF, frase e licença do módulo, e o outro tenant não
 * muda. Caso 3 (reenvio do mesmo pedido_uuid): modules/pedido/api/zeragem-apos.db.test.ts.
 * Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FRASE_ZERAR_DADOS, PREFIXO_PLATAFORMA } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { CAMINHOS_ZERAR_PEDIDOS, type ZeragemPedidosResposta as Resposta } from '../../../modules/pedido/contracts/index';
import { appPgDeTeste, inserirAdministradorDeTeste, SENHA_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { chaveAcesso, cnfDe, hashSql, sqlDePedido } from '../../../db/testes/fixture';
import { atalhosPortal, inserirSuperadmin, type AppPortal } from '../../apoio/portal-pg';

const EMAIL_SA = 'sa-zerar-pedidos@exemplo.invalid';
const url = (chave: keyof typeof CAMINHOS_ZERAR_PEDIDOS, tenant: string) => `${PREFIXO_PLATAFORMA}${CAMINHOS_ZERAR_PEDIDOS[chave].replace(':id', tenant)}`;

describe.skipIf(!PG_DISPONIVEL)('T-0093 — "Zerar pedidos não faturados" no /config pela API de produção', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  let token = '';
  let A = '';
  let B = '';
  let SEMLIC = '';
  /** Pedidos do A: dois saem (bko e fdv), três ficam (com nota, com título, faturado). */
  const P = { bko: randomUUID(), fdv: randomUUID(), nota: randomUUID(), titulo: randomUUID(), faturado: randomUUID() };
  const FDV_UUID = randomUUID();
  /** Pedidos do B: o do FDV tem o a faturar já faturado sem nota, então a porta falha (MXC03) depois do portal_zerar (caso 4). */
  const PB = { bko: randomUUID(), fdv: randomUUID() };
  const FDV_UUID_B = randomUUID();
  const notas: string[] = [];

  const adm = async <L = Record<string, unknown>>(sql: string, prm: unknown[] = []) => (await b.admin.query(sql, prm)).rows as L[];
  const n = async (sql: string, prm: unknown[]) => (await adm<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, prm))[0]!.n;
  /** Retrato do que nunca pode mudar: pedidos que ficam, notas, XML (sha256) e o tenant B inteiro. */
  const intocados = async () => ({
    pedidosA: await adm('SELECT id, status, updated_at FROM pedido.pedido WHERE tenant_id = $1 AND id = ANY ($2) ORDER BY id', [A, [P.nota, P.titulo, P.faturado]]),
    notas: await adm('SELECT id, status, numero, updated_at FROM faturamento.nota WHERE tenant_id = $1 ORDER BY id', [A]),
    xml: await adm('SELECT nota_id, sha256 FROM faturamento.nota_xml WHERE tenant_id = $1 ORDER BY nota_id', [A]),
    titulos: await n('faturamento.titulo WHERE tenant_id = $1', [A]),
    pedidosB: await n('pedido.pedido WHERE tenant_id = $1', [B]),
  });

  /** Nota autorizada do pedido, com o XML guardado e, se pedido, um título (molde do db/testes/pedido-portal-zerar-0064). */
  const notaDoPedido = async (pedido: string, cnf: number, titulo: boolean) => {
    const nota = randomUUID();
    const filial = randomUUID();
    const chave = chaveAcesso(1, 1, cnf);
    const protocolo = `1132600000${String(cnf % 100000).padStart(5, '0')}`;
    const xml = `<nfeProc>${nota}</nfeProc>`;
    notas.push(nota);
    await b.admin.query(`
SELECT set_config('app.tenant_id', '${A}', true);
INSERT INTO faturamento.nota (id, tenant_id, filial_id, pedido_id, serie, numero, idempotencia_chave, cliente_id, natureza_operacao, produtos_centavos, total_nota_centavos)
  VALUES ('${nota}', '${A}', '${filial}', '${pedido}', 1, faturamento.reservar_numero('${filial}', 'homologacao', 1::smallint, 1), '${randomUUID()}', gen_random_uuid(), 'Venda', 1000, 1000);
UPDATE faturamento.nota SET status = 'em_autorizacao', chave_acesso = '${chave}', c_nf = '${cnfDe(cnf)}' WHERE id = '${nota}';
UPDATE faturamento.nota SET status = 'autorizada_guarda_pendente', protocolo = '${protocolo}', autorizada_em = now(), c_stat = 100 WHERE id = '${nota}';
INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256)
  VALUES ('${A}', 'nfe_autorizada', '${nota}', '${chave}', '${protocolo}', '${xml}', ${hashSql(xml)});
${titulo ? `INSERT INTO faturamento.titulo (tenant_id, nota_id, parcela, total_parcelas, vencimento, valor_centavos, conta_como_real) VALUES ('${A}', '${nota}', 1, 1, '2026-12-21', 1000, false);` : ''}`);
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'integracao-fdv'];
    A = await criarTenant(b.admin, `zp-a-${randomUUID().slice(0, 6)}`, MODULOS);
    B = await criarTenant(b.admin, `zp-b-${randomUUID().slice(0, 6)}`, MODULOS);
    SEMLIC = await criarTenant(b.admin, `zp-c-${randomUUID().slice(0, 6)}`, ['core', 'cadastros']);
    const sa = sqlDePedido(A, 1);
    const sb = sqlDePedido(B, 1);
    await b.admin.query(`
${sa.pedidoSql({ id: P.bko })} ${sa.itemSql(P.bko, 1)}
${sa.pedidoSql({ id: P.fdv, origem: 'fdv', externalId: FDV_UUID })} ${sa.itemSql(P.fdv, 1)}
${sa.pedidoSql({ id: P.nota })} ${sa.itemSql(P.nota, 1)}
${sa.pedidoSql({ id: P.titulo })} ${sa.itemSql(P.titulo, 1)}
${sa.pedidoSql({ id: P.faturado })} ${sa.itemSql(P.faturado, 1, { faturada: 10000 })}
UPDATE pedido.pedido SET status = 'aprovado' WHERE tenant_id = '${A}';
UPDATE pedido.pedido SET status = 'faturado' WHERE id = '${P.faturado}';
${sb.pedidoSql({ id: PB.bko })} ${sb.pedidoSql({ id: PB.fdv, origem: 'fdv', externalId: FDV_UUID_B })}
UPDATE pedido.pedido SET status = 'aprovado' WHERE tenant_id = '${B}';
INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado, pedido_id) VALUES ('${B}', '${FDV_UUID_B}', NULL, repeat('1', 64), 'entregue', '${PB.fdv}');
INSERT INTO faturamento.pedido_a_faturar (tenant_id, pedido_id, filial_id, cliente_id, payload, status) VALUES ('${B}', '${PB.fdv}', gen_random_uuid(), gen_random_uuid(), '{"itens": []}', 'faturado');
INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado, pedido_id) VALUES ('${A}', '${FDV_UUID}', NULL, repeat('1', 64), 'entregue', '${P.fdv}');
INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, numero_erp, corpo, hash, estado) VALUES ('${A}', '${FDV_UUID}', 'integrado', 'PED-2', '{"status": "integrado"}', repeat('2', 64), 'pendente');
INSERT INTO faturamento.pedido_a_faturar (tenant_id, pedido_id, filial_id, cliente_id, payload, status) VALUES ('${A}', '${P.fdv}', gen_random_uuid(), gen_random_uuid(), '{"itens": []}', 'a_faturar');`);
    const cnf = parseInt(A.slice(0, 6), 16);
    await notaDoPedido(P.nota, cnf, false);
    await notaDoPedido(P.titulo, cnf + 1, true);
    await inserirSuperadmin(b, EMAIL_SA);
    await inserirAdministradorDeTeste(b.admin, A, { id: randomUUID(), email: 'adm-zp@exemplo.invalid', nome: 'Pessoa Fictícia', filialIds: [] });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao' }));
    p = atalhosPortal(app);
    token = await p.sessao(EMAIL_SA);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('caso 6: sem sessão é 401, sem CSRF é 403, frase errada é 422 e o JWT do tenant não vale; nada muda', async () => {
    const antes = await n('pedido.pedido WHERE tenant_id = $1', [A]);
    expect((await p.pedir('POST', url('zerar', A), { chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } })).statusCode).toBe(401);
    expect((await p.pedir('POST', url('zerar', A), { token, csrf: false, chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } })).statusCode).toBe(403);
    // frase é regra (RN-CAD-10): o Zerar por cadastro dá 422; aqui o Zod do contrato a confere e dá 400 (divergência avisada ao gerente, 25/11)
    const frase = await p.pedir('POST', url('zerar', A), { token, chave: randomUUID(), corpo: { frase: 'apagar tudo' } });
    expect([400, 422], frase.body).toContain(frase.statusCode);
    expect(frase.body).toContain('frase');
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: (await adm<{ slug: string }>('SELECT slug FROM plataforma.tenant WHERE id = $1', [A]))[0]!.slug, email: 'adm-zp@exemplo.invalid', senha: SENHA_DE_TESTE } });
    expect(login.statusCode, login.body).toBe(200);
    const jwt = login.json<{ token_acesso: string }>().token_acesso;
    expect((await p.pedir('POST', url('zerar', A), { cabecalhos: { authorization: `Bearer ${jwt}` }, chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } })).statusCode).toBe(401);
    // empresa sem a licença do pedido: recusa sem apagar
    const semLic = await p.pedir('POST', url('zerar', SEMLIC), { token, chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } });
    expect(semLic.statusCode, semLic.body).toBeGreaterThanOrEqual(400);
    expect(semLic.statusCode).toBeLessThan(500);
    expect(await n('pedido.pedido WHERE tenant_id = $1', [A])).toBe(antes);
  });

  it('casos 1 e 2: a prévia conta o mesmo que o zerar; saem o bko e o fdv (a faturar cancelado, recebido liberado); ficam nota, título e faturado', async () => {
    const antes = await intocados();
    const previa = await p.pedir('POST', url('previa', A), { token });
    expect(previa.statusCode, previa.body).toBe(200);
    const pv = previa.json<Resposta>();
    expect(pv).toMatchObject({ simulado: true, apagados_fdv: 1, apagados: [{ tabela: 'pedido', quantidade: 2 }] });
    const z = await p.pedir('POST', url('zerar', A), { token, chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } });
    expect(z.statusCode, z.body).toBe(200);
    const r = z.json<Resposta>();
    expect(r.simulado).toBe(false);
    expect(r.mantidos).toEqual(pv.mantidos);
    expect(r.apagados).toEqual(
      expect.arrayContaining([
        { tabela: 'pedido', quantidade: 2 },
        { tabela: 'integracao_fdv.pedido_recebido', quantidade: 1 },
        { tabela: 'integracao_fdv.retorno_enviado', quantidade: 1 },
        { tabela: 'faturamento.pedido_a_faturar', quantidade: 1 },
      ]),
    );
    expect(await n('pedido.pedido WHERE tenant_id = $1 AND id = ANY ($2)', [A, [P.bko, P.fdv]])).toBe(0);
    expect(await n('pedido.pedido_item WHERE tenant_id = $1 AND pedido_id = ANY ($2)', [A, [P.bko, P.fdv]])).toBe(0);
    expect(await adm('SELECT status FROM faturamento.pedido_a_faturar WHERE pedido_id = $1', [P.fdv])).toEqual([{ status: 'cancelado' }]);
    expect(await n('integracao_fdv.pedido_recebido WHERE tenant_id = $1', [A])).toBe(0);
    expect(await intocados()).toEqual(antes);
    // zerar de novo pela API: 200 sem nada a apagar
    const de2 = await p.pedir('POST', url('zerar', A), { token, chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } });
    expect(de2.statusCode, de2.body).toBe(200);
    expect(de2.json<Resposta>().apagados.every((x) => x.quantidade === 0)).toBe(true);
  });

  it('caso 4: a porta aposZerarPedidos falha (a faturar já faturado) e o zerar inteiro é desfeito: 409 e nada muda no B', async () => {
    const retrato = async () => ({
      pedidos: await n('pedido.pedido WHERE tenant_id = $1', [B]),
      itens: await n('pedido.pedido_item WHERE tenant_id = $1', [B]),
      recebido: await n('integracao_fdv.pedido_recebido WHERE tenant_id = $1', [B]),
      aFaturar: await adm('SELECT status FROM faturamento.pedido_a_faturar WHERE tenant_id = $1', [B]),
      auditoria: await n("plataforma.auditoria WHERE tenant_id = $1 AND acao = 'pedido.dados.zerar'", [B]),
    });
    const antes = await retrato();
    expect(antes.pedidos).toBe(2);
    const z = await p.pedir('POST', url('zerar', B), { token, chave: randomUUID(), corpo: { frase: FRASE_ZERAR_DADOS } });
    expect(z.statusCode, z.body).toBe(409);
    expect(await retrato()).toEqual(antes);
  });

  it('caso 5: a auditoria do zerar e da porta leva só contagens, sem número, cliente, valor nem pedido_uuid', async () => {
    const aud = await adm<{ acao: string; depois: unknown }>(
      "SELECT acao, depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao IN ('pedido.dados.zerar', 'integracao-fdv.pedido_recebido.liberar_reenvio', 'faturamento.pedido_a_faturar.descartar') ORDER BY created_at",
      [A],
    );
    expect(aud.map((a) => a.acao)).toEqual(
      expect.arrayContaining(['pedido.dados.zerar', 'integracao-fdv.pedido_recebido.liberar_reenvio', 'faturamento.pedido_a_faturar.descartar']),
    );
    const texto = JSON.stringify(aud);
    for (const s of [P.bko, P.fdv, FDV_UUID, 'PED-2', 'retrato', 'total']) expect(texto).not.toContain(s);
  });
});
