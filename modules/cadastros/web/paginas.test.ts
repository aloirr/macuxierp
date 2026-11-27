import { describe, expect, it } from 'vitest';
import { PAGINAS, acoesDaPagina, consultaDaUrl, csvDaPagina } from './paginas';
import { paraQuery } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { COLUNAS_RESUMO, PAGINA_CARGA, type LinhaResumo } from './carga';

describe('páginas do BKO', () => {
  it('toda página do manifesto tem rota própria e menu declarado', () => {
    const menus = new Set<string>(manifest.web?.menus);
    for (const p of PAGINAS) expect(menus.has(p.menu), p.menu).toBe(true);
    expect(new Set(PAGINAS.map((p) => p.rota)).size).toBe(PAGINAS.length);
    for (const m of menus) expect(PAGINAS.some((p) => p.menu === m) || m === PAGINA_CARGA.menu, m).toBe(true);
  });
  it('filtros vivem na URL: ida e volta preserva busca, cursor e filtros e ignora o que não é da página', () => {
    const clientes = PAGINAS.find((p) => p.id === 'clientes')!;
    const cursor = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
    const q = consultaDaUrl(clientes, new URLSearchParams(`busca=acme&cursor=${cursor}&filial_id=f1&lixo=1&inativos=true&pagina=3`));
    expect(q).toEqual({ busca: 'acme', cursor, filial_id: 'f1', inativos: true });
    expect(paraQuery(q)).toBe(`?busca=acme&cursor=${cursor}&filial_id=f1&inativos=true`);
    expect(paraQuery(consultaDaUrl(clientes, new URLSearchParams('limite=999')))).toBe('');
    expect(consultaDaUrl(clientes, new URLSearchParams('limite=100')).limite).toBe(100);
  });
  it('CSV da página: colunas formatadas, sem a coluna que o perfil não vê e com proteção contra fórmula', () => {
    const produtos = PAGINAS.find((p) => p.id === 'produtos')!;
    const linha = { codigo: 'P1', descricao: '=SOMA(A1)', ncm: '22021000', cest: null, unidade_comercial: 'UN', custo_centavos: 450, inativo: false };
    const gerente = csvDaPagina(produtos, 'gerente', [linha]);
    expect(gerente).toContain('Custo');
    expect(gerente).toContain("'=SOMA(A1)");
    expect(csvDaPagina(produtos, 'vendedor', [linha])).not.toContain('Custo');
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

describe('coluna Situação como selo (MC-0201, regra 11)', () => {
  it('RN-MC-0201: clientes, produtos, tabelas de preço e filiais têm a coluna inativo do tipo status, com selo Ativo (ok) e Inativo (neutro)', () => {
    for (const id of ['clientes', 'produtos', 'tabelas-preco', 'filiais']) {
      const col = PAGINAS.find((p) => p.id === id)!.colunas.filter((c) => c.chave === 'inativo');
      expect(col, id).toHaveLength(1);
      expect(col[0]!.tipo, id).toBe('status');
      expect(col[0]!.selos!(false), id).toEqual([{ texto: 'Ativo', tom: 'ok' }]);
      expect(col[0]!.selos!(true), id).toEqual([{ texto: 'Inativo', tom: 'neutro' }]);
      expect(col[0]!.formatar!(true), id).toBe('Inativo');
    }
  });
  it('RN-MC-0201: o resumo da carga tem a coluna Situação do tipo status, com selo por situação', () => {
    const col = COLUNAS_RESUMO.filter((c) => c.titulo === 'Situação');
    expect(col).toHaveLength(1);
    expect(col[0]!.tipo).toBe('status');
    const linha = (situacao: string) => ({ situacao }) as LinhaResumo;
    expect(col[0]!.selos!(linha('Processado'))).toEqual([{ texto: 'Processado', tom: 'ok' }]);
    expect(col[0]!.selos!(linha('Arquivo recusado'))).toEqual([{ texto: 'Arquivo recusado', tom: 'erro' }]);
    expect(col[0]!.selos!(linha('Ignorado'))).toEqual([{ texto: 'Ignorado', tom: 'neutro' }]);
  });
});
