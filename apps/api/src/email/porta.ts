/**
 * Porta de e-mail transacional da API (T-0076, "esqueci a senha"). Três adaptadores, escolhidos pelo `lerConfigApi`:
 * - `smtp`: nodemailer (TLS implícito com `tls: true`; senão STARTTLS obrigatório, nunca credencial em texto puro);
 * - `arquivo`: não envia; só registra no log que um envio aconteceu (só um id, sem data/hora, que o log já traz), para desenvolvimento;
 * - `desligado`: lança `ErroEmailDesligado` (quem chama decide a resposta).
 * LGPD e segredos: nenhum adaptador loga destinatário, assunto, texto ou senha; o erro do SMTP sai com mensagem fixa e só o
 * código do nodemailer (a mensagem original pode conter o destinatário). Falha = exceção; a retentativa é de quem chama.
 */
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
  /** Parte `text/html` do mesmo conteúdo (T-0111, modelo do design #705); ausente = só texto. Nunca vai a log. */
  html?: string;
}

export interface EnvioEmail {
  enviar(m: MensagemEmail): Promise<void>;
}

export interface ConfigSmtp {
  transporte: 'smtp';
  host: string;
  porta: number;
  /** TLS implícito (`secure` do nodemailer, padrão da porta 465). `false` = STARTTLS obrigatório (padrão da 587). */
  tls: boolean;
  usuario: string;
  senha: string;
  /** Endereço do campo From. */
  remetente: string;
}

export type ConfigEmail = ConfigSmtp | { transporte: 'arquivo' } | { transporte: 'desligado' };

/** Logger mínimo (o do Fastify/pino serve). */
export interface LogEmail {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface OpcoesTransporteSmtp {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
}

export interface CartaSmtp {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface TransporteSmtp {
  sendMail(carta: CartaSmtp): Promise<unknown>;
}

export interface OpcoesEnvioEmail {
  log?: LogEmail;
  /** Padrão: `nodemailer.createTransport`. Injetável para teste. */
  criarTransporte?: (opts: OpcoesTransporteSmtp) => TransporteSmtp;
}

export class ErroEmailDesligado extends Error {
  constructor() {
    super('e-mail desligado: configure MACUXI_SMTP_HOST ou MACUXI_EMAIL_TRANSPORTE');
    this.name = 'ErroEmailDesligado';
  }
}

/** Falha do envio SMTP. A mensagem é fixa; `codigo` é o código do nodemailer (ex.: `EAUTH`, `ECONNECTION`), quando houver. */
export class ErroEnvioEmail extends Error {
  readonly codigo: string | null;
  constructor(codigo: string | null) {
    super(codigo ? `falha no envio do e-mail (${codigo})` : 'falha no envio do e-mail');
    this.name = 'ErroEnvioEmail';
    this.codigo = codigo;
  }
}

const PADRAO_CODIGO = /^[A-Z][A-Z0-9_]{1,31}$/;

function codigoDoErro(e: unknown): string | null {
  const c = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof c === 'string' && PADRAO_CODIGO.test(c) ? c : null;
}

export function emailDisponivel(config: ConfigEmail): boolean {
  return config.transporte !== 'desligado';
}

export function criarEnvioEmail(config: ConfigEmail, opcoes: OpcoesEnvioEmail = {}): EnvioEmail {
  const { log } = opcoes;
  switch (config.transporte) {
    case 'desligado':
      return {
        enviar: () => Promise.reject(new ErroEmailDesligado()),
      };
    case 'arquivo':
      return {
        enviar: async () => {
          log?.info({ email_id: randomUUID(), transporte: 'arquivo' }, 'e-mail não enviado (só registrado)');
        },
      };
    case 'smtp': {
      const criar = opcoes.criarTransporte ?? ((o: OpcoesTransporteSmtp): TransporteSmtp => nodemailer.createTransport(o));
      const transporte = criar({
        host: config.host,
        port: config.porta,
        secure: config.tls,
        requireTLS: !config.tls,
        auth: { user: config.usuario, pass: config.senha },
      });
      return {
        enviar: async (m) => {
          try {
            // multipart/alternative (text/plain + text/html) quando há `html`: o nodemailer monta as duas partes
            await transporte.sendMail({ from: config.remetente, to: m.para, subject: m.assunto, text: m.texto, ...(m.html ? { html: m.html } : {}) });
          } catch (e) {
            const erro = new ErroEnvioEmail(codigoDoErro(e));
            log?.warn({ transporte: 'smtp', codigo: erro.codigo }, 'falha no envio do e-mail');
            throw erro;
          }
        },
      };
    }
  }
}
