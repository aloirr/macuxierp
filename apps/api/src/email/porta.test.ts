import { describe, expect, it } from 'vitest';
import { type CartaSmtp, type ConfigEmail, criarEnvioEmail, emailDisponivel, ErroEmailDesligado, ErroEnvioEmail, type OpcoesTransporteSmtp } from './porta';

const SMTP: ConfigEmail = { transporte: 'smtp', host: 'smtp.exemplo.test', porta: 587, tls: false, usuario: 'usuario-ficticio', senha: 'senha-ficticia-sigilosa', remetente: 'nao-responda@exemplo.test' };
const MENSAGEM = { para: 'destinatario@exemplo.test', assunto: 'Assunto fictício', texto: 'Texto fictício com link-ficticio' };

function logFalso() {
  const linhas: { nivel: string; obj: object; msg: string }[] = [];
  return {
    linhas,
    log: {
      info: (obj: object, msg: string) => linhas.push({ nivel: 'info', obj, msg }),
      warn: (obj: object, msg: string) => linhas.push({ nivel: 'warn', obj, msg }),
    },
  };
}

function smtpFalso(falha?: unknown) {
  const opcoes: OpcoesTransporteSmtp[] = [];
  const cartas: CartaSmtp[] = [];
  const criarTransporte = (o: OpcoesTransporteSmtp) => {
    opcoes.push(o);
    return {
      sendMail: async (c: CartaSmtp) => {
        cartas.push(c);
        if (falha !== undefined) throw falha;
        return { messageId: 'id-ficticio' };
      },
    };
  };
  return { opcoes, cartas, criarTransporte };
}

function semDadosDaMensagem(texto: string) {
  for (const v of [MENSAGEM.para, MENSAGEM.assunto, MENSAGEM.texto, 'senha-ficticia-sigilosa']) expect(texto).not.toContain(v);
}

describe('porta de e-mail (T-0076)', () => {
  it('smtp: monta o transporte (STARTTLS obrigatório sem TLS implícito) e envia from=remetente, to, subject, text', async () => {
    const falso = smtpFalso();
    const { linhas, log } = logFalso();
    await criarEnvioEmail(SMTP, { log, criarTransporte: falso.criarTransporte }).enviar(MENSAGEM);
    expect(falso.opcoes).toEqual([{ host: 'smtp.exemplo.test', port: 587, secure: false, requireTLS: true, auth: { user: 'usuario-ficticio', pass: 'senha-ficticia-sigilosa' } }]);
    expect(falso.cartas).toEqual([{ from: 'nao-responda@exemplo.test', to: MENSAGEM.para, subject: MENSAGEM.assunto, text: MENSAGEM.texto }]);
    semDadosDaMensagem(JSON.stringify(linhas));
  });

  it('T-0111: com html, a carta leva text e html (multipart/alternative); nada da mensagem vai ao log', async () => {
    const falso = smtpFalso();
    const { linhas, log } = logFalso();
    const comHtml = { ...MENSAGEM, html: '<p>Texto fictício com link-ficticio</p>' };
    await criarEnvioEmail(SMTP, { log, criarTransporte: falso.criarTransporte }).enviar(comHtml);
    expect(falso.cartas).toEqual([{ from: 'nao-responda@exemplo.test', to: MENSAGEM.para, subject: MENSAGEM.assunto, text: MENSAGEM.texto, html: comHtml.html }]);
    semDadosDaMensagem(JSON.stringify(linhas));
  });

  it('smtp com TLS implícito: secure ligado, sem requireTLS', () => {
    const falso = smtpFalso();
    criarEnvioEmail({ ...SMTP, porta: 465, tls: true } as ConfigEmail, { criarTransporte: falso.criarTransporte });
    expect(falso.opcoes[0]).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it('falha do transporte vira ErroEnvioEmail com mensagem fixa e só o código, sem vazar destinatário em erro ou log', async () => {
    const original = Object.assign(new Error(`Mailbox unavailable: ${MENSAGEM.para}`), { code: 'EENVELOPE', response: `550 ${MENSAGEM.para}` });
    const falso = smtpFalso(original);
    const { linhas, log } = logFalso();
    const erro = await criarEnvioEmail(SMTP, { log, criarTransporte: falso.criarTransporte }).enviar(MENSAGEM).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect((erro as ErroEnvioEmail).codigo).toBe('EENVELOPE');
    expect((erro as Error).message).toBe('falha no envio do e-mail (EENVELOPE)');
    expect((erro as Error).cause).toBeUndefined();
    semDadosDaMensagem(`${(erro as Error).message} ${(erro as Error).stack ?? ''} ${JSON.stringify(erro)}`);
    expect(linhas).toEqual([{ nivel: 'warn', obj: { transporte: 'smtp', codigo: 'EENVELOPE' }, msg: 'falha no envio do e-mail' }]);
  });

  it('falha sem código (ou com código fora do padrão) sai só com a mensagem fixa', async () => {
    for (const falha of [new Error(MENSAGEM.para), { code: MENSAGEM.para }, 'texto solto']) {
      const erro = await criarEnvioEmail(SMTP, { criarTransporte: smtpFalso(falha).criarTransporte }).enviar(MENSAGEM).catch((e: unknown) => e);
      expect((erro as ErroEnvioEmail).codigo).toBeNull();
      expect((erro as Error).message).toBe('falha no envio do e-mail');
    }
  });

  it('arquivo: não envia; registra só um id, nunca para, assunto ou texto', async () => {
    const { linhas, log } = logFalso();
    const envio = criarEnvioEmail({ transporte: 'arquivo' }, { log });
    await envio.enviar(MENSAGEM);
    await envio.enviar(MENSAGEM);
    expect(linhas).toHaveLength(2);
    const [a, b] = linhas.map((l) => l.obj as { email_id: string });
    expect(a?.email_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a?.email_id).not.toBe(b?.email_id);
    expect(Object.keys(linhas[0]?.obj ?? {}).sort()).toEqual(['email_id', 'transporte']);
    semDadosDaMensagem(JSON.stringify(linhas));
  });

  it('desligado: lança ErroEmailDesligado sem dado da mensagem', async () => {
    const erro = await criarEnvioEmail({ transporte: 'desligado' }).enviar(MENSAGEM).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroEmailDesligado);
    semDadosDaMensagem((erro as Error).message);
  });

  it('emailDisponivel: false só no desligado', () => {
    expect(emailDisponivel({ transporte: 'desligado' })).toBe(false);
    expect(emailDisponivel({ transporte: 'arquivo' })).toBe(true);
    expect(emailDisponivel(SMTP)).toBe(true);
  });
});
