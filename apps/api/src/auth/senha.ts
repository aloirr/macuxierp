/**
 * Senha com argon2id (doc 04, "Segurança"), pelo `crypto.argon2` nativo do Node >= 24.7 (engines da raiz): nenhuma
 * dependência nativa nova. Formato PHC: `$argon2id$v=19$m=<KiB>,t=<passes>,p=<paralelismo>$<sal>$<hash>` (base64 sem
 * preenchimento), o mesmo das bibliotecas argon2 — um hash migrado de outra biblioteca continua conferindo.
 */
import * as crypto from 'node:crypto';
import { promisify } from 'node:util';

export interface ParametrosArgon2 {
  memoria: number; // KiB
  passes: number;
  paralelismo: number;
}

/** Mínimo da OWASP para argon2id (19 MiB, 2 passes, 1 via). */
export const ARGON2_PADRAO: ParametrosArgon2 = { memoria: 19_456, passes: 2, paralelismo: 1 };

type Argon2Fn = (
  algoritmo: 'argon2id',
  p: { message: string | Buffer; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number },
  cb: (erro: Error | null, chave: Buffer) => void,
) => void;

function argon2(): (algoritmo: 'argon2id', p: Parameters<Argon2Fn>[1]) => Promise<Buffer> {
  const fn = (crypto as unknown as { argon2?: Argon2Fn }).argon2;
  if (!fn) throw new Error('crypto.argon2 indisponível: o Macuxi ERP exige Node >= 24.7');
  return promisify(fn) as (algoritmo: 'argon2id', p: Parameters<Argon2Fn>[1]) => Promise<Buffer>;
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
const TAMANHO_HASH = 32;

export async function gerarHashSenha(senha: string, p: ParametrosArgon2 = ARGON2_PADRAO): Promise<string> {
  const sal = crypto.randomBytes(16);
  const h = await argon2()('argon2id', { message: senha, nonce: sal, parallelism: p.paralelismo, tagLength: TAMANHO_HASH, memory: p.memoria, passes: p.passes });
  return `$argon2id$v=19$m=${p.memoria},t=${p.passes},p=${p.paralelismo}$${b64(sal)}$${b64(h)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Confere em tempo constante. Hash fora do formato = falso (nunca lança para não vazar detalhe ao login). */
export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const m = PHC.exec(hash);
  if (!m) return false;
  const esperado = Buffer.from(m[5] ?? '', 'base64');
  const obtido = await argon2()('argon2id', {
    message: senha,
    nonce: Buffer.from(m[4] ?? '', 'base64'),
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: esperado.length,
  });
  return obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado);
}
