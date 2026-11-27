/**
 * Senha provisória do operador (T-0052; 44 B, fonte única no SDK `senha-temporaria.ts`): o gerador do
 * scripts/deploy/producao/operador.sh roda DE VERDADE (o trecho entre os marcadores, num bash) e cada senha sai no formato
 * do SDK, com as classes e o tamanho iguais aos dele (a API usa o próprio SDK; o core passa a usar na v0.3.20); as cópias da regra no empresa.mjs
 * e no superadmin.mjs (o contêiner não tem node_modules) se comportam como o `regrasDescumpridasTemporaria` do SDK. O turbo.json põe scripts/deploy/producao/** nos inputs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regrasDescumpridasTemporaria, senhaTemporariaNoFormato, TAMANHO_SENHA_TEMPORARIA } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CLASSES_API, padraoDoFonte, senhaProvisoria, trechoDoFonte } from './apoio-operador-teste';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'deploy', 'producao');
const FONTE_OPERADOR = readFileSync(resolve(PRODUCAO, 'operador.sh'), 'utf8');
const GERADOR = trechoDoFonte(FONTE_OPERADOR, '# >>> gerador da senha provisória', '# <<< gerador da senha provisória');
const QUANTAS = 200;

describe('operador.sh: gerador da senha provisória (T-0052)', () => {
  it('44 B: as classes (maiúsculas, minúsculas e dígitos) e o tamanho são os do SDK, sem especial', () => {
    for (const [nome, valor] of Object.entries(CLASSES_API)) expect(GERADOR, nome).toContain(`${nome}='${valor}'`);
    expect(GERADOR).toContain(`TAMANHO_SENHA=${TAMANHO_SENHA_TEMPORARIA}\n`);
    expect(GERADOR).not.toMatch(/SIMBOLOS/);
  });

  // Limite próprio: 200 senhas num bash só; sob a carga do turbo passou de 5 s (sozinho, < 1 s).
  it(`${QUANTAS} senhas do bash: 18 caracteres do alfabeto, uma de cada classe e a regra da temporária cumprida`, () => {
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${GERADOR}\nfor _ in $(seq ${QUANTAS}); do gerar_senha; echo; done`], { encoding: 'utf8', timeout: 60_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const senhas = r.stdout.trimEnd().split('\n');
    expect(senhas).toHaveLength(QUANTAS);
    for (const s of senhas) {
      expect(senhaTemporariaNoFormato(s), s).toBe(true);
      expect(regrasDescumpridasTemporaria(s)).toEqual([]);
    }
    // aleatória de fato: sem repetição e sem posição fixa para o dígito
    expect(new Set(senhas).size).toBe(QUANTAS);
    expect(new Set(senhas.map((s) => [...s].findIndex((c) => CLASSES_API.DIGITOS.includes(c)))).size).toBeGreaterThan(3);
  }, 30_000);

  it('o apoio dos testes (senhaProvisoria) também cumpre a regra da temporária', () => {
    for (let i = 0; i < 200; i++) expect(regrasDescumpridasTemporaria(senhaProvisoria())).toEqual([]);
  });
});

describe('empresa.mjs e superadmin.mjs: cópia da regra única de senha', () => {
  const AMOSTRAS = ['abcdEFGH23456789', 'abcdEFGH!@#%+=?a', '23456789!@#%+=?2', 'Ação1!xx', 'çãõ 1 _', 'abc²def1', 'abc def 1', 'ABC-1', '!!!!1111', '\tA1\n', 'a1@'];
  for (const arquivo of ['empresa.mjs', 'superadmin.mjs']) {
    it(`${arquivo}: letra e número como a regra da temporária do SDK (isenta do especial)`, () => {
      const fonte = readFileSync(resolve(PRODUCAO, arquivo), 'utf8');
      expect(fonte).not.toMatch(/SENHA_ESPECIAL/);
      const [letra, numero] = ['SENHA_LETRA', 'SENHA_NUMERO'].map((n) => new RegExp(padraoDoFonte(fonte, n), 'u'));
      for (const s of AMOSTRAS) {
        const copia = letra!.test(s) && numero!.test(s);
        const sdk = regrasDescumpridasTemporaria(s).filter((r) => r !== 'caracteres').length === 0;
        expect(copia, JSON.stringify(s)).toBe(sdk);
      }
      expect(fonte).toContain('!cumpreRegraSenha(op.senha)');
    });
  }
});
