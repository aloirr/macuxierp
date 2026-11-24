import { describe, expect, it } from 'vitest';
import { classificarArquivo, LAYOUT } from '../domain';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');

describe('layout dos arquivos do kit (D1, D2)', () => {
  it('D1: os 8 arquivos entram; os do kit fora da v1 e os 3 que deixaram de ser carga são ignorados; outro nome é recusado', () => {
    expect(classificarArquivo('Cliente.CSV')).toEqual({ classe: 'carga', entidade: 'cliente' });
    expect(classificarArquivo('titulo.csv')).toEqual({ classe: 'ignorado', entidade: 'titulo' });
    expect(classificarArquivo('cliente_endereco.csv')).toEqual({ classe: 'ignorado', entidade: 'cliente_endereco' });
    expect(classificarArquivo('forma_pagamento.csv')).toEqual({ classe: 'ignorado', entidade: 'forma_pagamento' });
    expect(classificarArquivo('prazo_pagamento.csv')).toEqual({ classe: 'ignorado', entidade: 'prazo_pagamento' });
    expect(classificarArquivo('condicoes_pagamento.csv')).toEqual({ classe: 'carga', entidade: 'condicao_pagamento' });
    expect(classificarArquivo('Condicao_Pagamento.csv')).toEqual({ classe: 'carga', entidade: 'condicao_pagamento' });
    expect(classificarArquivo('qualquer.csv')).toEqual({ classe: 'recusado' });
    expect(classificarArquivo('cliente.xlsx')).toEqual({ classe: 'recusado' });
  });
  it('D2: as colunas obrigatórias de cada arquivo estão entre as usadas e a fixture tem os 8 arquivos de carga e o titulo (ignorado)', () => {
    for (const e of Object.keys(LAYOUT) as (keyof typeof LAYOUT)[]) {
      for (const o of LAYOUT[e].obrigatorias) expect([...LAYOUT[e].usadas, ...LAYOUT[e].ignoradas], `${e}.${o}`).toContain(o);
    }
    expect(readdirSync(pasta).filter((f) => f.endsWith('.csv'))).toHaveLength(9);
  });
});
