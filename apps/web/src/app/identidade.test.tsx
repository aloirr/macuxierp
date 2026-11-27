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
    expect(metadata.icons).toMatchObject({ icon: faviconDataUri, apple: [{ url: appleTouchIconDataUri, sizes: '180x180' }] });
  });
  it('o topo do shell usa a AssinaturaErp (sem texto de assinatura) e o layout importa botoes.css', () => {
    const casca = fonte('(shell)/layout.tsx');
    expect(casca).toContain('<AssinaturaErp />');
    expect(casca).not.toContain('NOME_PRODUTO');
    expect(fonte('layout.tsx')).toContain("@macuxierp/ui/botoes.css");
  });
  it('o CSS do shell não define .btn próprio nem usa borda-cinza em campo', () => {
    expect(css).not.toMatch(/\.btn\b/);
    expect(css).toMatch(/\.campo input, \.campo select \{[^}]*borda-campo/);
    expect(css).toMatch(/\.entrada[^{]*\{[^}]*borda-campo/);
  });
  it('o foco no topo, no menu e no cartão é branco pela .mx-fundo-escuro do ui', () => {
    expect(fonte('(shell)/layout.tsx')).toMatch(/<header className="topo mx-fundo-escuro">/);
    expect(renderToStaticMarkup(<CabecalhoCartao titulo="X" />)).toContain('<header class="mx-fundo-escuro">');
    expect(css).not.toMatch(/\.topo[^{]*:focus-visible/);
    expect(css).not.toMatch(/\.lateral[^{]*:focus-visible/);
    const botoes = readFileSync(require.resolve('@macuxierp/ui/botoes.css'), 'utf8');
    expect(botoes).toMatch(/\.mx-fundo-escuro :focus-visible \{[^}]*var\(--mx-cor-branco\)/);
  });
  it('o diálogo de motivo recebe "Manter a nota" e o sinal destrutivo, sem cor nova além do vermelho do destrutivo (opção B)', () => {
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
  it('o cabeçalho dos cartões renderiza a C (altura 100) e não o texto "Macuxi ERP"', () => {
    const h = renderToStaticMarkup(<CabecalhoCartao titulo="Acesse sua conta" />);
    expect(h).toContain('alt="Macuxi ERP"');
    expect(h).toContain('height="100"');
    expect(h).not.toMatch(/>Macuxi ERP</);
    expect(fonte('cabecalho-cartao.tsx')).toContain('<AssinaturaErp variante="C" altura={100} />');
    expect(fonte('login/formulario.tsx')).toContain('CabecalhoCartao');
    expect(fonte('filial/page.tsx')).toContain('CabecalhoCartao');
  });
  it('a faixa é azul-noite pelo token e o padding preserva a área de proteção da C', () => {
    expect(css).toMatch(/\.cartao-central header \{[^}]*background: var\(--mx-cor-azul-noite\)/);
    expect(css).toMatch(/\.cartao-central header \{[^}]*padding: 24px 32px/);
  });
  it('o grupo-campos segue o raio do tema e o rádio usa .mx-radio', () => {
    expect(css).not.toContain('accent-color');
    expect(css).toMatch(/fieldset\.grupo-campos \{[^}]*border-radius: 6px/);
  });

  it('o menu lateral usa o token de rótulo e o cartão de login tem 16 px de margem lateral em tela pequena (T-0051)', () => {
    expect(css).toMatch(/\.lateral h2 \{[^}]*font-size: var\(--mx-tamanho-rotulo-menu\)/);
    expect(css).not.toContain('--mx-tamanho-titulo-grupo');
    expect(css).toMatch(/@media \(max-width: 480px\) \{[^}]*\.cartao-central \{[^}]*margin-left: 16px; margin-right: 16px/);
  });
});
