/**
 * T-0057 E2 (ADR 0014 §3 e §4): autenticação de máquina e plugin `/entrada/v1`, com o dublê da porta do B1 (a função
 * `cadastros.entrada_autenticar` ainda não existe). Dados fictícios.
 */
import { randomBytes } from 'node:crypto';
import {
  CABECALHO_CONECTOR_ID_ENTRADA,
  CODIGO_EMPRESA_INATIVA_ENTRADA,
  definirRotaEntrada,
  TRABALHO_ENTRADA_LOTE,
  type CredencialEntradaArmazenada,
  type Licenca,
  type PortaCredencialEntrada,
} from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, BancoMemoria, FilaDeTrabalhosMemoria, OutboxMemoria, RelogioFixo, tenantDaTx } from '@macuxierp/platform-sdk/testes';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarApp } from '../app';
import type { TenantAuth } from '../auth/portas';
import { RepositorioAuthMemoria } from '../auth/repositorio-memoria';
import { CONFIG_AUTH_PADRAO } from '../auth/servico';
import { emitirTokenAcesso } from '../auth/jwt';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE } from '../apoio-teste';
import { AutenticadorEntrada, hmacChaveEntrada, lerPepperEntrada, LIMITE_FALHAS_ENTRADA } from './autenticacao';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const OUTRO = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const CREDENCIAL = '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b';
const PEPPER = randomBytes(32);
const chave = () => randomBytes(32).toString('base64url');
const CHAVE = chave();
const CHAVE_OUTRO = chave();

const apps: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** Dublê da porta do B1: lê fora do tenant (`semTenant`), como a função SECURITY DEFINER. */
class PortaMemoria implements PortaCredencialEntrada {
  buscas = 0;
  constructor(readonly credenciais: Map<string, CredencialEntradaArmazenada>) {}
  async buscar(tx: unknown, conectorId: string) {
    expect(tenantDaTx(tx as never)).toBeNull();
    this.buscas++;
    return this.credenciais.get(conectorId) ?? null;
  }
}

async function montar(o: { pepper?: Buffer | null; licencas?: Licenca[]; semEntrada?: boolean; situacao?: TenantAuth['situacao'] } = {}) {
  const pepper = o.pepper === undefined ? PEPPER : o.pepper;
  const porta = new PortaMemoria(
    new Map([
      ['thathyany-erp', { tenant_id: TENANT, credencial_id: CREDENCIAL, chave_hmac: hmacChaveEntrada(PEPPER, CHAVE) }],
      ['outro-erp', { tenant_id: OUTRO, credencial_id: CREDENCIAL, chave_hmac: hmacChaveEntrada(PEPPER, CHAVE_OUTRO) }],
    ]),
  );
  const banco = new BancoMemoria();
  const trabalhos = new FilaDeTrabalhosMemoria();
  const relogio = new RelogioFixo(new Date('2026-11-27T02:00:00Z'));
  const vistos: { tenant: string | null; conector: string; cabecalhos: Record<string, string> }[] = [];
  const rotas = [
    definirRotaEntrada({
      metodo: 'POST',
      caminho: '/lotes',
      corpo: z.object({ entidade: z.string() }),
      executar: async (c, e) => {
        vistos.push({ tenant: tenantDaTx(c.tx), conector: c.conector.conector_id, cabecalhos: { ...e.cabecalhos } });
        const t = await c.enfileirar({ tipo: TRABALHO_ENTRADA_LOTE, payload: { entidade: e.corpo.entidade } });
        return { status: 202, corpo: { lote_id: t.id } };
      },
    }),
    definirRotaEntrada({
      metodo: 'GET',
      caminho: '/cursores/:entidade',
      executar: async (c, e) => ({ corpo: { entidade: e.params.entidade, tenant: tenantDaTx(c.tx), ip_origem: c.ip_origem } }),
    }),
    definirRotaEntrada({
      metodo: 'POST',
      caminho: '/sinal',
      executar: async (c) => c.enfileirar({ tipo: 'pedido.qualquer', payload: {} }).then(() => ({})),
    }),
  ];
  const repoAuth = new RepositorioAuthMemoria();
  repoAuth.tenants.push(
    { id: TENANT, slug: 'thathyany', razao_social: 'Empresa de Teste', fuso: 'America/Manaus', situacao: o.situacao ?? 'ativo' },
    { id: OUTRO, slug: 'outra', razao_social: 'Outra de Teste', fuso: 'America/Manaus', situacao: 'ativo' },
  );
  const app = await criarApp({
    versao: '0.1.0',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: JWT_SEGREDO_DE_TESTE, argon2: ARGON2_RAPIDO },
    cookieSeguro: true,
    banco,
    repoAuth,
    licencas: { ler: async () => o.licencas ?? [{ modulo: 'cadastros', ativo: true, valido_ate: null }] },
    outbox: new OutboxMemoria(),
    auditoria: new AuditoriaMemoria(),
    trabalhos,
    relogio,
    modulos: [],
    ...(o.semEntrada ? {} : { entrada: { rotas, autenticador: new AutenticadorEntrada(banco, porta, pepper) } }),
    logger: false,
  });
  apps.push(app);
  return { app, porta, trabalhos, vistos };
}

const cab = (conector: string, k: string) => ({ authorization: `Bearer ${k}`, [CABECALHO_CONECTOR_ID_ENTRADA]: conector });
const NEUTRO = { codigo: 'NAO_AUTENTICADO', mensagem: 'Credencial de conector inválida' };

describe('T-0057 E2: /entrada/v1 com autenticação de máquina', () => {
  it('chave certa: abre a transação no tenant da credencial, enfileira o trabalho do cadastros e a rota não vê o Authorization', async () => {
    const { app, trabalhos, vistos } = await montar();
    const r = await app.inject({ method: 'POST', url: '/entrada/v1/lotes', headers: cab('thathyany-erp', CHAVE), payload: { entidade: 'produto' } });
    expect(r.statusCode, r.body).toBe(202);
    expect(vistos).toEqual([{ tenant: TENANT, conector: 'thathyany-erp', cabecalhos: expect.objectContaining({ [CABECALHO_CONECTOR_ID_ENTRADA]: 'thathyany-erp' }) }]);
    expect(vistos[0]!.cabecalhos).not.toHaveProperty('authorization');
    expect(trabalhos.pedidos.map((t) => [t.tipo, t.tenant_id])).toEqual([[TRABALHO_ENTRADA_LOTE, TENANT]]);
    const g = await app.inject({ method: 'GET', url: '/entrada/v1/cursores/produto', headers: cab('outro-erp', CHAVE_OUTRO) });
    // o IP chega à rota já truncado (o inject usa 127.0.0.1)
    expect(g.json()).toEqual({ entidade: 'produto', tenant: OUTRO, ip_origem: '127.0.0.0/24' });
  });

  it('o mesmo 401 neutro para chave errada, chave de outro conector, conector inexistente, sem cabeçalho, fora do formato e JWT do BKO', async () => {
    const { app } = await montar();
    const jwt = emitirTokenAcesso({ usuario_id: CREDENCIAL, tenant_id: TENANT, perfil: 'administrador', filial_ids: [] }, JWT_SEGREDO_DE_TESTE, new Date('2026-11-27T02:00:00Z'), 900).token;
    const casos = [
      cab('thathyany-erp', chave()),
      cab('thathyany-erp', CHAVE_OUTRO),
      cab('nao-existe', CHAVE),
      { authorization: `Bearer ${CHAVE}` },
      cab('thathyany erp', CHAVE),
      cab('thathyany-erp', 'curta'),
      cab('thathyany-erp', jwt),
      { authorization: `Bearer ${jwt}` },
      {},
    ];
    for (const headers of casos) {
      const r = await app.inject({ method: 'POST', url: '/entrada/v1/lotes', headers, payload: { entidade: 'produto' } });
      expect(r.statusCode, JSON.stringify(headers)).toBe(401);
      expect(r.json()).toEqual(NEUTRO);
    }
  });

  it('sem o pepper (ou fora do formato): 503 em tudo, sem ler a credencial', async () => {
    const { app, porta } = await montar({ pepper: null });
    const r = await app.inject({ method: 'POST', url: '/entrada/v1/lotes', headers: cab('thathyany-erp', CHAVE), payload: { entidade: 'produto' } });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'INDISPONIVEL', request_id: r.headers['x-request-id'] });
    expect(porta.buscas).toBe(0);
    expect(lerPepperEntrada({})).toBeNull();
    expect(lerPepperEntrada({ MACUXIERP_PEPPER_ENTRADA: 'ab'.repeat(31) })).toBeNull();
    expect(lerPepperEntrada({ MACUXIERP_PEPPER_ENTRADA: PEPPER.toString('hex') })).toEqual(PEPPER);
  });

  it('regra 6: sem a licença do cadastros no tenant da credencial, 403 MODULO_INATIVO', async () => {
    const { app } = await montar({ licencas: [] });
    const r = await app.inject({ method: 'POST', url: '/entrada/v1/lotes', headers: cab('thathyany-erp', CHAVE), payload: { entidade: 'produto' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    expect(r.json()).not.toHaveProperty('request_id'); // só os 5xx levam o request_id no corpo
  });

  it.each(['suspenso', 'encerrado'] as const)('ADR 0014 §1: empresa %s responde 403 EMPRESA_INATIVA antes da licença, sem chamar a rota', async (situacao) => {
    const { app, vistos, trabalhos } = await montar({ situacao });
    const r = await app.inject({ method: 'POST', url: '/entrada/v1/lotes', headers: cab('thathyany-erp', CHAVE), payload: { entidade: 'produto' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: CODIGO_EMPRESA_INATIVA_ENTRADA });
    expect([vistos, trabalhos.pedidos]).toEqual([[], []]);
  });

  it('a rota só enfileira trabalho do cadastros: tipo de outro módulo é erro interno, sem gravar', async () => {
    const { app, trabalhos } = await montar();
    const r = await app.inject({ method: 'POST', url: '/entrada/v1/sinal', headers: cab('thathyany-erp', CHAVE), payload: {} });
    expect(r.statusCode).toBe(500);
    expect(trabalhos.pedidos).toEqual([]);
  });

  it('limite de falhas por IP e conector: depois de 20 falhas, 429 com Retry-After, mesmo com a chave certa', async () => {
    const { app, porta } = await montar();
    for (let i = 0; i < LIMITE_FALHAS_ENTRADA.maximo; i++) {
      const r = await app.inject({ method: 'GET', url: '/entrada/v1/cursores/produto', headers: cab('thathyany-erp', chave()) });
      expect(r.statusCode).toBe(401);
    }
    const buscas = porta.buscas;
    const r = await app.inject({ method: 'GET', url: '/entrada/v1/cursores/produto', headers: cab('thathyany-erp', CHAVE) });
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(porta.buscas).toBe(buscas);
    // outro conector do mesmo IP não é travado
    expect((await app.inject({ method: 'GET', url: '/entrada/v1/cursores/produto', headers: cab('outro-erp', CHAVE_OUTRO) })).statusCode).toBe(200);
  });

  it('sem `entrada` nas dependências, o prefixo não existe (404)', async () => {
    const { app } = await montar({ semEntrada: true });
    expect((await app.inject({ method: 'POST', url: '/entrada/v1/lotes', headers: cab('thathyany-erp', CHAVE), payload: {} })).statusCode).toBe(404);
  });
});
