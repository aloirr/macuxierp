import { describe, expect, it } from 'vitest';
import { paraCsv } from './csv';

describe('exportar CSV', () => {
  const colunas = [{ chave: 'nome', rotulo: 'Nome' }, { chave: 'valor', rotulo: 'Valor' }];
  it('usa ponto e vírgula, BOM e quebra CRLF (Excel em português)', () => {
    expect(paraCsv(colunas, [{ nome: 'Ana', valor: 10 }])).toBe('﻿Nome;Valor\r\nAna;10\r\n');
  });
  it('escapa aspas, separador e quebra de linha', () => {
    expect(paraCsv(colunas, [{ nome: 'A "B"; C\nD', valor: null }])).toBe('﻿Nome;Valor\r\n"A ""B""; C\nD";\r\n');
  });
  it('neutraliza fórmula (= + - @) para a planilha não executar o conteúdo', () => {
    expect(paraCsv(colunas, [{ nome: '=1+1', valor: '@x' }])).toBe("﻿Nome;Valor\r\n'=1+1;'@x\r\n");
  });
  it('formata o valor da coluna quando há formatador', () => {
    expect(paraCsv([{ chave: 'v', rotulo: 'V', formatar: (x) => `R$ ${x}` }], [{ v: 5 }])).toBe('﻿V\r\nR$ 5\r\n');
  });
});
