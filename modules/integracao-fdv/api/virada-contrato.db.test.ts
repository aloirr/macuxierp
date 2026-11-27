/**
 * T-0107 (decisão 13 A): virada de versão de contrato do Hub. O ciclo da entidade recoloca na fila, sem mexer no hash, quem foi enviado
 * (aceito ou recusado) em versão diferente da vigente (`contrato_enviado`, migração 0069). Contra o PostgreSQL real, com dublê do Hub.
 * PRAZO_CONTRATO_V2_LIGADO = true: a vigente do prazo_pagamento é v2; as outras entidades, v1.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import { AGORA, admSql, ciclo, criarCredencial, cursorEntidade, espelho, hubDuble, ok, payloadProduto } from './apoio-conector-teste';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const depois = (s: number): Date => mais(AGORA, s);
const LOTE_ID = '7c2e9a14-5d3b-4e86-9f01-3a8b64d2c7e5';
const aceito = (entidade: string) => ({ lote_id: LOTE_ID, status: 'recebido', entidade, modo: 'delta', recebidos: 1, repetido: false, consulta: `/integracao/v1/lotes/${LOTE_ID}` });
const concluido = (entidade: string, erros: unknown[] = []) => ({ lote_id: LOTE_ID, entidade, modo: 'delta', status: erros.length ? 'concluido_com_erros' : 'concluido', contagens: { recebidas: 1, com_erro: erros.length, novas: 1 }, erros });
const prazo = (chave: string) => ({ external_id: chave, ativo: true, forma_external_id: 'FP-1', codigo: chave, parcelas_dias: [30], descricao: `Prazo ${chave}`, prazo_medio_dias: 30 });

describe.skipIf(!PG_DISPONIVEL)('T-0107: virada de versão de contrato (precisa da coluna contrato_enviado, 0069)', { timeout: 20_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const reg = async (t: string, chave: string, e = 'prazo_pagamento') =>
    (await adm('SELECT pendente, hash, hash_confirmado, contrato_enviado FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3', [t, e, chave]))[0]!;
  const posts = (hub: ReturnType<typeof hubDuble>) => hub.chamadas.filter((c) => c.pedido.metodo === 'POST');

  /** Tenant com a forma FP-1 confirmada e o prazo PZ-1 já aceito em `versao` (não pendente). */
  async function cenario(slug: string, o: { versao?: string | null; entidade?: 'prazo_pagamento' | 'produto'; recusado?: boolean } = {}): Promise<{ t: string; chave: string; entidade: string }> {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t, { conector: `conector-${slug}` });
    const entidade = o.entidade ?? 'prazo_pagamento';
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FP-1', ativo: true, codigo: 'FP-1', descricao: 'Boleto' }, { confirmado: true });
    const chave = entidade === 'prazo_pagamento' ? 'PZ-1' : 'P001';
    await espelho(efemero.admin, t, entidade, entidade === 'prazo_pagamento' ? prazo(chave) : payloadProduto(chave), { confirmado: !o.recusado, pendente: false });
    if (o.versao !== undefined) await adm('UPDATE integracao_fdv.registro_publicado SET contrato_enviado = $3 WHERE tenant_id = $1 AND registro_external_id = $2', [t, chave, o.versao]);
    await cursorEntidade(efemero.admin, t, entidade, { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANTIGO' } });
    return { t, chave, entidade };
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-INF-10: enviado em v1 e vigente v2 volta à fila sem mexer no hash, reenvia em v2 e grava v2', async () => {
    const { t, chave } = await cenario('vir-a', { versao: 'v1' });
    const antes = await reg(t, chave);
    const hub = hubDuble({ 'POST /lotes': [ok(aceito('prazo_pagamento'))], 'GET /lotes/{id}': [ok(concluido('prazo_pagamento'))] });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    const [post] = posts(hub);
    expect(post).toBeDefined();
    expect(post!.pedido.corpo).toMatchObject({ versao_contrato: 'v2', registros: [{ external_id: chave }] });
    await ciclo(banco, agenda, hub, depois(6), [t]);
    const depoisDoEnvio = await reg(t, chave);
    expect(depoisDoEnvio).toMatchObject({ pendente: false, contrato_enviado: 'v2', hash: antes.hash });
  });

  it('RN-INF-10: recusado em v1 (saemDaFila, sem hash confirmado) volta, e o recusado em v2 guarda v2 e não volta mais', async () => {
    const { t, chave } = await cenario('vir-b', { versao: 'v1', recusado: true });
    const erro = [{ indice: 0, external_id: chave, origem: 'hub', codigo: 'regra_invalida', campo: 'codigo', reprocessavel: false }];
    const hub = hubDuble({ 'POST /lotes': [ok(aceito('prazo_pagamento'))], 'GET /lotes/{id}': [ok(concluido('prazo_pagamento', erro))] });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    expect(posts(hub)).toHaveLength(1);
    await ciclo(banco, agenda, hub, depois(6), [t]);
    expect(await reg(t, chave)).toMatchObject({ pendente: false, hash_confirmado: null, contrato_enviado: 'v2' });
    await ciclo(banco, agenda, hub, depois(7200), [t]);
    expect(posts(hub)).toHaveLength(1); // gravou a versão tentada: não é recolocado em laço
  });

  it('RN-INF-10: aceito em v2 não volta e o ciclo seguinte sem virada não marca nada', async () => {
    const { t, chave } = await cenario('vir-c', { versao: 'v2' });
    const hub = hubDuble();
    await ciclo(banco, agenda, hub, AGORA, [t]);
    expect(posts(hub)).toHaveLength(0);
    expect(await reg(t, chave)).toMatchObject({ pendente: false, contrato_enviado: 'v2' });
  });

  it('RN-INF-10: outro tenant não é tocado', async () => {
    const a = await cenario('vir-d1', { versao: 'v1' });
    const b = await cenario('vir-d2', { versao: 'v1' });
    const hub = hubDuble({ 'POST /lotes': [ok(aceito('prazo_pagamento'))] });
    await ciclo(banco, agenda, hub, AGORA, [a.t]); // só o ciclo do tenant A
    expect((await reg(a.t, a.chave)).pendente).toBe(true);
    expect(await reg(b.t, b.chave)).toMatchObject({ pendente: false, contrato_enviado: 'v1' });
  });

  it('RN-INF-10: entidade que não é prazo_pagamento segue em v1 e não é recolocada', async () => {
    const { t, chave } = await cenario('vir-e', { versao: 'v1', entidade: 'produto' });
    const hub = hubDuble();
    await ciclo(banco, agenda, hub, AGORA, [t]);
    expect(posts(hub)).toHaveLength(0);
    expect(await reg(t, chave, 'produto')).toMatchObject({ pendente: false, contrato_enviado: 'v1' });
  });
});

describe.skipIf(!PG_DISPONIVEL)('T-0107: prazo com parcelas_dias em texto não gera laço de reenvio', { timeout: 20_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const posts = (hub: ReturnType<typeof hubDuble>) => hub.chamadas.filter((c) => c.pedido.metodo === 'POST');

  async function cenarioTexto(slug: string): Promise<{ t: string }> {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t, { conector: `conector-${slug}` });
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FP-1', ativo: true, codigo: 'FP-1', descricao: 'Boleto' }, { confirmado: true });
    await espelho(efemero.admin, t, 'prazo_pagamento', { ...prazo('PZ-1'), parcelas_dias: '28/56' }, { pendente: true });
    await cursorEntidade(efemero.admin, t, 'prazo_pagamento', { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANTIGO' } });
    return { t };
  }
  const linha = async (t: string) =>
    (await adm(`SELECT pendente, hash, hash_confirmado, payload FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND registro_external_id = 'PZ-1'`, [t]))[0]!;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-INF-10: texto "28/56" sai como [28,56], o aceite fecha pendente=false com hash=hash_confirmado e o ciclo seguinte não posta', async () => {
    const { t } = await cenarioTexto('txt-a');
    const hub = hubDuble({ 'POST /lotes': [ok(aceito('prazo_pagamento'))], 'GET /lotes/{id}': [ok(concluido('prazo_pagamento'))] });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    expect(posts(hub)).toHaveLength(1);
    expect((posts(hub)[0]!.pedido.corpo as { registros: { parcelas_dias: number[] }[] }).registros[0]!.parcelas_dias).toEqual([28, 56]);
    await ciclo(banco, agenda, hub, depois(6), [t]);
    const l = await linha(t);
    expect(l.pendente).toBe(false);
    expect(l.hash).toBe(l.hash_confirmado);
    expect((l.payload as { parcelas_dias: number[] }).parcelas_dias).toEqual([28, 56]);
    await ciclo(banco, agenda, hub, depois(7200), [t]);
    expect(posts(hub)).toHaveLength(1);
  });

  it('RN-INF-10: recusa firme com texto também sai da fila (pendente=false) e o ciclo seguinte não posta', async () => {
    const { t } = await cenarioTexto('txt-b');
    const erro = [{ indice: 0, external_id: 'PZ-1', origem: 'hub', codigo: 'regra_invalida', campo: 'codigo', reprocessavel: false }];
    const hub = hubDuble({ 'POST /lotes': [ok(aceito('prazo_pagamento'))], 'GET /lotes/{id}': [ok(concluido('prazo_pagamento', erro))] });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    await ciclo(banco, agenda, hub, depois(6), [t]);
    expect((await linha(t)).pendente).toBe(false);
    await ciclo(banco, agenda, hub, depois(7200), [t]);
    expect(posts(hub)).toHaveLength(1);
  });
});
