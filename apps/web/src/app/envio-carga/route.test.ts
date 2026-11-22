import { beforeEach, describe, expect, it, vi } from 'vitest';

const enviarCarga = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'token' }) }) }));
vi.mock('@/lib/api', () => ({ enviarCarga: (...a: unknown[]) => enviarCarga(...a), NaoAutenticado: class extends Error {} }));

import { FOLGA_MULTIPART, POST } from './route';
import { PAGINA_CARGA } from '@macuxierp/cadastros/web';

function pedido(corpo: string, cabecalhos: Record<string, string> = {}) {
  const f = new FormData();
  f.append('modo', corpo);
  return new Request('http://erp.local/envio-carga', { method: 'POST', body: f, headers: { host: 'erp.local', ...cabecalhos } });
}

describe('POST /envio-carga', () => {
  beforeEach(() => enviarCarga.mockReset());

  it('origem "null" ou inválida dá 403, não 500', async () => {
    for (const o of ['null', 'não é url']) expect((await POST(pedido('validar', { origin: o }))).status).toBe(403);
    expect((await POST(pedido('validar', { origin: 'http://outro.com' }))).status).toBe(403);
    expect(enviarCarga).not.toHaveBeenCalled();
  });

  it('sem content-length devolve 413 antes de ler o corpo', async () => {
    const r = new Request('http://erp.local/envio-carga', { method: 'POST', body: 'x', headers: { host: 'erp.local' } });
    r.headers.delete('content-length');
    expect((await POST(r)).status).toBe(413);
    expect(enviarCarga).not.toHaveBeenCalled();
  });

  it('content-length acima do limite mais a folga devolve 413', async () => {
    const r = pedido('validar', { 'content-length': String(PAGINA_CARGA.maxBytes + FOLGA_MULTIPART + 1) });
    expect((await POST(r)).status).toBe(413);
    expect(enviarCarga).not.toHaveBeenCalled();
  });

  it('content-length que mente: o stream é cortado no limite', async () => {
    const grande = new Uint8Array(PAGINA_CARGA.maxBytes + FOLGA_MULTIPART + 10);
    const r = new Request('http://erp.local/envio-carga', {
      method: 'POST', body: grande, headers: { host: 'erp.local', 'content-length': '100', 'content-type': 'multipart/form-data; boundary=x' },
    });
    expect((await POST(r)).status).toBe(413);
    expect(enviarCarga).not.toHaveBeenCalled();
  });

  it('envio dentro do limite segue para a API', async () => {
    enviarCarga.mockResolvedValue({ ok: true, relatorio: {} });
    const r = pedido('validar');
    r.headers.set('content-length', '200');
    expect((await POST(r)).status).toBe(200);
    expect(enviarCarga).toHaveBeenCalledOnce();
  });
});
