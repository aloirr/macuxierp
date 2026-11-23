import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, delete: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT ${d}`);
  },
}));
vi.mock('@/lib/config/executar', () => ({
  executarConfig: async (_: string, f: (t: string) => unknown) => {
    estado.chamadas.push(await f('tok'));
    return { ok: true };
  },
}));
vi.mock('@/lib/config/api', () => ({ trocarSenhaPlataforma: async (_t: string, d: unknown) => d }));

import { FormularioSenha } from './formulario';
import { trocarSenhaAcao } from './acoes';

const form = (nova: string) => {
  const f = new FormData();
  f.set('senha_atual', 'provisoria');
  f.set('senha_nova', nova);
  return f;
};

describe('/config/senha', () => {
  beforeEach(() => {
    estado.chamadas = [];
  });
  it('não usa mais minLength 14; usa o mínimo do SDK e lista as regras', () => {
    const html = renderToStaticMarkup(<FormularioSenha />);
    expect(html).not.toContain('minLength="14"');
    expect(html).not.toContain('14 caracteres');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('A senha precisa ter');
    expect(html).toContain('Um caractere especial');
  });
  it('aceita 8 caracteres com letra, número e especial', async () => {
    await expect(trocarSenhaAcao({}, form('abc1234!'))).rejects.toThrow('REDIRECT /config');
    expect(estado.chamadas).toHaveLength(1);
  });
  it('recusa senha sem especial, citando a regra que falta', async () => {
    const r = await trocarSenhaAcao({}, form('abc12345'));
    expect(r.erro).toContain('Um caractere especial');
    expect(estado.chamadas).toHaveLength(0);
  });
});
