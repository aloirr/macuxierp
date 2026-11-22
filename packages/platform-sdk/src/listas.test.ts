import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHAVES_FORA_DO_CONTRATO,
  CHAVES_PAGINACAO,
  ConsultaLista,
  ConsultaPaginada,
  PaginaListaInvalida,
  TIPO_CSV,
  colunasDoPerfil,
  csvDaLista,
  definirPaginaLista,
  filtrosDaUrl,
  lerFiltros,
  paginaDe,
  paginar,
  paraCsv,
  paraQuery,
  primeiraPagina,
  proximaPagina,
  recomecarLista,
  respostaCsv,
  trocarFiltro,
  urlDaLista,
} from './listas';
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

// ---- T-0041: descritor comum de página de lista (lacuna c do PR #37 e RD-0121) ----

const Cliente = z.object({ id: z.string().uuid(), nome: z.string(), limite_credito_centavos: z.number().int() });

const clientes = definirPaginaLista({
  id: 'clientes',
  api: '/v1/cadastros/clientes',
  item: Cliente,
  busca: true,
  inativos: true,
  filtros: { filial_id: z.string().uuid().optional(), uf: z.string().length(2).optional() },
  colunas: [
    { id: 'nome', titulo: 'Nome', valor: (c) => c.nome },
    { id: 'limite', titulo: 'Limite', valor: (c) => c.limite_credito_centavos, exige: 'cadastros.cliente.credito' },
  ],
  csv: { arquivo: 'clientes.csv' },
});

describe('chaves de paginação num lugar só (RD-0121)', () => {
  it('ConsultaPaginada usa as mesmas chaves de paginação', () => {
    expect(Object.keys(ConsultaPaginada.shape).sort()).toEqual([...CHAVES_PAGINACAO].sort());
  });
});

describe('definirPaginaLista: rota da API, item Zod, filtros, colunas e CSV', () => {
  it('a página sabe as chaves que aceita na URL: filtros do módulo, busca e inativos se declarados, e a paginação', () => {
    expect(clientes.chaves).toEqual(['busca', 'cursor', 'filial_id', 'inativos', 'limite', 'uf']);
    const auditoria = definirPaginaLista({ id: 'auditoria', api: '/v1/core/auditoria', item: Cliente, colunas: [], csv: false });
    expect(auditoria.chaves).toEqual(['cursor', 'limite']);
  });

  it('a consulta da API vem do descritor: parâmetro inválido falha (a rota devolve 400 VALIDACAO)', () => {
    expect(clientes.consulta.parse({ busca: ' acme ', inativos: 'true', filial_id: id(1), lixo: '1' })).toEqual({ limite: 50, busca: 'acme', inativos: true, filial_id: id(1) });
    expect(clientes.consulta.parse({})).toEqual({ limite: 50, inativos: false });
    for (const ruim of [{ limite: '0' }, { limite: '201' }, { cursor: 'x' }, { filial_id: 'x' }, { inativos: '1' }, { uf: 'AMZ' }, { busca: 'a'.repeat(81) }]) {
      expect(clientes.consulta.safeParse(ruim).success, JSON.stringify(ruim)).toBe(false);
    }
  });

  it('sem busca e inativos declarados, a consulta não os devolve', () => {
    const p = definirPaginaLista({ id: 'licencas', api: '/v1/core/licencas', item: Cliente, colunas: [], csv: false });
    expect(p.consulta.parse({ busca: 'x', inativos: 'true' })).toEqual({ limite: 50 });
  });

  it('a resposta da API é paginaDe(item)', () => {
    expect(clientes.resposta.parse({ itens: [{ id: id(1), nome: 'A', limite_credito_centavos: 1 }], proximo_cursor: null }).itens).toHaveLength(1);
    expect(clientes.resposta.safeParse({ itens: [{ id: id(1) }], proximo_cursor: null }).success).toBe(false);
  });

  it('recusa descritor fora do contrato', () => {
    const base = { id: 'x', api: '/v1/cadastros/x', item: Cliente, colunas: [], csv: false as const };
    const erro = (d: Parameters<typeof definirPaginaLista>[0]) => () => definirPaginaLista(d);
    expect(erro({ ...base, api: '/cadastros/x' })).toThrow(PaginaListaInvalida);
    expect(erro({ ...base, api: '/v1/cadastros/x?busca=a' })).toThrow(PaginaListaInvalida);
    expect(erro({ ...base, api: '/v1/cadastros/:id' })).toThrow(PaginaListaInvalida);
    expect(erro({ ...base, id: 'Clientes' })).toThrow(PaginaListaInvalida);
    for (const k of [...CHAVES_PAGINACAO, 'busca', 'inativos', ...CHAVES_FORA_DO_CONTRATO, 'Filial']) {
      expect(erro({ ...base, filtros: { [k]: z.string().optional() } }), k).toThrow(PaginaListaInvalida);
    }
    const col = { id: 'a', titulo: 'A', valor: () => 1 };
    expect(erro({ ...base, colunas: [col, col] })).toThrow(PaginaListaInvalida);
    expect(erro({ ...base, csv: { arquivo: '../x.csv' } })).toThrow(PaginaListaInvalida);
    expect(erro({ ...base, csv: { arquivo: 'x.txt' } })).toThrow(PaginaListaInvalida);
  });

  it('o descritor é congelado (dado, não estado)', () => {
    expect(Object.isFrozen(clientes)).toBe(true);
    expect(Object.isFrozen(clientes.chaves)).toBe(true);
  });
});

describe('filtros da tela a partir do descritor', () => {
  it('lê só as chaves da página; inativos só quando é true', () => {
    expect(filtrosDaUrl(clientes, `?busca=+acme+&x=1&pagina=2&inativos=true&cursor=${id(2)}&limite=20`)).toEqual({ busca: 'acme', inativos: 'true', cursor: id(2), limite: '20' });
    expect(filtrosDaUrl(clientes, '?inativos=false')).toEqual({});
    expect(filtrosDaUrl(clientes, '?inativos=1')).toEqual({});
  });

  it('urlDaLista: a mesma query para a tela e para a API, sem inativos falso', () => {
    expect(urlDaLista('/cadastros/clientes', { uf: 'AM', busca: 'a b', inativos: 'false' })).toBe('/cadastros/clientes?busca=a+b&uf=AM');
    expect(urlDaLista(clientes.api, { inativos: 'true' })).toBe('/v1/cadastros/clientes?inativos=true');
    expect(urlDaLista(clientes.api, {})).toBe('/v1/cadastros/clientes');
  });

  it('trocar filtro volta à primeira página; vazio remove; inativos diferente de true remove', () => {
    const f = { busca: 'a', cursor: id(3), limite: '20', inativos: 'true' };
    expect(trocarFiltro(f, 'uf', 'AM')).toEqual({ busca: 'a', limite: '20', inativos: 'true', uf: 'AM' });
    expect(trocarFiltro(f, 'busca', '  ')).toEqual({ limite: '20', inativos: 'true' });
    expect(trocarFiltro(f, 'inativos', 'false')).toEqual({ busca: 'a', limite: '20' });
    expect(trocarFiltro(f, 'cursor', id(9))).toEqual({ busca: 'a', limite: '20', inativos: 'true' });
  });

  it('próxima página com o proximo_cursor; null na última', () => {
    expect(proximaPagina({ busca: 'a' }, id(4))).toEqual({ busca: 'a', cursor: id(4) });
    expect(proximaPagina({ busca: 'a' }, null)).toBeNull();
    expect(primeiraPagina({ busca: 'a', cursor: id(4), limite: '20' })).toEqual({ busca: 'a', limite: '20' });
  });

  it('400 VALIDACAO: o shell recomeça na primeira página, sem paginação e sem os campos inválidos', () => {
    const f = { busca: 'a', cursor: id(4), limite: '999', filial_id: 'x', uf: 'AM' };
    expect(recomecarLista(f, { filial_id: 'UUID inválido', limite: 'máximo 200' })).toEqual({ busca: 'a', uf: 'AM' });
    expect(recomecarLista(f)).toEqual({ busca: 'a', filial_id: 'x', uf: 'AM' });
  });
});

describe('colunas e CSV do descritor', () => {
  const linhas = [{ id: id(1), nome: '=HIPERLINK()', limite_credito_centavos: 1000 }];

  it('a coluna com exige só aparece para quem pode (esconde; a API protege)', () => {
    expect(colunasDoPerfil(clientes, 'gerente').map((c) => c.id)).toEqual(['nome', 'limite']);
    expect(colunasDoPerfil(clientes, 'vendedor').map((c) => c.id)).toEqual(['nome']);
  });

  it('csvDaLista usa as colunas do perfil, o nome do descritor e o paraCsv do SDK', () => {
    const r = csvDaLista(clientes, 'vendedor', linhas);
    expect(r.cabecalhos).toMatchObject({ 'content-type': TIPO_CSV, 'content-disposition': 'attachment; filename="clientes.csv"' });
    expect(r.corpo).toBe(paraCsv(colunasDoPerfil(clientes, 'vendedor'), linhas));
    expect(String(r.corpo).slice(1)).toBe(`Nome\r\n'=HIPERLINK()\r\n`);
  });

  it('página sem CSV não exporta', () => {
    const p = definirPaginaLista({ id: 'perfis', api: '/v1/core/perfis', item: Cliente, colunas: [], csv: false });
    expect(() => csvDaLista(p, 'administrador', [])).toThrow(PaginaListaInvalida);
  });
});

describe('listas.ts roda no navegador (sem Node)', () => {
  it('nenhum import de Node nem de pg no listas.ts e nos módulos que ele importa em tempo de execução', () => {
    const ler = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    const runtime = (src: string) => [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]!);
    const visitados = new Set<string>();
    const fila = ['./listas.ts'];
    while (fila.length) {
      const f = fila.pop()!;
      if (visitados.has(f)) continue;
      visitados.add(f);
      for (const dep of runtime(ler(f))) {
        expect(dep, `${f} importa ${dep}`).not.toMatch(/^(node:|pg$|fs$|path$|crypto$|util$)/);
        if (dep.startsWith('./')) fila.push(`${dep}.ts`);
      }
    }
    expect(visitados.size).toBeGreaterThan(1);
  });
});
