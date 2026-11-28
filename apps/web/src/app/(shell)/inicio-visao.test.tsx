import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Perfil } from '@macuxierp/platform-sdk';
import { EU_FALSO } from '@/lib/falso';
import { atalhosDoInicio } from '@/lib/inicio';
import { MANIFESTOS } from '@/lib/manifestos';
import { montarMenu } from '@/lib/menu';
import { InicioVisao } from './inicio-visao';

function inicio(perfil: Perfil, semModulo?: string): string {
  const modulos = EU_FALSO.modulos.filter((m) => m.id !== semModulo);
  return renderToStaticMarkup(<InicioVisao atalhos={atalhosDoInicio(montarMenu(modulos, MANIFESTOS, perfil))} />);
}
const cartoes = (h: string) => h.match(/class="atalho"/g)?.length ?? 0;

describe('Início do BKO (decisões 58 e 59)', () => {
  it('com as três permissões, três cartões em três colunas, cada um levando à lista do módulo', () => {
    const h = inicio('administrador');
    expect(cartoes(h)).toBe(3);
    expect(h).toContain('atalhos-3');
    expect(h).toContain('<h1>Início</h1>');
    expect(h).not.toContain('Olá'); // RD-2380 A: sem saudação; ficam o h1 e os atalhos
    expect(h).not.toContain('Por onde quer começar');
    expect(h).not.toContain('Atalhos');
    for (const r of ['Pedidos', 'Notas fiscais', 'Clientes']) expect(h).toContain(`<b>${r}</b>`);
    for (const d of ['Lançar e acompanhar', 'Emitir e consultar', 'Incluir e consultar']) expect(h).toContain(`<span>${d}</span>`);
    expect(h.match(/<span class="seta" aria-hidden="true">→<\/span>/g)).toHaveLength(3);
    expect(h).not.toMatch(/\d{2,}/); // sem números nem contadores
  });
  it('sem licença do faturamento some Notas fiscais e os dois restantes esticam', () => {
    const h = inicio('administrador', 'faturamento');
    expect(cartoes(h)).toBe(2);
    expect(h).toContain('atalhos-2');
    expect(h).not.toContain('Notas fiscais');
  });
  it('sem permissão de ver clientes some Clientes', () => {
    // Página da lista exigindo uma permissão que o perfil "leitura" não tem: o item some do menu e, com ele, o atalho.
    const paginas = [{ modulo: 'cadastros' as const, menu: 'Clientes', titulo: 'Clientes', rota: '/cadastros/clientes', ver: 'cadastros.cliente.editar' as const }];
    const menu = montarMenu(EU_FALSO.modulos, MANIFESTOS, 'leitura', paginas);
    const rotulos = atalhosDoInicio(menu).map((a) => a.rotulo);
    expect(rotulos).not.toContain('Clientes');
    expect(rotulos).toContain('Pedidos');
    expect(cartoes(renderToStaticMarkup(<InicioVisao atalhos={atalhosDoInicio(menu)} />))).toBe(rotulos.length);
  });
  it('nenhum atalho: só título e a frase do vazio, sem saudação, sem Atalhos nem botão', () => {
    const h = renderToStaticMarkup(<InicioVisao atalhos={[]} />);
    expect(cartoes(h)).toBe(0);
    expect(h).toContain('<h1>Início</h1>');
    expect(h).not.toContain('Olá');
    expect(h).not.toContain('Por onde quer começar');
    expect(h).toContain('Nenhum atalho disponível para o seu perfil. Use o menu para acessar as telas liberadas.');
    expect(h).not.toContain('Atalhos');
    expect(h).not.toContain('<button');
  });
});
