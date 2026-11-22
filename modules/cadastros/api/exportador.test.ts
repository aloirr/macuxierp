import { describe, expect, it } from 'vitest';
import type { Transacao } from '@macuxierp/platform-sdk';
import { exportadorCadastros, TABELAS_EXPORTADAS } from './exportador';

describe('exportação LGPD do cadastros (RN-CORE-07)', () => {
  it('RN-CORE-07: exporta uma lista por tabela do tenant, pela transação (RLS), sem as tabelas oficiais', async () => {
    const sqls: string[] = [];
    const tx: Transacao = {
      consultar: async <L>(sql: string) => {
        sqls.push(sql);
        return [{ id: 'x' }] as L[];
      },
    };
    const saida = await exportadorCadastros.exportar(tx);
    expect(exportadorCadastros.modulo).toBe('cadastros');
    expect(Object.keys(saida)).toEqual([...TABELAS_EXPORTADAS]);
    expect(Object.values(saida).every((l) => l.length === 1)).toBe(true);
    expect(sqls.every((s) => /^SELECT \* FROM cadastros\.\w+ ORDER BY id$/.test(s))).toBe(true); // sem tenant_id no WHERE: a RLS isola
  });
});
