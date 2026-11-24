/**
 * Configuração da API pelo ambiente (nada de segredo em código; o `.env` de produção fica no servidor). A conexão com o
 * banco usa as variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_app`, `PGPASSWORD`, `PGDATABASE`).
 */
import { lerChaveA1 } from '@macuxierp/core/api';
import { chaveIntegracaoDoAmbiente, PADRAO_HEX_32 } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import type { ConfigEmail } from './email/porta';

/** Vazio conta como ausente (o `env.modelo` deixa as variáveis com `=` e nada depois). */
const vazioAusente = (v: unknown) => (v === '' ? undefined : v);
const textoOpcional = z.preprocess(vazioAusente, z.string().optional());

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
  MACUXIERP_SEGREDO_BFF: z.preprocess(vazioAusente, z.string().regex(PADRAO_HEX_32, 'precisa de 64 caracteres hex').optional()),
  /** E-mail transacional (T-0076). Ausente: `smtp` se houver `MACUXI_SMTP_HOST`, senão `desligado`. */
  MACUXI_EMAIL_TRANSPORTE: z.preprocess(vazioAusente, z.enum(['smtp', 'arquivo', 'desligado'], { errorMap: () => ({ message: 'use smtp, arquivo ou desligado' }) }).optional()),
  MACUXI_SMTP_HOST: textoOpcional,
  MACUXI_SMTP_PORTA: z.preprocess(vazioAusente, z.coerce.number().int().min(1).max(65_535).default(587)),
  /** `1` = TLS implícito (`secure` do nodemailer); `0` = STARTTLS obrigatório. Ausente: `1` só na porta 465 (padrão do nodemailer). */
  MACUXI_SMTP_TLS: z.preprocess(vazioAusente, z.enum(['0', '1'], { errorMap: () => ({ message: 'use 0 ou 1' }) }).optional()),
  MACUXI_SMTP_USUARIO: textoOpcional,
  MACUXI_SMTP_SENHA: textoOpcional,
  MACUXI_SMTP_REMETENTE: textoOpcional,
});

type AmbienteLido = z.infer<typeof Ambiente>;

/** Regra do e-mail (T-0076); o erro cita só o nome das variáveis, nunca o valor. */
function lerConfigEmail(e: AmbienteLido): ConfigEmail {
  const transporte = e.MACUXI_EMAIL_TRANSPORTE ?? (e.MACUXI_SMTP_HOST ? 'smtp' : 'desligado');
  if (transporte !== 'smtp') return { transporte };
  const faltam = (['MACUXI_SMTP_HOST', 'MACUXI_SMTP_USUARIO', 'MACUXI_SMTP_SENHA', 'MACUXI_SMTP_REMETENTE'] as const).filter((n) => !e[n]);
  if (faltam.length > 0) throw new Error(`configuração inválida: ${faltam.map((n) => `${n} (obrigatória com o e-mail smtp)`).join('; ')}`);
  return {
    transporte: 'smtp',
    host: e.MACUXI_SMTP_HOST as string,
    porta: e.MACUXI_SMTP_PORTA,
    tls: e.MACUXI_SMTP_TLS === undefined ? e.MACUXI_SMTP_PORTA === 465 : e.MACUXI_SMTP_TLS === '1',
    usuario: e.MACUXI_SMTP_USUARIO as string,
    senha: e.MACUXI_SMTP_SENHA as string,
    remetente: e.MACUXI_SMTP_REMETENTE as string,
  };
}

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
  /** E-mail transacional (T-0076, `MACUXI_EMAIL_TRANSPORTE` e `MACUXI_SMTP_*`); ver `lerConfigEmail` e `email/porta.ts`. */
  email: ConfigEmail;
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
    email: lerConfigEmail(e),
  };
}
