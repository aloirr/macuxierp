import { describe, expect, it } from 'vitest';
import { PERFIS } from '@macuxierp/platform-sdk';
import { paginaClientes } from '@macuxierp/cadastros/web';
import type { EuResposta } from '@macuxierp/platform-sdk';
import { escritaDeclarada, telaDaRota, telaFormulario } from '../telas';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import { larguraDoCampo } from '../../components/descritor/formulario-generico';
import { NOVA_FILIAL, EDITAR_CLIENTE, LISTA_CLIENTES, NOVO_CLIENTE, ROTA_CLIENTE, ROTA_CLIENTE_NOVO, ROTA_CLIENTES } from './cadastros';

const FUSO = 'America/Manaus';
const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const F = '8a2b6c10-1d3e-4f5a-8b7c-9d0e1f2a3b4c';
const modulos = (...ids: string[]) => ids.map((id) => ({ id: id as EuResposta['modulos'][number]['id'], menus: id === 'cadastros' ? ['Clientes'] : [] }));

const cliente = {
  id: ID, tipo_pessoa: 'PJ', documento: '11222333000181', ie: null, ind_ie_dest: '9', razao_social: 'Bar do Zé Ltda', nome_fantasia: 'Bar do Zé', email_nfe: null,
  limite_credito_centavos: 150000, condicao_pagamento_id: null, tabela_preco_id: null, filial_id: F, vendedor_id: null, prazo_medio_dias: 30, external_id: null, inativo: false,
};

describe('adaptador do cadastros: Clientes (v0.3.28)', () => {
  it('registra lista, novo e edição pela rota da página', () => {
    expect(telaDaRota(ROTA_CLIENTES)).toBe(LISTA_CLIENTES);
    expect(telaFormulario(ROTA_CLIENTE_NOVO)).toBe(NOVO_CLIENTE);
    expect(telaFormulario(ROTA_CLIENTE)).toBe(EDITAR_CLIENTE);
  });

  it('lista: filtros do descritor (filial e vendedor, lidos do cadastros) mais inativos, e a busca declarada pela página', () => {
    expect(LISTA_CLIENTES.filtrosTela.map((f) => f.chave)).toEqual(['filial_id', 'vendedor_id', 'inativos']);
    expect(LISTA_CLIENTES.filtrosTela.filter((f) => f.tipo === 'cadastro').map((f) => f.fonte)).toEqual(['/v1/cadastros/filiais', '/v1/cadastros/vendedores']);
    expect(paginaClientes.busca).toBe(true);
    expect(paginaClientes.inativos).toBe(true);
    expect(Object.keys(paginaClientes.filtros)).toEqual(['filial_id', 'vendedor_id']);
  });

  it('lista: colunas do descritor com tipo; o limite só aparece a quem tem cadastros.cliente.credito', () => {
    const gerente = LISTA_CLIENTES.colunas('gerente', FUSO);
    expect(gerente.map((c) => c.id)).toEqual(paginaClientes.colunas.map((c) => c.id));
    expect(gerente.find((c) => c.id === 'limite_credito_centavos')?.tipo).toBe('dinheiro');
    expect(gerente.find((c) => c.id === 'inativo')).toMatchObject({ rotulo: 'Situação', tipo: 'status' });
    expect(gerente.find((c) => c.id === 'prazo_medio_dias')?.tipo).toBe('numero');
    expect(LISTA_CLIENTES.colunas('vendedor', FUSO).map((c) => c.id)).not.toContain('limite_credito_centavos');
  });

  it('lista: linha em texto, selo de situação e rota do registro', () => {
    const l = LISTA_CLIENTES.linha(cliente, FUSO);
    expect(l).toMatchObject({ documento: '11.222.333/0001-81', razao_social: 'Bar do Zé Ltda', ind_ie_dest: 'Não contribuinte', inativo: 'Ativo' });
    expect(LISTA_CLIENTES.selos?.(cliente, FUSO)).toEqual({ inativo: [{ texto: 'Ativo', tom: 'ok' }] });
    expect(LISTA_CLIENTES.selos?.({ ...cliente, inativo: true }, FUSO)).toEqual({ inativo: [{ texto: 'Inativo', tom: 'neutro' }] });
    expect(LISTA_CLIENTES.rotaDaLinha?.(cliente)).toBe(`/cadastros/clientes/${ID}`);
    expect(LISTA_CLIENTES.novo).toMatchObject({ rota: ROTA_CLIENTE_NOVO, criar: 'cadastros.cliente.editar' });
  });

  it('formulário: campos por perfil e modo (endereço só na criação; limite de crédito só com a ação)', () => {
    const nomes = (t: typeof NOVO_CLIENTE, perfil: Parameters<NonNullable<typeof NOVO_CLIENTE.camposDoPerfil>>[0]) => (t.camposDoPerfil?.(perfil) ?? []).map((c) => c.nome);
    expect(nomes(NOVO_CLIENTE, 'gerente')).toEqual(expect.arrayContaining(['documento', 'razao_social', 'limite_credito_centavos', 'end_cep', 'end_uf']));
    expect(nomes(NOVO_CLIENTE, 'vendedor')).not.toContain('limite_credito_centavos');
    expect(nomes(EDITAR_CLIENTE, 'gerente')).toContain('limite_credito_centavos');
    expect(nomes(EDITAR_CLIENTE, 'gerente')).not.toContain('end_cep');
    expect(NOVO_CLIENTE.camposDoPerfil?.('gerente').find((c) => c.nome === 'limite_credito_centavos')?.tipo).toBe('numero');
    expect(NOVO_CLIENTE.camposDoPerfil?.('gerente').find((c) => c.nome === 'filial_id')).toMatchObject({ tipo: 'cadastro', fonte: '/v1/cadastros/filiais', obrigatorio: true });
  });

  it('formulário: validação do módulo (RN-CAD-01) e corpo do POST; sem dado válido, não monta', () => {
    expect(NOVO_CLIENTE.validar({}, [], 'gerente')).toMatchObject({ documento: 'Preencha este campo', razao_social: 'Preencha este campo' });
    expect(NOVO_CLIENTE.validar({ tipo_pessoa: 'PJ', documento: '123', razao_social: 'X', ind_ie_dest: '9', filial_id: F, end_cep: '69000000', end_logradouro: 'Rua A', end_numero: '1', end_bairro: 'Centro', end_municipio_ibge: '1302603', end_uf: 'AM', limite_credito_centavos: '0,00' }, [], 'gerente').documento).toBeTruthy();
    const v = { tipo_pessoa: 'PJ', documento: '11.222.333/0001-81', razao_social: 'Bar do Zé Ltda', ind_ie_dest: '9', filial_id: F, end_cep: '69000-000', end_logradouro: 'Rua A', end_numero: '1', end_bairro: 'Centro', end_municipio_ibge: '1302603', end_uf: 'am', limite_credito_centavos: '1.500,00' };
    expect(NOVO_CLIENTE.validar(v, [], 'gerente')).toEqual({});
    expect(NOVO_CLIENTE.montar(v, [], 'gerente')).toMatchObject({ documento: '11222333000181', limite_credito_centavos: 150000, enderecos: [{ uf: 'AM', cep: '69000000' }] });
    expect(() => NOVO_CLIENTE.montar({}, [], 'gerente')).toThrow();
  });

  it('edição: abre com os valores do cliente e o PATCH leva só o que mudou (sem mudança, nada)', () => {
    const { valores, original } = EDITAR_CLIENTE.edicao!.abrir(cliente);
    expect(valores).toMatchObject({ documento: '11.222.333/0001-81', razao_social: 'Bar do Zé Ltda', limite_credito_centavos: '1.500,00' });
    expect(EDITAR_CLIENTE.edicao!.ler(ID)).toBe(`/v1/cadastros/clientes/${ID}`);
    expect(EDITAR_CLIENTE.edicao!.montarPatch(valores, original, 'gerente')).toBeNull();
    expect(EDITAR_CLIENTE.edicao!.montarPatch({ ...valores, razao_social: 'Bar do Zé ME' }, original, 'gerente')).toEqual({ razao_social: 'Bar do Zé ME' });
    expect(EDITAR_CLIENTE.validar(valores, [], 'gerente')).toEqual({});
  });

  it('escrita: o shell só aceita POST em /clientes e PATCH em /clientes/<uuid>', () => {
    expect(escritaDeclarada('POST', '/v1/cadastros/clientes')).toBe(true);
    expect(escritaDeclarada('PATCH', `/v1/cadastros/clientes/${ID}`)).toBe(true);
    expect(escritaDeclarada('PATCH', '/v1/cadastros/clientes')).toBe(false);
    expect(escritaDeclarada('DELETE', `/v1/cadastros/clientes/${ID}`)).toBe(false);
  });

  it('regra 6: a página só aparece com a licença do cadastros e com o perfil (ver do descritor)', () => {
    const rota = (perfil: (typeof PERFIS)[number], ids: string[], r: string) => resolverPagina(montarMenu(modulos(...ids), MANIFESTOS, perfil), r, perfil);
    expect(rota('gerente', ['core'], ROTA_CLIENTES)).toBeUndefined(); // sem a licença
    expect(rota('gerente', ['cadastros'], ROTA_CLIENTES)?.pagina?.rota).toBe(ROTA_CLIENTES);
    expect(rota('gerente', ['cadastros'], ROTA_CLIENTE_NOVO)?.pagina?.rota).toBe(ROTA_CLIENTE_NOVO);
    expect(rota('gerente', ['cadastros'], `/cadastros/clientes/${ID}`)?.pagina?.rota).toBe(ROTA_CLIENTE);
    // O "novo" exige cadastros.cliente.editar: o perfil que não edita não o enxerga.
    const semEditar = PERFIS.find((p) => rota(p, ['cadastros'], ROTA_CLIENTES) !== undefined && rota(p, ['cadastros'], ROTA_CLIENTE_NOVO) === undefined);
    if (semEditar) expect(rota(semEditar, ['cadastros'], ROTA_CLIENTE_NOVO)).toBeUndefined();
    expect(PERFIS.filter((p) => rota(p, ['cadastros'], ROTA_CLIENTE_NOVO) !== undefined)).toContain('gerente');
  });
});

describe('Nova filial: endereço em 12 colunas (marca, v0.3.30)', () => {
  const SPAN: Record<string, number> = { ' campo-curto': 2, ' campo-medio': 4, ' campo-3': 3, ' campo-8': 8 };
  const campos = NOVA_FILIAL.camposDoPerfil?.('gerente') ?? NOVA_FILIAL.campos;
  const endereco = campos.filter((c) => c.nome.startsWith('end_'));
  const largura = (n: string) => SPAN[larguraDoCampo(endereco.find((c) => c.nome === n)!)];

  it('ordem: CEP, Logradouro, Número, Complemento, Bairro, Município, UF', () => {
    expect(endereco.map((c) => c.nome)).toEqual(['end_cep', 'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro', 'end_municipio_ibge', 'end_uf']);
  });

  it('linha 1 fecha 12 (2+8+2) e linha 2 fecha 12 (3+3+4+2)', () => {
    expect(['end_cep', 'end_logradouro', 'end_numero'].map(largura)).toEqual([2, 8, 2]);
    expect(['end_complemento', 'end_bairro', 'end_municipio_ibge', 'end_uf'].map(largura)).toEqual([3, 3, 4, 2]);
    expect(['end_cep', 'end_logradouro', 'end_numero'].reduce((t, n) => t + (largura(n) ?? 0), 0)).toBe(12);
    expect(['end_complemento', 'end_bairro', 'end_municipio_ibge', 'end_uf'].reduce((t, n) => t + (largura(n) ?? 0), 0)).toBe(12);
  });
});
