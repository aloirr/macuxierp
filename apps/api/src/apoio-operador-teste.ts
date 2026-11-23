/**
 * Apoio dos testes do operador (operador-empresa.db.test.ts e operador-superadmin.db.test.ts): leitura de trechos e
 * padrões dos fontes .mjs, o alfabeto da senha provisória da API e o ambiente do `psql` como no contêiner (PG* do admin).
 * Tudo lança erro quando não acha o que procura: um fonte mudado derruba o teste, nunca o deixa passar em branco.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** `.source` da regex literal `const <nome> = /.../;` de um fonte .mjs. */
export function padraoDoFonte(fonte: string, nome: string): string {
  const m = new RegExp(`const ${nome}\\s*=\\s*/(.+?)/[a-z]*;`).exec(fonte);
  if (!m) throw new Error(`${nome} não encontrado`);
  return new RegExp(m[1]!).source;
}

/** Trecho literal de um fonte .mjs, do início de `inicio` até a primeira ocorrência de `fim` depois dele (inclusive). */
export function trechoDoFonte(fonte: string, inicio: string, fim: string): string {
  const i = fonte.indexOf(inicio);
  if (i < 0) throw new Error(`${inicio} não encontrado`);
  const f = fonte.indexOf(fim, i);
  if (f < 0) throw new Error(`fim de ${inicio} não encontrado`);
  return fonte.slice(i, f + fim.length);
}

/** Alfabeto da senha provisória da API lido do fonte (as 4 constantes de modules/core/domain/usuarios.ts): a regra de
 *  fronteiras (app-importa-interno-de-modulo) não deixa apps/ importar `@macuxierp/core/domain`. */
const FONTE_USUARIOS = readFileSync(resolve(RAIZ, 'modules', 'core', 'domain', 'usuarios.ts'), 'utf8');
export const ALFABETO_API = ['MAIUSCULAS', 'MINUSCULAS', 'DIGITOS', 'SIMBOLOS']
  .map((nome) => {
    const m = new RegExp(`const ${nome} = '([^']+)';`).exec(FONTE_USUARIOS);
    if (!m) throw new Error(`${nome} não encontrado em usuarios.ts`);
    return m[1]!;
  })
  .join('');
if (ALFABETO_API.length !== 64) throw new Error('alfabeto da API deixou de ter 64 símbolos: revise senhaProvisoria()');

/** 16 caracteres do alfabeto da API (64 símbolos: 1 byte = 1 caractere sem viés), com maiúscula, minúscula e dígito. */
export function senhaProvisoria(): string {
  for (;;) {
    const s = [...randomBytes(16)].map((b) => ALFABETO_API[b % 64]).join('');
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) return s;
  }
}

/** Ambiente do `psql` como no contêiner: PG* do admin local apontando para `nomeDoBanco` (o teste soma as MACUXIERP_*). */
export function envPsqlAdmin(nomeDoBanco: string): NodeJS.ProcessEnv {
  const env = process.env;
  return {
    PATH: env.PATH,
    PGHOST: env.MACUXI_PG_HOST ?? '127.0.0.1',
    PGPORT: env.MACUXI_PG_PORTA ?? '5432',
    PGUSER: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
    PGDATABASE: nomeDoBanco,
    PGCONNECT_TIMEOUT: '5',
    ...(env.MACUXI_PG_ADMIN_SENHA === undefined ? {} : { PGPASSWORD: env.MACUXI_PG_ADMIN_SENHA }),
    ...(env.MACUXI_PSQL ? { MACUXIERP_PSQL: env.MACUXI_PSQL } : {}),
  };
}
