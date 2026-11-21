import { describe, expect, it } from 'vitest';
import { PAGINAS, acoesDaPagina, consultaDaUrl, urlDaConsulta } from './paginas';
import { manifest } from '../manifest';

describe('páginas do BKO', () => {
  it('toda página do manifesto tem rota própria e menu declarado', () => {
    const menus = new Set<string>(manifest.web?.menus);
    for (const p of PAGINAS) expect(menus.has(p.menu), p.menu).toBe(true);
    expect(new Set(PAGINAS.map((p) => p.rota)).size).toBe(PAGINAS.length);
    for (const m of menus) expect(PAGINAS.some((p) => p.menu === m), m).toBe(true);
  });
  it('filtros vivem na URL: ida e volta preserva busca, página e filtros e ignora o que não é da página', () => {
    const clientes = PAGINAS.find((p) => p.id === 'clientes')!;
    const q = consultaDaUrl(clientes, new URLSearchParams('busca=acme&pagina=3&filial_id=f1&lixo=1&inativos=true'));
    expect(q).toEqual({ busca: 'acme', pagina: 3, por_pagina: 50, filial_id: 'f1', inativos: true });
    expect(urlDaConsulta(q)).toBe('busca=acme&pagina=3&filial_id=f1&inativos=true');
    expect(consultaDaUrl(clientes, new URLSearchParams('pagina=-2')).pagina).toBe(1);
  });
  it('permissões na UI espelham a API: faturista edita cliente mas não o limite; vendedor só vê e exporta', () => {
    const clientes = PAGINAS.find((p) => p.id === 'clientes')!;
    expect(acoesDaPagina('faturista', clientes)).toMatchObject({ criar: true, editar: true, exportar: true, camposRestritos: [] });
    expect(acoesDaPagina('gerente', clientes).camposRestritos).toEqual(['limite_credito_centavos']);
    expect(acoesDaPagina('vendedor', clientes)).toMatchObject({ criar: false, editar: false, exportar: true });
    expect(acoesDaPagina('leitura', PAGINAS.find((p) => p.id === 'filiais')!)).toMatchObject({ criar: false, editar: false });
    expect(acoesDaPagina('administrador', PAGINAS.find((p) => p.id === 'filiais')!).editar).toBe(true);
  });
  it('as tabelas oficiais são só leitura para todos os perfis', () => {
    const oficiais = PAGINAS.find((p) => p.id === 'oficiais')!;
    for (const perfil of ['administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura'] as const) {
      expect(acoesDaPagina(perfil, oficiais)).toMatchObject({ criar: false, editar: false });
    }
  });
  it('o custo do produto só aparece na tela de quem edita produto', () => {
    const produtos = PAGINAS.find((p) => p.id === 'produtos')!;
    expect(acoesDaPagina('gerente', produtos).colunasVisiveis).toContain('custo_centavos');
    expect(acoesDaPagina('vendedor', produtos).colunasVisiveis).not.toContain('custo_centavos');
  });
});
