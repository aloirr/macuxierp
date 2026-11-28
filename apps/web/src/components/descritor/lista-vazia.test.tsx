import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TelaLista } from '@/lib/descritor/tipos';
import { LISTA_PEDIDOS } from '@/lib/telas/pedido';
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
const render = async (tela: TelaLista, busca: string, rota = '/faturamento/titulos') => renderToStaticMarkup(await ListaGenerica({ tela, rota, rotaDaPagina: rota, busca: new URLSearchParams(busca), perfil: 'administrador', acesso: 'x', fuso: 'America/Manaus' }));

describe('lista vazia sem e com filtro (MC-0016)', () => {
  it('sem filtro mostra o texto de semFiltro e nenhum "Limpar filtros"', async () => {
    const h = await render(comVazio(VAZIO), '');
    expect(h).toContain(VAZIO.semFiltro);
    expect(h).not.toContain('Limpar filtros');
  });
  it('com filtro mostra comFiltro e o link "Limpar filtros" para a rota sem filtros', async () => {
    const h = await render(comVazio(VAZIO), 'status=aberto');
    expect(h).toContain(VAZIO.comFiltro);
    expect(h).toMatch(/<a class="filtros-limpar" href="\/faturamento\/titulos">Limpar filtros<\/a>/);
    expect(h.match(/Limpar filtros/g)).toHaveLength(1); // um link só, ao lado dos filtros (RD-2382)
    expect(h.indexOf('Limpar filtros')).toBeLessThan(h.indexOf('</form>'));
  });
  it('com filtro e limite, "Limpar filtros" preserva o limite; só limite ou cursor não contam como filtro', async () => {
    expect(await render(comVazio(VAZIO), 'status=aberto&limite=50')).toMatch(/href="\/faturamento\/titulos\?limite=50">Limpar filtros/);
    const h = await render(comVazio(VAZIO), 'limite=50&cursor=abc');
    expect(h).toContain(VAZIO.semFiltro);
    expect(h).not.toContain('Limpar filtros');
  });
  it('sem vazio declarado: "Nenhum registro ainda." sem filtro e "Nenhum registro com estes filtros." só com filtro', async () => {
    const { vazio: _, ...semVazio } = LISTA_TITULOS.pagina;
    const t = { ...LISTA_TITULOS, pagina: semVazio } as TelaLista;
    const sem = await render(t, '');
    expect(sem).toContain('Nenhum registro ainda.');
    expect(sem).not.toContain('com estes filtros');
    expect(await render(t, 'status=aberto')).toContain('Nenhum registro com estes filtros.');
  });
  it('a nota de fuso saiu das listas (RD-1062)', async () => {
    const nota = 'Horários no fuso da empresa.';
    for (const l of [LISTA_PEDIDOS_A_FATURAR, LISTA_NOTAS, LISTA_REJEICOES]) expect(await render(l, '')).not.toContain(nota);
    expect(await render(LISTA_TITULOS, '')).not.toContain(nota);
  });
});

describe('barra do rodapé e busca sem "Filtrar" (RD-2381, RD-2382)', () => {
  it('Pedidos e Notas: uma barra só, depois da tabela, com as ações e a paginação juntas', async () => {
    for (const [tela, rota] of [[LISTA_PEDIDOS, '/pedido/pedidos'], [LISTA_NOTAS, '/faturamento/notas']] as const) {
      vi.mocked(buscarPagina).mockResolvedValueOnce({ itens: [], proximo_cursor: 'c2' });
      const h = renderToStaticMarkup(await ListaGenerica({ tela, rota, rotaDaPagina: rota, busca: new URLSearchParams(''), perfil: 'administrador', acesso: 'x', fuso: 'America/Manaus' }));
      expect(h.match(/class="barra-acoes barra-rodape-lista"/g), rota).toHaveLength(1);
      const barra = h.indexOf('barra-rodape-lista');
      expect(barra, rota).toBeGreaterThan(h.indexOf('class="cartao-tabela"'));
      expect(barra, rota).toBeGreaterThan(h.indexOf(tela.pagina.vazio?.semFiltro ?? 'Nenhum registro ainda.'));
      expect(h.indexOf('Exportar CSV'), rota).toBeGreaterThan(barra);
      expect(h.indexOf('Próxima página'), rota).toBeGreaterThan(barra);
      expect(h.match(/aria-label="Paginação"/g), rota).toHaveLength(1);
    }
  });
  it('na última página nada de paginação aparece: nem "Próxima página" nem "Fim da lista."', async () => {
    const h = await render(LISTA_PEDIDOS, '', '/pedido/pedidos');
    expect(h).not.toContain('Paginação');
    expect(h).not.toContain('Fim da lista');
    expect(h).toContain('class="barra-acoes barra-rodape-lista"'); // as ações da lista continuam no rodapé
  });
  it('a busca se chama "Buscar"; o "Filtrar" só existe para quem está sem JS; o formulário continua GET', async () => {
    const h = await render(LISTA_PEDIDOS, 'busca=123', '/pedido/pedidos');
    expect(h).toContain('<form class="filtros" role="search" aria-label="Filtros" action="/pedido/pedidos" method="get">');
    expect(h).toContain('<label class="campo filtro-col-4"><span>Buscar</span><input type="search" maxLength="80" placeholder="Número do pedido" name="busca" value="123"/></label>');
    expect(h).toContain('<button class="mx-botao filtros-enviar" type="submit">Filtrar</button>');
    expect(h).not.toContain('filtros-acoes');
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
