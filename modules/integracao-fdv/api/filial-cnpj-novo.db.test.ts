/**
 * v0.3.24 (RN-CORE-16, decisão 51 = propagar o CNPJ): a troca do CNPJ da empresa chega ao conector como `cadastros.filial.alterada@1`
 * da filial padrão (mesmo id e mesmo external_id, só o CNPJ muda; PR #849). Este teste prova a ida ao Hub (`/integracao/v1`) no
 * contrato canônico com o CNPJ novo: a filial sai UMA vez, sem chave nova nem linha nova no espelho, e a reentrega do mesmo evento
 * não gera outro envio. Contra o PostgreSQL real, com o dublê do Hub (`bash db/scripts/pg-local.sh`); só dado fictício.
 * A ligação do consumidor de `core.empresa.cnpj_alterado@1` no apps/worker é do engenheiro-software: aqui o evento da filial
 * entra direto no consumidor deste módulo, como o despachante entregaria.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import { AGORA, admSql, cadFilial, ciclo, CNPJ_FILIAL_1, criarCredencial, cursorEntidade, evento, hubDuble, licenciadas, loteAceito, loteConcluido, ok, TEMPO_PREPARO_MS, U } from './apoio-conector-teste';
import { criarConsumidorPublicarCadastros } from './consumidor-cadastros';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const depois = (s: number): Date => mais(AGORA, s);
const ID_ULTIMO = /\/([0-9a-f-]{36})$/;
/** CNPJ novo fictício com DV válido (RN-CORE-16); o antigo é o CNPJ_FILIAL_1 do apoio, padrão do cadFilial. */
const CNPJ_NOVO = '98765432000198';

describe.skipIf(!PG_DISPONIVEL)('RN-CORE-16: ida da filial padrão com o CNPJ novo', { timeout: 30_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const consumidor = criarConsumidorPublicarCadastros({ licencas: licenciadas('integracao-fdv'), agora: () => AGORA });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  }, TEMPO_PREPARO_MS);
  afterAll(async () => {
    await efemero?.remover();
  }, TEMPO_PREPARO_MS);

  it('a filial padrão sai uma vez com o CNPJ novo, na mesma chave, e a reentrega do evento não envia de novo', async () => {
    const t = await criarTenant(efemero.admin, 'fil-cnpj-novo', ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t);
    const f = U();
    const filial = (cnpj: string, em: string) => evento(t, 'cadastros.filial.alterada@1', f, cadFilial(f, { external_id: 'FIL-PADRAO', padrao: true, cnpj }), em);
    // o foco é o lote da filial: o sinal tem teste próprio
    const tratar = async (e: ReturnType<typeof evento>) => {
      await banco.comTenant(t, (tx) => consumidor.tratar(e, tx));
      await adm("DELETE FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade <> 'filial'", [t]);
      await adm('DELETE FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]);
    };
    const linhas = () => adm("SELECT registro_external_id, erp_id, pendente, hash, hash_confirmado, payload FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'filial' AND deleted_at IS NULL", [t]);
    const padrao = async () => (await adm("SELECT erp_id FROM integracao_fdv.referencia WHERE tenant_id = $1 AND tipo = 'filial_padrao' AND deleted_at IS NULL", [t]))[0]!.erp_id;
    const acordar = (em: Date) => adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1 AND entidade = 'filial'", [t, em]);
    const hub = hubDuble({
      'POST /lotes': [(p) => ok(loteAceito({ id: String((p.corpo as { lote_id?: string }).lote_id ?? U()), entidade: 'filial', recebidos: 1 }))],
      'GET /lotes/{id}': [(p) => ok(loteConcluido({ id: ID_ULTIMO.exec(p.caminho)![1]!, entidade: 'filial' }))],
    });
    const posts = () => hub.chamadas.filter((x) => x.pedido.metodo === 'POST' && (x.pedido.corpo as { entidade?: string }).entidade === 'filial');

    // 1) a filial padrão com o CNPJ antigo já foi ao Hub e está confirmada
    await tratar(filial(CNPJ_FILIAL_1, '2026-11-22T09:00:00.000Z'));
    await cursorEntidade(efemero.admin, t, 'filial', { credencialId: cred, proximoEm: AGORA, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANTIGO' } });
    await ciclo(banco, agenda, hub, AGORA, [t]);
    await ciclo(banco, agenda, hub, depois(6), [t]);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.pedido.corpo).toMatchObject({ registros: [{ external_id: 'FIL-PADRAO', cnpj: CNPJ_FILIAL_1 }] });
    const antes = (await linhas())[0]!;
    expect(antes).toMatchObject({ pendente: false, erp_id: f });
    expect(antes.hash_confirmado).toBe(antes.hash);

    // 2) RN-CORE-16: o cadastros publica a filial padrão com o CNPJ novo (mesmo id, mesmo external_id); reentregue duas vezes
    const troca = filial(CNPJ_NOVO, '2026-11-22T11:00:00.000Z');
    await tratar(troca);
    await tratar(troca);
    const remapeada = await linhas();
    expect(remapeada).toHaveLength(1); // a chave não muda: nada de linha nova nem troca de chave
    expect(remapeada[0]).toMatchObject({ registro_external_id: 'FIL-PADRAO', erp_id: f, pendente: true, payload: { cnpj: CNPJ_NOVO, codigo: '0001' } });
    expect(remapeada[0]!.hash).not.toBe(antes.hash);
    expect(await padrao()).toBe(f);

    // 3) a filial sai uma vez, no contrato canônico, com o CNPJ novo e uma chave de idempotência nova
    await acordar(depois(7200));
    await ciclo(banco, agenda, hub, depois(7200), [t]);
    await ciclo(banco, agenda, hub, depois(7210), [t]);
    expect(posts()).toHaveLength(2);
    const corpo = posts()[1]!.pedido.corpo as { registros: Array<Record<string, unknown>> };
    expect(corpo).toMatchObject({ entidade: 'filial', modo: 'delta', registros: [{ external_id: 'FIL-PADRAO', ativo: true, codigo: '0001', cnpj: CNPJ_NOVO }] });
    expect(corpo.registros).toHaveLength(1);
    expect(JSON.stringify(corpo)).not.toContain(CNPJ_FILIAL_1);
    expect(posts()[1]!.pedido.chaveIdempotencia).not.toBe(posts()[0]!.pedido.chaveIdempotencia);
    const final = (await linhas())[0]!;
    expect(final).toMatchObject({ pendente: false });
    expect(final.hash_confirmado).toBe(final.hash);

    // 4) a reentrega tardia do mesmo evento não reabre o registro nem gera outro envio
    await tratar(troca);
    expect((await linhas())[0]).toMatchObject({ pendente: false });
    await acordar(depois(14_400));
    await ciclo(banco, agenda, hub, depois(14_400), [t]);
    expect(posts()).toHaveLength(2);
  });
});
