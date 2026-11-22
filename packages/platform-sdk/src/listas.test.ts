import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHAVES_FORA_DO_CONTRATO,
  CHAVES_PAGINACAO,
  celulaBooleana,
  celulaCentavos,
  celulaData,
  celulaDataHora,
  celulaDecimal,
  celulaInteiro,
  celulaLista,
  ConsultaLista,
  ConsultaPaginada,
  PaginaListaInvalida,
  TIPO_CSV,
  colunasDoPerfil,
  csvDaLista,
  definirPaginaLista,
  detectarSeparador,
  filtrosDaUrl,
  lerCsv,
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

describe('leitor de CSV (D11 da T-0026)', () => {
  const aceitas = ['external_id', 'nome', 'ativo', 'cidade'];
  const ler = (t: string | Uint8Array, obrigatorias: string[] = ['external_id', 'nome']) => lerCsv(t, { aceitas, obrigatorias });
  const lido = (t: string | Uint8Array, obrigatorias?: string[]) => {
    const r = ler(t, obrigatorias);
    if (!r.ok) throw new Error(`esperava leitura: ${r.erro.codigo}`);
    return r;
  };

  it('UTF-8 com e sem BOM, em bytes ou texto; acento preservado', () => {
    const texto = 'external_id;nome\r\nc1;São João\r\n';
    const bytes = new TextEncoder().encode(texto);
    const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    for (const e of [texto, `\ufeff${texto}`, bytes, comBom]) {
      expect(lido(e).linhas).toEqual([{ numero: 2, celulas: { external_id: 'c1', nome: 'São João' } }]);
    }
  });

  it('arquivo fora de UTF-8 é recusado com a orientação "CSV UTF-8"', () => {
    const latin1 = new Uint8Array([...new TextEncoder().encode('external_id;nome\nc1;S'), 0xe3, 0x6f]);
    const r = ler(latin1);
    expect(r).toMatchObject({ ok: false, erro: { codigo: 'CSV_CODIFICACAO' } });
    expect(!r.ok && r.erro.motivo).toMatch(/CSV UTF-8/);
  });

  it('separador ; ou , pelo cabeçalho (mais frequente; empate dá ;) e só fora de aspas', () => {
    expect(detectarSeparador('a;b;c')).toBe(';');
    expect(detectarSeparador('a,b,c')).toBe(',');
    expect(detectarSeparador('a;b,c')).toBe(';');
    expect(detectarSeparador('"x,y,z";b')).toBe(';');
    const r = lido('external_id,nome\nc1,"Loja, Centro"\n');
    expect(r.separador).toBe(',');
    expect(r.linhas[0]!.celulas.nome).toBe('Loja, Centro');
  });

  it('aspas da RFC 4180: "" vira aspas e a quebra de linha dentro de aspas fica na célula; numeração é da linha física', () => {
    const r = lido('external_id;nome\nc1;"Loja ""A""\nsegunda linha"\nc2;B\n');
    expect(r.linhas).toEqual([
      { numero: 2, celulas: { external_id: 'c1', nome: 'Loja "A"\nsegunda linha' } },
      { numero: 4, celulas: { external_id: 'c2', nome: 'B' } },
    ]);
    expect(ler('external_id;nome\nc1;"sem fechar\n')).toMatchObject({ ok: false, erro: { codigo: 'CSV_ASPAS', linha: 2 } });
  });

  it('ida e volta: paraCsv → lerCsv', () => {
    const linhas = [{ id: 'c1', nome: 'Loja "A"; Centro' }, { id: 'c2', nome: 'Linha\r\nquebrada' }];
    const csv = paraCsv([{ titulo: 'external_id', valor: (l: (typeof linhas)[number]) => l.id }, { titulo: 'nome', valor: (l: (typeof linhas)[number]) => l.nome }], linhas);
    expect(lido(csv).linhas.map((l) => l.celulas)).toEqual([{ external_id: 'c1', nome: 'Loja "A"; Centro' }, { external_id: 'c2', nome: 'Linha\r\nquebrada' }]);
  });

  it('linha em branco ou só com separadores é ignorada e conta na numeração; células aparadas; ausente = vazio', () => {
    const r = lido('external_id;nome;ativo\n\n  c1 ; A \n;;\nc2;B\n');
    expect(r.linhas).toEqual([
      { numero: 3, celulas: { external_id: 'c1', nome: 'A', ativo: '' } },
      { numero: 5, celulas: { external_id: 'c2', nome: 'B', ativo: '' } },
    ]);
  });

  it('cabeçalho sem diferença de maiúsculas e em qualquer ordem; ; sobrando no fim é aceito', () => {
    const r = lido('NOME;External_ID;\nA;c1;\n');
    expect(r.colunas).toEqual(['nome', 'external_id']);
    expect(r.linhas[0]!.celulas).toEqual({ nome: 'A', external_id: 'c1' });
  });

  it('coluna desconhecida, repetida ou obrigatória ausente recusa o arquivo; arquivo vazio também', () => {
    expect(ler('external_id;nome;cpf\n')).toMatchObject({ ok: false, erro: { codigo: 'CSV_COLUNA_DESCONHECIDA', coluna: 'cpf', linha: 1 } });
    expect(ler('external_id;nome;NOME\n')).toMatchObject({ ok: false, erro: { codigo: 'CSV_COLUNA_REPETIDA', coluna: 'nome' } });
    expect(ler('external_id;ativo\n')).toMatchObject({ ok: false, erro: { codigo: 'CSV_COLUNA_AUSENTE', coluna: 'nome' } });
    expect(ler('external_id;;nome\n')).toMatchObject({ ok: false, erro: { codigo: 'CSV_COLUNA_DESCONHECIDA', coluna: 'coluna 2' } });
    expect(ler('\n\n')).toMatchObject({ ok: false, erro: { codigo: 'CSV_VAZIO' } });
  });

  it('LGPD: CSV sem cabeçalho não ecoa a 1ª linha no erro (só a posição); nome de coluna do kit com ponto é ecoado', () => {
    const cpf = '529.982.247-25'; // fictício (DV válido), sem dono
    const r = ler(`${cpf};Fulana de Tal\nc1;A\n`);
    expect(r).toMatchObject({ ok: false, erro: { codigo: 'CSV_COLUNA_DESCONHECIDA', coluna: 'coluna 1' } });
    for (const proibido of [cpf, '52998224725', 'Fulana']) expect(JSON.stringify(r)).not.toContain(proibido);
    expect(ler('external_id;Fulana de Tal\n')).toMatchObject({ ok: false, erro: { coluna: 'coluna 2' } });
    const semMascara = ler('external_id;52998224725\n');
    expect(semMascara).toMatchObject({ ok: false, erro: { coluna: 'coluna 2' } });
    expect(JSON.stringify(semMascara)).not.toContain('52998224725');
    expect(ler('external_id;nome;endereco.logradouro\n')).toMatchObject({ ok: false, erro: { coluna: 'endereco.logradouro' } });
  });

  it('linha com mais células preenchidas que o cabeçalho é recusada sozinha, sem o valor no motivo', () => {
    const r = lido('external_id;nome\nc1;A;VALOR-SENTINELA\nc2;B;\n');
    expect(r.linhas.map((l) => l.numero)).toEqual([3]);
    expect(r.errosLinha).toEqual([{ codigo: 'CSV_CELULAS_A_MAIS', linha: 2, motivo: expect.any(String) }]);
    expect(JSON.stringify(r.errosLinha)).not.toContain('SENTINELA');
  });
});

describe('conversores genéricos de célula (D11 da T-0026)', () => {
  const valor = <T>(r: { ok: boolean; valor?: T }) => (r.ok ? r.valor : 'recusada');

  it('vazio é undefined em todos (célula vazia não altera nada, D6)', () => {
    for (const c of [celulaBooleana, celulaData, celulaDataHora, celulaCentavos, celulaLista, (s: string) => celulaInteiro(s), (s: string) => celulaDecimal(s, 2)]) {
      expect(c('  ')).toEqual({ ok: true, valor: undefined });
    }
  });

  it('sim/não', () => {
    for (const s of ['sim', 'S', 'true', '1', 'Verdadeiro']) expect(valor(celulaBooleana(s))).toBe(true);
    for (const s of ['não', 'NAO', 'n', 'false', '0', 'falso']) expect(valor(celulaBooleana(s))).toBe(false);
    expect(celulaBooleana('talvez').ok).toBe(false);
  });

  it('data AAAA-MM-DD conferida no calendário', () => {
    expect(valor(celulaData('2024-02-29'))).toBe('2024-02-29');
    expect(celulaData('2025-02-29')).toMatchObject({ ok: false, motivo: 'Data inexistente' });
    expect(celulaData('29/02/2024').ok).toBe(false);
  });

  it('data-hora só em UTC (com Z)', () => {
    expect(valor(celulaDataHora('2026-11-21T15:00:00Z'))).toBe('2026-11-21T15:00:00.000Z');
    expect(valor(celulaDataHora('2026-11-21T15:00:00.5Z'))).toBe('2026-11-21T15:00:00.500Z');
    expect(celulaDataHora('2026-11-21T15:00:00').ok).toBe(false);
    expect(celulaDataHora('2026-11-21T15:00:00-04:00').ok).toBe(false);
    expect(celulaDataHora('2026-11-31T15:00:00Z').ok).toBe(false);
    expect(celulaDataHora('2026-11-21T24:00:00Z').ok).toBe(false);
  });

  it('inteiro com faixa e centavos inteiros ≥ 0', () => {
    expect(valor(celulaInteiro('-3'))).toBe(-3);
    expect(celulaInteiro('10000', { min: 1, max: 9999 }).ok).toBe(false);
    expect(celulaInteiro('1,5').ok).toBe(false);
    expect(valor(celulaCentavos('1990'))).toBe(1990);
    for (const s of ['-1', '19,90', '19.90', '1e3', '99999999999999999999']) expect(celulaCentavos(s).ok).toBe(false);
  });

  it('decimal com casas por parâmetro, vírgula ou ponto, sem arredondar; 1.500 e 1,500 são ambíguos', () => {
    expect(valor(celulaDecimal('12,5', 2))).toBe(1250);
    expect(valor(celulaDecimal('12.5', 2))).toBe(1250);
    expect(valor(celulaDecimal('1.2500', 4))).toBe(12500);
    expect(valor(celulaDecimal('7', 4))).toBe(70000);
    expect(valor(celulaDecimal('0,500', 4))).toBe(5000);
    expect(valor(celulaDecimal('1234,500', 4))).toBe(12345000);
    expect(valor(celulaDecimal('2,50000', 2))).toBe(250);
    expect(celulaDecimal('1,125', 2)).toMatchObject({ ok: false });
    expect(celulaDecimal('1,12345', 4)).toMatchObject({ ok: false, motivo: 'No máximo 4 casas decimais' });
    for (const s of ['1.500', '1,500', '999,000']) expect(celulaDecimal(s, 4)).toMatchObject({ ok: false, motivo: expect.stringMatching(/ambíguo/) });
    expect(celulaDecimal('1.500,00', 2).ok).toBe(false);
    expect(celulaDecimal('-2,5', 4).ok).toBe(false);
    expect(valor(celulaDecimal('-2,5', 4, { negativo: true }))).toBe(-25000);
    expect(() => celulaDecimal('1', 7)).toThrow(RangeError);
  });

  it('lista separada por /', () => {
    expect(valor(celulaLista(' 0 / 30/60 '))).toEqual(['0', '30', '60']);
    expect(celulaLista('0//30').ok).toBe(false);
  });
});
