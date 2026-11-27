/**
 * Sondagem da credencial recusada (decisão 25 B): só o sinal chama o Hub, 1 vez a cada 30 min da pausa mais antiga
 * ('credencial' e 'licenca_fdv'); envio e reconciliação continuam sem chamar. A 2ª parte depende da coluna
 * `integracao_fdv.sinal.ultimo_codigo` (migração 0073 do banco-dados): falha até ela entrar no main.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { ContextoAgenda, ItemAgenda } from '@macuxierp/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAgendaConector } from './agenda-conector';
import { INTERVALO_SONDAGEM_CREDENCIAL_S } from '../domain';
import { mais } from './conector-comum';
import { AGORA, CHAVE_CLARA, admSql, ciclo, contextoDaAgenda, criarCredencial, cursorEntidade, hubDuble, ok, recusa, retentavel } from './apoio-conector-teste';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const depois = (s: number): Date => mais(AGORA, s);
const PAUSA = INTERVALO_SONDAGEM_CREDENCIAL_S;

describe.skipIf(!PG_DISPONIVEL)('sondagem da credencial recusada no PostgreSQL real', { timeout: 20_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const pausas = (t: string) => adm('SELECT entidade::text AS entidade, pausada_motivo, pausada_em, proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 ORDER BY entidade', [t]);

  /** Tenant com credencial, duas entidades pausadas (produto e cliente) há `haSegundos` e o sinal vencido. */
  async function cenario(slug: string, o: { haSegundos: number; motivo?: 'credencial' | 'licenca_fdv' }): Promise<{ t: string }> {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t, { conector: `conector-${slug}` });
    for (const e of ['produto', 'cliente']) {
      await cursorEntidade(efemero.admin, t, e, { proximoEm: depois(+99_999), credencialId: cred });
      await adm('UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = $3, pausada_em = $4 WHERE tenant_id = $1 AND entidade = $2', [t, e, o.motivo ?? 'credencial', depois(-o.haSegundos)]);
    }
    await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [t, depois(-1), depois(-1)]);
    return { t };
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  describe('sem a coluna ultimo_codigo (independe da 0073)', () => {
    it('RN-INF-04: antes dos 30 min o sinal, o envio e a reconciliação não chamam o Hub', async () => {
      const { t } = await cenario('son-a', { haSegundos: PAUSA - 1 });
      const hub = hubDuble();
      await adm('UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(0);
      expect((await pausas(t)).map((p) => p.pausada_motivo)).toEqual(['credencial', 'credencial']);
    });
  });

  describe('com a coluna ultimo_codigo (depende da migração 0073)', () => {
    it('RN-INF-04: com 30 min ou mais, o sinal faz 1 chamada; aceita limpa credencial e licença de todas as entidades e antecipa o envio', async () => {
      const { t } = await cenario('son-c', { haSegundos: PAUSA });
      await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'licenca_fdv' WHERE tenant_id = $1 AND entidade = 'cliente'", [t]);
      await adm("UPDATE integracao_fdv.sinal SET ultimo_codigo = 'credencial_revogada' WHERE tenant_id = $1", [t]);
      const hub = hubDuble({ 'POST /sinal': [ok({})] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas.map((c) => c.pedido.caminho)).toEqual(['/sinal']);
      for (const p of await pausas(t)) expect(p).toMatchObject({ pausada_motivo: null, pausada_em: null, proximo_em: AGORA });
      expect((await adm('SELECT ultimo_codigo FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!.ultimo_codigo).toBeNull();
    });

    it('RN-INF-04: recusa de novo repausa com pausada_em = agora (recomeça os 30 min) e grava o código do Hub', async () => {
      const { t } = await cenario('son-d', { haSegundos: PAUSA + 5 });
      const hub = hubDuble({ 'POST /sinal': [recusa(403, 'credencial_revogada')] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(1);
      for (const p of await pausas(t)) expect(p).toMatchObject({ pausada_motivo: 'credencial', pausada_em: AGORA });
      expect((await adm('SELECT ultimo_codigo FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!.ultimo_codigo).toBe('credencial_revogada');
      // 29 min depois ainda não sonda; 30 min depois sonda de novo
      await adm('UPDATE integracao_fdv.sinal SET proximo_sinal_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, agenda, hub, depois(PAUSA - 60), [t]);
      expect(hub.chamadas).toHaveLength(1);
    });

    it('RN-INF-04: erro sem código grava http_<status>', async () => {
      const { t } = await cenario('son-e', { haSegundos: PAUSA });
      await ciclo(banco, agenda, hubDuble({ 'POST /sinal': [recusa(401)] }), AGORA, [t]);
      expect((await adm('SELECT ultimo_codigo FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!.ultimo_codigo).toMatch(/^(credencial_invalida|http_401)$/);
    });

    it('RN-INF-04: 5xx na sondagem não mexe na pausa', async () => {
      const { t } = await cenario('son-f', { haSegundos: PAUSA * 2 });
      const antes = await pausas(t);
      await ciclo(banco, agenda, hubDuble({ 'POST /sinal': [retentavel(503)] }), AGORA, [t]);
      expect(await pausas(t)).toEqual(antes);
    });

    it('log de aviso na sondagem e na pausa: só os campos permitidos, nunca a chave nem o conectorId', async () => {
      const { t } = await cenario('son-g', { haSegundos: PAUSA });
      const logs: Array<[Record<string, unknown>, string]> = [];
      const log = { warn: (c: Record<string, unknown>, m: string) => void logs.push([c, m]) };
      const posse = depois(120);
      const item: ItemAgenda = { tenant_id: t, tarefa: 'sinal', chave: null };
      const ctx: ContextoAgenda = { ...contextoDaAgenda(banco, item, hubDuble({ 'POST /sinal': [recusa(403, 'credencial_revogada')] }), AGORA, posse), ...({ log } as object) };
      await agenda.executar(item, ctx);
      expect(logs).toHaveLength(1);
      expect(Object.keys(logs[0]![0]).sort()).toEqual(['codigo_hub', 'entidade', 'http', 'motivo', 'resultado', 'tenant_id']);
      expect(logs[0]![0]).toMatchObject({ tenant_id: t, entidade: 'todas', motivo: 'credencial', codigo_hub: 'credencial_revogada', http: 403, resultado: 'sondagem_recusada' });
      const texto = JSON.stringify(logs);
      expect(texto).not.toContain(CHAVE_CLARA);
      expect(texto).not.toContain('conector-son-g');
    });
  });
});
