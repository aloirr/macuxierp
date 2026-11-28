import { describe, expect, it } from 'vitest';
import type { EuResposta } from '@macuxierp/platform-sdk';
import { telaDaRota, escritaDeclarada } from '../../telas';
import { MANIFESTOS } from '../../manifestos';
import { montarMenu, resolverPagina } from '../../menu';
import { paginasDoMenu } from '../../paginas';
import {
  LISTA_ESTOQUE, PAGINAS_CADASTROS_OUTROS, ROTA_ESTOQUE, ROTA_OFICIAIS, ROTA_OFICIAIS_CEST, ROTA_OFICIAIS_CFOP, ROTA_OFICIAIS_IBGE, TABELAS_OFICIAIS_TELA, paginaEstoque,
} from './index';
import { formatarCest, formatarNcm } from './oficiais';

const FUSO = 'America/Manaus';
const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const modulos = [{ id: 'cadastros' as EuResposta['modulos'][number]['id'], menus: ['Estoque', 'Tabelas oficiais'] }];
const menu = (perfil: 'gerente' | 'vendedor') => montarMenu(modulos, MANIFESTOS, perfil);

describe('Estoque (T-0123, lote A)', () => {
  it('registra a lista só de leitura: sem Novo, sem linha clicável e sem escrita declarada', () => {
    expect(telaDaRota(ROTA_ESTOQUE)).toBe(LISTA_ESTOQUE);
    expect(LISTA_ESTOQUE.novo).toBeUndefined();
    expect(LISTA_ESTOQUE.rotaDaLinha).toBeUndefined();
    expect(escritaDeclarada('POST', '/v1/cadastros/estoque/movimentos')).toBe(false);
    expect(paginaEstoque.api).toBe('/v1/cadastros/estoque');
    expect(paginaEstoque.csv).toBe(false);
  });

  it('saldo em qtd4 sai com vírgula e milhar; filial e produto são filtros de cadastro (nome no lugar do UUID)', () => {
    const linha = LISTA_ESTOQUE.linha({ id: ID, filial_id: ID, produto_id: ID, quantidade: 12500000 }, FUSO);
    expect(linha).toMatchObject({ quantidade: '1.250', filial_id: ID });
    expect(LISTA_ESTOQUE.linha({ id: ID, filial_id: ID, produto_id: ID, quantidade: -5000 }, FUSO).quantidade).toBe('-0,5');
    expect(LISTA_ESTOQUE.filtrosTela.map((f) => [f.chave, f.tipo, f.fonte])).toEqual([
      ['filial_id', 'cadastro', '/v1/cadastros/filiais'], ['produto_id', 'cadastro', '/v1/cadastros/produtos'],
    ]);
    expect(LISTA_ESTOQUE.colunas('gerente', FUSO).find((c) => c.id === 'quantidade')?.tipo).toBe('numero');
  });

  it('a consulta da página aceita busca, filial, produto, limite e cursor', () => {
    expect(paginaEstoque.chaves).toEqual(expect.arrayContaining(['busca', 'filial_id', 'produto_id', 'cursor', 'limite']));
    expect(paginaEstoque.item.parse({ id: ID, filial_id: ID, produto_id: ID, quantidade: 10000 }).quantidade).toBe(10000);
  });
});

describe('Tabelas oficiais (T-0123, lote A)', () => {
  it('quatro seções, cada uma com a API da própria tabela, só leitura', () => {
    expect(TABELAS_OFICIAIS_TELA.map((t) => [t.titulo, t.pagina.api])).toEqual([
      ['NCM', '/v1/cadastros/oficiais/ncm'], ['CEST', '/v1/cadastros/oficiais/cest'], ['CFOP', '/v1/cadastros/oficiais/cfop'], ['Municípios (IBGE)', '/v1/cadastros/oficiais/municipios'],
    ]);
    for (const t of TABELAS_OFICIAIS_TELA) {
      expect(telaDaRota(t.rota)).toBe(t.lista);
      expect(t.lista.tipo === 'lista' && t.lista.novo).toBeUndefined();
      expect(t.pagina.busca).toBe(true);
    }
    expect(escritaDeclarada('POST', '/v1/cadastros/oficiais/ncm')).toBe(false);
  });

  it('filtros: vigência em todas, UF só nos municípios', () => {
    const por = Object.fromEntries(TABELAS_OFICIAIS_TELA.map((t) => [t.rota, t.lista.filtrosTela.map((f) => f.chave)]));
    expect(por[ROTA_OFICIAIS]).toEqual(['data']);
    expect(por[ROTA_OFICIAIS_CEST]).toEqual(['data']);
    expect(por[ROTA_OFICIAIS_CFOP]).toEqual(['data']);
    expect(por[ROTA_OFICIAIS_IBGE]).toEqual(['uf', 'data']);
    expect(TABELAS_OFICIAIS_TELA[3]!.pagina.chaves).toEqual(expect.arrayContaining(['uf', 'data', 'busca', 'cursor']));
  });

  it('linhas formatadas: NCM com pontos, CEST com pontos, data civil em dd/mm/aaaa', () => {
    expect(formatarNcm('22021000')).toBe('2202.10.00');
    expect(formatarNcm('2202')).toBe('2202');
    expect(formatarCest('0300100')).toBe('03.001.00');
    const ncm = TABELAS_OFICIAIS_TELA[0]!.lista.linha({ id: ID, codigo: '22021000', descricao: 'Águas', vigencia_inicio: '2022-04-01', vigencia_fim: null }, FUSO);
    expect(ncm).toEqual({ codigo: '2202.10.00', descricao: 'Águas', vigencia_inicio: '01/04/2022', vigencia_fim: '' });
    const ibge = TABELAS_OFICIAIS_TELA[3]!.lista.linha({ id: ID, codigo: '1302603', nome: 'Manaus', uf: 'AM', vigencia_inicio: null }, FUSO);
    expect(ibge).toMatchObject({ codigo: '1302603', nome: 'Manaus', uf: 'AM' });
  });
});

describe('menu do cadastros (T-0123, lote A)', () => {
  it('Estoque e Tabelas oficiais saem do oculto: aparecem no menu e abrem na primeira seção', () => {
    const itens = menu('gerente').flatMap((m) => m.itens ?? []);
    const rotulos = JSON.stringify(itens);
    expect(rotulos).toContain('Estoque');
    expect(rotulos).toContain('Tabelas oficiais');
    expect(resolverPagina(menu('gerente'), ROTA_OFICIAIS_CFOP, 'gerente')?.pagina?.titulo).toBe('CFOP');
    expect(paginasDoMenu('cadastros', 'Tabelas oficiais', 'gerente').map((p) => p.titulo)).toEqual(['NCM', 'CEST', 'CFOP', 'Municípios (IBGE)']);
  });

  it('a rota antiga /cadastros/oficiais segue valendo (NCM) e as páginas pedem cadastros.ver', () => {
    expect(PAGINAS_CADASTROS_OUTROS.every((p) => p.ver === 'cadastros.ver')).toBe(true);
    expect(PAGINAS_CADASTROS_OUTROS.map((p) => p.rota)).toContain('/cadastros/oficiais');
  });
});
