import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { textoTodos } from '@/lib/descritor/lista';
import { LISTA_PEDIDOS } from '@/lib/telas/pedido';
import { FormularioGenerico } from './formulario-generico';
import { TabelaVista } from './ui-cliente';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));

describe('formulário do novo pedido (T-0021 rodada 2)', () => {
  it('mostra o total do pedido logo acima do botão "Lançar pedido"', () => {
    const h = renderToStaticMarkup(<FormularioGenerico rota="/pedido/pedidos/novo" opcoes={{}} produtos={[]} />);
    const total = h.indexOf('data-testid="total-pedido"');
    expect(total).toBeGreaterThan(-1);
    expect(h).toMatch(/Total do pedido:[^]*R\$.0,00/);
    expect(total).toBeLessThan(h.indexOf('Lançar pedido'));
    expect(h.indexOf('Lançar pedido') - total).toBeLessThan(400);
  });
  it('os itens têm a legenda "Itens do pedido" e os botões usam as classes do botoes.css', () => {
    const h = renderToStaticMarkup(<FormularioGenerico rota="/pedido/pedidos/novo" opcoes={{}} produtos={[]} />);
    expect(h).toMatch(/<caption[^>]*>Itens do pedido<\/caption>/);
    expect(h).toContain('class="mx-botao"');
    expect(h).toContain('mx-botao-secundario');
    expect(h).not.toContain('btn');
  });
});

describe('filtros e selo da lista', () => {
  it('"Todas" para filtro feminino e "Todos" para os demais', () => {
    expect(textoTodos('Filial')).toBe('Todas');
    expect(textoTodos('Status')).toBe('Todos');
    expect(textoTodos('Cliente')).toBe('Todos');
  });
  it('o status do pedido na lista vira selo com o tom do detalhe', () => {
    const selos = LISTA_PEDIDOS.selos?.({ status: 'aprovado' }, 'America/Manaus');
    expect(selos?.status?.[0]?.tom).toBe('ok');
    expect(LISTA_PEDIDOS.selos?.({ status: 'desconhecido' }, 'America/Manaus')).toEqual({});
  });
  it('dinheiro e número ficam sem quebra de linha', () => {
    const h = renderToStaticMarkup(<TabelaVista colunas={[{ id: 't', rotulo: 'Total', tipo: 'dinheiro' }]} vazio="" linhas={[{ chave: '1', celulas: { t: 'R$ 1.234,56' } }]} />);
    expect(h).toContain('class="sem-quebra"');
  });
});

describe('grade de 12 colunas do formulário (T-0121, regra 11)', () => {
  it('campo curto, médio, longo e largo; contêiner sem teto e h1 em azul-noite', async () => {
    const { larguraDoCampo } = await import('./formulario-generico');
    const { readFileSync } = await import('node:fs');
    expect(larguraDoCampo({ nome: 'cep', tipo: 'texto' })).toBe(' campo-curto');
    expect(larguraDoCampo({ nome: 'validade', tipo: 'data' })).toBe(' campo-curto');
    expect(larguraDoCampo({ nome: 'filial_id', tipo: 'cadastro' })).toBe(' campo-medio');
    expect(larguraDoCampo({ nome: 'razao_social', tipo: 'texto' })).toBe('');
    expect(larguraDoCampo({ nome: 'observacao', tipo: 'area' })).toBe(' campo-largo');
    expect(larguraDoCampo({ nome: 'nfe_serie', tipo: 'texto' })).toBe(' campo-medio');
    expect(larguraDoCampo({ nome: 'nfe_numero_inicial', tipo: 'texto' })).toBe(' campo-medio');
    expect(larguraDoCampo({ nome: 'serie', tipo: 'texto' })).toBe(' campo-curto');
    expect(larguraDoCampo({ nome: 'end_numero', tipo: 'texto' })).toBe(' campo-curto');
    expect(larguraDoCampo({ nome: 'numeroso', tipo: 'texto' })).toBe('');
    expect(larguraDoCampo({ nome: 'cep', tipo: 'texto', colunas: 3 })).toBe(' campo-col-3');
    const css = readFileSync(`${__dirname}/../../app/globals.css`, 'utf8');
    expect(css).not.toMatch(/\.conteudo \{[^}]*max-width/);
    expect(css).toMatch(/\.conteudo h1 \{[^}]*azul-noite[^}]*margin: 0 0 4px/);
    expect(css).toMatch(/\.formulario \{ display: grid; grid-template-columns: repeat\(12/);
  });
});
