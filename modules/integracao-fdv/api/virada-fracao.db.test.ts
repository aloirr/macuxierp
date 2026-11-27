/**
 * T-0097 critério 3 (RN-INF-07, decisão 23 A): na virada do fracionário a unidade recusada firme com `quantidade_fracionaria` volta
 * UMA vez à fila, sem mexer no hash. Contra o PostgreSQL real, com dublê do Hub. Cenário: o registro foi recusado antes da virada
 * (aqui, por ser fração em CX); o cadastro da unidade passa a KG (ou segue em CX) e o ciclo seguinte decide.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import { AGORA, admSql, ciclo, criarCredencial, cursorEntidade, espelho, hubDuble, loteAceito, loteConcluido, ok, payloadProduto } from './apoio-conector-teste';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const LOTE_ID = '7c2e9a14-5d3b-4e86-9f01-3a8b64d2c7e5';
const LOTE_2 = '9a1b3c5d-7e2f-4a60-8b14-2c6d8e0f1a37';
const aceito = (id = LOTE_ID) => loteAceito({ id, entidade: 'produto_unidade', recebidos: 1 });
const concluido = (id = LOTE_ID) => loteConcluido({ id, entidade: 'produto_unidade' });

describe.skipIf(!PG_DISPONIVEL)('T-0097: virada do fracionário reenvia uma vez a unidade recusada com quantidade_fracionaria', { timeout: 20_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  /** Lotes com registro válido: a recusa local vai só em `linhas_invalidas`. */
  const posts = (hub: ReturnType<typeof hubDuble>) => hub.chamadas.filter((c) => c.pedido.metodo === 'POST' && ((c.pedido.corpo as { registros?: unknown[] }).registros ?? []).length > 0);
  const linha = async (t: string) =>
    (await adm(`SELECT pendente, hash, hash_confirmado, fonte_refs FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'produto_unidade' AND registro_external_id = 'U-FRAC'`, [t]))[0]!;

  /** Unidade recusada localmente no primeiro ciclo (fração em CX): a recusa firme que existia antes da virada. */
  async function recusada(slug: string): Promise<{ t: string; hub: ReturnType<typeof hubDuble> }> {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t, { conector: `conector-${slug}` });
    await espelho(efemero.admin, t, 'produto', payloadProduto('PROD'), { confirmado: true });
    await espelho(efemero.admin, t, 'produto_unidade', { external_id: 'U-FRAC', ativo: true, produto_external_id: 'PROD', unidade: 'CX', fator: 1.5, padrao: false }, { alterado: new Date('2026-11-22T09:00:00.000Z') });
    await cursorEntidade(efemero.admin, t, 'produto_unidade', { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANT' } });
    const hub = hubDuble({ 'POST /lotes': [ok(aceito()), ok(aceito(LOTE_2))], 'GET /lotes/{id}': [ok(concluido()), ok(concluido(LOTE_2))] });
    await ciclo(banco, agenda, hub, AGORA, [t]); // recusa local: só em linhas_invalidas, sem registro válido
    await ciclo(banco, agenda, hub, mais(AGORA, 6), [t]); // consulta do lote: a recusa firme sai da fila
    expect(posts(hub)).toHaveLength(0);
    expect(await adm('SELECT codigo FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND resolvido_em IS NULL', [t])).toEqual([{ codigo: 'quantidade_fracionaria' }]);
    expect((await linha(t)).pendente).toBe(false);
    return { t, hub };
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-INF-07: a unidade recusada que passou a ser KG volta à fila sem mexer no hash, é enviada com a fração e fecha o erro', async () => {
    const { t, hub } = await recusada('vfr-a');
    const antes = await linha(t);
    await adm(`UPDATE integracao_fdv.registro_publicado SET payload = jsonb_set(payload, '{unidade}', '"KG"') WHERE tenant_id = $1 AND registro_external_id = 'U-FRAC'`, [t]);
    await ciclo(banco, agenda, hub, mais(AGORA, 20000), [t]);
    const [post] = posts(hub);
    expect(post!.pedido.corpo).toMatchObject({ registros: [{ external_id: 'U-FRAC', unidade: 'KG', fator: 1.5 }] });
    await ciclo(banco, agenda, hub, mais(AGORA, 20010), [t]);
    expect(await linha(t)).toMatchObject({ hash: antes.hash, fonte_refs: { virada_fracao: true } }); // hash intacto; pendente não se confere (o payload foi trocado à mão)
    expect((await linha(t)).hash_confirmado).not.toBeNull();
    expect(await adm('SELECT count(*)::int AS n FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND resolvido_em IS NULL', [t])).toEqual([{ n: 0 }]);
  });

  it('RN-CAD-17: fração em unidade que não é KG/M continua recusada, e a virada não reenvia em laço (idempotente)', async () => {
    const { t, hub } = await recusada('vfr-b');
    await ciclo(banco, agenda, hub, mais(AGORA, 20000), [t]); // a virada recoloca uma vez; a recusa local se repete
    await ciclo(banco, agenda, hub, mais(AGORA, 20010), [t]);
    expect((await linha(t))).toMatchObject({ pendente: false, fonte_refs: { virada_fracao: true } });
    await ciclo(banco, agenda, hub, mais(AGORA, 40000), [t]);
    await ciclo(banco, agenda, hub, mais(AGORA, 60000), [t]);
    expect(posts(hub)).toHaveLength(0);
    const erros = await adm(`SELECT count(*)::int AS n FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND codigo = 'quantidade_fracionaria' AND origem = 'erp'`, [t]);
    expect(erros).toEqual([{ n: 2 }]); // original + uma única repetição da virada
  });

  it('RN-INF-07: outro tenant não é tocado', async () => {
    const a = await recusada('vfr-c1');
    const b = await recusada('vfr-c2');
    await ciclo(banco, agenda, a.hub, mais(AGORA, 20000), [a.t]);
    expect((await linha(a.t)).fonte_refs).toMatchObject({ virada_fracao: true });
    expect((await linha(b.t)).fonte_refs).not.toHaveProperty('virada_fracao');
  });
});
