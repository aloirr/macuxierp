/**
 * Configuração da API pelo ambiente (nada de segredo em código; o `.env` de produção fica no servidor). A conexão com o
 * banco usa as variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_app`, `PGPASSWORD`, `PGDATABASE`).
 */
import { z } from 'zod';

const Ambiente = z.object({
  MACUXIERP_JWT_SEGREDO: z.string().min(32, 'precisa de 32 caracteres ou mais'),
  MACUXIERP_PORTA: z.coerce.number().int().min(1).max(65_535).default(3000),
  MACUXIERP_HOST: z.string().min(1).default('0.0.0.0'),
  MACUXIERP_VERSAO: z.string().min(1).default('dev'),
  /** `0` só em desenvolvimento local sem HTTPS. */
  MACUXIERP_COOKIE_SEGURO: z.enum(['0', '1']).default('1'),
  MACUXIERP_PG_POOL: z.coerce.number().int().min(1).max(100).default(10),
  /** Chave mestra do A1 (ADR 0005): 32 bytes em hex (64 caracteres) ou base64. */
  MACUXIERP_CHAVE_A1: z
    .string({ required_error: 'obrigatória' })
    .transform((v) => (/^[0-9a-fA-F]{64}$/.test(v.trim()) ? Buffer.from(v.trim(), 'hex') : Buffer.from(v.trim(), 'base64')))
    .refine((b) => b.length === 32, 'precisa de 32 bytes (hex ou base64)'),
});

export interface ConfigApi {
  jwtSegredo: string;
  porta: number;
  host: string;
  versao: string;
  cookieSeguro: boolean;
  poolMax: number;
  /** Mesma regra do `lerChaveA1` do core (ainda fora do `@macuxierp/core/api`; pedido ao modulo-core na T-0029). */
  chaveA1: Buffer;
}

/** Lê e valida o ambiente; o erro cita só o nome da variável, nunca o valor. */
export function lerConfigApi(env: NodeJS.ProcessEnv): ConfigApi {
  const r = Ambiente.safeParse(env);
  if (!r.success) throw new Error(`configuração inválida: ${r.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join('; ')}`);
  const e = r.data;
  return {
    jwtSegredo: e.MACUXIERP_JWT_SEGREDO,
    porta: e.MACUXIERP_PORTA,
    host: e.MACUXIERP_HOST,
    versao: e.MACUXIERP_VERSAO,
    cookieSeguro: e.MACUXIERP_COOKIE_SEGURO === '1',
    poolMax: e.MACUXIERP_PG_POOL,
    chaveA1: e.MACUXIERP_CHAVE_A1,
  };
}
