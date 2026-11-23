import { describe, expect, it } from 'vitest';
import { diagnosticoBanco } from './erro-banco';

describe('diagnosticoBanco (T-0052): só SQLSTATE e nomes de objeto do pg', () => {
  it('erro do pg: sqlstate e nomes, sem message, detail, hint, where nem internalQuery', () => {
    const erro = Object.assign(new Error('valor 52998224725'), {
      code: '23514', constraint: 'c_check', table: 't', column: 'col', routine: 'ExecConstraints',
      detail: 'Failing row contains (52998224725).', hint: 'h', where: 'w', internalQuery: 'q',
    });
    expect(diagnosticoBanco(erro)).toEqual({ sqlstate: '23514', restricao: 'c_check', tabela: 't', coluna: 'col', rotina: 'ExecConstraints' });
  });

  it('nomes cortados em 63 caracteres; campo que não é string fica fora', () => {
    const d = diagnosticoBanco({ code: '42P01', table: 'x'.repeat(100), constraint: 5, column: null });
    expect(d).toEqual({ sqlstate: '42P01', tabela: 'x'.repeat(63) });
  });

  it('sem code SQLSTATE (Error comum, código do Node, não objeto): vazio', () => {
    expect(diagnosticoBanco(new Error('x'))).toEqual({});
    expect(diagnosticoBanco(Object.assign(new Error('x'), { code: 'ECONNREFUSED', table: 't' }))).toEqual({});
    expect(diagnosticoBanco({ code: 23514 })).toEqual({});
    expect(diagnosticoBanco('texto')).toEqual({});
    expect(diagnosticoBanco(null)).toEqual({});
  });
});
