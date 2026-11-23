import { describe, expect, it } from 'vitest';
import { casarRota, paginaDaRota, paginasDoMenu, type PaginaRegistrada } from './paginas';

describe('páginas registradas (D-02)', () => {
  it('o aviso da exportação (T-0040) chega ao shell', () => {
    expect(paginaDaRota('/core/empresa/exportacao')?.aviso).toMatch(/\S/);
  });
});

describe('ocultaNoMenu (R-20261122-001923)', () => {
  it('detalhe e novo do pedido abrem pela URL e não viram item de menu', () => {
    expect(casarRota('/pedido/pedidos/novo')?.pagina.rota).toBe('/pedido/pedidos/novo');
    expect(casarRota('/pedido/pedidos/3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70')?.pagina.rota).toBe('/pedido/pedidos/:id');
    expect(paginasDoMenu('pedido', 'Pedidos').map((p) => p.rota)).toEqual(['/pedido/pedidos']);
  });
  it('o campo do módulo vence e a oculta não tira a rota', () => {
    const base = { modulo: 'core', menu: 'Empresa', titulo: 'A', rota: '/core/empresa/a' } as const;
    const lista: PaginaRegistrada[] = [{ ...base }, { ...base, titulo: 'B', rota: '/core/empresa/b', ocultaNoMenu: true }];
    expect(paginasDoMenu('core', 'Empresa', undefined, lista).map((p) => p.rota)).toEqual(['/core/empresa/a']);
    expect(casarRota('/core/empresa/b', lista)?.pagina.titulo).toBe('B');
  });
});
