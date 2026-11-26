import { describe, expect, it } from 'vitest';
import { consultaDaTela, trocarFiltro, urlProxima } from './listas-url';

const ID1 = '11111111-1111-4111-8111-111111111111';

describe('filtros e URLs da lista', () => {
  it('junta as chaves da página com cursor e limite; busca e inativos só se declarados', () => {
    const q = `?busca=ana&uf=AM&x=1&inativos=true&limite=20&cursor=${ID1}`;
    expect(consultaDaTela(q, ['uf', 'busca'])).toEqual({ uf: 'AM', busca: 'ana', limite: '20', cursor: ID1 });
    expect(consultaDaTela(q, ['uf'])).toEqual({ uf: 'AM', limite: '20', cursor: ID1 });
  });
  it('urlProxima leva o cursor e mantém busca/filtros', () => {
    expect(urlProxima('/core/usuarios', { busca: 'ana', uf: 'AM' }, ID1)).toBe(`/core/usuarios?busca=ana&cursor=${ID1}&uf=AM`);
  });
  it('última página (null) não tem próxima', () => {
    expect(urlProxima('/x', { busca: 'a' }, null)).toBeNull();
  });
  it('trocarFiltro zera o cursor', () => {
    const f = { busca: 'a', cursor: ID1 };
    expect(trocarFiltro(f, 'uf', 'AM')).toEqual({ busca: 'a', uf: 'AM' });
    expect(trocarFiltro(f, 'busca', '')).toEqual({});
  });
  it('trocarFiltro com chave cursor remove o cursor', () => {
    expect(trocarFiltro({ busca: 'a', cursor: ID1 }, 'cursor', ID1)).toEqual({ busca: 'a' });
  });
  it('chave repetida: a primeira vence', () => {
    expect(consultaDaTela('?uf=AM&uf=SP', ['uf'])).toEqual({ uf: 'AM' });
  });
  it('inativos só entra com o valor exato true', () => {
    expect(consultaDaTela('?inativos=true', ['inativos'])).toEqual({ inativos: 'true' });
    expect(consultaDaTela('?inativos=false', ['inativos'])).toEqual({});
    expect(consultaDaTela('?inativos=1', ['inativos'])).toEqual({});
  });
});

