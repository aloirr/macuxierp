import { describe, expect, it } from 'vitest';
import { ConsultaLista, ConsultaPaginada, lerFiltros, paginaDe, paginar, paraCsv, paraQuery, respostaCsv } from './listas';
import { z } from 'zod';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('paginação única por cursor (RD-0003)', () => {
  it('limite padrão 50, máximo 200, cursor em UUID', () => {
    expect(ConsultaPaginada.parse({})).toEqual({ limite: 50 });
    expect(ConsultaPaginada.parse({ limite: '200', cursor: id(1) })).toEqual({ limite: 200, cursor: id(1) });
    expect(ConsultaPaginada.safeParse({ limite: '201' }).success).toBe(false);
    expect(ConsultaPaginada.safeParse({ cursor: '3' }).success).toBe(false);
  });

  it('a lista de cadastro aceita busca e inativos, e só um formato (sem pagina/por_pagina)', () => {
    expect(ConsultaLista.parse({ busca: '  acme ', inativos: 'true' })).toEqual({ limite: 50, busca: 'acme', inativos: true });
    expect(ConsultaLista.parse({ pagina: '2', por_pagina: '10' })).toEqual({ limite: 50, inativos: false });
  });

  it('paginar corta no limite e aponta o próximo cursor só quando sobrou linha', () => {
    const linhas = [1, 2, 3].map((n) => ({ id: id(n) }));
    expect(paginar(linhas, 2)).toEqual({ itens: linhas.slice(0, 2), proximo_cursor: id(2) });
    expect(paginar(linhas, 3)).toEqual({ itens: linhas, proximo_cursor: null });
    expect(paginar([], 50)).toEqual({ itens: [], proximo_cursor: null });
  });

  it('paginaDe valida a resposta { itens, proximo_cursor }', () => {
    const P = paginaDe(z.object({ id: z.string().uuid() }));
    expect(P.parse({ itens: [{ id: id(1) }], proximo_cursor: null }).itens).toHaveLength(1);
    expect(P.safeParse({ itens: [], pagina: 1 }).success).toBe(false);
  });
});

describe('filtros na URL (RD-0002)', () => {
  it('lê só as chaves permitidas, aparadas e sem vazio', () => {
    expect(lerFiltros('?busca=+acme+&uf=&x=1&busca=outra', ['busca', 'uf'])).toEqual({ busca: 'acme' });
  });

  it('paraQuery é estável e ignora vazio', () => {
    expect(paraQuery({ uf: 'AM', busca: 'a b', cursor: undefined, inativos: false, limite: 50 })).toBe('?busca=a+b&inativos=false&limite=50&uf=AM');
    expect(paraQuery({ busca: '' })).toBe('');
  });
});

describe('CSV do BKO (RD-0002)', () => {
  const colunas = [
    { titulo: 'Nome', valor: (l: { nome: string; saldo: number }) => l.nome },
    { titulo: 'Saldo', valor: (l: { nome: string; saldo: number }) => l.saldo },
  ];

  it('BOM, separador ;, CRLF, aspas e injeção de fórmula; número negativo fica número', () => {
    const csv = paraCsv(colunas, [{ nome: '=SOMA(A1)', saldo: -5 }, { nome: 'Loja "A"; Centro', saldo: 10 }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(`Nome;Saldo\r\n'=SOMA(A1);-5\r\n"Loja ""A""; Centro";10\r\n`);
  });

  it('respostaCsv baixa como anexo, sem cache e com nome limpo', () => {
    const r = respostaCsv('clientes/../x y.csv', 'a');
    expect(r.cabecalhos).toMatchObject({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="clientes_.._x_y.csv"', 'cache-control': 'no-store' });
  });
});
