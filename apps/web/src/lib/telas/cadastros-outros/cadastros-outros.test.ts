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
import { EDITAR_CONDICAO, EDITAR_VENDEDOR, LISTA_CONDICOES, LISTA_EQUIPE, NOVA_CONDICAO, NOVO_VENDEDOR, TRANSFERIR_CARTEIRA, parcelasDoTexto } from './condicoes-equipe';
import { telaFormulario } from '../../telas';

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
    expect(PAGINAS_CADASTROS_OUTROS.filter((p) => ['Estoque', 'Tabelas oficiais'].includes(p.menu)).every((p) => p.ver === 'cadastros.ver')).toBe(true);
    expect(PAGINAS_CADASTROS_OUTROS.map((p) => p.rota)).toContain('/cadastros/oficiais');
  });
});

describe('Condições de pagamento e Equipe e carteira (T-0123, lote B)', () => {
  const ID2 = '9a1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c71';
  const cond = { id: ID, codigo: 'C30', descricao: 'Boleto 30/60', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45, inativo: false };

  it('registra lista, novo e edição; POST e PATCH declarados, DELETE não', () => {
    expect(telaDaRota('/cadastros/condicoes-pagamento')).toBe(LISTA_CONDICOES);
    expect(telaFormulario('/cadastros/condicoes-pagamento/novo')).toBe(NOVA_CONDICAO);
    expect(telaFormulario('/cadastros/condicoes-pagamento/:id')).toBe(EDITAR_CONDICAO);
    expect(escritaDeclarada('POST', '/v1/cadastros/condicoes-pagamento')).toBe(true);
    expect(escritaDeclarada('PATCH', `/v1/cadastros/condicoes-pagamento/${ID}`)).toBe(true);
    expect(escritaDeclarada('DELETE', `/v1/cadastros/condicoes-pagamento/${ID}`)).toBe(false);
    expect(escritaDeclarada('POST', '/v1/cadastros/carteira/transferir')).toBe(true);
    expect(escritaDeclarada('POST', '/v1/cadastros/vendedores')).toBe(true);
  });

  it('parcelas num campo só: "30/60" vira lista; RN-CAD-15 vem do módulo; o POST leva inteiros', () => {
    expect(parcelasDoTexto('30/60, 90')).toEqual(['30', '60', '90']);
    const v = { codigo: 'C30', descricao: 'Boleto 30/60', forma_tpag: '15', parcelas: '30/60', prazo_medio_dias: '' };
    expect(NOVA_CONDICAO.validar(v, [], 'gerente')).toEqual({});
    expect(NOVA_CONDICAO.montar(v, [], 'gerente')).toMatchObject({ codigo: 'C30', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: null });
    expect(NOVA_CONDICAO.validar({ ...v, parcelas: '30/x' }, [], 'gerente').parcelas).toBeTruthy();
    expect(NOVA_CONDICAO.validar({}, [], 'gerente')).toMatchObject({ codigo: expect.any(String), descricao: expect.any(String) });
    expect(NOVA_CONDICAO.campos.map((c) => c.nome)).toContain('parcelas');
  });

  it('edição: abre com as parcelas em texto e o PATCH leva só o que mudou', () => {
    const { valores, original } = EDITAR_CONDICAO.edicao!.abrir(cond);
    expect(valores).toMatchObject({ codigo: 'C30', parcelas: '30/60', prazo_medio_dias: '45' });
    expect(EDITAR_CONDICAO.edicao!.montarPatch(valores, original, 'gerente')).toBeNull();
    expect(EDITAR_CONDICAO.edicao!.montarPatch({ ...valores, descricao: 'Boleto 30/60 dias' }, original, 'gerente')).toEqual({ descricao: 'Boleto 30/60 dias' });
  });

  it('lista das condições: colunas do descritor, selo de situação e rota da linha', () => {
    expect(LISTA_CONDICOES.colunas('gerente', FUSO).map((c) => c.id)).toEqual(expect.arrayContaining(['codigo', 'descricao', 'forma_tpag', 'prazos_dias', 'inativo']));
    expect(LISTA_CONDICOES.rotaDaLinha?.(cond)).toBe(`/cadastros/condicoes-pagamento/${ID}`);
    expect(LISTA_CONDICOES.novo).toMatchObject({ criar: 'cadastros.condicao_pagamento.editar' });
  });

  it('equipe: lista com filtro de filial, novo vendedor e PATCH só do que mudou', () => {
    expect(LISTA_EQUIPE.filtrosTela.map((f) => f.chave)).toEqual(['filial_id', 'inativos']);
    expect(LISTA_EQUIPE.rotaDaLinha?.({ id: ID2 })).toBe(`/cadastros/equipe/${ID2}`);
    const v = { codigo: 'V01', nome: 'Maria da Silva', filial_id: ID };
    expect(NOVO_VENDEDOR.validar(v, [], 'gerente')).toEqual({});
    expect(NOVO_VENDEDOR.montar(v, [], 'gerente')).toMatchObject({ codigo: 'V01', filial_id: ID, usuario_id: null });
    const vend = { id: ID2, codigo: 'V01', nome: 'Maria da Silva', filial_id: ID, usuario_id: null, inativo: false };
    const { valores, original } = EDITAR_VENDEDOR.edicao!.abrir(vend);
    expect(EDITAR_VENDEDOR.edicao!.montarPatch(valores, original, 'gerente')).toBeNull();
    expect(EDITAR_VENDEDOR.edicao!.montarPatch({ ...valores, nome: 'Maria Souza' }, original, 'gerente')).toEqual({ nome: 'Maria Souza' });
  });

  it('transferência de carteira: origem e destino diferentes; corpo com de e para', () => {
    expect(TRANSFERIR_CARTEIRA.validar({ de: ID, para: ID }, [], 'gerente').para).toBeTruthy();
    expect(TRANSFERIR_CARTEIRA.validar({ de: ID, para: ID2 }, [], 'gerente')).toEqual({});
    expect(TRANSFERIR_CARTEIRA.montar({ de: ID, para: ID2 }, [], 'gerente')).toEqual({ de: ID, para: ID2 });
  });

  it('menu: Condições e Equipe saem do oculto; Equipe tem a seção Transferir carteira', () => {
    const rotulos = JSON.stringify(montarMenu([{ id: 'cadastros' as EuResposta['modulos'][number]['id'], menus: ['Condições de pagamento', 'Equipe e carteira'] }], MANIFESTOS, 'administrador'));
    expect(rotulos).toContain('Condições de pagamento');
    expect(rotulos).toContain('Equipe e carteira');
    expect(paginasDoMenu('cadastros', 'Equipe e carteira', 'administrador').map((p) => p.titulo)).toEqual(['Equipe e carteira', 'Transferir carteira']);
  });
});
