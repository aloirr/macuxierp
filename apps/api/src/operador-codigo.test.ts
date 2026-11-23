/**
 * Código da empresa no operador (RN-CORE-11, T-0053): o scripts/deploy/producao/empresa.mjs roda no contêiner sem
 * node_modules e por isso tem cópia de `UFS` e de `PADRAO_CODIGO_EMPRESA` do SDK. Este teste trava a cópia, no molde do
 * operador-senha.test.ts. O turbo.json põe scripts/deploy/producao/** nos inputs.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PADRAO_CODIGO_EMPRESA, UFS } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { padraoDoFonte } from './apoio-operador-teste';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'deploy', 'producao');
const FONTE_EMPRESA = readFileSync(resolve(PRODUCAO, 'empresa.mjs'), 'utf8');
const FONTE_OPERADOR = readFileSync(resolve(PRODUCAO, 'operador.sh'), 'utf8');

function ufsDoFonte(): string[] {
  const m = /const UFS\s*=\s*\[([^\]]*)\]/.exec(FONTE_EMPRESA);
  if (!m) throw new Error('UFS não encontrado em empresa.mjs');
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe('empresa.mjs: cópia do código da empresa (RN-CORE-11)', () => {
  it('UFS igual à do SDK, na mesma ordem', () => {
    expect(ufsDoFonte()).toEqual([...UFS]);
  });

  it('PADRAO_CODIGO igual ao PADRAO_CODIGO_EMPRESA do SDK', () => {
    expect(padraoDoFonte(FONTE_EMPRESA, 'PADRAO_CODIGO')).toBe(PADRAO_CODIGO_EMPRESA.source);
  });

  it('empresa.mjs valida --codigo e --uf com a cópia', () => {
    expect(FONTE_EMPRESA).toContain('!PADRAO_CODIGO.test(op.codigo) || !UFS.includes(op.codigo.slice(0, 2))');
    expect(FONTE_EMPRESA).toContain('!UFS.includes(op.uf)');
  });

  it('operador.sh: o formato do --codigo é o mesmo padrão (a UF da lista o empresa.mjs confere)', () => {
    expect(FONTE_OPERADOR).toContain(`[[ "$CODIGO" =~ ${PADRAO_CODIGO_EMPRESA.source} ]]`);
  });
});
