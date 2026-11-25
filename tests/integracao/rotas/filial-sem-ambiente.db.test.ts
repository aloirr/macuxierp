/**
 * D-2 da v0.3.12 (docs/testes/plano-v0.3.12.md): o ambiente fiscal da filial não muda pela edição de cadastro. A única
 * escrita do ambiente é o `PUT /v1/core/ambientes-fiscais/:filial_id` da T-0030 (RN-CORE-08); a produção só com a aprovação
 * do Alexandre (CLAUDE.md, regra 7).
 *
 * Comportamento REAL medido em 2026-11-24 (API de produção, Postgres): `PATCH /v1/cadastros/filiais/:id` usa o
 * `FilialAtualizacao` (Zod sem `.strict()`), então o campo `ambiente` é DESCARTADO em silêncio, com 200, e não recusado.
 * O teste trava o que importa (o ambiente segue homologação, nada grava em core.ambiente_fiscal, a resposta não traz o
 * campo) e o 200 de hoje; se o produto passar a recusar o campo (400 do Zod com o campo), troque o esperado do status.
 * Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { filialValida } from '../../../modules/cadastros/api/fixtures-teste';
import { montarApiPg } from '../../apoio/api-pg';

describe.skipIf(!PG_DISPONIVEL)('D-2: PATCH de filial com `ambiente` não troca o ambiente fiscal (RN-CORE-08, Postgres)', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'E'>>>;
  let filial: string;

  const ambienteDaApi = async () => {
    const g = await api.chamar('E', 'GET', `/v1/core/ambientes-fiscais?filial_id=${filial}`);
    expect(g.statusCode, g.body).toBe(200);
    return g.json<{ itens: { filial_id: string; ambiente: string }[] }>().itens;
  };
  const linhasDoAmbiente = async () =>
    (await api.b.admin.query('SELECT ambiente FROM core.ambiente_fiscal WHERE filial_id = $1', [filial])).rows;

  beforeAll(async () => {
    api = await montarApiPg({ E: ['cadastros'] });
    const r = await api.chamar('E', 'POST', '/v1/cadastros/filiais', filialValida());
    expect(r.statusCode, r.body).toBeLessThan(300);
    filial = r.json<{ id: string }>().id;
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it.each([
    ['só o ambiente', { ambiente: 'producao' }],
    ['ambiente junto com outro campo', { ambiente: 'producao', razao_social: 'Filial Ficticia D2 Ltda' }],
  ])('%s: 200 com o campo descartado; o ambiente segue homologação', async (_nome, corpo) => {
    const r = await api.chamar('E', 'PATCH', `/v1/cadastros/filiais/${filial}`, corpo);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<Record<string, unknown>>()).not.toHaveProperty('ambiente');
    expect(await linhasDoAmbiente()).toEqual([]);
    expect(await ambienteDaApi()).toEqual([{ filial_id: filial, ambiente: 'homologacao', recado_aprovacao: null }]);
  });

  it('o outro campo do mesmo PATCH é gravado (o descarte é só do `ambiente`)', async () => {
    const g = await api.chamar('E', 'GET', `/v1/cadastros/filiais/${filial}`);
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json<{ razao_social: string }>().razao_social).toBe('Filial Ficticia D2 Ltda');
  });
});
