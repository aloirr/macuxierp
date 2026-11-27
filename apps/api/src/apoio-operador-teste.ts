/**
 * Apoio dos testes do operador (operador-empresa.db.test.ts e operador-superadmin.db.test.ts): leitura de trechos e
 * padrões dos fontes .mjs, o alfabeto da senha provisória do SDK e o ambiente do `psql` como no contêiner (PG* do admin).
 * Tudo lança erro quando não acha o que procura: um fonte mudado derruba o teste, nunca o deixa passar em branco.
 */
import { randomInt } from 'node:crypto';
import {
  ALFABETO_SENHA_TEMPORARIA,
  DIGITOS_SENHA_TEMPORARIA,
  gerarSenhaTemporaria,
  MAIUSCULAS_SENHA_TEMPORARIA,
  MINUSCULAS_SENHA_TEMPORARIA,
} from '@macuxierp/platform-sdk';


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

/** As classes da senha temporária e provisória do SDK (44 B, fonte única), pelo nome das constantes do operador.sh. */
export const CLASSES_API = Object.freeze({
  MAIUSCULAS: MAIUSCULAS_SENHA_TEMPORARIA,
  MINUSCULAS: MINUSCULAS_SENHA_TEMPORARIA,
  DIGITOS: DIGITOS_SENHA_TEMPORARIA,
}) as Readonly<Record<'MAIUSCULAS' | 'MINUSCULAS' | 'DIGITOS', string>>;
export const ALFABETO_API = ALFABETO_SENHA_TEMPORARIA;

/** Uma provisória como o `gerar_senha` do operador.sh: o gerador do SDK com o CSPRNG do Node. */
export function senhaProvisoria(): string {
  return gerarSenhaTemporaria((n) => randomInt(n));
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
