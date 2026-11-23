import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { acumularPagina } from '@macuxierp/ui/paginacao';
import { dadosDaEmpresa } from '@/lib/config/empresa';
import { MANIFESTOS } from '@/lib/manifestos';
import { FormularioEmpresa } from './empresas/nova/formulario';
import { ListaEmpresas } from './lista-empresas';
import { TopoPlataforma } from './topo-plataforma';
import { PainelEmpresa } from './empresas/[id]/painel';

const base = { fuso: 'America/Manaus', created_at: '2026-11-23T12:00:00.000Z', updated_at: '2026-11-23T12:00:00.000Z' };
const lic = (...a: string[]) => ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'].map((modulo) => ({ modulo, ativo: modulo === 'core' || a.includes(modulo), valido_ate: null })) as EmpresaPlataforma['modulos'];
const acme: EmpresaPlataforma = { ...base, codigo: 'AM2808', id: '11111111-1111-4111-8111-111111111111', slug: 'acme', nome: 'Acme Ltda', situacao: 'ativo', modulos: lic('cadastros', 'fiscal'), primeiro_admin: { id: '22222222-2222-4222-8222-222222222222', ativo: true, bloqueado: false } };
const beta: EmpresaPlataforma = { ...acme, codigo: null, id: '33333333-3333-4333-8333-333333333333', slug: 'beta', nome: 'Beta SA', situacao: 'suspenso', modulos: lic(), primeiro_admin: null };
const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
const chaves = { admin: 'k1', senha: 'k2', situacao: 'k3' };

describe('lista de empresas', () => {
  const h = renderToStaticMarkup(<ListaEmpresas empresas={[acme, beta]} vazio="Nenhuma empresa ainda. Crie a primeira." />);
  it('colunas Código, Nome, Situação e Módulos, linha com rótulo "Abrir empresa <código>"', () => {
    for (const t of ['Código', 'Nome', 'Situação', 'Módulos']) expect(h).toContain(t);
    expect(h).toContain('Abrir empresa AM2808');
    expect(h).toMatch(/<a [^>]*href="\/config\/empresas\/11111111-1111-4111-8111-111111111111"[^>]*>AM2808<\/a>/);
    expect(h).toContain('tabela-rolavel com-sinal-rolagem');
    expect(h).not.toContain('>acme<');
    expect(readFileSync(join(__dirname, '../../globals.css'), 'utf8')).toMatch(/\.tabela-rolavel\.com-sinal-rolagem \{[^}]*local/);
    expect(h).toContain('Abrir empresa BETA');
  });
  it('situação em texto (não só cor) e módulos ligados sem o core', () => {
    expect(h).toContain('Ativo');
    expect(h).toContain('Suspenso');
    expect(h).toContain('Cadastros, Fiscal');
    expect(h).toContain('title="Cadastros, Fiscal"');
    expect(h).toContain('aria-label="Cadastros, Fiscal"');
    expect(h).toContain('>2 módulos<');
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[{ ...acme, modulos: lic('fiscal') }]} vazio="" />)).toContain('>1 módulo<');
    expect(h).toMatch(/<td[^>]*><span>0 módulos<\/span><\/td>/);
    expect(readFileSync(join(__dirname, '../../globals.css'), 'utf8')).toMatch(/@media \(max-width: 480px\) \{ \.modulos-lista \{ display: none; \} \.modulos-resumo \{ display: inline; \} \}/);
    expect(h).not.toContain('referencia');
  });
  it('vazio mostra o texto da spec', () => {
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[]} vazio="Nenhuma empresa com esse código. Limpe a busca." />)).toContain('Nenhuma empresa com esse código. Limpe a busca.');
  });
});

describe('topo do portal: sem menu de tenant', () => {
  const h = renderToStaticMarkup(<TopoPlataforma nome="Operadora" />);
  it('só o selo Plataforma, "Empresas" e Sair', () => {
    expect(h).toContain('Plataforma');
    expect(h).toContain('Empresas');
    expect(h).toContain('Sair');
    expect(h).toContain('mx-fundo-escuro');
  });
  it('nenhum módulo, filial, perfil nem NavLateral', () => {
    for (const t of ['Cadastros', 'Pedidos', 'Faturamento', 'Fiscal', 'Filial', 'filial', 'Licenças', 'lateral']) expect(h).not.toContain(t);
    const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/montarMenu|NavLateral|contexto\(\)|COOKIE_ACESSO/);
  });
});

describe('empresa: módulos, 1º administrador e situação', () => {
  it('módulos: sem a linha do Core nem "Sempre ligado", dependência com motivo, salvar desabilitado sem mudança', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={beta} deps={deps} chaves={chaves} />);
    expect(beta.modulos.some((m) => m.modulo === 'core')).toBe(true); // a API devolve o core; a tela filtra
    expect(h).not.toContain('Sempre ligado');
    expect(h).not.toMatch(/<li[^>]*>(?:(?!<\/li>).)*>Core</);
    expect(h).toMatch(/Exige [^<]*Fiscal/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Salvar módulos<\/button>/);
  });
  it('todo checkbox de módulo, inclusive o desabilitado por dependência, usa .mx-checkbox (#311)', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={beta} deps={deps} chaves={chaves} />);
    const caixas = h.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(caixas.length).toBeGreaterThan(1);
    for (const c of caixas) expect(c).toContain('class="mx-checkbox"');
    expect(caixas.some((c) => c.includes('disabled'))).toBe(true);
  });

  it('com administrador: só o estado e "Redefinir senha"; nem e-mail nem nome; sem senha na tela', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={acme} deps={deps} chaves={chaves} />);
    expect(h).toContain('Ativo');
    expect(h).toContain('Redefinir senha');
    expect(h).not.toContain('Criar administrador');
    expect(h).not.toContain('Esta senha não volta a aparecer'); // painel só depois da ação
    expect(h).not.toContain('Entrar como');
    expect(h).toContain('Suspender empresa');
  });
  it('administrador bloqueado aparece em texto; sem administrador: formulário com "Administrador" padrão', () => {
    const bloq = renderToStaticMarkup(<PainelEmpresa empresa={{ ...acme, primeiro_admin: { id: acme.primeiro_admin!.id, ativo: true, bloqueado: true } }} deps={deps} chaves={chaves} />);
    expect(bloq).toContain('Bloqueado');
    const sem = renderToStaticMarkup(<PainelEmpresa empresa={beta} deps={deps} chaves={chaves} />);
    expect(sem).toContain('Criar administrador');
    expect(sem).toContain('value="Administrador"');
    expect(sem).toContain('Reativar empresa');
  });
  it('nenhum diálogo aberto de saída; cada ação destrutiva usa o DialogoMotivo da spec', () => {
    expect(renderToStaticMarkup(<PainelEmpresa empresa={acme} deps={deps} chaves={chaves} />)).not.toContain('role="dialog"');
    const fonte = readFileSync(join(__dirname, 'empresas/[id]/painel.tsx'), 'utf8');
    for (const t of ['Redefinir a senha do administrador?', 'rotuloConfirmar="Redefinir"', "'Manter ativa'", 'Manter ligado', 'Não escreva dado pessoal no motivo', 'Os usuários da empresa deixam de entrar', 'Esta senha não volta a aparecer. Entregue ao administrador por canal seguro.']) {
      expect(fonte).toContain(t);
    }
    expect(fonte).not.toMatch(/localStorage|sessionStorage|console\./);
  });
});

describe('empresa: dados e e-mail do 1º administrador', () => {
  const completa = { ...acme, razao_social: 'Acme Comércio Ltda', cnpj: '12345678000195', cidade: 'Manaus', uf: 'AM', primeiro_admin: { ...acme.primeiro_admin!, email_mascarado: 'ad****@exemplo.com.br' } };
  it('empresa completa: dados com o CNPJ formatado e o e-mail mascarado com o botão "Mostrar"', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={completa} deps={deps} chaves={chaves} />);
    expect(h).toContain('<h2 id="h-dados">Dados da empresa</h2>');
    expect(h).toContain('Acme Comércio Ltda');
    expect(h).toContain('12.345.678/0001-95');
    expect(h).toContain('Manaus/AM');
    expect(h).toContain('23/11/2026 08:00');
    expect(h).toContain('ad****@exemplo.com.br');
    expect(h).toContain('Mostrar');
    expect(h).not.toContain('admin@exemplo.com.br');
  });
  it('campos null mostram "—"; sem máscara, sem o cartão do e-mail', () => {
    const vazios = dadosDaEmpresa({ ...acme, razao_social: null, cnpj: null, cidade: null, uf: null });
    expect(vazios.filter((l) => l.valor === '—').map((l) => l.rotulo)).toEqual(['Razão social', 'CNPJ', 'Cidade/UF']);
    expect(renderToStaticMarkup(<PainelEmpresa empresa={acme} deps={deps} chaves={chaves} />)).not.toContain('Mostrar');
  });
});

describe('CSS do portal: reaproveita .conteudo e .topo (1024 px e tela pequena)', () => {
  const css = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
  const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8');
  it('o conteúdo usa .conteudo, que já tem os @media de 801 a 1100 px e de até 800 px', () => {
    expect(layout).toContain('className="conteudo"');
    expect(css).not.toContain('conteudo-plataforma');
    expect(css).toMatch(/@media \(min-width: 801px\) and \(max-width: 1100px\)[^\n]*\.conteudo \{ padding: 24px; \}/);
    expect(css).toMatch(/@media \(max-width: 800px\)[^\n]*\.conteudo \{ padding: 16px; \}/);
  });
  it('o topo é .topo com .topo-plataforma só trocando o fundo grafite e a cor dos links', () => {
    expect(renderToStaticMarkup(<TopoPlataforma nome="Operadora" />)).toContain('class="topo topo-plataforma mx-fundo-escuro"');
    const regras = css.split('\n').filter((l) => l.startsWith('.topo-plataforma'));
    expect(regras.join('\n')).toMatch(/background: var\(--mx-cor-grafite\)/);
    expect(regras.join('\n')).not.toMatch(/display: flex|padding:/);
  });
});

describe('ajustes de marca e componentes do #309', () => {
  const css = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
  const fonte = readFileSync(join(__dirname, 'empresas/[id]/painel.tsx'), 'utf8');
  it('CSS: área de proteção da C (24 px), senha em 20 px/600 monoespaçada, títulos de cartão, borda de tabela e foco padrão', () => {
    expect(css).toMatch(/\.cartao-plataforma \.marca-login \{ margin: 0 0 24px; \}/);
    expect(css).toMatch(/\.senha-provisoria \{[^}]*font-size: var\(--mx-tamanho-grande\);[^}]*font-weight: 600/);
    expect(css).toMatch(/\.codigo, \.senha-provisoria \{ font-family: var\(--mx-fonte-codigo\)/);
    expect(css).toMatch(/\.bloco h2 \{ font-size: var\(--mx-tamanho-titulo-cartao\)/);
    expect(css).toMatch(/\.painel-senha \{[^}]*border: 1px solid var\(--mx-cor-borda-tabela\)/);
    expect(css).not.toMatch(/outline:\s*none/);
  });
  it('Desligar módulo e Redefinir senha usam DialogoMotivo semTexto (sem Observação)', () => {
    expect(fonte.match(/semTexto/g)).toHaveLength(2);
    expect(fonte).not.toContain('rotuloTexto="Observação"');
  });
  it('lista de empresas: "Carregar mais" só com próximo cursor, sem link ?cursor=', () => {
    const com = renderToStaticMarkup(<ListaEmpresas empresas={[acme]} vazio="" proximo="33333333-3333-4333-8333-333333333333" />);
    expect(com).toContain('Carregar mais');
    expect(com).not.toContain('cursor=');
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[acme]} vazio="" />)).not.toContain('Carregar mais');
    expect(readFileSync(join(__dirname, 'page.tsx'), 'utf8')).not.toContain('cursor=');
  });
  it('a página nova acumula sem duplicar', () => {
    const r = acumularPagina([acme], [{ ...acme, nome: 'Acme 2' }, beta], (e) => e.id);
    expect(r.map((e) => e.slug)).toEqual(['acme', 'beta']);
    expect(r[0]?.nome).toBe('Acme 2');
  });
});

describe('formulário Criar empresa', () => {
  const h = renderToStaticMarkup(<FormularioEmpresa chaveInicial="k" />);
  it('sem slug e sem UF; com código do FDV obrigatório', () => {
    expect(h).not.toContain('name="slug"');
    expect(h).toContain('Código do FDV');
    expect(h).not.toContain('(opcional)');
    expect(h).toContain('name="codigo"');
    expect(h).not.toContain('name="uf"');
  });
  it('o form nunca é GET, nem antes da hidratação (nada de dado na URL)', () => {
    expect(h).toMatch(/<form [^>]*method="post"/);
    expect(h).not.toMatch(/method="get"/i);
  });
  it('o fuso é um select com os 15 fusos do Brasil, padrão America/Manaus', () => {
    expect(h).toMatch(/<select name="fuso"/);
    expect(h.match(/<option /g)).toHaveLength(15);
    expect(h).toContain('<option value="America/Noronha">Fernando de Noronha (UTC−2)</option>');
    expect(h).toContain('<option value="America/Manaus" selected="">Manaus (UTC−4)</option>');
    expect(h).toContain('<option value="America/Rio_Branco">Rio Branco (UTC−5)</option>');
    expect(h).not.toMatch(/>America\//);
    expect(h).not.toContain('UTC-');
    expect(h).not.toMatch(/<input name="fuso"/);
  });
  it('o código vai para maiúsculas ao digitar (CSS e valor) e no envio', () => {
    expect(h).toMatch(/<input class="codigo-maiusculo"[^>]*name="codigo"/);
    const css = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
    expect(css).toMatch(/\.codigo-maiusculo \{ text-transform: uppercase/);
    expect(readFileSync(join(__dirname, 'empresas/nova/formulario.tsx'), 'utf8')).toContain(".trim().toUpperCase()");
  });
  it('CSS: ações do /config sem quebrar por dentro; falha do BKO em texto secundário a 13 px', () => {
    const css = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
    expect(css).toMatch(/td:nth-child\(5\) button \{ white-space: nowrap/);
    expect(css).toMatch(/\.falha-sob-nome \{ display: block; font-size: 13px; color: var\(--mx-cor-texto-secundario\)/);
  });
});
