import { describe, expect, it } from 'vitest';
import { lerAteOTeto } from './ler-ate-teto';
import * as sdk from './index';

/** Fonte de 0..n-1 por cursor (id numérico), devolvendo até `limite + 1` (a linha a mais diz que há próxima página). */
const fonte = (n: number) => {
  const chamadas: { cursor: string | undefined; limite: number }[] = [];
  const ler = async (p: { cursor: string | undefined; limite: number }) => {
    chamadas.push(p);
    const inicio = p.cursor === undefined ? 0 : Number(p.cursor) + 1;
    return Array.from({ length: Math.max(0, Math.min(p.limite + 1, n - inicio)) }, (_, i) => ({ id: inicio + i }));
  };
  return { ler, chamadas };
};

describe('RD-2346: lerAteOTeto (export em páginas por cursor, até o teto)', () => {
  it('lê tudo em páginas e não corta quando cabe no teto', async () => {
    const f = fonte(7);
    const r = await lerAteOTeto({ ler: f.ler, cursorDe: (l) => String(l.id), mapear: (l) => l.id * 10, teto: 100, pagina: 3 });
    expect(r).toEqual({ itens: [0, 10, 20, 30, 40, 50, 60], cortado: false });
    expect(f.chamadas.map((c) => c.cursor)).toEqual([undefined, '2', '5']);
  });

  it('para no teto e marca cortado quando há mais; exatamente no teto sem mais não corta', async () => {
    expect(await lerAteOTeto({ ler: fonte(10).ler, cursorDe: (l) => String(l.id), mapear: (l) => l.id, teto: 4, pagina: 3 })).toEqual({ itens: [0, 1, 2, 3], cortado: true });
    expect(await lerAteOTeto({ ler: fonte(6).ler, cursorDe: (l) => String(l.id), mapear: (l) => l.id, teto: 6, pagina: 3 })).toEqual({ itens: [0, 1, 2, 3, 4, 5], cortado: false });
    expect(await lerAteOTeto({ ler: fonte(0).ler, cursorDe: (l) => String(l.id), mapear: (l) => l.id, teto: 6, pagina: 3 })).toEqual({ itens: [], cortado: false });
  });

  it('o caminho do CSV dos recebidos tem chave própria no SDK (clientesRecebidosCsv)', () => {
    expect(sdk.CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidosCsv).toBe(`${sdk.CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidos}/exportar`);
    expect(sdk.lerAteOTeto).toBe(lerAteOTeto);
  });
});
