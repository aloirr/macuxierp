import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { MANIFESTOS } from '@/lib/manifestos';
import { ListaEmpresas } from './lista-empresas';
import { TopoPlataforma } from './topo-plataforma';
import { PainelEmpresa } from './empresas/[id]/painel';

const base = { fuso: 'America/Manaus', created_at: '2026-11-23T12:00:00.000Z', updated_at: '2026-11-23T12:00:00.000Z' };
const lic = (...a: string[]) => ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'].map((modulo) => ({ modulo, ativo: modulo === 'core' || a.includes(modulo), valido_ate: null })) as EmpresaPlataforma['modulos'];
const acme: EmpresaPlataforma = { ...base, id: '11111111-1111-4111-8111-111111111111', slug: 'acme', nome: 'Acme Ltda', situacao: 'ativo', modulos: lic('cadastros', 'fiscal'), primeiro_admin: { id: '22222222-2222-4222-8222-222222222222', ativo: true, bloqueado: false } };
const beta: EmpresaPlataforma = { ...acme, id: '33333333-3333-4333-8333-333333333333', slug: 'beta', nome: 'Beta SA', situacao: 'suspenso', modulos: lic(), primeiro_admin: null };
const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
const chaves = { admin: 'k1', senha: 'k2', situacao: 'k3' };

describe('lista de empresas', () => {
  const h = renderToStaticMarkup(<ListaEmpresas empresas={[acme, beta]} vazio="Nenhuma empresa ainda. Crie a primeira." />);
  it('colunas Slug, Nome, Situação e Módulos, linha com rótulo "Abrir empresa <slug>"', () => {
    for (const t of ['Slug', 'Nome', 'Situação', 'Módulos']) expect(h).toContain(t);
    expect(h).toContain('Abrir empresa acme');
    expect(h).toMatch(/<a [^>]*href="\/config\/empresas\/11111111-1111-4111-8111-111111111111"[^>]*>acme<\/a>/);
    expect(h).toContain('tabela-rolavel com-sinal-rolagem');
    expect(readFileSync(join(__dirname, '../../globals.css'), 'utf8')).toMatch(/\.tabela-rolavel\.com-sinal-rolagem \{[^}]*local/);
    expect(h).toContain('Abrir empresa beta');
  });
  it('situação em texto (não só cor) e módulos ligados sem o core', () => {
    expect(h).toContain('Ativo');
    expect(h).toContain('Suspenso');
    expect(h).toContain('Cadastros, Fiscal');
    expect(h).not.toContain('referencia');
  });
  it('vazio mostra o texto da spec', () => {
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[]} vazio="Nenhuma empresa com esse slug. Limpe a busca." />)).toContain('Nenhuma empresa com esse slug. Limpe a busca.');
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
  it('módulos: core "Sempre ligado", dependência com motivo, salvar desabilitado sem mudança', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={beta} deps={deps} chaves={chaves} />);
    expect(h).toContain('Sempre ligado');
    expect(h).toMatch(/Exige [^<]*Fiscal/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Salvar módulos<\/button>/);
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
