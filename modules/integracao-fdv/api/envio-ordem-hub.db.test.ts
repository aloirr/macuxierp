/**
 * v0.3.26 (decisão 35 A): forma única por código, prazo v2 validado e ordem de dependência no envio ao Hub.
 * Contra o PostgreSQL real, com o dublê do Hub (`bash db/scripts/pg-local.sh`).
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import { AGORA, admSql, ciclo, criarCredencial, cursorEntidade, espelho, U, hubDuble, loteAceito, loteConcluido, ok } from './apoio-conector-teste';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const ID_ULTIMO = /\/([0-9a-f-]{36})$/;
const ANTIGO = { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANTIGO' };

describe.skipIf(!PG_DISPONIVEL)('v0.3.26: ordem e unicidade no envio ao Hub', { timeout: 30_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  const hubDe = (entidade: string, erros: unknown[] = []) =>
    hubDuble({
      'POST /lotes': [(p) => ok(loteAceito({ id: String((p.corpo as { lote_id?: string }).lote_id ?? U()), entidade, recebidos: 1 }))],
      'GET /lotes/{id}': [(p) => ok(loteConcluido({ id: ID_ULTIMO.exec(p.caminho)![1]!, entidade, erros }))],
    });
  const posts = (hub: ReturnType<typeof hubDe>, entidade: string) =>
    hub.chamadas.filter((x) => x.pedido.metodo === 'POST' && (x.pedido.corpo as { entidade?: string }).entidade === entidade).map((x) => x.pedido.corpo as { registros: Array<Record<string, unknown>>; linhas_invalidas: Array<Record<string, unknown>>; versao_contrato: string });

  it('RN-INF-11: duas formas com o mesmo código: só a já confirmada vai; a outra fica como linha inválida e nunca no mesmo lote', async () => {
    const t = await criarTenant(efemero.admin, 'fw-forma-unica', ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t);
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FA', ativo: true, codigo: 'BOLETO', nome: 'Boleto' }, { confirmado: true });
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FB', ativo: true, codigo: 'BOLETO', nome: 'Boleto 2' }, { pendente: true, alterado: new Date('2026-11-22T09:30:00.000Z') });
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FC', ativo: true, codigo: 'PIX', nome: 'PIX' }, { pendente: true, alterado: new Date('2026-11-22T09:31:00.000Z') });
    await cursorEntidade(efemero.admin, t, 'forma_pagamento', { credencialId: cred, proximoEm: AGORA, cursor: ANTIGO });
    const hub = hubDe('forma_pagamento');
    await ciclo(banco, agenda, hub, AGORA, [t]);
    const corpo = posts(hub, 'forma_pagamento')[0]!;
    expect(corpo.registros.map((r) => r.external_id)).toEqual(['FC']);
    expect(corpo.linhas_invalidas).toMatchObject([{ external_id: 'FB', codigo: 'regra_invalida', campo: 'codigo' }]);
  });

  it('RN-INF-11 e RN-INF-12: o prazo sai com a forma vencedora do código e parcelas_dias em lista de inteiros (linha antiga em texto)', async () => {
    const t = await criarTenant(efemero.admin, 'fw-prazo-v2', ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t);
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FA', ativo: true, codigo: 'BOLETO', nome: 'Boleto' }, { confirmado: true });
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FB', ativo: true, codigo: 'BOLETO', nome: 'Boleto 2' }, { pendente: true });
    await espelho(efemero.admin, t, 'prazo_pagamento', { external_id: 'PZ', ativo: true, forma_external_id: 'FB', codigo: '28-56', parcelas_dias: '28/56', descricao: '28 e 56', prazo_medio_dias: 42 }, { pendente: true });
    await cursorEntidade(efemero.admin, t, 'prazo_pagamento', { credencialId: cred, proximoEm: AGORA, cursor: ANTIGO });
    const hub = hubDe('prazo_pagamento');
    await ciclo(banco, agenda, hub, AGORA, [t]);
    await ciclo(banco, agenda, hub, mais(AGORA, 600), [t]);
    const corpo = posts(hub, 'prazo_pagamento')[0]!;
    expect(corpo.versao_contrato).toBe('v2');
    expect(corpo.registros).toMatchObject([{ external_id: 'PZ', forma_external_id: 'FA', parcelas_dias: [28, 56], prazo_medio_dias: 42 }]);
    const [linha] = await adm("SELECT payload, hash, hash_confirmado, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = 'PZ'", [t]);
    expect(linha).toMatchObject({ payload: { forma_external_id: 'FA', parcelas_dias: [28, 56] }, pendente: false });
    expect(linha!.hash_confirmado).toBe(linha!.hash);
  });

  it('RN-INF-12: prazo sem prazo médio fica retido com motivo e não vai ao Hub', async () => {
    const t = await criarTenant(efemero.admin, 'fw-prazo-sem-medio', ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t);
    await espelho(efemero.admin, t, 'forma_pagamento', { external_id: 'FA', ativo: true, codigo: 'BOLETO', nome: 'Boleto' }, { confirmado: true });
    await espelho(efemero.admin, t, 'prazo_pagamento', { external_id: 'PZ', ativo: true, forma_external_id: 'FA', codigo: '28-56', parcelas_dias: '28/56', descricao: '28 e 56' }, { pendente: true });
    await cursorEntidade(efemero.admin, t, 'prazo_pagamento', { credencialId: cred, proximoEm: AGORA, cursor: ANTIGO });
    const hub = hubDe('prazo_pagamento');
    await ciclo(banco, agenda, hub, AGORA, [t]);
    const corpo = posts(hub, 'prazo_pagamento')[0]!;
    expect(corpo.registros).toEqual([]);
    expect(corpo.linhas_invalidas).toMatchObject([{ external_id: 'PZ', campo: 'prazo_medio_dias' }]);
  });

  it('RN-INF-02: o Hub recusa o vendedor por filial inexistente: a confirmação da filial cai, a filial volta à fila e o vendedor fica retido sem reenvio em laço', async () => {
    const t = await criarTenant(efemero.admin, 'fw-dependencia', ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t);
    await espelho(efemero.admin, t, 'filial', { external_id: 'F1', ativo: true, codigo: '0001', nome: 'Matriz' }, { confirmado: true });
    await espelho(efemero.admin, t, 'vendedor', { external_id: 'V1', ativo: true, nome: 'Ana', filial_external_id: 'F1' }, { pendente: true });
    await cursorEntidade(efemero.admin, t, 'vendedor', { credencialId: cred, proximoEm: AGORA, cursor: ANTIGO });
    await cursorEntidade(efemero.admin, t, 'filial', { credencialId: cred, proximoEm: mais(AGORA, 86_400), cursor: ANTIGO });
    const hub = hubDe('vendedor', [{ indice: 0, external_id: 'V1', codigo: 'filial_inexistente', campo: 'filial_external_id', mensagem: 'x', reprocessavel: false, origem: 'hub' }]);
    await ciclo(banco, agenda, hub, AGORA, [t]);
    await ciclo(banco, agenda, hub, mais(AGORA, 600), [t]);
    const filial = (await adm("SELECT hash_confirmado, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = 'F1'", [t]))[0]!;
    expect(filial).toMatchObject({ hash_confirmado: null, pendente: true });
    const vendedor = (await adm("SELECT pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = 'V1'", [t]))[0]!;
    expect(vendedor.pendente).toBe(true);
    // o vendedor não é reenviado enquanto a filial não for confirmada de novo
    await ciclo(banco, agenda, hub, mais(AGORA, 2400), [t]);
    await ciclo(banco, agenda, hub, mais(AGORA, 4800), [t]);
    const vendedoresEnviados = posts(hub, 'vendedor').filter((c) => c.registros.length > 0);
    expect(vendedoresEnviados).toHaveLength(1);
    // a filial foi reenviada antes (a dependência volta à frente do dependente)
    expect(posts(hub, 'filial').length).toBeGreaterThanOrEqual(1);
  });
});
