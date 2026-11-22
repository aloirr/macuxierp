import { describe, expect, it } from 'vitest';
import { paginaDaRota, paginasDoMenu, paginaVisivel } from './paginas';

describe('páginas registradas (D-02)', () => {
  it('o aviso da exportação (T-0040) chega ao shell', () => {
    expect(paginaDaRota('/core/empresa/exportacao')?.aviso).toMatch(/exportação ainda não está disponível/);
  });
});

describe('carga de cadastros (T-0026)', () => {
  it('entra no registro pelo descritor e o menu aponta para a rota declarada', () => {
    const p = paginasDoMenu('cadastros', 'Carga de cadastros')[0];
    expect(p?.rota).toBe('/cadastros/carga-de-cadastros');
    expect(paginaDaRota(p!.rota)).toBe(p);
  });
  it('só quem pode executar a carga vê a página (ver por página)', () => {
    const p = paginaDaRota('/cadastros/carga-de-cadastros')!;
    expect(p.ver).toBe('cadastros.carga.executar');
    expect(paginasDoMenu('cadastros', 'Carga de cadastros', 'gerente')).toHaveLength(1);
    expect(paginasDoMenu('cadastros', 'Carga de cadastros', 'leitura')).toHaveLength(0);
    expect(paginaVisivel(p, 'leitura')).toBe(false);
  });
});
