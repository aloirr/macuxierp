import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssinaturaErp, appleTouchIconDataUri, faviconDataUri } from '@macuxierp/ui/marca';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DialogoMotivo } from '@macuxierp/ui';
import { CabecalhoCartao } from './cabecalho-cartao';
import { metadata } from './layout';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const fonte = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('identidade do shell (T-0021, ajustes B)', () => {
  it('o favicon do metadata é o data URI do símbolo da ui', () => {
    expect(metadata.icons).toMatchObject({ icon: faviconDataUri, apple: appleTouchIconDataUri });
  });
  it('o topo do shell usa a AssinaturaErp (sem texto de assinatura) e o layout importa botoes.css', () => {
    const casca = fonte('(shell)/layout.tsx');
    expect(casca).toContain('<AssinaturaErp />');
    expect(casca).not.toContain('NOME_PRODUTO');
    expect(fonte('layout.tsx')).toContain("@macuxierp/ui/botoes.css");
  });
  it('o CSS do shell não define .btn próprio nem usa borda-cinza em campo', () => {
    expect(css).not.toMatch(/\.btn\b/);
    expect(css).toMatch(/\.campo input \{[^}]*borda-campo/);
    expect(css).toMatch(/\.entrada[^{]*\{[^}]*borda-campo/);
  });
  it('o foco do Sair no topo é branco (WCAG 2.4.7)', () => {
    expect(css).toMatch(/\.topo \.mx-botao-secundario:focus-visible \{ outline-color: var\(--mx-cor-branco\)/);
    expect(css).not.toMatch(/\.mx-botao:hover/);
  });
  it('o diálogo de motivo recebe "Manter a nota" e o sinal destrutivo, sem cor nova', () => {
    const h = renderToStaticMarkup(<DialogoMotivo titulo="Cancelar" rotuloFechar="Manter a nota" destrutivo aoConfirmar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(h).toContain('>Manter a nota<');
    expect(h).toContain('data-destrutivo="true"');
  });
});

describe('assinatura no topo', () => {
  it('renderiza a imagem "Macuxi ERP" da ui', () => {
    const h = renderToStaticMarkup(<AssinaturaErp />);
    expect(h).toContain('alt="Macuxi ERP"');
    expect(h).toContain('data:image/svg+xml');
  });
});

describe('assinatura C no login e na seleção de filial', () => {
  it('o cabeçalho dos cartões renderiza a C (altura 62) e não o texto "Macuxi ERP"', () => {
    const h = renderToStaticMarkup(<CabecalhoCartao titulo="Acesse sua conta" />);
    expect(h).toContain('alt="Macuxi ERP"');
    expect(h).toContain('height="62"');
    expect(h).not.toMatch(/>Macuxi ERP</);
    expect(fonte('cabecalho-cartao.tsx')).toContain('<AssinaturaErp variante="C" />');
    expect(fonte('login/page.tsx')).toContain('CabecalhoCartao');
    expect(fonte('filial/page.tsx')).toContain('CabecalhoCartao');
  });
  it('a faixa é azul-noite pelo token e o padding preserva a área de proteção da C', () => {
    expect(css).toMatch(/\.cartao-central header \{[^}]*background: var\(--mx-cor-azul-noite\)/);
    expect(css).toMatch(/\.cartao-central header \{[^}]*padding: 20px 32px/);
  });
});
