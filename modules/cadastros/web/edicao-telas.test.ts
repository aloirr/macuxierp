import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { PAGINAS_EDICAO, PAGINAS } from './paginas';
import { camposDoCliente, corpoAlterarCliente, corpoCriarCliente, indicadorSugerido, paginaClientes, valoresDoCliente, validarCliente, type ClienteResumo } from './clientes';
import { camposDoProduto, corpoAlterarProduto, corpoCriarProduto, paginaProdutos, valoresDoProduto, validarProduto } from './produtos';
import { corpoAlterarTabelaPreco, corpoCriarTabelaPreco, paginaTabelasPreco, validarTabelaPreco, valoresDaTabelaPreco, type TabelaPrecoResumo } from './precos';
import { camposDaFilial, corpoAlterarFilial, corpoCriarFilial, paginaFiliais, validarFilialTela, valoresDaFilial, type FilialResumo } from './filiais';
import { errosDaApi, soOQueMudou } from './edicao';

const UUID = (n: number) => `3f1d5a07-7b0e-4a52-9d3c-${String(n).padStart(12, '0')}`;
const cliente: ClienteResumo = {
  id: UUID(1), tipo_pessoa: 'PJ', documento: '11222333000181', ie: null, ind_ie_dest: '9', razao_social: 'Mercado Fictício Ltda', nome_fantasia: null, email_nfe: null,
  limite_credito_centavos: 150000, condicao_pagamento_id: null, tabela_preco_id: null, filial_id: UUID(2), vendedor_id: null, external_id: null, inativo: false,
};
const novoCliente = {
  tipo_pessoa: 'PJ', documento: '11.222.333/0001-81', razao_social: 'Mercado Fictício Ltda', nome_fantasia: '', ind_ie_dest: '9', ie: '', email_nfe: '', filial_id: UUID(2), vendedor_id: '',
  condicao_pagamento_id: '', tabela_preco_id: '', limite_credito_centavos: '', end_cep: '69.000-000', end_logradouro: 'Rua A', end_numero: '10', end_complemento: '', end_bairro: 'Centro', end_municipio_ibge: '1302603', end_uf: 'am',
};

describe('telas de edição do cadastros (T-0088)', () => {
  it('listas pelo SDK: paginação e busca do contrato (limite padrão 50, máximo 200)', () => {
    for (const p of [paginaClientes, paginaProdutos, paginaTabelasPreco, paginaFiliais]) expect(p.busca).toBe(true);
  });
  it('páginas de formulário: rotas únicas, fora do menu e com a ação de editar', () => {
    const rotas = [...PAGINAS, ...PAGINAS_EDICAO].map((p) => p.rota);
    expect(new Set(rotas).size).toBe(rotas.length);
    for (const p of PAGINAS_EDICAO) {
      expect(p.ocultaNoMenu).toBe(true);
      expect(manifest.web?.menus).toContain(p.menu);
    }
  });
  it('RN-CAD-01: documento inválido para o tipo de pessoa é recusado na tela', () => {
    expect(validarCliente({ ...novoCliente, documento: '11.222.333/0001-82' }, 'criar', 'faturista').documento).toBeTruthy();
    expect(validarCliente({ ...novoCliente, tipo_pessoa: 'PF' }, 'criar', 'faturista').documento).toBeTruthy();
    expect(validarCliente(novoCliente, 'criar', 'faturista')).toEqual({});
  });
  it('RN-CAD-02: contribuinte precisa de IE válida; isento e não contribuinte não levam número', () => {
    expect(validarCliente({ ...novoCliente, ind_ie_dest: '1', ie: '' }, 'criar', 'faturista').ie).toBeTruthy();
    expect(validarCliente({ ...novoCliente, ind_ie_dest: '2', ie: '123456' }, 'criar', 'faturista').ie).toBeTruthy();
    expect(validarCliente({ ...novoCliente, ind_ie_dest: '9', ie: '123456' }, 'criar', 'faturista').ie).toBeTruthy();
    expect(validarCliente({ ...novoCliente, ind_ie_dest: '2', ie: 'isento' }, 'criar', 'faturista').ie).toBeUndefined();
    expect(indicadorSugerido('')).toBe('9');
    expect(indicadorSugerido('ISENTO')).toBe('2');
  });
  it('RN-CAD-02: na edição a IE de contribuinte usa a UF do endereço principal gravado', () => {
    const v = { ...valoresDoCliente(cliente), ind_ie_dest: '1', ie: '123' };
    expect(validarCliente(v, 'editar', 'faturista', 'AM').ie).toBeTruthy();
  });
  it('limite de crédito: só o perfil com cadastros.cliente.credito vê o campo e o envia', () => {
    expect(camposDoCliente('gerente', 'editar').some((c) => c.nome === 'limite_credito_centavos')).toBe(true);
    expect(camposDoCliente('faturista', 'editar').some((c) => c.nome === 'limite_credito_centavos')).toBe(false);
    expect(corpoCriarCliente(novoCliente, 'faturista')).not.toHaveProperty('limite_credito_centavos', 1);
    const v = { ...valoresDoCliente(cliente), limite_credito_centavos: '2.000,00' };
    expect(corpoAlterarCliente(v, cliente, 'gerente')).toEqual({ limite_credito_centavos: 200000 });
    expect(corpoAlterarCliente(v, cliente, 'faturista')).toBeNull();
  });
  it('criação do cliente leva o endereço principal normalizado (CEP em números, UF maiúscula) e o documento só em dígitos', () => {
    const c = corpoCriarCliente(novoCliente, 'gerente');
    expect(c?.documento).toBe('11222333000181');
    expect(c?.enderecos[0]).toMatchObject({ tipo: 'principal', cep: '69000000', uf: 'AM', municipio_ibge: '1302603' });
  });
  it('edição manda só o que mudou (PATCH) e nada quando não mudou; o endereço fica de fora na edição', () => {
    const v = valoresDoCliente(cliente);
    expect(corpoAlterarCliente(v, cliente, 'gerente')).toBeNull();
    expect(corpoAlterarCliente({ ...v, razao_social: ' Novo Nome ' }, cliente, 'gerente')).toEqual({ razao_social: 'Novo Nome' });
    expect(camposDoCliente('gerente', 'editar').some((c) => c.nome.startsWith('end_'))).toBe(false);
  });
  it('produto: formato de NCM, CEST e EAN conferido na tela; vigência e ST ficam com a API (RN-CAD-04)', () => {
    const v = { codigo: 'P1', descricao: 'Café 500 g', ncm: '0901.21.00', cest: '', unidade_comercial: 'UN', ean: '', marca: '', origem: '0', grupo_tributacao: 'G1', producao_propria: 'false', custo_centavos: '12,50' };
    expect(validarProduto(v, 'criar', 'gerente')).toEqual({});
    expect(validarProduto({ ...v, ncm: '123' }, 'criar', 'gerente').ncm).toBeTruthy();
    expect(validarProduto({ ...v, cest: '12' }, 'criar', 'gerente').cest).toBeTruthy();
    expect(validarProduto({ ...v, ean: '12' }, 'criar', 'gerente').ean).toBeTruthy();
    expect(validarProduto({ ...v, custo_centavos: 'abc' }, 'criar', 'gerente').custo_centavos).toBeTruthy();
    const c = corpoCriarProduto(v, 'gerente');
    expect(c).toMatchObject({ ncm: '09012100', cest: null, unidade_tributavel: 'UN', custo_centavos: 1250, producao_propria: false });
  });
  it('produto: o custo só aparece e só vai a quem edita produto; a edição manda só o que mudou', () => {
    expect(camposDoProduto('vendedor', 'editar').some((c) => c.nome === 'custo_centavos')).toBe(false);
    const original = corpoCriarProduto({ codigo: 'P1', descricao: 'Café', ncm: '09012100', cest: '', unidade_comercial: 'UN', ean: '', marca: '', origem: '0', grupo_tributacao: 'G1', producao_propria: 'false', custo_centavos: '12,50' }, 'gerente')!;
    const p = { ...original, id: UUID(9), inativo: false };
    const v = valoresDoProduto(p);
    expect(corpoAlterarProduto(v, p, 'gerente')).toBeNull();
    expect(corpoAlterarProduto({ ...v, descricao: 'Café torrado', producao_propria: 'true' }, p, 'gerente')).toEqual({ descricao: 'Café torrado', producao_propria: true });
  });
  it('422 da API vira erro de campo (endereço principal vira end_*) e soOQueMudou ignora diferença só de null/ausente', () => {
    expect(errosDaApi([{ campo: 'enderecos.0.uf', mensagem: 'UF inválida' }, { campo: 'ncm', mensagem: 'NCM vencido' }])).toEqual({ end_uf: 'UF inválida', ncm: 'NCM vencido' });
    expect(soOQueMudou({ a: null, b: 1 }, { b: 1 })).toEqual({});
  });
  it('lista única: o PAGINAS do shell vem do descritor do SDK (api, filtros, títulos e formatação iguais)', () => {
    for (const [id, d] of [['clientes', paginaClientes], ['produtos', paginaProdutos], ['tabelas-preco', paginaTabelasPreco], ['filiais', paginaFiliais]] as const) {
      const p = PAGINAS.find((x) => x.id === id)!;
      expect(p.api, id).toBe(d.api);
      expect(p.filtros, id).toEqual(Object.keys(d.filtros));
      expect(p.colunas.map((c) => [c.chave, c.rotulo]), id).toEqual(d.colunas.map((c) => [c.id, c.titulo]));
    }
    const col = (id: string, chave: string) => PAGINAS.find((p) => p.id === id)!.colunas.find((c) => c.chave === chave)!;
    expect(col('clientes', 'ind_ie_dest').formatar!('9')).toBe('Não contribuinte');
    expect(col('produtos', 'ncm').formatar!('09012100')).toBe(paginaProdutos.colunas.find((c) => c.id === 'ncm')!.valor({ ncm: '09012100' } as never));
  });

  const tabela: TabelaPrecoResumo = { id: UUID(5), nome: 'Atacado', vigencia_inicio: '2026-01-01', vigencia_fim: null, padrao: false, external_id: null, inativo: false };
  it('RN-CAD-06: o fim da vigência da tabela não pode ser anterior ao início', () => {
    const v = valoresDaTabelaPreco(tabela);
    expect(validarTabelaPreco(v, 'editar', 'gerente')).toEqual({});
    expect(validarTabelaPreco({ ...v, vigencia_fim: '2025-12-31' }, 'editar', 'gerente').vigencia_fim).toBeTruthy();
    expect(validarTabelaPreco({ ...v, vigencia_inicio: '01/01/2026' }, 'criar', 'gerente').vigencia_inicio).toBeTruthy();
    expect(validarTabelaPreco({ ...v, nome: ' ' }, 'criar', 'gerente').nome).toBeTruthy();
  });
  it('tabela de preço: criação pelo contrato e PATCH só com o que mudou', () => {
    const v = valoresDaTabelaPreco(tabela);
    expect(corpoCriarTabelaPreco(v)).toMatchObject({ nome: 'Atacado', vigencia_fim: null, padrao: false });
    expect(corpoAlterarTabelaPreco(v, tabela)).toBeNull();
    expect(corpoAlterarTabelaPreco({ ...v, padrao: 'true', vigencia_fim: '2026-12-31' }, tabela)).toEqual({ padrao: true, vigencia_fim: '2026-12-31' });
  });

  const filial: FilialResumo = {
    id: UUID(7), cnpj: '11222333000181', ie: null, razao_social: 'Matriz Manaus Ltda', nome_fantasia: null, crt: '1', padrao: true, emissora: false, nfe_serie: null, nfe_numero_inicial: null,
    industrial_ipi: false, regime_pis_cofins: null, external_id: null, inativo: false,
    endereco: { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', municipio_ibge: '1302603', uf: 'AM', cep: '69000000', pais_bacen: '1058' },
  };
  it('RN-FIS-02: CRT 3 pede o regime de PIS/COFINS e os demais CRT recusam o regime', () => {
    const v = valoresDaFilial(filial);
    expect(validarFilialTela(v, 'editar', 'administrador')).toEqual({});
    expect(validarFilialTela({ ...v, crt: '3' }, 'editar', 'administrador').regime_pis_cofins).toBeTruthy();
    expect(validarFilialTela({ ...v, crt: '3', regime_pis_cofins: 'cumulativo' }, 'editar', 'administrador')).toEqual({});
    expect(validarFilialTela({ ...v, regime_pis_cofins: 'cumulativo' }, 'editar', 'administrador').regime_pis_cofins).toBeTruthy();
  });
  it('D8: filial emissora precisa de série e número inicial; RN-CAD-03: município coerente com a UF', () => {
    const v = valoresDaFilial(filial);
    expect(validarFilialTela({ ...v, emissora: 'true' }, 'editar', 'administrador').nfe_serie).toBeTruthy();
    expect(validarFilialTela({ ...v, emissora: 'true', nfe_serie: '1', nfe_numero_inicial: '1' }, 'editar', 'administrador')).toEqual({});
    expect(validarFilialTela({ ...v, nfe_serie: '1' }, 'editar', 'administrador').nfe_numero_inicial).toBeTruthy();
    expect(validarFilialTela({ ...v, nfe_serie: '1000', nfe_numero_inicial: '1' }, 'editar', 'administrador').nfe_serie).toBeTruthy();
    expect(validarFilialTela({ ...v, end_uf: 'SP' }, 'editar', 'administrador').end_municipio_ibge).toBeTruthy();
  });
  it('filial: CNPJ só na criação (conferido pelo contrato); PATCH só com o que mudou, endereço inteiro quando muda', () => {
    const v = valoresDaFilial(filial);
    expect(camposDaFilial('administrador', 'editar').some((c) => c.nome === 'cnpj')).toBe(false);
    expect(validarFilialTela({ ...v, cnpj: '11.222.333/0001-82' }, 'criar', 'administrador').cnpj).toBeTruthy();
    expect(corpoCriarFilial(v)).toMatchObject({ cnpj: '11222333000181', crt: '1', endereco: { uf: 'AM', cep: '69000000' } });
    expect(corpoAlterarFilial(v, filial)).toBeNull();
    expect(corpoAlterarFilial({ ...v, razao_social: 'Outra Ltda', industrial_ipi: 'true' }, filial)).toEqual({ razao_social: 'Outra Ltda', industrial_ipi: true });
    expect(corpoAlterarFilial({ ...v, end_numero: '20' }, filial)).toEqual({ endereco: { ...filial.endereco, numero: '20' } });
  });
  it('422 do endereço da filial vira end_* e as páginas de preços e filiais estão no mapa de edição', () => {
    expect(errosDaApi([{ campo: 'endereco.uf', mensagem: 'UF inválida' }])).toEqual({ end_uf: 'UF inválida' });
    expect(PAGINAS_EDICAO.map((p) => p.id)).toEqual(expect.arrayContaining(['tabela-preco-nova', 'tabela-preco', 'filial-nova', 'filial']));
  });
});
