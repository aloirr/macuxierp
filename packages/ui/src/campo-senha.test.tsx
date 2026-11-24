import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampoSenha } from './CampoSenha.js';
import { gerarCssBotoes } from './estilos.js';

type Props = Parameters<typeof CampoSenha>[0];
const campo = (extra: Partial<Props> = {}) =>
  renderToStaticMarkup(<CampoSenha id="senha" rotulo="Senha" valor="" aoMudar={() => {}} visivel={false} aoAlternar={() => {}} {...extra} />);

describe('CampoSenha (T-0094, alinhado ao FDV)', () => {
  it('oculta: campo password e botão "Mostrar senha" com ícone de 18 px', () => {
    const h = campo();
    expect(h).toMatch(/<input[^>]*type="password"/);
    expect(h).toMatch(/<button[^>]*aria-label="Mostrar senha"/);
    expect(h).not.toContain('M3 3l18 18');
    expect(h).toMatch(/<svg[^>]*width="18"[^>]*height="18"/);
  });

  it('visível: campo text, botão "Ocultar senha" e olho riscado (o rótulo troca com `visivel`)', () => {
    const h = campo({ visivel: true });
    expect(h).toMatch(/<input[^>]*type="text"/);
    expect(h).toMatch(/<button[^>]*aria-label="Ocultar senha"/);
    expect(h).toContain('M3 3l18 18');
  });

  it('sem aoAlternar não há olho, mesmo visível, e o recuo do texto volta ao normal', () => {
    const h = campo({ aoAlternar: undefined, visivel: true });
    expect(h).not.toContain('<button');
    expect(h).not.toContain('<svg');
    expect(h).toMatch(/<input[^>]*type="text"/);
    expect(h).toContain('padding:0 12px 0 12px');
  });

  it('com olho: campo de 44 px e recuo de 48 px à direita; botão 44×44 colado à direita, só ícone', () => {
    const h = campo();
    expect(h).toContain('height:44px');
    expect(h).toContain('padding:0 48px 0 12px');
    const botao = h.match(/<button[^>]*>/)?.[0] ?? '';
    expect(botao).toContain('type="button"');
    expect(botao).toContain('class="mx-olho"');
    expect(botao).toContain('width:44px;height:44px');
    expect(botao).toContain('right:0');
    expect(botao).toContain('background:transparent');
    expect(botao).toContain('border:none');
    expect(botao).toContain('color:var(--mx-cor-texto-secundario)');
    expect(botao).not.toContain('aria-pressed');
    expect(h).not.toMatch(/<button[^>]*>[^<]*[A-Za-z]/);
  });

  it('hover em grafite e foco de 2 px com offset −2 px em azul-noite (classe .mx-olho)', () => {
    const css = gerarCssBotoes();
    expect(css).toContain('.mx-olho:hover:not(:disabled) {\n  color: var(--mx-cor-grafite);\n}');
    expect(css).toContain('.mx-olho:focus-visible {\n  outline: 2px solid var(--mx-cor-azul-noite);\n  outline-offset: -2px;\n}');
  });

  it('finalidade: padrão current-password; criacao new-password; sem correção, maiúscula nem spellcheck', () => {
    expect(campo()).toContain('autoComplete="current-password"');
    expect(campo({ finalidade: 'entrada' })).toContain('autoComplete="current-password"');
    const h = campo({ finalidade: 'criacao', rotulo: 'Senha nova' });
    expect(h).toContain('autoComplete="new-password"');
    expect(h).toContain('autoCapitalize="none"');
    expect(h).toContain('autoCorrect="off"');
    expect(h).toContain('spellCheck="false"');
  });

  it('rótulo de 13 px semibold ligado ao campo; ícone escondido do leitor', () => {
    const h = campo({ rotulo: 'Senha nova' });
    expect(h).toContain('<label for="senha"');
    expect(h).toContain('font-size:var(--mx-tamanho-pequeno)');
    expect(h).toContain('font-weight:var(--mx-peso-rotulo-campo)');
    expect(h).toContain('>Senha nova</label>');
    expect(h).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it('erro: aria-invalid, role=alert de 12 px e aria-describedby = descrito + <id>-erro', () => {
    const h = campo({ erro: 'Informe a senha.', descrito: 'regras-senha' });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('aria-describedby="regras-senha senha-erro"');
    expect(h).toMatch(/id="senha-erro"[^>]*role="alert"|role="alert"[^>]*id="senha-erro"/);
    expect(h).toMatch(/>Informe a senha\.</);
    expect(h).toContain('var(--mx-cor-erro-texto)');
    expect(h).toContain('font-size:var(--mx-tamanho-micro)');
  });

  it('só descrito, sem erro: describedby com a lista de regras e sem aria-invalid', () => {
    const h = campo({ descrito: 'regras-senha' });
    expect(h).toContain('aria-describedby="regras-senha"');
    expect(h).not.toContain('aria-invalid');
  });

  it('sem erro nem descrito: sem aria-invalid nem describedby; cores só por token', () => {
    const h = campo();
    expect(h).not.toContain('aria-invalid');
    expect(h).not.toContain('aria-describedby');
    expect(h).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
