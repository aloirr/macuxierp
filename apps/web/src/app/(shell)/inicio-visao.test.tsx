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
    for (const r of ['Pedidos', 'Notas fiscais', 'Clientes']) expect(h).toContain(`>${r}</a>`);
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
  it('nenhum atalho: estado vazio com uma frase, sem botão', () => {
    const h = renderToStaticMarkup(<InicioVisao atalhos={[]} />);
    expect(cartoes(h)).toBe(0);
    expect(h).toContain('Nenhum módulo disponível');
    expect(h).not.toContain('<button');
  });
});
