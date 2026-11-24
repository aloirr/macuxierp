/**
 * Configuração da API pelo ambiente (nada de segredo em código; o `.env` de produção fica no servidor). A conexão com o
 * banco usa as variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_app`, `PGPASSWORD`, `PGDATABASE`).
 */
import { lerChaveA1 } from '@macuxierp/core/api';
import { chaveIntegracaoDoAmbiente, PADRAO_HEX_32 } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import type { ConfigEmail } from './email/porta';

/** Vazio conta como ausente (o `env.modelo` deixa as variáveis com `=` e nada depois). */
const vazioAusente = <T,>(v: T): T | undefined => (v === '' ? undefined : v);

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
});

/**
 * E-mail transacional (T-0076), no formato que o deploy grava em `/opt/macuxierp/email.env` (valores sem aspas):
 * - `MACUXI_EMAIL_TRANSPORTE`: `smtp` | `arquivo` | `desligado`; ausente = `smtp` se houver `MACUXI_SMTP_HOST`, senão `desligado`;
 * - `MACUXI_SMTP_PORTA`: só dígitos, 1..65535; ausente = 587;
 * - `MACUXI_SMTP_TLS`: `tls` (TLS implícito, `secure` do nodemailer) ou `starttls` (STARTTLS obrigatório); ausente = `tls` na
 *   465 e `starttls` nas outras;
 * - `MACUXI_SMTP_HOST`, `MACUXI_SMTP_USUARIO`, `MACUXI_SMTP_SENHA`, `MACUXI_SMTP_REMETENTE`: obrigatórias com o transporte smtp.
 * Falta ou formato inválido NÃO derruba a partida: o e-mail fica `desligado` e cada problema vira um aviso que cita só o NOME
 * da variável, nunca o valor (o `main.ts` emite os avisos no log). Vazio conta como ausente.
 */
export function lerConfigEmail(env: NodeJS.ProcessEnv): { email: ConfigEmail; avisos: string[] } {
  const v = (nome: string) => vazioAusente(env[nome]);
  const desligado = (avisos: string[]) => ({ email: { transporte: 'desligado' } as const, avisos: avisos.map((a) => `e-mail desligado: ${a}`) });

  const transporteLido = v('MACUXI_EMAIL_TRANSPORTE');
  if (transporteLido !== undefined && transporteLido !== 'smtp' && transporteLido !== 'arquivo' && transporteLido !== 'desligado') {
    return desligado(['MACUXI_EMAIL_TRANSPORTE fora do formato (use smtp, arquivo ou desligado)']);
  }
  const host = v('MACUXI_SMTP_HOST');
  const transporte = transporteLido ?? (host ? 'smtp' : 'desligado');
  if (transporte !== 'smtp') return { email: { transporte }, avisos: [] };

  const avisos: string[] = [];
  const portaLida = v('MACUXI_SMTP_PORTA');
  let porta = 587;
  if (portaLida !== undefined) {
    porta = /^\d{1,5}$/.test(portaLida) ? Number(portaLida) : 0;
    if (porta < 1 || porta > 65_535) avisos.push('MACUXI_SMTP_PORTA fora do formato (só dígitos, de 1 a 65535)');
  }
  const tlsLido = v('MACUXI_SMTP_TLS');
  if (tlsLido !== undefined && tlsLido !== 'tls' && tlsLido !== 'starttls') avisos.push('MACUXI_SMTP_TLS fora do formato (use tls ou starttls)');
  const obrigatorias = { MACUXI_SMTP_HOST: host, MACUXI_SMTP_USUARIO: v('MACUXI_SMTP_USUARIO'), MACUXI_SMTP_SENHA: v('MACUXI_SMTP_SENHA'), MACUXI_SMTP_REMETENTE: v('MACUXI_SMTP_REMETENTE') };
  for (const [nome, valor] of Object.entries(obrigatorias)) if (!valor) avisos.push(`${nome} ausente (obrigatória com o transporte smtp)`);
  if (avisos.length > 0) return desligado(avisos);

  return {
    email: {
      transporte: 'smtp',
      host: obrigatorias.MACUXI_SMTP_HOST as string,
      porta,
      tls: (tlsLido ?? (porta === 465 ? 'tls' : 'starttls')) === 'tls',
      usuario: obrigatorias.MACUXI_SMTP_USUARIO as string,
      senha: obrigatorias.MACUXI_SMTP_SENHA as string,
      remetente: obrigatorias.MACUXI_SMTP_REMETENTE as string,
    },
    avisos: [],
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
  /** Avisos da partida (hoje só do e-mail): citam só nomes de variáveis, nunca valores; o `main.ts` os emite no log. */
  avisos: string[];
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
  const email = lerConfigEmail(env);
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
    email: email.email,
    avisos: email.avisos,
  };
}
