import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./empresas/acoes', () => ({ maisEmpresasAcao: vi.fn() }));

import { ListaEmpresas } from './lista-empresas';

describe('ListaEmpresas (36 A)', () => {
  it('o erro do "Carregar mais" fica no ResultadoAcao abaixo da tabela', () => {
    const h = renderToStaticMarkup(<ListaEmpresas empresas={[]} vazio="Nenhuma empresa." proximo="c1" />);
    expect(h.indexOf('data-resultado-acao')).toBeGreaterThan(h.indexOf('</table>'));
    expect(h).not.toContain('class="erro"');
  });
});
