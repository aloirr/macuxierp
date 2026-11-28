import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { acumularPagina } from '@macuxierp/ui/paginacao';
import { lugarDaEmpresa, textoCriadaEm } from '@/lib/config/empresa';
import { MANIFESTOS } from '@/lib/manifestos';
import { FormularioEmpresa } from './empresas/nova/formulario';
import { ListaEmpresas } from './lista-empresas';
import { TopoPlataforma } from './topo-plataforma';
import { PainelEmpresa } from './empresas/[id]/painel';

const base = { tem_fdv: false, fuso: 'America/Manaus', created_at: '2026-11-23T12:00:00.000Z', updated_at: '2026-11-23T12:00:00.000Z' };
const lic = (...a: string[]) => ['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'].map((modulo) => ({ modulo, ativo: modulo === 'core' || a.includes(modulo), valido_ate: null })) as EmpresaPlataforma['modulos'];
const acme: EmpresaPlataforma = { ...base, codigo: 'AM2808', id: '11111111-1111-4111-8111-111111111111', slug: 'acme', nome: 'Acme Ltda', situacao: 'ativo', modulos: lic('cadastros', 'fiscal'), primeiro_admin: { id: '22222222-2222-4222-8222-222222222222', ativo: true, bloqueado: false } };
const beta: EmpresaPlataforma = { ...acme, codigo: null, id: '33333333-3333-4333-8333-333333333333', slug: 'beta', nome: 'Beta SA', situacao: 'suspenso', modulos: lic(), primeiro_admin: null };
const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
const chaves = { situacao: 'k3' };

describe('lista de empresas', () => {
  const h = renderToStaticMarkup(<ListaEmpresas empresas={[acme, beta]} vazio="Nenhuma empresa ainda. Crie a primeira." />);
  it('colunas como a simulação 124 A (Empresa, Código, CNPJ, Situação, Macuxi FDV, Módulos, Criada em, Ações), linha com rótulo "Abrir empresa <código>"', () => {
    expect([...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(['Empresa', 'Código', 'CNPJ', 'Situação', 'Macuxi FDV', 'Módulos', 'Criada em', '']);
    expect(h).toContain('<span class="codigo">AM2808</span>'); // o código é texto; o link é o nome
    expect(h).toContain('Abrir empresa AM2808');
    expect(h).toMatch(/<a [^>]*href="\/config\/empresas\/11111111-1111-4111-8111-111111111111"[^>]*>Acme Ltda<\/a>/);
    expect(h).toContain('tabela-rolavel com-sinal-rolagem');
    expect(h).not.toContain('>acme<');
    expect(readFileSync(join(__dirname, '../../globals.css'), 'utf8')).toMatch(/\.tabela-rolavel\.com-sinal-rolagem \{[^}]*local/);
    expect(h).toContain('Abrir empresa BETA');
  });
  it('situação em texto (não só cor) e módulos ligados sem o core', () => {
    expect(h).toContain('Ativo');
    expect(h).toContain('Suspenso');
    expect(h).toContain('Cadastros · Fiscal'); // separados por " · ", como a 124 A
    expect(h).toContain('title="Cadastros · Fiscal"');
    expect(h).toContain('aria-label="Cadastros · Fiscal"');
    expect(h).toContain('>2 módulos<');
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[{ ...acme, modulos: lic('fiscal') }]} vazio="" />)).toContain('>1 módulo<');
    expect(h).toMatch(/<td[^>]*><span>0 módulos<\/span><\/td>/);
    expect(readFileSync(join(__dirname, '../../globals.css'), 'utf8')).toMatch(/@media \(max-width: 480px\) \{ \.modulos-lista \{ display: none; \} \.modulos-resumo \{ display: inline; \} \}/);
    expect(h).not.toContain('referencia');
  });
  it('124 A e RD-2360 a RD-2363: um título só com a contagem, a busca única na mesma linha, sem botão, e "Nova empresa" abaixo da tabela', () => {
    expect(h.match(/<h1>/g)).toHaveLength(1);
    expect(h).toContain('<h1>Empresas <span class="contagem">· 2</span></h1>');
    expect(h.indexOf('class="busca-lista"')).toBeLessThan(h.indexOf('<table'));
    expect(h.match(/type="search"/g)).toHaveLength(1);
    expect(h).toContain('placeholder="Buscar por código ou nome"');
    expect(h).not.toMatch(/>Buscar<\/button>|Criar empresa|Buscar por código</);
    expect(h.indexOf('>Nova empresa</a>')).toBeGreaterThan(h.indexOf('</table>'));
    expect(h).toMatch(/class="barra-acoes barra-rodape-lista"><a class="mx-botao" href="\/config\/empresas\/nova">Nova empresa<\/a><\/div>/);
    const css = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
    expect(css).toContain('.titulo-lista h1 { grid-column: span 8;');
    expect(css).toContain('.titulo-lista .busca-lista { grid-column: span 4;');
  });
  it('vazio mostra o texto da spec', () => {
    expect(renderToStaticMarkup(<ListaEmpresas empresas={[]} vazio="Nenhuma empresa com esse código. Limpe a busca." />)).toContain('Nenhuma empresa com esse código. Limpe a busca.');
  });
});

describe('topo do portal: sem menu de tenant', () => {
  const h = renderToStaticMarkup(<TopoPlataforma nome="Operadora" />);
  it('só o selo Plataforma e Sair, sem o link "Empresas" (RD-2360)', () => {
    expect(h).toContain('Plataforma');
    expect(h).not.toContain('Empresas');
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
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Salvar<\/button>/);
  });
  it('todo checkbox de módulo, inclusive o desabilitado por dependência, usa .mx-checkbox (#311)', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={beta} deps={deps} chaves={chaves} />);
    const caixas = h.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(caixas.length).toBeGreaterThan(1);
    for (const c of caixas) expect(c).toContain('class="mx-checkbox"');
    expect(caixas.some((c) => c.includes('disabled'))).toBe(true);
  });

  it('Config v4: o 1º administrador saiu do painel (vira a linha de Usuários); o Suspender fica no rodapé fixo da página, em vermelho', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={acme} deps={deps} chaves={chaves} />);
    expect(h).not.toContain('1º administrador');
    expect(h).not.toContain('Criar administrador');
    expect(h).not.toContain('Entrar como');
    expect(h).toContain('id="h-usuarios"');
    const rodape = h.slice(h.indexOf('class="rodape-pagina"'));
    expect(rodape).toMatch(/class="mx-botao-destrutivo rodape-suspender"[^>]*>Suspender</);
    expect(h).not.toContain('id="h-situacao"'); // RD-2368: sem o bloco Situação
    expect(h.indexOf('id="h-usuarios"')).toBeLessThan(h.indexOf('class="rodape-pagina"'));
    expect(renderToStaticMarkup(<PainelEmpresa empresa={beta} deps={deps} chaves={chaves} />)).toContain('>Reativar<');
  });
  it('nenhum diálogo aberto de saída; cada ação destrutiva usa o DialogoMotivo da spec', () => {
    expect(renderToStaticMarkup(<PainelEmpresa empresa={acme} deps={deps} chaves={chaves} />)).not.toContain('role="dialog"');
    const fonte = readFileSync(join(__dirname, 'empresas/[id]/painel.tsx'), 'utf8');
    for (const t of ["'Manter ativa'", 'Manter ligado', 'Não escreva dado pessoal no motivo', 'Os usuários da empresa deixam de entrar']) {
      expect(fonte).toContain(t);
    }
    expect(fonte).not.toMatch(/localStorage|sessionStorage|console\./);
  });
});

describe('empresa: Ficha com o CNPJ (docs/design/telas-horizontais §3)', () => {
  const completa = { ...acme, razao_social: 'Acme Comércio Ltda', cnpj: '12345678000195', cidade: 'Manaus', uf: 'AM', primeiro_admin: acme.primeiro_admin };
  it('empresa completa: a Ficha (bloco largo) traz a razão social, o CNPJ formatado e a cidade; sem cartão "Dados da empresa"', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={completa} deps={deps} chaves={chaves} cnpj={{ permitida: true }} />);
    expect(h).not.toContain('Dados da empresa');
    expect(h).toContain('class="bloco bloco-largo ficha-editavel"');
    expect(h.indexOf('id="h-ficha"')).toBeLessThan(h.indexOf('id="h-modulos"'));
    expect(h).toContain('value="Acme Comércio Ltda"');
    expect(h).toContain('12.345.678/0001-95');
    expect(h).toContain('>Trocar CNPJ</button>');
    expect(h).toContain('Manaus/AM');
  });
  it('RD-2370: a barra do rodapé da página é "Salvar · Atualizar · Trocar CNPJ", com o Suspender sozinho à direita; nenhum botão no meio da ficha', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={completa} deps={deps} chaves={chaves} cnpj={{ permitida: true }} />);
    // no servidor a barra da ficha fica no rodapé do cartão; no navegador ela vai, por portal, para o rodapé da página, antes do Suspender
    const textos = (t: string) => [...t.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    const barra = h.slice(h.indexOf('class="barra-acoes rodape-cartao"'));
    expect(textos(barra.slice(0, barra.indexOf('</div>')))).toEqual(['Salvar', 'Atualizar', 'Trocar CNPJ']);
    expect(textos(h.slice(h.indexOf('class="rodape-pagina"')))).toEqual(['Suspender']);
    const campos = h.slice(h.indexOf('id="h-ficha"'), h.indexOf('class="barra-acoes rodape-cartao"'));
    expect(campos).not.toMatch(/>(Trocar CNPJ|Atualizar)<\/button>/);
    const css = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
    expect(css).toContain('.rodape-pagina .rodape-suspender { margin-left: auto; }');
  });
  it('CNPJ bloqueado (RN-CORE-16): sem o botão e com o motivo que a API devolveu; sem a leitura, fica fechado', () => {
    const msg = 'O CNPJ não pode ser trocado: a empresa já tem NF-e autorizada em produção';
    const h = renderToStaticMarkup(<PainelEmpresa empresa={completa} deps={deps} chaves={chaves} cnpj={{ permitida: false, motivo: 'nfe_autorizada_producao', mensagem: msg }} />);
    expect(h).not.toContain('Trocar CNPJ');
    expect(h).toContain(`${msg}.`);
    const sem = renderToStaticMarkup(<PainelEmpresa empresa={completa} deps={deps} chaves={chaves} />);
    expect(sem).not.toContain('Trocar CNPJ');
    expect(sem).toContain('Não foi possível verificar as notas agora; tente de novo.');
  });
  it('sem CNPJ: "—" e nenhuma troca; sem máscara, sem o "Mostrar" do e-mail', () => {
    const h = renderToStaticMarkup(<PainelEmpresa empresa={acme} deps={deps} chaves={chaves} />);
    expect(h).toContain('<p class="valor-cnpj" aria-labelledby="rotulo-cnpj">—</p>');
    expect(h).not.toContain('Trocar CNPJ');
    expect(h).not.toContain('Mostrar');
  });
  it('Cidade/UF: o cadastro manda; sem ele, a ficha da Receita (nome do município ou só a UF); criada em, no fuso', () => {
    const semLugar = { cidade: null, uf: null };
    const f = { municipio_ibge: '1302603', uf: 'AM' };
    expect(lugarDaEmpresa(semLugar, f)).toBe('AM');
    expect(lugarDaEmpresa({ ...semLugar, cidade: 'Manaus' }, f)).toBe('Manaus/AM');
    expect(lugarDaEmpresa(semLugar, { uf: null })).toBeNull();
    expect(lugarDaEmpresa(semLugar, { ...f, municipio_nome: 'Manaus' })).toBe('Manaus/AM');
    expect(lugarDaEmpresa({ ...semLugar, cidade: 'Parintins' }, { ...f, municipio_nome: 'Manaus' })).toBe('Parintins/AM');
    expect(textoCriadaEm(acme)).toBe('Criada em 23/11/2026 08:00');
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
    expect(css).toMatch(/\.frase-confirmar \{[^}]*font-family: var\(--mx-fonte-codigo\);[^}]*font-weight: var\(--mx-peso-rotulo-campo\);[^}]*color: var\(--mx-cor-grafite\);[^}]*background: var\(--mx-cor-nevoa\);[^}]*border: 1px solid var\(--mx-cor-borda-tabela\);[^}]*box-decoration-break: clone/);
    expect(css).not.toMatch(/\.frase-confirmar \{[^}]*nowrap/);
    expect(css).toMatch(/\.segredo \{[^}]*font-family: var\(--mx-fonte-codigo\)/);
    expect(css).not.toContain('ui-monospace, monospace');
    expect(readFileSync(join(__dirname, '../../../components/frase-confirmacao.tsx'), 'utf8')).toContain('className="frase-confirmar"');
    expect(css).toMatch(/\.bloco h2 \{ font-size: var\(--mx-tamanho-titulo-cartao\)/);
    expect(css).not.toContain('.painel-senha'); // o painel da senha do 1º administrador saiu na Config v4
    expect(css).not.toMatch(/outline:\s*none/);
  });
  it('Desligar módulo usa DialogoMotivo semTexto (sem Observação)', () => {
    expect(fonte.match(/semTexto/g)).toHaveLength(1);
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
});
