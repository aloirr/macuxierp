/**
 * T-0012/T-0017: a segunda barreira da trava de escrita no Hub real (recado R-20261122-020834-gerente-projetos,
 * 22/11/2026 02h08 de Manaus) — a guarda do transporte (`apoio/trava-escrita.ts`). Sem rede: o `fetch` é falso e conta
 * as chamadas, para provar que a guarda recusa ANTES de chamar; a chave é gerada na hora (formato `mxc_`).
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetornoErp } from '../../modules/integracao-fdv/contracts/index';
import { clienteDoSdk, criarAdaptadorConector } from './apoio/adaptador-conector';
import { criarClienteHubPedidos } from './apoio/cliente-hub-pedidos';
import { CredencialHub, lerConfigHub, URL_HUB_PADRAO } from './apoio/config';
import { ORDEM_CARGA_HUB } from './apoio/contrato-hub';
import { gerarChaveConector } from './apoio/duble-hub';
import { transporteFetch } from './apoio/emissor-minimo';
import { RelogioDeTeste } from './apoio/relogio';
import {
  ehChaveMacuxierp,
  ehDubleLocal,
  ehLeituraPermitida,
  ErroTravaEscrita,
  exigirLeitura,
  guardarFetch,
  LEITURAS_PERMITIDAS,
  travaAtiva,
} from './apoio/trava-escrita';

const BASE = URL_HUB_PADRAO;
const DUBLE = 'http://127.0.0.1:9/integracao/v1';
const UUID = randomUUID();
const TRAVA = /trava de escrita no Hub real \(recado R-20261122-020834-gerente-projetos/;
const AGORA = new Date('2026-11-22T06:00:00.000Z');

/** `fetch` falso: nunca vai à rede, conta as chamadas e responde 200 com JSON vazio. */
function fetchFalso() {
  return vi.fn(async (_e: string | URL | Request, _i?: RequestInit) =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

/** Pedidos que são escrita (ou fora da lista fechada) e têm de ser recusados. */
const ESCRITAS: [string, string][] = [
  ['POST', '/lotes'],
  ['GET', '/pedidos/pendentes'],
  ['GET', '/pedidos/pendentes?limite=1'],
  ['POST', `/pedidos/${UUID}/retorno`],
  ['POST', '/sinal'],
  ['POST', '/sessoes'],
  ['POST', '/reconciliacoes'],
  ['PUT', `/lotes/${UUID}`],
  ['DELETE', `/lotes/${UUID}`],
  ['PATCH', '/cursores/filial'],
  ['HEAD', '/cursores/filial'],
  ['POST', '/cursores/filial'],
  ['GET', '/lotes'],
  ['GET', `/lotes/${UUID}`],
  ['GET', `/lotes/${UUID.toUpperCase()}`],
  ['GET', `/lotes/${UUID}?limite_erros=5500`],
  ['GET', '/lotes/nao-e-uuid'],
  ['GET', `/lotes/${UUID}/erros`],
  ['GET', `/lotes/${UUID}?limite_erros=5&outro=1`],
  ['GET', `/lotes/${UUID}?limite_erros=abc`],
  ['GET', `/lotes/${UUID}?limite_erros=1&limite_erros=2`],
  ['GET', '/cursores/inexistente'],
  ['GET', '/cursores/filial?x=1'],
  ['GET', '/cursores/%66ilial'],
  ['GET', '/cursores/../lotes'],
  ['GET', '/cursores'],
  ['GET', '/pedidos'],
];
const LEITURAS: string[] = ['/cursores/filial', '/cursores/forma_pagamento'];

describe('T-0012 — lista fechada de leitura da trava de escrita', () => {
  it('a lista fechada tem só GET /cursores/{entidade}', () => {
    expect(LEITURAS_PERMITIDAS.map((l) => `${l.metodo} ${l.rota}`)).toEqual(['GET /cursores/{entidade}']);
    for (const e of ORDEM_CARGA_HUB) expect(ehLeituraPermitida('GET', `/cursores/${e}`)).toBe(true);
    for (const c of LEITURAS) expect(ehLeituraPermitida('GET', c)).toBe(true);
    expect(ehLeituraPermitida('get', '/cursores/filial')).toBe(true);
  });

  it('recusa toda escrita e tudo o que não está na lista, com a mensagem da trava e sem o uuid', () => {
    for (const [m, c] of ESCRITAS) {
      expect(ehLeituraPermitida(m, c), `${m} ${c}`).toBe(false);
      expect(() => exigirLeitura(m, c)).toThrow(ErroTravaEscrita);
      try {
        exigirLeitura(m, c);
      } catch (e) {
        expect((e as Error).message).toMatch(TRAVA);
        expect((e as Error).message).not.toContain(UUID);
      }
    }
  });

  it('"da chave macuxierp": o perfil thathyany-seguro ou o Conector macuxierp, sem maiúsculas nem espaços', () => {
    expect(ehChaveMacuxierp('thathyany-seguro', 'qualquer')).toBe(true);
    for (const c of ['macuxierp', 'MACUXIERP', ' Macuxi ERP ', 'macuxi\terp'])
      expect(ehChaveMacuxierp('tenant-teste', c)).toBe(true);
    for (const c of ['macuxierp-teste', 'macuxierp2', 'erp']) expect(ehChaveMacuxierp('tenant-teste', c)).toBe(false);
  });

  it('o dublê local é só http://127.0.0.1:<porta>; o resto é tratado como Hub real', () => {
    expect(ehDubleLocal(DUBLE)).toBe(true);
    expect(ehDubleLocal('http://127.0.0.1:43210')).toBe(true);
    for (const u of [BASE, 'http://127.0.0.1.exemplo.com:80/integracao/v1', 'https://127.0.0.1:443/integracao/v1', 'http://localhost:9/integracao/v1'])
      expect(ehDubleLocal(u)).toBe(false);
  });
});

describe('T-0012 — guarda do fetch do alvo real: lança antes de qualquer rede', () => {
  it('deixa passar só o GET de cursor, uma chamada cada', async () => {
    const falso = fetchFalso();
    const g = guardarFetch(falso);
    for (const c of LEITURAS) expect((await g(`${BASE}${c}`, { method: 'GET' })).status).toBe(200);
    expect((await g(new URL(`${BASE}/cursores/cliente`))).status).toBe(200);
    expect(falso).toHaveBeenCalledTimes(LEITURAS.length + 1);
  });

  it('recusa POST /lotes, GET /pedidos/pendentes, POST /pedidos/{uuid}/retorno e o resto fora da lista, sem chamar o fetch', async () => {
    const falso = fetchFalso();
    const g = guardarFetch(falso);
    for (const [m, c] of ESCRITAS) await expect(g(`${BASE}${c}`, { method: m }), `${m} ${c}`).rejects.toThrow(TRAVA);
    await expect(g(new Request(`${BASE}/lotes`, { method: 'POST', body: '{}' }))).rejects.toThrow(ErroTravaEscrita);
    // GET com corpo, URL fora de /integracao/v1, com fragmento ou inválida
    await expect(g(`${BASE}/cursores/filial`, { method: 'GET', body: '{}' })).rejects.toThrow(ErroTravaEscrita);
    await expect(g('https://api.macuxifdv.com.br/cursores/filial')).rejects.toThrow(ErroTravaEscrita);
    await expect(g(`${BASE}/cursores/filial#x`)).rejects.toThrow(ErroTravaEscrita);
    await expect(g('não é url')).rejects.toThrow(ErroTravaEscrita);
    expect(falso).not.toHaveBeenCalled();
  });
});

describe('T-0012/T-0017 — os transportes do arnês contra o Hub real passam pela guarda', () => {
  let falso: ReturnType<typeof fetchFalso>;
  const travada = () => new CredencialHub('macuxierp', gerarChaveConector());
  /** A escrita só sai liberada pelo `lerConfigHub` (tenant-teste, outro Conector, LIBERA_ESCRITA=1). */
  const liberada = (conector = 'erp-teste') => {
    const c = lerConfigHub({
      MACUXI_HUB_ALVO: 'real',
      MACUXI_HUB_PERFIL: 'tenant-teste',
      MACUXI_HUB_CHAVE_TENANT_TESTE: gerarChaveConector(),
      MACUXI_HUB_CONECTOR_ID_TENANT_TESTE: conector,
      MACUXI_HUB_TENANT: 'tenant de teste',
      MACUXI_HUB_TENANT_TESTE: '1',
      MACUXI_HUB_LIBERA_ESCRITA: '1',
    });
    if (c.alvo !== 'real' || !c.credencial.escritaLiberada) throw new Error('credencial liberada esperada');
    return c.credencial;
  };
  const retorno = { status: 'integrado', numero_erp: 'P-1' } as unknown as RetornoErp;
  beforeEach(() => {
    falso = fetchFalso();
    vi.stubGlobal('fetch', falso);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cliente da volta (SDK): GET /pedidos/pendentes e POST /pedidos/{uuid}/retorno lançam a trava sem chamar o fetch', async () => {
    const hub = criarClienteHubPedidos({ url: BASE, credencial: travada(), versaoErp: 'dev' });
    await expect(hub.pendentes(1)).rejects.toThrow(TRAVA);
    await expect(hub.enviarRetorno(UUID, retorno)).rejects.toThrow(TRAVA);
    expect(hub.chamadas).toEqual([]);
    expect(falso).not.toHaveBeenCalled();
  });

  it('cliente do SDK (lado conector): POST /lotes e GET /lotes/{uuid} lançam; só o GET de cursor sai pelo fetch guardado', async () => {
    const { cliente, cred } = clienteDoSdk({ url: BASE, credencial: travada(), versaoErp: 'dev' });
    await expect(cliente.chamar(cred, { metodo: 'POST', caminho: '/lotes', corpo: {} })).rejects.toThrow(TRAVA);
    await expect(
      cliente.chamar(cred, { metodo: 'GET', caminho: `/lotes/${UUID}?limite_erros=5500` }),
    ).rejects.toThrow(TRAVA);
    expect(falso).not.toHaveBeenCalled();
    expect(await cliente.chamar(cred, { metodo: 'GET', caminho: '/cursores/filial' })).toMatchObject({ tipo: 'ok' });
    expect(falso).toHaveBeenCalledTimes(1);
    expect(String(falso.mock.calls[0]![0])).toBe(`${BASE}/cursores/filial`);
  });

  it('adaptador conector: publicar um lote no real travado lança a trava sem chamar o fetch', async () => {
    const lado = criarAdaptadorConector({
      url: BASE,
      credencial: travada(),
      versaoErp: 'dev',
      relogio: new RelogioDeTeste(AGORA),
      log: () => {},
    });
    await expect(
      lado.publicar({
        entidade: 'forma_pagamento',
        modo: 'delta',
        registros: [{ external_id: 'fp-1', alterado_em: AGORA.toISOString(), ativo: true, nome: 'Fictícia' }],
      }),
    ).rejects.toThrow(TRAVA);
    expect(falso).not.toHaveBeenCalled();
  });

  it('emissor mínimo: POST /lotes e GET /pedidos/pendentes lançam; GET de cursor passa', async () => {
    const t = transporteFetch({ url: BASE, credencial: travada(), versaoErp: 'dev', relogio: new RelogioDeTeste(AGORA) });
    await expect(t.chamar('POST', '/lotes', {}, 'chave-1')).rejects.toThrow(TRAVA);
    await expect(t.chamar('GET', '/pedidos/pendentes?limite=1')).rejects.toThrow(TRAVA);
    expect(falso).not.toHaveBeenCalled();
    expect(await t.chamar('GET', '/cursores/filial')).toMatchObject({ tipo: 'ok', status: 200 });
    expect(falso).toHaveBeenCalledTimes(1);
  });

  it('com a escrita liberada pela configuração (tenant-teste, outro Conector, LIBERA_ESCRITA=1), o real escreve', async () => {
    const { cliente, cred } = clienteDoSdk({ url: BASE, credencial: liberada(), versaoErp: 'dev' });
    expect(await cliente.chamar(cred, { metodo: 'POST', caminho: '/lotes', corpo: {} })).toMatchObject({ tipo: 'ok' });
    const t = transporteFetch({ url: BASE, credencial: liberada(), versaoErp: 'dev', relogio: new RelogioDeTeste(AGORA) });
    expect(await t.chamar('POST', '/lotes', {}, 'chave-1')).toMatchObject({ tipo: 'ok' });
    expect(falso).toHaveBeenCalledTimes(2);
  });

  it('defesa em profundidade: com o Conector macuxierp, nem uma credencial liberada escreve no transporte', async () => {
    // o lerConfigHub nunca libera o Conector macuxierp; aqui, uma credencial forjada simula esse erro de configuração
    const chave = gerarChaveConector();
    const forjada = {
      conectorId: ' MacuxiERP ',
      escritaLiberada: true,
      autorizacao: () => `Bearer ${chave}`,
      chaveParaCabecalho: () => chave,
    } as unknown as CredencialHub;
    expect(travaAtiva(BASE, forjada)).toBe(true);
    expect(travaAtiva(DUBLE, forjada)).toBe(false);
    expect(travaAtiva(BASE, liberada())).toBe(false);
    expect(travaAtiva(BASE, travada())).toBe(true);
    expect(travaAtiva(BASE, { conectorId: 'erp-teste', escritaLiberada: false })).toBe(true);
    const { cliente, cred } = clienteDoSdk({ url: BASE, credencial: forjada, versaoErp: 'dev' });
    await expect(cliente.chamar(cred, { metodo: 'POST', caminho: '/lotes', corpo: {} })).rejects.toThrow(TRAVA);
    const t = transporteFetch({ url: BASE, credencial: forjada, versaoErp: 'dev', relogio: new RelogioDeTeste(AGORA) });
    await expect(t.chamar('POST', '/lotes', {}, 'chave-1')).rejects.toThrow(TRAVA);
    expect(falso).not.toHaveBeenCalled();
  });

  it('o dublê local não muda nada: escrita sem restrição, mesmo com a credencial sem a escrita liberada', async () => {
    const hub = criarClienteHubPedidos({ url: DUBLE, credencial: travada(), versaoErp: 'dev' });
    expect((await hub.pendentes(1)).status).toBe(200);
    expect((await hub.enviarRetorno(UUID, retorno)).status).toBe(200);
    const t = transporteFetch({ url: DUBLE, credencial: travada(), versaoErp: 'dev', relogio: new RelogioDeTeste(AGORA) });
    expect(await t.chamar('POST', '/lotes', {}, 'chave-1')).toMatchObject({ tipo: 'ok' });
    expect(falso).toHaveBeenCalledTimes(3);
    expect(String(falso.mock.calls[0]![0])).toMatch(/^http:\/\/127\.0\.0\.1:9\/integracao\/v1\/pedidos\/pendentes/);
  });
});
