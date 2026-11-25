/**
 * F-8 (plano da v0.3.12; PF-2 da v0.3.13): a rota `GET /v1/integracao-fdv/clientes-recebidos` (e o `/exportar`) na API de
 * produção sobre o PostgreSQL efêmero (`montarApiPg`), com dois tenants de verdade:
 * - isolamento: o tenant B não vê nenhuma linha do A (nem pelo id do A como cursor), e vice-versa;
 * - RN-CORE-02: sem `integracao-fdv.ver` é 403 PERFIL_SEM_PERMISSAO; sem a licença do módulo, 403 MODULO_INATIVO;
 * - LGPD (F-9): a resposta não leva o documento inteiro nem o payload do pré-cadastro.
 * As linhas entram pelo admin com os mesmos campos que o worker grava (db/testes/pre-cadastro-0057.db.test.ts). Sem Postgres pula.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMINHOS_INTEGRACAO_FDV_TENANT,
  PERFIS,
  PERMISSOES,
  PaginaClientesRecebidosFdv,
} from '../../../packages/platform-sdk/src/index';
import { PG_DISPONIVEL } from '../../../packages/platform-sdk/src/pg-testes';
import { montarApiPg } from '../../apoio/api-pg';

const ROTA = `/v1${CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidos}`;
const DOCUMENTO = '11444777000161';
const SEM_VER = PERFIS.find((p) => !(PERMISSOES['integracao-fdv.ver'] as readonly string[]).includes(p));

describe.skipIf(!PG_DISPONIVEL)('F-8 — rota clientes-recebidos: isolamento, perfil e licença no PostgreSQL real', () => {
  let api: Awaited<ReturnType<typeof montarApiPg<'A' | 'B' | 'SEMLIC'>>>;
  const uuids = { A: [] as string[], B: [] as string[] };
  const ids = { A: [] as string[], B: [] as string[] };

  /** Uma revisão gravada como o worker grava (dados fictícios). */
  const inserir = async (tenant: string, situacao: 'recebido' | 'recusado' | 'aceito', razao: string) => {
    const uuid = randomUUID();
    const r = await api.b.admin.query<{ id: string }>(
      `INSERT INTO integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao, hash, codigo_fdv, razao_social,
         documento_mascarado, payload, recebido_em, situacao, motivo, erros, cliente_id, decidido_em, ultima_recusa_em)
       VALUES ($1, $2, 1, repeat('1', 64), '12345', $3, '11.444.777/****-**',
         CASE WHEN $4 = 'aceito' THEN NULL ELSE jsonb_build_object('documento', $5::text) END,
         '2026-11-24T10:00:00-04:00', $4,
         CASE WHEN $4 = 'recusado' THEN 'Documento inválido.' END,
         CASE WHEN $4 = 'recusado' THEN '[{"campo":"documento","codigo":"documento_invalido","mensagem":"Documento inválido."}]'::jsonb END,
         CASE WHEN $4 = 'aceito' THEN gen_random_uuid() END,
         CASE WHEN $4 IN ('aceito', 'recusado') THEN now() END,
         CASE WHEN $4 = 'recusado' THEN now() END)
       RETURNING id`,
      [tenant, uuid, razao, situacao, DOCUMENTO],
    );
    return { uuid, id: r.rows[0]!.id };
  };
  const ler = async (quem: 'A' | 'B' | 'SEMLIC', consulta = '', perfil?: (typeof PERFIS)[number]) =>
    api.chamar(quem, 'GET', `${ROTA}${consulta}`, undefined, perfil);

  beforeAll(async () => {
    api = await montarApiPg({ A: ['integracao-fdv'], B: ['integracao-fdv'], SEMLIC: [] });
    for (const [quem, sit] of [['A', 'recebido'], ['A', 'recusado'], ['A', 'aceito'], ['B', 'recusado']] as const) {
      const l = await inserir(api.t[quem], sit, `Mercadinho Fictício ${quem}`);
      uuids[quem].push(l.uuid);
      ids[quem].push(l.id);
    }
    await inserir(api.t.SEMLIC, 'recebido', 'Mercadinho Fictício SEMLIC');
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('cada tenant vê só as próprias linhas, no contrato PaginaClientesRecebidosFdv', async () => {
    for (const quem of ['A', 'B'] as const) {
      const r = await ler(quem);
      expect(r.statusCode, r.body).toBe(200);
      const pagina = PaginaClientesRecebidosFdv.parse(r.json());
      expect(pagina.itens.map((i) => i.cliente_uuid).sort()).toEqual([...uuids[quem]].sort());
      expect(r.body).not.toContain(quem === 'A' ? 'Fictício B' : 'Fictício A');
    }
  });

  it('o filtro por situação continua dentro do tenant; o id de uma linha de A como cursor de B não traz nada de A', async () => {
    const r = await ler('B', '?situacao=recusado');
    expect(PaginaClientesRecebidosFdv.parse(r.json()).itens.map((i) => i.cliente_uuid)).toEqual(uuids.B);
    const comCursorDeA = await ler('B', `?cursor=${ids.A[0]}`);
    // PF-5 (R-20261124-211940) pede 400 com o campo `cursor`; até a correção do dono, o mínimo é não vazar o A
    expect(comCursorDeA.body).not.toContain('Fictício A');
    for (const u of uuids.A) expect(comCursorDeA.body).not.toContain(u);
  });

  it('LGPD (F-9): nem a lista nem o CSV levam o documento inteiro nem o payload', async () => {
    const lista = await ler('A');
    const csv = await api.chamar('A', 'GET', `${ROTA}/exportar`);
    expect(csv.statusCode, csv.body).toBe(200);
    for (const r of [lista, csv]) {
      expect(r.body).not.toContain(DOCUMENTO);
      expect(r.body).not.toContain('payload');
    }
    expect(csv.body).not.toContain('Fictício B');
  });

  it('RN-CORE-02: perfil sem integracao-fdv.ver é 403 PERFIL_SEM_PERMISSAO na lista e no CSV', async () => {
    expect(SEM_VER, 'algum perfil não tem integracao-fdv.ver').toBeDefined();
    for (const url of [ROTA, `${ROTA}/exportar`]) {
      const r = await api.chamar('A', 'GET', url, undefined, SEM_VER);
      expect(r.statusCode, url).toBe(403);
      expect(r.json(), url).toMatchObject({ codigo: 'PERFIL_SEM_PERMISSAO' });
    }
  });

  it('RN-CORE-02: tenant sem a licença do integracao-fdv é 403 MODULO_INATIVO, mesmo com linhas gravadas', async () => {
    for (const url of [ROTA, `${ROTA}/exportar`]) {
      const r = await api.chamar('SEMLIC', 'GET', url);
      expect(r.statusCode, url).toBe(403);
      expect(r.json(), url).toMatchObject({ codigo: 'MODULO_INATIVO' });
      expect(r.body).not.toContain('Fictício');
    }
  });

  it('sem sessão é 401', async () => {
    expect((await api.app.inject({ method: 'GET', url: ROTA })).statusCode).toBe(401);
  });
});
