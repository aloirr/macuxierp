import { describe, expect, it } from 'vitest';
import {
  celulaBooleana,
  celulaCentavos,
  celulaData,
  celulaDataHora,
  celulaDecimal,
  celulaInteiro,
  celulaLista,
  ConsultaLista,
  ConsultaPaginada,
  detectarSeparador,
  lerCsv,
  lerFiltros,
  paginaDe,
  paginar,
  paraCsv,
  paraQuery,
  respostaCsv,
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
