/**
 * F0 (fundação): a estrutura do monorepo bate com o doc 04. O dono de cada módulo (.coord/donos.json) é conferido
 * pela governança (scripts/coord-verificar.test.mjs), não aqui: tests/ não lê documentação nem coordenação (R4).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = join(import.meta.dirname, '..', '..');
const MODULOS = ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'];

describe('estrutura do monorepo (F0)', () => {
  it('cada módulo tem manifest, contracts, domain, api, web e db', () => {
    for (const m of MODULOS) {
      for (const p of ['manifest.ts', 'contracts/index.ts', 'domain', 'api', 'web', 'db']) {
        expect(existsSync(join(raiz, 'modules', m, p)), `modules/${m}/${p}`).toBe(true);
      }
    }
  });

  it('não há módulo fora da lista da v1', () => {
    expect(readdirSync(join(raiz, 'modules')).sort()).toEqual([...MODULOS].sort());
  });

});
