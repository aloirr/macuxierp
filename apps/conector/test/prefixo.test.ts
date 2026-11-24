/** ADR 0014 §6 item 1: `hub.prefixo` configurável (padrão `/entrada/v1` do Macuxi ERP); a URL continua só HTTPS (HTTP só localhost). */
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigConector } from '../src/config/esquema';
import { PREFIXO_PADRAO } from '../src/contrato';
import { ClienteHub, ErroHubTransitorio } from '../src/hub/cliente';
import { HubFalso } from './suporte/hub-falso';

const base = (hub: Record<string, unknown>) => ({
  hub: { conectorId: 'cnx-teste-01', url: 'https://erp.exemplo.com.br', ...hub },
  erp: { tipo: 'postgres', host: 'h', banco: 'b', usuario: 'u' },
  entidades: {},
});
const mensagens = (hub: Record<string, unknown>) => {
  const r = ConfigConector.safeParse(base(hub));
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('hub.prefixo no esquema da configuração', () => {
  it('sem hub.prefixo vale o padrão /entrada/v1', () => {
    expect(PREFIXO_PADRAO).toBe('/entrada/v1');
    expect(ConfigConector.parse(base({})).hub.prefixo).toBe('/entrada/v1');
  });

  it('aceita um prefixo próprio que começa com "/" e não termina em "/"', () => {
    expect(ConfigConector.parse(base({ prefixo: '/integracao/v1' })).hub.prefixo).toBe('/integracao/v1');
    expect(ConfigConector.parse(base({ prefixo: '/api/entrada_dados/v2' })).hub.prefixo).toBe('/api/entrada_dados/v2');
  });

  it('recusa prefixo inválido com a orientação: sem "/" no início, com "/" no fim, "//", vazio, query ou espaço', () => {
    for (const prefixo of ['entrada/v1', '/entrada/v1/', '/entrada//v1', '', '/', '/entrada/v1?x=1', '/entrada v1', 'https://erp.exemplo.com.br/entrada/v1']) {
      expect(mensagens({ prefixo }), prefixo).toEqual([expect.stringMatching(/^hub\.prefixo: hub\.prefixo começa com "\/"/)]);
    }
  });

  it('a URL continua só HTTPS; HTTP só em localhost', () => {
    expect(mensagens({ url: 'http://erp.exemplo.com.br' })).toEqual([expect.stringMatching(/precisa de HTTPS/)]);
    expect(mensagens({ url: 'http://127.0.0.1:8080' })).toEqual([]);
    expect(mensagens({ url: 'http://localhost:8080', prefixo: '/x/v1' })).toEqual([]);
  });
});

describe('ClienteHub monta as rotas com o prefixo', () => {
  let hub: HubFalso | undefined;
  afterEach(async () => hub?.parar());

  const cliente = (h: HubFalso, prefixo?: string) =>
    new ClienteHub({ url: `${h.url}/`, ...(prefixo ? { prefixo } : {}), token: async () => h.token, conectorId: 'cnx-teste-01', retry: { tentativas: 1, baseMs: 1, maxMs: 2 } });

  it('padrão: chama /entrada/v1/...', async () => {
    hub = await HubFalso.iniciar();
    await cliente(hub).consultarCursor('cliente');
    expect(hub.chamadas.map((c) => c.caminho)).toEqual(['/entrada/v1/cursores/cliente']);
  });

  it('prefixo próprio: chama <prefixo>/... (cursor, sinal e pedidos)', async () => {
    hub = await HubFalso.iniciar();
    hub.prefixo = '/integracao/v1';
    const c = cliente(hub, '/integracao/v1');
    await c.consultarCursor('produto');
    await c.pedidosPendentes();
    expect(hub.chamadas.map((x) => x.caminho)).toEqual(['/integracao/v1/cursores/produto', '/integracao/v1/pedidos/pendentes']);
  });

  it('prefixo diferente do servidor: a rota não existe (404) e o Conector trata como resposta inesperada, sem dado', async () => {
    hub = await HubFalso.iniciar();
    await expect(cliente(hub, '/outro/v9').consultarCursor('cliente')).rejects.toBeInstanceOf(ErroHubTransitorio);
    expect(hub.chamadas[0]?.caminho).toBe('/outro/v9/cursores/cliente');
  });
});
