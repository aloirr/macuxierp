import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enviarComTentativas } from './envio-apos-resposta';
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
  const log = { warn: (...args: unknown[]) => void warns.push(args) } as unknown as Pick<FastifyBaseLogger, 'warn'>;
  return { warns, log };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('enviarComTentativas (T-0076)', () => {
  it('a 2ª tentativa acontece depois da 1ª falha, após a espera; com sucesso, sem warn', async () => {
    vi.useFakeTimers();
    const { envio, chamadas } = envioFalso([new ErroEnvioEmail('ECONNECTION'), null]);
    const { warns, log } = logFalso();
    void enviarComTentativas(envio, MENSAGEM, { log, esperaMs: 50 });
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
    void enviarComTentativas(envio, MENSAGEM);
    await vi.advanceTimersByTimeAsync(1999);
    expect(chamadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas).toHaveLength(2);
  });

  it('falha final: um warn só com evento e tentativas, sem para, assunto, texto nem mensagem do erro', async () => {
    vi.useFakeTimers();
    const erro = new Error('falhou para destinatario@exemplo.test');
    const { envio, chamadas } = envioFalso([erro, new ErroEnvioEmail('EAUTH')]);
    const { warns, log } = logFalso();
    void enviarComTentativas(envio, MENSAGEM, { log, esperaMs: 10 });
    await vi.runAllTimersAsync();
    expect(chamadas).toHaveLength(2);
    expect(warns).toHaveLength(1);
    const [obj] = warns[0]!;
    expect(Object.keys(obj as object).sort()).toEqual(['evento', 'tentativas']);
    expect((obj as { evento: string }).evento).toBe('email.falha');
    expect((obj as { tentativas: number }).tentativas).toBe(2);
    const serializado = JSON.stringify(warns);
    for (const proibido of [MENSAGEM.para, MENSAGEM.assunto, MENSAGEM.texto, 'destinatario', 'link-ficticio', erro.message]) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it('com ErroEmailDesligado: uma chamada só e nenhum warn', async () => {
    vi.useFakeTimers();
    const { envio, chamadas } = envioFalso([new ErroEmailDesligado(), new ErroEmailDesligado()]);
    const { warns, log } = logFalso();
    void enviarComTentativas(envio, MENSAGEM, { log, esperaMs: 10 });
    await vi.runAllTimersAsync();
    expect(chamadas).toHaveLength(1);
    expect(warns).toHaveLength(0);
  });

  it('nunca rejeita: envio que lança síncrono e log que lança não geram rejeição', async () => {
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
      const log = {
        warn: () => {
          throw new Error('log quebrado');
        },
      } as unknown as Pick<FastifyBaseLogger, 'warn'>;
      const feito = enviarComTentativas(envio, MENSAGEM, { log, esperaMs: 1 });
      await vi.runAllTimersAsync();
      await expect(feito).resolves.toBeUndefined();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));
      expect(rejeicoes).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', ouvir);
    }
  });
});
