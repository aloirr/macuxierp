import { describe, expect, expectTypeOf, it } from 'vitest';
import { PERFIS } from './modulo';
import { paginaVisivel, type PaginaBase } from './paginas';
import { pode, type Acao } from './permissoes';

// Formatos atuais das páginas (RD-0178): os módulos passam a estender `PaginaBase` e continuam atribuíveis a ela.
interface FormatoPaginaCore extends PaginaBase {
  id: string;
  menu: 'Empresa' | 'Usuários e perfis';
  ver: Acao;
  rf: string;
  filtros: readonly string[];
  exportaCsv: boolean;
  botoes: readonly { id: string; rotulo: string; acao: Acao; confirma?: boolean }[];
}

interface FormatoPaginaCadastros extends PaginaBase {
  id: string;
  api: string;
  colunas: readonly { chave: string; rotulo: string; exige?: Acao }[];
  filtros: readonly string[];
  editar?: Acao;
  restritos?: readonly { campo: string; exige: Acao }[];
}

interface FormatoPaginaCarga extends PaginaBase {
  api: string;
  maxArquivos: number;
}

const CARGA: FormatoPaginaCarga = {
  id: 'carga',
  menu: 'Carga de cadastros',
  titulo: 'Carga de cadastros',
  rota: '/cadastros/carga-de-cadastros',
  ver: 'cadastros.carga.executar',
  api: '/v1/cadastros/cargas',
  maxArquivos: 16,
};

describe('PaginaBase (RD-0178): um tipo de página para os módulos e o shell', () => {
  it('as páginas do core, do cadastros e a carga são atribuíveis ao tipo base', () => {
    expectTypeOf<FormatoPaginaCore>().toMatchTypeOf<PaginaBase>();
    expectTypeOf<FormatoPaginaCadastros>().toMatchTypeOf<PaginaBase>();
    expectTypeOf<FormatoPaginaCarga>().toMatchTypeOf<PaginaBase>();
    // O shell concatena os arrays sem `.map` de cópia.
    const todas: readonly PaginaBase[] = [...([] as FormatoPaginaCore[]), ...([] as FormatoPaginaCadastros[]), CARGA];
    expect(todas).toHaveLength(1);
    expect(paginaVisivel(CARGA, 'administrador')).toBe(true);
  });

  it('campos: menu, titulo e rota obrigatórios; id, aviso e ver opcionais; ver é Acao', () => {
    expectTypeOf<PaginaBase['menu']>().toEqualTypeOf<string>();
    expectTypeOf<PaginaBase['titulo']>().toEqualTypeOf<string>();
    expectTypeOf<PaginaBase['rota']>().toEqualTypeOf<string>();
    expectTypeOf<PaginaBase['id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PaginaBase['aviso']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PaginaBase['ver']>().toEqualTypeOf<Acao | undefined>();
    // @ts-expect-error: `ver` fora da matriz de permissões não compila.
    const errada: PaginaBase = { menu: 'X', titulo: 'X', rota: '/core/x', ver: 'core.nao.existe' };
    expect(errada.menu).toBe('X');
  });
});

describe('paginaVisivel (esconde, não protege: a API checa de novo, RN-CORE-02)', () => {
  it('sem `ver`, todo perfil vê a página', () => {
    for (const perfil of PERFIS) expect(paginaVisivel({ menu: 'Clientes', titulo: 'Clientes', rota: '/cadastros/clientes' }, perfil)).toBe(true);
  });

  it('com `ver`, só quem `pode` a ação', () => {
    const pagina: PaginaBase = { menu: 'Empresa', titulo: 'Certificado A1', rota: '/core/empresa/certificado', ver: 'core.certificado.gerir' };
    for (const perfil of PERFIS) expect(paginaVisivel(pagina, perfil)).toBe(pode(perfil, 'core.certificado.gerir'));
  });
});
