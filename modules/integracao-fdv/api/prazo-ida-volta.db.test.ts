/**
 * T-0085 item 6: ida e volta do prazo médio. A condição com `prazo_medio_dias` fora da faixa das parcelas sai firme (linha inválida
 * `prazo_medio_fora_da_faixa`, fora da fila); o cadastros publica a condição alterada com o prazo médio recalculado (média das
 * parcelas); o consumidor remapeia, o hash muda, o registro volta a ser pendente, sai UMA vez em v2 e é confirmado.
 * Contra o PostgreSQL real, com o dublê do Hub (`bash db/scripts/pg-local.sh`).
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import { AGORA, admSql, cadCondicao, ciclo, criarCredencial, cursorEntidade, evento, hubDuble, licenciadas, ok, U } from './apoio-conector-teste';
import { criarConsumidorPublicarCadastros } from './consumidor-cadastros';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const depois = (s: number): Date => mais(AGORA, s);
const ID_ULTIMO = /\/([0-9a-f-]{36})$/;
const aceito = (id: string) => ({ lote_id: id, status: 'recebido', entidade: 'prazo_pagamento', modo: 'delta', recebidos: 1, repetido: false, consulta: `/integracao/v1/lotes/${id}` });
const concluido = (id: string) => ({ lote_id: id, entidade: 'prazo_pagamento', modo: 'delta', status: 'concluido', contagens: { recebidas: 1, com_erro: 0, novas: 1 }, erros: [] });

describe.skipIf(!PG_DISPONIVEL)('T-0085: ida e volta do prazo médio fora da faixa', { timeout: 30_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const consumidor = criarConsumidorPublicarCadastros({ licencas: licenciadas('integracao-fdv'), agora: () => AGORA });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-15: fora da faixa sai firme; com o prazo médio recalculado o registro sai uma vez em v2, é confirmado e o ciclo seguinte não envia', async () => {
    const t = await criarTenant(efemero.admin, 'prz-ida-volta', ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t);
    const c = U();
    const condicao = (medio: number, em: string) => evento(t, 'cadastros.condicao_pagamento.alterada@1', c, cadCondicao(c, { external_id: 'PZ-IV', forma_external_id: 'FP-IV', forma_codigo: 'BOLETO', forma_nome: 'Boleto', prazos_dias: [28, 56], prazo_medio_dias: medio }), em);
    // o foco aqui é o lote do prazo: o consumidor também agenda forma e sinal, que têm teste próprio
    const tratar = async (e: ReturnType<typeof evento>) => {
      await banco.comTenant(t, (tx) => consumidor.tratar(e, tx));
      await adm("DELETE FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade <> 'prazo_pagamento'", [t]);
      await adm('DELETE FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]);
    };
    const prazo = async () =>
      (await adm("SELECT pendente, hash, hash_confirmado, contrato_enviado, payload FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND registro_external_id = 'PZ-IV'", [t]))[0]!;
    const acordar = (em: Date) => adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1 AND entidade = 'prazo_pagamento'", [t, em]);
    const hub = hubDuble({
      'POST /lotes': [(p) => ok(aceito(String((p.corpo as { lote_id?: string }).lote_id ?? U())))],
      'GET /lotes/{id}': [(p) => ok(concluido(ID_ULTIMO.exec(p.caminho)![1]!))],
    });
    const postsPrazo = () => hub.chamadas.filter((x) => x.pedido.metodo === 'POST' && (x.pedido.corpo as { entidade?: string }).entidade === 'prazo_pagamento');

    // 1) prazo médio 90, fora de 28..56: a forma já está confirmada no Hub; o prazo sai firme (declarado, fora da fila)
    await tratar(condicao(90, '2026-11-22T09:00:00.000Z'));
    await adm("UPDATE integracao_fdv.registro_publicado SET pendente = false, hash_confirmado = hash, confirmado_em = alterado_em WHERE tenant_id = $1 AND entidade = 'forma_pagamento'", [t]);
    await cursorEntidade(efemero.admin, t, 'prazo_pagamento', { credencialId: cred, proximoEm: AGORA, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANTIGO' } });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    await ciclo(banco, agenda, hub, depois(6), [t]);
    const antes = await prazo();
    expect(postsPrazo()).toHaveLength(1);
    expect((postsPrazo()[0]!.pedido.corpo as { registros: unknown[]; linhas_invalidas: unknown[] })).toMatchObject({ registros: [], linhas_invalidas: [{ external_id: 'PZ-IV', codigo: 'regra_invalida', campo: 'prazo_medio_dias' }] }); // no Hub vira regra_invalida (T-0112)
    expect(await adm("SELECT codigo, campo, origem FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND registro_external_id = 'PZ-IV' ORDER BY created_at LIMIT 1", [t])).toEqual([{ codigo: 'prazo_medio_fora_da_faixa', campo: 'prazo_medio_dias', origem: 'erp' }]);
    expect(antes).toMatchObject({ pendente: false, hash_confirmado: null, contrato_enviado: 'v2' });
    await acordar(depois(7200));
    await ciclo(banco, agenda, hub, depois(7200), [t]);
    expect(postsPrazo()).toHaveLength(1); // firme: não repete

    // 2) o cadastros recalcula o prazo médio (média das parcelas: 42) e publica a condição alterada
    await tratar(condicao(42, '2026-11-22T11:00:00.000Z'));
    const remapeado = await prazo();
    expect(remapeado.hash).not.toBe(antes.hash);
    expect(remapeado).toMatchObject({ pendente: true, payload: { prazo_medio_dias: 42 } });
    await acordar(depois(7300));
    await ciclo(banco, agenda, hub, depois(7300), [t]);
    await ciclo(banco, agenda, hub, depois(7310), [t]);
    expect(postsPrazo()).toHaveLength(2);
    expect(postsPrazo()[1]!.pedido.corpo).toMatchObject({ versao_contrato: 'v2', registros: [{ external_id: 'PZ-IV', prazo_medio_dias: 42 }], linhas_invalidas: [] });
    const final = await prazo();
    expect(final).toMatchObject({ pendente: false, contrato_enviado: 'v2' });
    expect(final.hash_confirmado).toBe(final.hash);

    // 3) o ciclo seguinte não envia nada
    await acordar(depois(14_400));
    await ciclo(banco, agenda, hub, depois(14_400), [t]);
    expect(postsPrazo()).toHaveLength(2);
  });
});
