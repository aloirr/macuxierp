import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TelaLista } from '@/lib/descritor/tipos';
import { NOTA_FUSO } from '@/lib/descritor/textos';
import { LISTA_NOTAS, LISTA_PEDIDOS_A_FATURAR, LISTA_REJEICOES, LISTA_TITULOS } from '@/lib/telas/faturamento';
import { NaoAutenticado } from '@/lib/api';
import { TrocarSenhaPendente } from '@/lib/troca-pendente';
import { buscarPagina } from '@/lib/listas';
import { ListaGenerica } from './lista-generica';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));
vi.mock('@/lib/listas', () => ({ buscarPagina: vi.fn(async () => ({ itens: [], proximo_cursor: null })) }));

const VAZIO = { semFiltro: 'Nenhum título a receber ainda. As notas autorizadas geram os títulos.', comFiltro: 'Nenhum título com estes filtros. Limpe os filtros para ver todos.' };
const comVazio = (vazio?: typeof VAZIO): TelaLista => ({ ...LISTA_TITULOS, pagina: { ...LISTA_TITULOS.pagina, ...(vazio ? { vazio } : {}) } as TelaLista['pagina'] });
const render = async (tela: TelaLista, busca: string) => renderToStaticMarkup(await ListaGenerica({ tela, rota: '/faturamento/titulos', rotaDaPagina: '/faturamento/titulos', busca: new URLSearchParams(busca), perfil: 'administrador', acesso: 'x', fuso: 'America/Manaus' }));

describe('lista vazia sem e com filtro (MC-0016)', () => {
  it('sem filtro mostra o texto de semFiltro e nenhum "Limpar filtros"', async () => {
    const h = await render(comVazio(VAZIO), '');
    expect(h).toContain(VAZIO.semFiltro);
    expect(h).not.toContain('Limpar filtros');
  });
  it('com filtro mostra comFiltro e o link "Limpar filtros" para a rota sem filtros', async () => {
    const h = await render(comVazio(VAZIO), 'status=aberto');
    expect(h).toContain(VAZIO.comFiltro);
    expect(h).toMatch(/<a class="mx-botao-secundario" href="\/faturamento\/titulos">Limpar filtros<\/a>/);
  });
  it('com filtro e limite, "Limpar filtros" preserva o limite; só limite ou cursor não contam como filtro', async () => {
    expect(await render(comVazio(VAZIO), 'status=aberto&limite=50')).toMatch(/href="\/faturamento\/titulos\?limite=50">Limpar filtros/);
    const h = await render(comVazio(VAZIO), 'limite=50&cursor=abc');
    expect(h).toContain(VAZIO.semFiltro);
    expect(h).not.toContain('Limpar filtros');
  });
  it('sem vazio declarado na página nem na tela, vale o texto genérico do shell com ou sem filtro', async () => {
    const { vazio: _, ...semVazio } = LISTA_TITULOS.pagina;
    const t = { ...LISTA_TITULOS, pagina: semVazio } as TelaLista;
    expect(await render(t, '')).toContain('Nenhum registro com estes filtros.');
    expect(await render(t, 'status=aberto')).toContain('Nenhum registro com estes filtros.');
  });
  it('a nota de fuso aparece nas listas com data e hora e não em títulos (só datas)', async () => {
    const nota = NOTA_FUSO;
    for (const l of [LISTA_PEDIDOS_A_FATURAR, LISTA_NOTAS, LISTA_REJEICOES]) expect(await render(l, '')).toContain(nota);
    expect(await render(LISTA_TITULOS, '')).not.toContain(nota);
  });
});

describe('falha de sessão na lista', () => {
  it('401 vai a /sessao/renovar e senha provisória vai a /senha, sem cair no error.tsx', async () => {
    vi.mocked(buscarPagina).mockRejectedValueOnce(new NaoAutenticado());
    await expect(render(comVazio(VAZIO), '')).rejects.toThrow('REDIRECT /sessao/renovar');
    vi.mocked(buscarPagina).mockRejectedValueOnce(new TrocarSenhaPendente());
    await expect(render(comVazio(VAZIO), '')).rejects.toThrow('REDIRECT /senha');
  });
});
