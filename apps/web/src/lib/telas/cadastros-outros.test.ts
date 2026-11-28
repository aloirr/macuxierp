import { describe, expect, it } from 'vitest';
import { escritaDeclarada, telaDaRota, telaFormulario } from '../telas';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import type { EuResposta } from '@macuxierp/platform-sdk';
import {
  EDITAR_PRODUTO, LISTA_PRODUTOS, NOVO_PRODUTO, ROTA_PRODUTO, ROTA_PRODUTO_NOVO, ROTA_PRODUTOS,
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
