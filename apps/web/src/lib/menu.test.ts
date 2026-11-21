import type { EuResposta } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EU_FALSO } from './falso';
import { MANIFESTOS } from './manifestos';
import { montarMenu, rotuloDaPagina, slug } from './menu';

describe('slug', () => {
  it('tira acento e espaço', () => expect(slug('Tabelas de preço')).toBe('tabelas-de-preco'));
  it('tira pontuação nas pontas', () => expect(slug(' Usuários e perfis! ')).toBe('usuarios-e-perfis'));
});

const mods = (...ids: string[]) => ids.map((id) => ({ id: id as EuResposta['modulos'][number]['id'], menus: [`Menu ${id}`] }));

describe('montarMenu (RN-CORE-02, RD-11)', () => {
  it('usa rótulos e ordem da API', () => {
    const m = montarMenu(mods('pedido', 'core'), MANIFESTOS, 'administrador');
    expect(m.map((g) => g.modulo)).toEqual(['pedido', 'core']);
    expect(m[0]?.itens[0]).toEqual({ rotulo: 'Menu pedido', href: '/pedido/menu-pedido' });
  });
  it('módulo que a API não devolve não aparece', () => {
    expect(montarMenu(EU_FALSO.modulos, MANIFESTOS, 'administrador').some((g) => g.modulo === 'fiscal')).toBe(false);
  });
  it('esconde módulo que não aceita o perfil', () => {
    const m = montarMenu(mods('core', 'integracao-fdv'), MANIFESTOS, 'faturista');
    expect(m.map((g) => g.modulo)).toEqual(['core']);
  });
  it('ignora módulo da API sem menus', () => {
    expect(montarMenu([{ id: 'core', menus: [] }], MANIFESTOS, 'administrador')).toEqual([]);
  });
  it('EU_FALSO traz os menus reais dos manifestos', () => {
    const itens = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'administrador').find((g) => g.modulo === 'cadastros')?.itens ?? [];
    expect(itens.map((i) => i.href)).toContain('/cadastros/tabelas-de-preco');
  });
  it('rotuloDaPagina devolve undefined para o que não está no menu', () => {
    const m = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'gerente');
    expect(rotuloDaPagina(m, 'pedido', 'pedidos')).toBe('Pedidos');
    expect(rotuloDaPagina(m, 'fiscal', 'regras-fiscais')).toBeUndefined();
  });
});
