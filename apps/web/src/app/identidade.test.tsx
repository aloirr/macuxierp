import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { faviconDataUri } from '@macuxierp/ui/marca';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DialogoMotivo } from '@macuxierp/ui';
import { metadata } from './layout';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const fonte = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('identidade do shell (T-0021, ajustes B)', () => {
  it('o favicon do metadata é o data URI do símbolo da ui', () => {
    expect(metadata.icons).toMatchObject({ icon: faviconDataUri });
  });
  it('o topo do shell usa a AssinaturaErp (sem texto de assinatura) e o layout importa botoes.css', () => {
    const casca = fonte('(shell)/layout.tsx');
    expect(casca).toContain('<Assinatura />');
    expect(casca).not.toContain('NOME_PRODUTO');
    expect(fonte('layout.tsx')).toContain("@macuxierp/ui/botoes.css");
  });
  it('o CSS do shell não define .btn próprio nem usa borda-cinza em campo', () => {
    expect(css).not.toMatch(/\.btn\b/);
    expect(css).toMatch(/\.campo input \{[^}]*borda-campo/);
    expect(css).toMatch(/\.entrada[^{]*\{[^}]*borda-campo/);
  });
  it('o hover provisório usa só tokens, sem filter/brightness', () => {
    const hover = css.match(/[^\n}]*:hover[^{]*\{[^}]*\}/g) ?? [];
    expect(hover.length).toBeGreaterThan(0);
    for (const r of hover) expect(r).not.toMatch(/filter|brightness|#[0-9a-f]{3,6}\b/i);
    expect(css).toMatch(/\.mx-botao:hover:not\(:disabled\) \{ background: var\(--mx-cor-grafite\)/);
  });
  it('o diálogo de motivo recebe "Manter a nota" e o sinal destrutivo, sem cor nova', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="Cancelar" rotuloFechar="Manter a nota" destrutivo aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(h).toContain('>Manter a nota<');
    expect(h).toContain('data-destrutivo="true"');
  });
});

describe('assinatura no topo', () => {
  it('renderiza a imagem "Macuxi ERP" da ui', async () => {
    const { Assinatura } = await import('./(shell)/assinatura');
    const h = renderToStaticMarkup(<Assinatura />);
    expect(h).toContain('alt="Macuxi ERP"');
    expect(h).toContain('data:image/svg+xml');
  });
});
