/**
 * Campos de diagnóstico de um erro de banco para o log do 500 (T-0052): o SQLSTATE e os nomes de objeto do pg.
 * Só nomes (restrição, tabela, coluna, rotina), nunca valores: `message`, `detail`, `hint`, `where` e `internalQuery`
 * podem trazer valor de coluna (dado pessoal) e ficam fora.
 */
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NOME_MAXIMO = 63; // limite de identificador do PostgreSQL (NAMEDATALEN - 1)

export interface DiagnosticoBanco {
  sqlstate?: string;
  restricao?: string;
  tabela?: string;
  coluna?: string;
  rotina?: string;
}

const nome = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, NOME_MAXIMO) : undefined);

export function diagnosticoBanco(erro: unknown): DiagnosticoBanco {
  if (typeof erro !== 'object' || erro === null) return {};
  const e = erro as { code?: unknown; constraint?: unknown; table?: unknown; column?: unknown; routine?: unknown };
  if (typeof e.code !== 'string' || !SQLSTATE.test(e.code)) return {};
  const campos: [keyof DiagnosticoBanco, string | undefined][] = [
    ['sqlstate', e.code],
    ['restricao', nome(e.constraint)],
    ['tabela', nome(e.table)],
    ['coluna', nome(e.column)],
    ['rotina', nome(e.routine)],
  ];
  return Object.fromEntries(campos.filter(([, v]) => v !== undefined)) as DiagnosticoBanco;
}
