/**
 * Configuração da API pelo ambiente (nada de segredo em código; o `.env` de produção fica no servidor). A conexão com o
 * banco usa as variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_app`, `PGPASSWORD`, `PGDATABASE`).
 */
import { lerChaveA1 } from '@macuxierp/core/api';
import { chaveIntegracaoDoAmbiente, PADRAO_HEX_32 } from '@macuxierp/platform-sdk';
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
  /** Prova do BFF da apps/web (T-0050): 32 bytes em hex (`openssl rand -hex 32` no preparar-vm.sh). Vazia = ausente. */
  MACUXIERP_SEGREDO_BFF: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(PADRAO_HEX_32, 'precisa de 64 caracteres hex').optional()),
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
  /**
   * `MACUXIERP_CHAVE_INTEGRACAO` (T-0011), pela mesma regra do worker (`chaveIntegracaoDoAmbiente` do SDK). Opcional: ausente =
   * `null` e a API sobe (só o `PUT /v1/plataforma/empresas/:id/integracao-fdv/credencial` do portal responde 503); presente e
   * inválida derruba a partida. Serve só às rotas do portal (ADR 0013); o BKO do tenant é só leitura.
   */
  chaveIntegracao: Buffer | null;
  /** `MACUXIERP_SEGREDO_BFF` (T-0050, ver `ipDoCliente`): ausente = `null`; presente e inválido derruba a partida. */
  segredoBff: string | null;
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
    chaveIntegracao: chaveIntegracaoDoAmbiente(env), // inválida: ErroCifra que cita só o nome da variável
    segredoBff: e.MACUXIERP_SEGREDO_BFF ?? null,
  };
}
