import type { EuResposta } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EU_FALSO } from './falso';
import { MANIFESTOS } from './manifestos';
import { montarMenu, resolverPagina, slug } from './menu';

describe('slug', () => {
  it('tira acento e espaço', () => expect(slug('Regras fiscais')).toBe('regras-fiscais'));
  it('tira pontuação nas pontas', () => expect(slug(' Emissão de notas! ')).toBe('emissao-de-notas'));
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
    expect(itens.map((i) => i.href)).toContain('/cadastros/tabelas-preco');
  });
  it('o href vem da rota declarada pela página do módulo, não do rótulo (D-02)', () => {
    const paginas = [{ modulo: 'cadastros' as const, menu: 'Equipe e carteira', titulo: 'Equipe e carteira', rota: '/cadastros/equipe' }];
    const m = montarMenu([{ id: 'cadastros', menus: ['Equipe e carteira', 'Filiais'] }], MANIFESTOS, 'administrador', paginas);
    expect(m[0]?.itens.map((i) => i.href)).toEqual(['/cadastros/equipe', '/cadastros/filiais']);
  });
  it('a rota aninhada de uma página resolve para o rótulo do menu (/core/empresa/certificado -> Empresa)', () => {
    const m = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'administrador');
    expect(resolverPagina(m, '/core/empresa/certificado', 'administrador')?.rotulo).toBe('Empresa');
    expect(resolverPagina(m, '/core/empresa/certificado', 'administrador')?.pagina?.titulo).toBeDefined();
    expect(resolverPagina(m, '/core/empresa', 'administrador')?.rotulo).toBe('Empresa');
    expect(resolverPagina(m, '/core/inexistente', 'administrador')).toBeUndefined();
  });
  it('resolverPagina devolve undefined para o que não está no menu e o rótulo para módulo sem páginas', () => {
    const m = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'gerente');
    expect(resolverPagina(m, '/pedido/pedidos', 'gerente')).toEqual({ rotulo: 'Pedidos' });
    expect(resolverPagina(m, '/fiscal/regras-fiscais', 'gerente')).toBeUndefined();
  });
});

describe('o `ver` de cada página por perfil (esconde o link e a rota)', () => {
  const paginas = [
    { modulo: 'core' as const, menu: 'Empresa', titulo: 'Certificado', rota: '/core/empresa/certificado', ver: 'core.certificado.gerir' as const },
    { modulo: 'core' as const, menu: 'Empresa', titulo: 'Empresa', rota: '/core/empresa', ver: 'core.empresa.ver' as const },
    { modulo: 'core' as const, menu: 'Auditoria', titulo: 'Auditoria', rota: '/core/auditoria', ver: 'core.auditoria.ver' as const },
  ];
  const api = [{ id: 'core' as const, menus: ['Empresa', 'Auditoria'] }];
  it('o link do item aponta para a primeira página que o perfil vê', () => {
    expect(montarMenu(api, MANIFESTOS, 'administrador', paginas)[0]?.itens[0]?.href).toBe('/core/empresa/certificado');
    expect(montarMenu(api, MANIFESTOS, 'gerente', paginas)[0]?.itens[0]?.href).toBe('/core/empresa');
  });
  it('item sem nenhuma página visível some do menu', () => {
    const itens = montarMenu(api, MANIFESTOS, 'gerente', paginas)[0]?.itens ?? [];
    expect(itens.map((i) => i.rotulo)).toEqual(['Empresa']);
  });
  it('a rota de página que o perfil não vê vira 404, mesmo com o item no menu', () => {
    const m = montarMenu(api, MANIFESTOS, 'gerente', paginas);
    expect(resolverPagina(m, '/core/empresa/certificado', 'gerente', paginas)).toBeUndefined();
    expect(resolverPagina(m, '/core/auditoria', 'gerente', paginas)).toBeUndefined();
    expect(resolverPagina(m, '/core/empresa', 'gerente', paginas)?.rotulo).toBe('Empresa');
  });
});
