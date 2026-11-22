/**
 * Configuração da API pelo ambiente (nada de segredo em código; o `.env` de produção fica no servidor). A conexão com o
 * banco usa as variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_app`, `PGPASSWORD`, `PGDATABASE`).
 */
import { lerChaveA1 } from '@macuxierp/core/api';
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
  MACUXIERP_CHAVE_A1: z.string({ required_error: 'obrigatória' }),
});

export interface ConfigApi {
  jwtSegredo: string;
  porta: number;
  host: string;
  versao: string;
  cookieSeguro: boolean;
  poolMax: number;
  /** Lida pelo `lerChaveA1` do core (ADR 0005). */
  chaveA1: Buffer;
}

/** Lê e valida o ambiente; o erro cita só o nome da variável, nunca o valor. */
export function lerConfigApi(env: NodeJS.ProcessEnv): ConfigApi {
  const r = Ambiente.safeParse(env);
  if (!r.success) throw new Error(`configuração inválida: ${r.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join('; ')}`);
  const e = r.data;
  let chaveA1: Buffer;
  try {
    chaveA1 = lerChaveA1(e.MACUXIERP_CHAVE_A1);
  } catch {
    // A mensagem é fixa: nunca ecoa o valor recebido.
    throw new Error('configuração inválida: MACUXIERP_CHAVE_A1 (precisa de 32 bytes (hex ou base64))');
  }
  return {
    jwtSegredo: e.MACUXIERP_JWT_SEGREDO,
    porta: e.MACUXIERP_PORTA,
    host: e.MACUXIERP_HOST,
    versao: e.MACUXIERP_VERSAO,
    cookieSeguro: e.MACUXIERP_COOKIE_SEGURO === '1',
    poolMax: e.MACUXIERP_PG_POOL,
    chaveA1,
  };
}
