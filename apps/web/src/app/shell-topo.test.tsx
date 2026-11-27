import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EU_FALSO, EU_FALSO_MEI, RAZAO_MEI_FALSA } from '@/lib/falso';
import { nomeDoTopo } from '@/lib/nome-topo';

const ctx = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock('@/lib/sessao', () => ({ contexto: async () => ctx.valor }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('./(shell)/nav-lateral', () => ({ NavLateral: () => null }));
vi.mock('./(shell)/botao-sair', () => ({ BotaoSair: () => null }));
vi.mock('./(shell)/link-trocar-senha', () => ({ LinkTrocarSenha: () => null }));
vi.mock('./(shell)/aviso-senha-trocada', () => ({ AvisoSenhaTrocada: () => null }));

// O layout é importado uma única vez (o mock de sessão lê ctx.valor a cada chamada), sem vi.resetModules.
let Casca: (p: { children: null }) => Promise<React.ReactElement>;
beforeAll(async () => {
  Casca = (await import('./(shell)/casca')).Casca as typeof Casca;
}, 30_000);

async function topo(eu: typeof EU_FALSO, filial: (typeof EU_FALSO)['filiais'][number]): Promise<string> {
  ctx.valor = { eu, filial };
  const h = renderToStaticMarkup(await Casca({ children: null }));
  return /<span class="nome-topo"[^>]*>.*?<\/span>/.exec(h)?.[0] ?? '';
}

describe('topo do BKO (A0)', () => {
  it('empresa = filial mostra um nome só', async () => {
    const f = { ...EU_FALSO.filiais[0]!, nome: EU_FALSO.empresa.razao_social };
    const h = await topo(EU_FALSO, f);
    expect(h).toContain('>Empresa de Demonstração Ltda</span>');
    expect(h).not.toContain('·');
  });
  it('nomes diferentes mostram os dois', async () => {
    const h = await topo(EU_FALSO, EU_FALSO.filiais[0]!);
    expect(h).toContain('>Empresa de Demonstração Ltda · Matriz Manaus</span>');
  });
  it('MEI longo (> 60 caracteres, com acento): um nome, title completo e reticências no CSS', async () => {
    expect(RAZAO_MEI_FALSA.length).toBeGreaterThan(60);
    const h = await topo(EU_FALSO_MEI, EU_FALSO_MEI.filiais[0]!);
    expect(h).toBe(`<span class="nome-topo" title="${RAZAO_MEI_FALSA}">${RAZAO_MEI_FALSA}</span>`);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(`${__dirname}/globals.css`, 'utf8')).toMatch(/\.topo \.nome-topo \{[^}]*text-overflow: ellipsis/);
    expect(readFileSync(`${__dirname}/globals.css`, 'utf8')).toMatch(/max-width: 800px\) \{ \.casca \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
  it('comparação: aparada, espaços colapsados e sem caixa; acento diferente conta como outro nome', () => {
    expect(nomeDoTopo('  Açaí   Ltda ', 'açaí ltda')).toBe('Açaí Ltda');
    expect(nomeDoTopo('Acai Ltda', 'Açaí Ltda')).toBe('Acai Ltda · Açaí Ltda');
  });
});
