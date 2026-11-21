import { describe, expect, it } from 'vitest';
import { MANIFESTOS } from './manifestos';
import { montarMenu, rotuloDaPagina, slug } from './menu';

describe('slug', () => {
  it('tira acento e espaço', () => expect(slug('Tabelas de preço')).toBe('tabelas-de-preco'));
  it('tira pontuação nas pontas', () => expect(slug(' Usuários e perfis! ')).toBe('usuarios-e-perfis'));
});

describe('montarMenu (RN-CORE-02)', () => {
  it('só traz módulos licenciados, na ordem dos manifestos', () => {
    const m = montarMenu(MANIFESTOS, ['pedido', 'core'], 'administrador');
    expect(m.map((g) => g.modulo)).toEqual(['core', 'pedido']);
  });
  it('sem licença de fiscal, o menu não tem fiscal', () => {
    expect(montarMenu(MANIFESTOS, ['core', 'cadastros'], 'administrador').some((g) => g.modulo === 'fiscal')).toBe(false);
  });
  it('esconde módulo que não aceita o perfil', () => {
    const m = montarMenu(MANIFESTOS, ['core', 'integracao-fdv'], 'faturista');
    expect(m.map((g) => g.modulo)).toEqual(['core']);
  });
  it('monta href por módulo e página', () => {
    const itens = montarMenu(MANIFESTOS, ['cadastros'], 'gerente')[0]?.itens ?? [];
    expect(itens.map((i) => i.href)).toContain('/cadastros/tabelas-de-preco');
  });
  it('rotuloDaPagina devolve undefined para o que não está no menu', () => {
    const m = montarMenu(MANIFESTOS, ['pedido'], 'gerente');
    expect(rotuloDaPagina(m, 'pedido', 'pedidos')).toBe('Pedidos');
    expect(rotuloDaPagina(m, 'fiscal', 'regras-fiscais')).toBeUndefined();
  });
});
