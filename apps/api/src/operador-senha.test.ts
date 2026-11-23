/**
 * Senha provisória do operador (T-0052, regra única de senha do SDK): o gerador do scripts/deploy/producao/operador.sh
 * roda DE VERDADE (o trecho entre os marcadores, num bash) e cada senha cumpre a regra, com as classes iguais às da API
 * (modules/core/domain/usuarios.ts); as cópias da regra no empresa.mjs e no superadmin.mjs (o contêiner não tem
 * node_modules) se comportam como o `regrasDescumpridas` do SDK. O turbo.json põe scripts/deploy/producao/** nos inputs.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regrasDescumpridas } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ALFABETO_API, CLASSES_API, padraoDoFonte, senhaProvisoria, trechoDoFonte } from './apoio-operador-teste';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'deploy', 'producao');
const FONTE_OPERADOR = readFileSync(resolve(PRODUCAO, 'operador.sh'), 'utf8');
const GERADOR = trechoDoFonte(FONTE_OPERADOR, '# >>> gerador da senha provisória', '# <<< gerador da senha provisória');
const QUANTAS = 200;

describe('operador.sh: gerador da senha provisória (T-0052)', () => {
  it('as classes (maiúsculas, minúsculas, dígitos e especiais) são as da API; o alfabeto continua com 64 símbolos', () => {
    for (const [nome, valor] of Object.entries(CLASSES_API)) expect(GERADOR, nome).toContain(`${nome}='${valor}'`);
    expect(ALFABETO_API).toHaveLength(64);
    expect(CLASSES_API.SIMBOLOS.length).toBeGreaterThan(0);
  });

  // Limite próprio: 200 senhas num bash só; sob a carga do turbo passou de 5 s (sozinho, < 1 s).
  it(`${QUANTAS} senhas do bash: 16 caracteres do alfabeto, uma de cada classe e a regra única cumprida`, () => {
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${GERADOR}\nfor _ in $(seq ${QUANTAS}); do gerar_senha; echo; done`], { encoding: 'utf8', timeout: 60_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const senhas = r.stdout.trimEnd().split('\n');
    expect(senhas).toHaveLength(QUANTAS);
    for (const s of senhas) {
      expect(s).toHaveLength(16);
      expect([...s].every((c) => ALFABETO_API.includes(c))).toBe(true);
      for (const classe of Object.values(CLASSES_API)) expect([...s].some((c) => classe.includes(c))).toBe(true);
      expect(regrasDescumpridas(s)).toEqual([]);
    }
    // aleatória de fato: sem repetição e sem posição fixa para o especial
    expect(new Set(senhas).size).toBe(QUANTAS);
    expect(new Set(senhas.map((s) => [...s].findIndex((c) => CLASSES_API.SIMBOLOS.includes(c)))).size).toBeGreaterThan(3);
  }, 30_000);

  it('o apoio dos testes (senhaProvisoria) também cumpre a regra', () => {
    for (let i = 0; i < 200; i++) expect(regrasDescumpridas(senhaProvisoria())).toEqual([]);
  });
});

describe('empresa.mjs e superadmin.mjs: cópia da regra única de senha', () => {
  const AMOSTRAS = ['abcdEFGH23456789', 'abcdEFGH!@#%+=?a', '23456789!@#%+=?2', 'Ação1!xx', 'çãõ 1 _', 'abc²def1', 'abc def 1', 'ABC-1', '!!!!1111', '\tA1\n', 'a1@'];
  for (const arquivo of ['empresa.mjs', 'superadmin.mjs']) {
    it(`${arquivo}: letra, número e especial como o SDK`, () => {
      const fonte = readFileSync(resolve(PRODUCAO, arquivo), 'utf8');
      const [letra, numero, especial] = ['SENHA_LETRA', 'SENHA_NUMERO', 'SENHA_ESPECIAL'].map((n) => new RegExp(padraoDoFonte(fonte, n), 'u'));
      for (const s of AMOSTRAS) {
        const copia = letra!.test(s) && numero!.test(s) && especial!.test(s);
        const sdk = regrasDescumpridas(s).filter((r) => r !== 'caracteres').length === 0;
        expect(copia, JSON.stringify(s)).toBe(sdk);
      }
      expect(fonte).toContain('!cumpreRegraSenha(op.senha)');
    });
  }
});
