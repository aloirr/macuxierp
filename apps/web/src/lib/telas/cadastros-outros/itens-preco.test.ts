import { describe, expect, it } from 'vitest';
import { escritaDeclarada, telaDaRota } from '../../telas';
import { casarRota } from '../../paginas';
import { ROTA_ITENS_PRECO, TELA_ITENS_PRECO, errosDaApiPorLinha, linhaDoItem, linhaVazia, lotePorLinha, rotaDosItens, type LinhaPreco } from './itens-preco';

const T = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const item = (id: string, filial_id: string, produto_id: string, preco_centavos: number, desconto_maximo_bp = 0) => ({ id, filial_id, produto_id, preco_centavos, desconto_maximo_bp });
const base = [linhaDoItem(item('i1', F1, P1, 1250, 550)), linhaDoItem(item('i2', F1, P2, 100000))];
const com = (l: LinhaPreco, o: Partial<LinhaPreco>): LinhaPreco => ({ ...l, ...o });

describe('itens da tabela de preço (T-0123, lote C)', () => {
  it('registra a grade: rota com :id, página fora do menu e só o PUT em lote declarado', () => {
    expect(telaDaRota(ROTA_ITENS_PRECO)).toBe(TELA_ITENS_PRECO);
    expect(rotaDosItens(T)).toBe(`/cadastros/tabelas-preco/${T}/itens`);
    const r = casarRota(rotaDosItens(T));
    expect(r?.params).toEqual({ id: T });
    expect(r?.pagina.ocultaNoMenu).toBe(true);
    expect(escritaDeclarada('PUT', `/v1/cadastros/tabelas-preco/${T}/itens`)).toBe(true);
    expect(escritaDeclarada('PUT', `/v1/cadastros/tabelas-preco/${T}`)).toBe(false);
    expect(escritaDeclarada('DELETE', `/v1/cadastros/tabelas-preco/${T}/itens`)).toBe(false);
  });

  it('o item vira texto em reais e % e volta ao mesmo centavo inteiro', () => {
    expect(base[0]).toMatchObject({ chave: 'i1', preco_centavos: '12,50', desconto_maximo_bp: '5,5' });
    expect(base[1]).toMatchObject({ preco_centavos: '1.000,00', desconto_maximo_bp: '' });
    const lote = lotePorLinha([com(base[0]!, { preco_centavos: '13,05' }), base[1]!], base, 'gerente');
    expect(lote.corpo).toEqual({ itens: [{ filial_id: F1, produto_id: P1, preco_centavos: 1305, desconto_maximo_bp: 550 }] });
    expect(lote.chaves).toEqual(['i1']);
  });

  it('sem mudança não há lote; linha nova em branco não entra nem vira erro', () => {
    expect(lotePorLinha(base, base, 'gerente')).toMatchObject({ corpo: null, nada: true });
    expect(lotePorLinha([...base, linhaVazia('nova-1')], base, 'gerente')).toMatchObject({ corpo: null, nada: true, erros: {} });
  });

  it('erro por linha: preço e escolha ausentes aparecem na linha certa, sem montar o corpo', () => {
    const lote = lotePorLinha([base[0]!, { ...linhaVazia('nova-1'), filial_id: F2, preco_centavos: '12,345' }], base, 'gerente');
    expect(lote.corpo).toBeNull();
    expect(lote.erros['nova-1']).toMatchObject({ produto_id: expect.any(String), preco_centavos: expect.any(String) });
    expect(lote.erros.i1).toBeUndefined();
    const desc = lotePorLinha([com(base[0]!, { desconto_maximo_bp: '100,01' })], base, 'gerente');
    expect(desc.erros.i1?.desconto_maximo_bp).toBeTruthy();
  });

  it('RN-CAD-06: produto repetido na mesma filial marca a linha repetida, mesmo contra uma linha já gravada', () => {
    const repetida: LinhaPreco = { ...linhaVazia('nova-1'), filial_id: F1, produto_id: P1, preco_centavos: '9,90' };
    const lote = lotePorLinha([...base, repetida], base, 'gerente');
    expect(lote.corpo).toBeNull();
    expect(lote.erros['nova-1']?.linha).toBe('Produto repetido na mesma filial');
    const outraFilial = lotePorLinha([...base, { ...repetida, filial_id: F2 }], base, 'gerente');
    expect(outraFilial.corpo?.itens).toHaveLength(1);
    expect(outraFilial.chaves).toEqual(['nova-1']);
  });

  it('erro da API (itens.N e itens.N.campo) volta à linha do lote; o resto vira erro geral', () => {
    const chaves = ['i1', 'nova-2'];
    const { porLinha, geral } = errosDaApiPorLinha({ 'itens.1.preco_centavos': 'Valor inválido', 'itens.0': 'Produto repetido na mesma filial', produto_id: 'Produto inexistente' }, chaves);
    expect(porLinha['nova-2']).toEqual({ preco_centavos: 'Valor inválido' });
    expect(porLinha.i1).toEqual({ linha: 'Produto repetido na mesma filial' });
    expect(geral).toBe('Produto inexistente');
    expect(errosDaApiPorLinha(undefined, chaves)).toEqual({ porLinha: {}, geral: null });
  });
});
