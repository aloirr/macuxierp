import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SemPermissao } from '@/lib/api';

let resposta: () => unknown = () => ({ itens: [] });
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'token' }) }) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), getValidado: async () => resposta() }));
// A Fiscal venceu: `eu.modulos` traz só as vigentes, então ela não está na lista.
vi.mock('@/lib/sessao', async (orig) => ({
  ...(await orig<typeof import('@/lib/sessao')>()),
  contexto: async () => ({ eu: { modulos: [{ id: 'core' }, { id: 'cadastros' }] }, filial: null }),
}));

import Licencas from './page';

const linhaFiscal = (h: string) => h.match(/<tr>(?:(?!<\/tr>).)*Fiscal(?:(?!<\/tr>).)*<\/tr>/)?.[0] ?? '';

describe('/licencas: situação da licença igual à do core (RN-CORE-02)', () => {
  it('com core.licenca.ver, a licença vencida aparece como Vencida', async () => {
    resposta = () => ({ itens: [{ modulo: 'fiscal', ativo: true, valido_ate: '2020-01-01T00:00:00.000Z' }] });
    const h = linhaFiscal(renderToStaticMarkup(await Licencas()));
    expect(h).toContain('>Vencida<');
    expect(h).not.toContain('>Inativa<');
  });
  it('sem core.licenca.ver (403), cai no eu.modulos e a vencida aparece como Inativa: só as vigentes chegam', async () => {
    resposta = () => { throw new SemPermissao(); };
    const h = linhaFiscal(renderToStaticMarkup(await Licencas()));
    expect(h).toContain('>Inativa<');
    expect(h).not.toContain('>Vencida<');
  });
});
