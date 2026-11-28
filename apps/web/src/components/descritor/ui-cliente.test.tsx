import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AcaoVista } from '@/lib/descritor/tipos';
import { itemDoMenu, repartirAcoes } from './acoes-detalhe';
import { TabelaVista } from './ui-cliente';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn(), ler: vi.fn() }));

const acao = (id: string, rotulo: string, extra: Partial<AcaoVista> = {}): AcaoVista => ({ id, rotulo, metodo: 'POST', caminho: '/v1/x', entrada: 'confirmar', ...extra });
const emitir = acao('emitir', 'Emitir nota');
const parcial = acao('parcial', 'Emitir parcial');
const inativar = acao('inativar', 'Inativar', { metodo: 'DELETE', destrutivo: true });
const html = (linhas: Parameters<typeof TabelaVista>[0]['linhas']) =>
  renderToStaticMarkup(<TabelaVista colunas={[{ id: 'a', rotulo: 'A' }]} vazio="x" acoes={{ rota: '/r', rotaDaPagina: '/r' }} linhas={linhas} />);

describe('ações de linha da TabelaVista (T-0099)', () => {
  it('uma principal à vista e o botão "Ações" com o nome da linha; nenhuma fileira de botões', () => {
    const h = html([{ chave: '1', celulas: { a: '1' }, rotulo: 'Pedido 7', acao: emitir, maisAcoes: [parcial] }]);
    expect(h).toContain('>Emitir nota</button>');
    expect(h).toContain('aria-haspopup="menu"');
    expect(h).toContain('aria-label="Ações de Pedido 7"');
    expect(h).not.toContain('barra-acoes');
    expect(h).not.toContain('⋯');
    expect(h).not.toContain('>Emitir parcial<'); // vai para o menu, fechado
    expect(h.match(/mx-acoes-alvo/g)).toHaveLength(2);
  });
  it('a principal muda pela situação da linha: sem acao, todas vão ao menu; sem menu, só a principal', () => {
    const so = html([{ chave: '1', celulas: { a: '1' }, acao: emitir }]);
    expect(so).toContain('>Emitir nota</button>');
    expect(so).not.toContain('aria-haspopup');
    const menu = html([{ chave: '1', celulas: { a: '1' }, maisAcoes: [parcial] }]);
    expect(menu).not.toContain('>Emitir parcial<');
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu.match(/mx-acoes-alvo/g)).toHaveLength(1);
  });
  it('a coluna Ações não aparece sem nenhuma ação, e a linha sem ação fica vazia nela', () => {
    expect(html([{ chave: '1', celulas: { a: '1' } }])).not.toMatch(/>Ações<|aria-label="Ações de /);
    const h = html([{ chave: '1', celulas: { a: '1' }, acao: emitir }, { chave: '2', celulas: { a: '2' } }]);
    expect(h.match(/mx-acoes-alvo/g)).toHaveLength(1);
  });
  it('repartição: a primeira é principal; destrutiva nunca fica solta (vai ao menu como perigo)', () => {
    expect(repartirAcoes([emitir, parcial, inativar], true)).toEqual({ principal: emitir, menu: [parcial, inativar] });
    expect(repartirAcoes([inativar], true)).toEqual({ principal: undefined, menu: [inativar] });
    expect(repartirAcoes([emitir, parcial], false)).toEqual({ principal: undefined, menu: [emitir, parcial] });
    const h = html([{ chave: '1', celulas: { a: '1' }, acao: inativar }]);
    expect(h).not.toContain('>Inativar<');
    expect(h).toContain('aria-haspopup="menu"');
  });
  it('destrutivo vira perigo no item do menu', () => {
    expect(itemDoMenu(inativar)).toEqual({ chave: 'inativar', rotulo: 'Inativar', perigo: true });
    expect(itemDoMenu(emitir).perigo).toBe(false);
  });
});
