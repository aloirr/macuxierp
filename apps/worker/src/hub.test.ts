/** Configuração do cliente do Hub no worker (T-0009 §6): lista fixa por ambiente, tudo ou nada. */
import { describe, expect, it } from 'vitest';
import { configurarHub, versaoDoErp } from './hub';

const OK = { MACUXIERP_HUB_URL_TESTE: 'https://hub-teste.exemplo.com.br', MACUXIERP_HUB_URL_PRODUCAO: 'https://hub.exemplo.com.br' };

describe('configurarHub', () => {
  it('sem as duas URLs: laço de agenda desligado (null)', () => {
    expect(configurarHub({}, '0.1.0')).toBeNull();
    expect(configurarHub({ MACUXIERP_HUB_URL_TESTE: ' ', MACUXIERP_HUB_URL_PRODUCAO: '' }, '0.1.0')).toBeNull();
  });

  it('com as duas https: cliente que chama a base do ambiente da credencial', async () => {
    const urls: string[] = [];
    const f = (async (u: URL | string) => {
      urls.push(String(u));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const hub = configurarHub(OK, '0.1.0', f);
    await hub?.chamar({ conectorId: 'c1', chave: 'k', ambiente: 'producao' }, { metodo: 'POST', caminho: '/sinal', corpo: {} });
    expect(urls).toEqual(['https://hub.exemplo.com.br/integracao/v1/sinal']);
  });

  it('as duas URLs do compose.yml (v0.1.1): base com o /integracao/v1 final, sem duplicá-lo', async () => {
    const urls: string[] = [];
    const f = (async (u: URL | string) => {
      urls.push(String(u));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const hub = configurarHub(
      { MACUXIERP_HUB_URL_TESTE: 'https://hub-teste.invalid/integracao/v1', MACUXIERP_HUB_URL_PRODUCAO: 'https://api.macuxifdv.com.br/integracao/v1' },
      '0.1.1',
      f,
    );
    await hub?.chamar({ conectorId: 'c1', chave: 'k', ambiente: 'teste' }, { metodo: 'GET', caminho: '/pedidos/pendentes?limite=10' });
    await hub?.chamar({ conectorId: 'c1', chave: 'k', ambiente: 'producao' }, { metodo: 'POST', caminho: '/sinal', corpo: {} });
    expect(urls).toEqual(['https://hub-teste.invalid/integracao/v1/pedidos/pendentes?limite=10', 'https://api.macuxifdv.com.br/integracao/v1/sinal']);
  });

  it('só uma URL ou URL sem https derruba a partida', () => {
    expect(() => configurarHub({ MACUXIERP_HUB_URL_TESTE: OK.MACUXIERP_HUB_URL_TESTE }, '0.1.0')).toThrow(/vão juntas/);
    expect(() => configurarHub({ ...OK, MACUXIERP_HUB_URL_PRODUCAO: 'http://hub.exemplo.com.br' }, '0.1.0')).toThrow(/url_invalida/);
  });
});

describe('versaoDoErp', () => {
  it('MACUXIERP_VERSAO sem o v inicial; ausente ou vazia → dev; fora do padrão derruba a partida', () => {
    expect(versaoDoErp({ MACUXIERP_VERSAO: 'v1.2.3' })).toBe('1.2.3');
    expect(versaoDoErp({ MACUXIERP_VERSAO: ' 0.4.0-rc.1 ' })).toBe('0.4.0-rc.1');
    expect(versaoDoErp({})).toBe('dev');
    expect(versaoDoErp({ MACUXIERP_VERSAO: '' })).toBe('dev');
    expect(versaoDoErp({ MACUXIERP_VERSAO: 'v' })).toBe('dev');
    expect(() => versaoDoErp({ MACUXIERP_VERSAO: '1.0\r\nX: y' })).toThrow(/^configuração inválida: MACUXIERP_VERSAO$/);
  });
});
