import { describe, expect, it } from 'vitest';
import { escritaDeclarada, telaDaRota, telaFormulario } from '../telas';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import type { EuResposta } from '@macuxierp/platform-sdk';
import {
  EDITAR_FILIAL, EDITAR_PRODUTO, EDITAR_TABELA_PRECO, LISTA_FILIAIS, LISTA_PRODUTOS, LISTA_TABELAS_PRECO, NOVA_FILIAL, NOVA_TABELA_PRECO, ROTA_TABELA_PRECO, ROTA_TABELA_PRECO_NOVA, ROTA_TABELAS_PRECO, NOVO_PRODUTO, ROTA_FILIAIS, ROTA_FILIAL, ROTA_FILIAL_NOVA, ROTA_PRODUTO, ROTA_PRODUTO_NOVO, ROTA_PRODUTOS,
} from './cadastros';

const FUSO = 'America/Manaus';
const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const modulos = [{ id: 'cadastros' as EuResposta['modulos'][number]['id'], menus: ['Produtos'] }];
const resolver = (rota: string) => resolverPagina(montarMenu(modulos, MANIFESTOS, 'gerente'), rota, 'gerente');

describe('adaptador do cadastros: Produtos (v0.3.28)', () => {
  const produto = {
    id: ID, codigo: 'P-001', descricao: 'Água mineral 500 ml', ncm: '22021000', cest: null, unidade_comercial: 'UN', unidade_tributavel: 'UN', ean: null, marca: null, origem: '0',
    grupo_tributacao: 'GT-01', producao_propria: false, custo_centavos: 125, external_id: null, inativo: false,
  };

  it('registra lista, novo e edição; o PATCH só vale em /produtos/<uuid>', () => {
    expect(telaDaRota(ROTA_PRODUTOS)).toBe(LISTA_PRODUTOS);
    expect(telaFormulario(ROTA_PRODUTO_NOVO)).toBe(NOVO_PRODUTO);
    expect(telaFormulario(ROTA_PRODUTO)).toBe(EDITAR_PRODUTO);
    expect(escritaDeclarada('POST', '/v1/cadastros/produtos')).toBe(true);
    expect(escritaDeclarada('PATCH', `/v1/cadastros/produtos/${ID}`)).toBe(true);
    expect(escritaDeclarada('PATCH', '/v1/cadastros/produtos')).toBe(false);
    expect(escritaDeclarada('DELETE', `/v1/cadastros/produtos/${ID}`)).toBe(false);
  });

  it('lista: colunas do descritor (custo só a quem edita produto), selo de situação e rota do registro', () => {
    expect(LISTA_PRODUTOS.colunas('gerente', FUSO).map((c) => c.id)).toEqual(expect.arrayContaining(['codigo', 'descricao', 'ncm', 'custo_centavos', 'inativo']));
    expect(LISTA_PRODUTOS.colunas('vendedor', FUSO).map((c) => c.id)).not.toContain('custo_centavos');
    expect(LISTA_PRODUTOS.linha(produto, FUSO)).toMatchObject({ codigo: 'P-001', ncm: '2202.10.00' });
    expect(LISTA_PRODUTOS.selos?.({ ...produto, inativo: true }, FUSO)).toEqual({ inativo: [{ texto: 'Inativo', tom: 'neutro' }] });
    expect(LISTA_PRODUTOS.rotaDaLinha?.(produto)).toBe(`/cadastros/produtos/${ID}`);
    expect(LISTA_PRODUTOS.novo).toMatchObject({ rota: ROTA_PRODUTO_NOVO, criar: 'cadastros.produto.editar' });
  });

  it('formulário: sim/não vira seleção, validação do módulo e corpo do POST', () => {
    const campos = NOVO_PRODUTO.camposDoPerfil!('gerente');
    expect(campos.find((c) => c.nome === 'producao_propria')).toMatchObject({ tipo: 'selecao', opcoes: [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }] });
    expect(campos.find((c) => c.nome === 'custo_centavos')?.tipo).toBe('numero');
    expect(NOVO_PRODUTO.camposDoPerfil!('vendedor').map((c) => c.nome)).not.toContain('custo_centavos');
    expect(NOVO_PRODUTO.validar({}, [], 'gerente')).toMatchObject({ codigo: 'Preencha este campo', ncm: 'Preencha este campo' });
    const v = { codigo: 'P-001', descricao: 'Água mineral 500 ml', ncm: '2202.10.00', unidade_comercial: 'UN', origem: '0', grupo_tributacao: 'GT-01', producao_propria: 'false', custo_centavos: '1,25' };
    expect(NOVO_PRODUTO.validar(v, [], 'gerente')).toEqual({});
    expect(NOVO_PRODUTO.montar(v, [], 'gerente')).toMatchObject({ ncm: '22021000', custo_centavos: 125, unidade_tributavel: 'UN' });
    expect(() => NOVO_PRODUTO.montar({}, [], 'gerente')).toThrow();
  });

  it('edição: abre com os valores e o PATCH leva só o que mudou', () => {
    const { valores, original } = EDITAR_PRODUTO.edicao!.abrir(produto);
    expect(valores).toMatchObject({ codigo: 'P-001', custo_centavos: '1,25', producao_propria: 'false' });
    expect(EDITAR_PRODUTO.edicao!.ler(ID)).toBe(`/v1/cadastros/produtos/${ID}`);
    expect(EDITAR_PRODUTO.edicao!.montarPatch(valores, original, 'gerente')).toBeNull();
    expect(EDITAR_PRODUTO.edicao!.montarPatch({ ...valores, descricao: 'Água 500 ml' }, original, 'gerente')).toEqual({ descricao: 'Água 500 ml' });
  });

  it('regra 6: a página só abre com a licença do cadastros', () => {
    expect(resolver(ROTA_PRODUTOS)?.pagina?.rota).toBe(ROTA_PRODUTOS);
    expect(resolver(`/cadastros/produtos/${ID}`)?.pagina?.rota).toBe(ROTA_PRODUTO);
    expect(resolverPagina(montarMenu([], MANIFESTOS, 'gerente'), ROTA_PRODUTOS, 'gerente')).toBeUndefined();
  });
});

describe('adaptador do cadastros: Filiais (v0.3.28)', () => {
  const filial = {
    id: ID, cnpj: '11222333000181', razao_social: 'Macuxi Distribuidora Ltda', nome_fantasia: null, ie: '041234567', crt: '3', regime_pis_cofins: 'nao_cumulativo', industrial_ipi: false,
    padrao: true, emissora: true, nfe_serie: 1, nfe_numero_inicial: 1, external_id: null, inativo: false,
    endereco: { cep: '69000000', logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM' },
  };
  const mod = [{ id: 'cadastros' as EuResposta['modulos'][number]['id'], menus: ['Filiais'] }];

  it('registra lista, novo e edição; o PATCH só vale em /filiais/<uuid>', () => {
    expect(telaDaRota(ROTA_FILIAIS)).toBe(LISTA_FILIAIS);
    expect(telaFormulario(ROTA_FILIAL_NOVA)).toBe(NOVA_FILIAL);
    expect(telaFormulario(ROTA_FILIAL)).toBe(EDITAR_FILIAL);
    expect(escritaDeclarada('PATCH', `/v1/cadastros/filiais/${ID}`)).toBe(true);
    expect(escritaDeclarada('PATCH', '/v1/cadastros/filiais')).toBe(false);
  });

  it('lista: colunas, selo e rota do registro', () => {
    expect(LISTA_FILIAIS.colunas('gerente', FUSO).map((c) => c.id)).toEqual(expect.arrayContaining(['cnpj', 'razao_social', 'crt', 'nfe_serie', 'inativo']));
    expect(LISTA_FILIAIS.linha(filial, FUSO)).toMatchObject({ cnpj: '11.222.333/0001-81', crt: 'Regime normal', regime_pis_cofins: 'Não cumulativo' });
    expect(LISTA_FILIAIS.rotaDaLinha?.(filial)).toBe(`/cadastros/filiais/${ID}`);
    expect(LISTA_FILIAIS.novo).toMatchObject({ rota: ROTA_FILIAL_NOVA, criar: 'cadastros.filial.editar' });
  });

  it('formulário: o regime de PIS/COFINS só aparece com CRT 3 (RN-FIS-02); o CNPJ só na criação', () => {
    const regime = NOVA_FILIAL.camposDoPerfil!('gerente').find((c) => c.nome === 'regime_pis_cofins')!;
    expect(regime.mostrarSe?.({ crt: '3' })).toBe(true);
    expect(regime.mostrarSe?.({ crt: '1' })).toBe(false);
    expect(NOVA_FILIAL.camposDoPerfil!('gerente').map((c) => c.nome)).toContain('cnpj');
    expect(EDITAR_FILIAL.camposDoPerfil!('gerente').map((c) => c.nome)).not.toContain('cnpj');
    expect(NOVA_FILIAL.validar({}, [], 'gerente')).toMatchObject({ cnpj: 'Preencha este campo', razao_social: 'Preencha este campo' });
    expect(() => NOVA_FILIAL.montar({}, [], 'gerente')).toThrow();
  });

  it('edição: abre com os valores e o PATCH leva só o que mudou', () => {
    const { valores, original } = EDITAR_FILIAL.edicao!.abrir(filial);
    expect(valores).toMatchObject({ razao_social: 'Macuxi Distribuidora Ltda', crt: '3', end_uf: 'AM' });
    expect(EDITAR_FILIAL.edicao!.montarPatch(valores, original, 'gerente')).toBeNull();
    expect(EDITAR_FILIAL.edicao!.montarPatch({ ...valores, razao_social: 'Macuxi Ltda' }, original, 'gerente')).toEqual({ razao_social: 'Macuxi Ltda' });
  });

  it('regra 6: a página só abre com a licença do cadastros', () => {
    expect(resolverPagina(montarMenu(mod, MANIFESTOS, 'gerente'), ROTA_FILIAIS, 'gerente')?.pagina?.rota).toBe(ROTA_FILIAIS);
    expect(resolverPagina(montarMenu(mod, MANIFESTOS, 'gerente'), `/cadastros/filiais/${ID}`, 'gerente')?.pagina?.rota).toBe(ROTA_FILIAL);
    expect(resolverPagina(montarMenu([], MANIFESTOS, 'gerente'), ROTA_FILIAIS, 'gerente')).toBeUndefined();
  });
});

describe('adaptador do cadastros: Tabelas de preço, só o cabeçalho (v0.3.28)', () => {
  const tabela = { id: ID, nome: 'Varejo 2026', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: true, external_id: null, inativo: false };
  const mod = [{ id: 'cadastros' as EuResposta['modulos'][number]['id'], menus: ['Tabelas de preço'] }];

  it('registra lista, novo e edição; o PATCH só vale em /tabelas-preco/<uuid>; o PUT dos itens é da grade (lote C)', () => {
    expect(telaDaRota(ROTA_TABELAS_PRECO)).toBe(LISTA_TABELAS_PRECO);
    expect(telaFormulario(ROTA_TABELA_PRECO_NOVA)).toBe(NOVA_TABELA_PRECO);
    expect(telaFormulario(ROTA_TABELA_PRECO)).toBe(EDITAR_TABELA_PRECO);
    expect(escritaDeclarada('PATCH', `/v1/cadastros/tabelas-preco/${ID}`)).toBe(true);
    expect(escritaDeclarada('PUT', `/v1/cadastros/tabelas-preco/${ID}/itens`)).toBe(true);
    expect(escritaDeclarada('PATCH', `/v1/cadastros/tabelas-preco/${ID}/itens`)).toBe(false);
  });

  it('lista, formulário (RN-CAD-06) e edição', () => {
    expect(LISTA_TABELAS_PRECO.colunas('gerente', FUSO).map((c) => c.id)).toEqual(['nome', 'vigencia_inicio', 'vigencia_fim', 'padrao', 'inativo']);
    expect(LISTA_TABELAS_PRECO.rotaDaLinha?.(tabela)).toBe(`/cadastros/tabelas-preco/${ID}`);
    expect(NOVA_TABELA_PRECO.validar({ nome: 'X', vigencia_inicio: '2026-02-01', vigencia_fim: '2026-01-01', padrao: 'false' }, [], 'gerente').vigencia_fim).toBeTruthy();
    const v = { nome: 'Atacado', vigencia_inicio: '2026-01-01', vigencia_fim: '', padrao: 'false' };
    expect(NOVA_TABELA_PRECO.validar(v, [], 'gerente')).toEqual({});
    expect(NOVA_TABELA_PRECO.montar(v, [], 'gerente')).toMatchObject({ nome: 'Atacado', vigencia_fim: null, padrao: false });
    const { valores, original } = EDITAR_TABELA_PRECO.edicao!.abrir(tabela);
    expect(EDITAR_TABELA_PRECO.edicao!.montarPatch(valores, original, 'gerente')).toBeNull();
    expect(EDITAR_TABELA_PRECO.edicao!.montarPatch({ ...valores, nome: 'Varejo' }, original, 'gerente')).toEqual({ nome: 'Varejo' });
  });

  it('regra 6: a página só abre com a licença do cadastros', () => {
    expect(resolverPagina(montarMenu(mod, MANIFESTOS, 'gerente'), ROTA_TABELAS_PRECO, 'gerente')?.pagina?.rota).toBe(ROTA_TABELAS_PRECO);
    expect(resolverPagina(montarMenu(mod, MANIFESTOS, 'gerente'), `/cadastros/tabelas-preco/${ID}`, 'gerente')?.pagina?.rota).toBe(ROTA_TABELA_PRECO);
    expect(resolverPagina(montarMenu([], MANIFESTOS, 'gerente'), ROTA_TABELAS_PRECO, 'gerente')).toBeUndefined();
  });
});
