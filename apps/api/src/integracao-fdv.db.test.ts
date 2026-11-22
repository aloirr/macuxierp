/**
 * Integração FDV montada na API (T-0011): as dependências de produção (`montarDependenciasProducao`, papel `macuxierp_app`, RLS)
 * com e sem a `MACUXIERP_CHAVE_INTEGRACAO`. Com a chave, o `PUT /v1/integracao-fdv/credencial` grava a credencial cifrada
 * (AES-256-GCM, AAD = tenant, versão 1) e a resposta, o log e a auditoria não levam a chave do conector; sem ela, 503
 * `CHAVE_INTEGRACAO_AUSENTE` e nada é gravado. Nenhuma chamada ao Hub: a rota só grava no banco (trava R-20261122-020834).
 * Chaves geradas no teste. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { decifrarCampo } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';

const LICENCAS = ['cadastros', 'pedido', 'integracao-fdv'];

describe.skipIf(!PG_DISPONIVEL)('integração FDV montada na API: PUT /credencial com e sem a chave mestra (PostgreSQL)', () => {
  let b: BancoEfemero;
  let comChave: FastifyInstance;
  let semChave: FastifyInstance;
  let tenantCom: string;
  let tenantSem: string;
  const chaveMestra = randomBytes(32);
  const chaveConector = `mfdv_${randomBytes(24).toString('hex')}`;
  const linhas: string[] = [];
  const destino = new Writable({ write: (c, _e, cb) => (linhas.push(String(c)), cb()) });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenantCom = await criarTenant(b.admin, 'loja-com-chave', LICENCAS);
    tenantSem = await criarTenant(b.admin, 'loja-sem-chave', LICENCAS);
    await inserirAdministradorDeTeste(b.admin, tenantCom, { id: randomUUID(), email: 'adm@loja-com-chave.teste', nome: 'Administradora', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, tenantSem, { id: randomUUID(), email: 'adm@loja-sem-chave.teste', nome: 'Administradora', filialIds: [] });
    ({ app: comChave } = await appPgDeTeste({ b, modulos: 'producao', chaveIntegracao: chaveMestra, logger: { stream: destino } }));
    ({ app: semChave } = await appPgDeTeste({ b, modulos: 'producao', logger: { stream: destino } }));
  });
  afterAll(async () => {
    await comChave?.close();
    await semChave?.close();
    await b?.remover();
  });

  async function token(app: FastifyInstance, empresa: string): Promise<string> {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa, email: `adm@${empresa}.teste`, senha: SENHA_DE_TESTE } });
    expect(r.statusCode).toBe(200);
    return `Bearer ${r.json<{ token_acesso: string }>().token_acesso}`;
  }
  const corpo = () => ({ conector_id: 'conector-teste', chave: chaveConector, ambiente: 'teste' });

  it('com a chave mestra: 201, credencial cifrada com a versão 1 e só o prefixo visível; a chave não sai na resposta, no log nem na auditoria', async () => {
    const auth = await token(comChave, 'loja-com-chave');
    const r = await comChave.inject({ method: 'PUT', url: '/v1/integracao-fdv/credencial', headers: { authorization: auth }, payload: corpo() });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ conector_id: 'conector-teste', ambiente: 'teste', chave_prefixo: chaveConector.slice(0, 8) });
    expect(r.body).not.toContain(chaveConector);

    const { rows } = await b.admin.query(
      'SELECT chave_cifrada, chave_mestra_versao FROM integracao_fdv.credencial WHERE tenant_id = $1 AND substituida_em IS NULL',
      [tenantCom],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].chave_mestra_versao).toBe(1);
    expect(Buffer.from(rows[0].chave_cifrada).toString('latin1')).not.toContain(chaveConector);
    expect(decifrarCampo({ chave: chaveMestra, tenantId: tenantCom, cifrado: rows[0].chave_cifrada }).toString('utf8')).toBe(chaveConector);

    const monitor = await comChave.inject({ method: 'GET', url: '/v1/integracao-fdv/monitor', headers: { authorization: auth } });
    expect(monitor.statusCode).toBe(200);
    expect(monitor.body).not.toContain(chaveConector);

    const auditoria = await b.admin.query('SELECT antes::text AS antes, depois::text AS depois FROM plataforma.auditoria WHERE tenant_id = $1', [tenantCom]);
    expect(auditoria.rows.length).toBeGreaterThan(0);
    for (const segredo of [chaveConector, chaveMestra.toString('hex'), chaveMestra.toString('base64'), SENHA_DE_TESTE]) {
      expect(linhas.join('')).not.toContain(segredo);
      expect(JSON.stringify(auditoria.rows)).not.toContain(segredo);
    }
  });

  it('sem a chave mestra: a API sobe, o monitor responde e o PUT /credencial dá 503 CHAVE_INTEGRACAO_AUSENTE sem gravar nada', async () => {
    const auth = await token(semChave, 'loja-sem-chave');
    const monitor = await semChave.inject({ method: 'GET', url: '/v1/integracao-fdv/monitor', headers: { authorization: auth } });
    expect(monitor.statusCode).toBe(200);
    const r = await semChave.inject({ method: 'PUT', url: '/v1/integracao-fdv/credencial', headers: { authorization: auth }, payload: corpo() });
    expect([r.statusCode, r.json().codigo]).toEqual([503, 'CHAVE_INTEGRACAO_AUSENTE']);
    expect(r.body).not.toContain(chaveConector);
    const { rows } = await b.admin.query('SELECT count(*)::int AS n FROM integracao_fdv.credencial WHERE tenant_id = $1', [tenantSem]);
    expect(rows[0].n).toBe(0);
    expect(linhas.join('')).not.toContain(chaveConector);
  });
});
