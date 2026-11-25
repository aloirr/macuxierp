import { afterEach, describe, expect, it, vi } from 'vitest';
import { agendarEnvioEmail, type LogEnvioEmail } from './envio-apos-resposta';
import { type EnvioEmail, ErroEmailDesligado, ErroEnvioEmail, type MensagemEmail } from './porta';

const MENSAGEM: MensagemEmail = { para: 'destinatario@exemplo.test', assunto: 'Assunto fictício', texto: 'Texto fictício com link-ficticio' };

/** EnvioEmail falso: cada chamada consome o próximo resultado (`null` = sucesso; erro = rejeição). */
function envioFalso(resultados: (Error | null)[]) {
  const chamadas: number[] = [];
  const envio: EnvioEmail = {
    enviar: async () => {
      chamadas.push(Date.now());
      const r = resultados[chamadas.length - 1] ?? null;
      if (r) throw r;
    },
  };
  return { envio, chamadas };
}

function logFalso() {
  const warns: unknown[][] = [];
  const infos: unknown[][] = [];
  const log = { warn: (...args: unknown[]) => void warns.push(args), info: (...args: unknown[]) => void infos.push(args) } as unknown as LogEnvioEmail;
  return { warns, infos, log };
}

/** Nenhum log leva destinatário, assunto ou texto (LGPD). */
function semDadoPessoal(registros: unknown[][], extras: string[] = []): void {
  const serializado = JSON.stringify(registros);
  for (const proibido of [MENSAGEM.para, MENSAGEM.assunto, MENSAGEM.texto, 'destinatario', 'link-ficticio', ...extras]) {
    expect(serializado).not.toContain(proibido);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('agendarEnvioEmail (T-0076)', () => {
  it('não bloqueia: retorna antes de enviar e não devolve promessa', async () => {
    vi.useFakeTimers();
    const { envio, chamadas } = envioFalso([null]);
    const r = agendarEnvioEmail(envio, MENSAGEM);
    expect(r).toBeUndefined();
    expect(chamadas).toHaveLength(0);
    await vi.runAllTimersAsync();
    expect(chamadas).toHaveLength(1);
  });

  it('a 2ª tentativa acontece depois da 1ª falha, após a espera; com sucesso, sem warn', async () => {
    vi.useFakeTimers();
    const { envio, chamadas } = envioFalso([new ErroEnvioEmail('ECONNECTION'), null]);
    const { warns, log } = logFalso();
    agendarEnvioEmail(envio, MENSAGEM, { log, esperaMs: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(chamadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(chamadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]! - chamadas[0]!).toBeGreaterThanOrEqual(50);
    await vi.runAllTimersAsync();
    expect(chamadas).toHaveLength(2);
    expect(warns).toHaveLength(0);
  });

  it('espera padrão de 2000 ms entre as tentativas', async () => {
    vi.useFakeTimers();
    const { envio, chamadas } = envioFalso([new Error('x'), null]);
    agendarEnvioEmail(envio, MENSAGEM);
    await vi.advanceTimersByTimeAsync(1999);
    expect(chamadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas).toHaveLength(2);
  });

  it('falha final: um warn só com evento, tentativas e o código SMTP da última tentativa, sem para, assunto, texto nem mensagem do erro', async () => {
    vi.useFakeTimers();
    const erro = new Error('falhou para destinatario@exemplo.test');
    const { envio, chamadas } = envioFalso([erro, new ErroEnvioEmail('EAUTH')]);
    const { warns, infos, log } = logFalso();
    agendarEnvioEmail(envio, MENSAGEM, { log, esperaMs: 10 });
    await vi.runAllTimersAsync();
    expect(chamadas).toHaveLength(2);
    expect(infos).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]![0]).toEqual({ evento: 'email.falha', tentativas: 2, codigo: 'EAUTH' });
    semDadoPessoal(warns, [erro.message]);
  });

  it('falha final sem ErroEnvioEmail: o warn leva codigo null, nunca a mensagem do erro', async () => {
    vi.useFakeTimers();
    const erro = new Error('falhou para destinatario@exemplo.test');
    const { envio } = envioFalso([new ErroEnvioEmail('ECONNECTION'), erro]);
    const { warns, log } = logFalso();
    agendarEnvioEmail(envio, MENSAGEM, { log, esperaMs: 10 });
    await vi.runAllTimersAsync();
    expect(warns.map((w) => w[0])).toEqual([{ evento: 'email.falha', tentativas: 2, codigo: null }]);
    semDadoPessoal(warns, [erro.message]);
  });

  it('SMTP aceitou: um info "email.enviado" com um envio_id aleatório (UUID) e nada mais', async () => {
    vi.useFakeTimers();
    const { envio } = envioFalso([null, null]);
    const { warns, infos, log } = logFalso();
    agendarEnvioEmail(envio, MENSAGEM, { log });
    agendarEnvioEmail(envio, MENSAGEM, { log });
    await vi.runAllTimersAsync();
    expect(warns).toHaveLength(0);
    expect(infos).toHaveLength(2);
    const ids = infos.map(([obj]) => {
      expect(Object.keys(obj as object).sort()).toEqual(['envio_id', 'evento']);
      expect((obj as { evento: string }).evento).toBe('email.enviado');
      return (obj as { envio_id: string }).envio_id;
    });
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
    semDadoPessoal(infos);
  });

  it('com ErroEmailDesligado: uma chamada só e nenhum warn', async () => {
    vi.useFakeTimers();
    const { envio, chamadas } = envioFalso([new ErroEmailDesligado(), new ErroEmailDesligado()]);
    const { warns, log } = logFalso();
    agendarEnvioEmail(envio, MENSAGEM, { log, esperaMs: 10 });
    await vi.runAllTimersAsync();
    expect(chamadas).toHaveLength(1);
    expect(warns).toHaveLength(0);
  });

  it('nunca lança: envio que lança síncrono e log que lança não geram rejeição não tratada', async () => {
    vi.useFakeTimers();
    const rejeicoes: unknown[] = [];
    const ouvir = (r: unknown) => void rejeicoes.push(r);
    process.on('unhandledRejection', ouvir);
    try {
      const envio: EnvioEmail = {
        enviar: () => {
          throw new Error('síncrono');
        },
      };
      const quebrado = () => {
        throw new Error('log quebrado');
      };
      const log = { warn: quebrado, info: quebrado } as unknown as LogEnvioEmail;
      expect(() => agendarEnvioEmail(envio, MENSAGEM, { log, esperaMs: 1 })).not.toThrow();
      // o log do sucesso também não derruba
      expect(() => agendarEnvioEmail(envioFalso([null]).envio, MENSAGEM, { log })).not.toThrow();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));
      expect(rejeicoes).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', ouvir);
    }
  });
});
