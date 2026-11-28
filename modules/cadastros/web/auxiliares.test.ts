import { describe, expect, it } from 'vitest';
import {
  CAMPOS_ITEM_PRECO, camposDaTransferencia, corpoAlterarVendedor, corpoCriarCondicao, corpoCriarVendedor, corpoItemPreco, corpoLotePreco, corpoMovimentoEstoque, corpoTransferencia,
  paginaCondicoes, paginaEstoque, paginaEquipe, paginaIbge, paginasOficiais, validarItemPreco, validarMovimentoEstoque, validarTransferencia, validarVendedor,
} from './auxiliares';
import { formularioPrazoVazio } from './prazos';

const F = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const P = '4a2e6b18-8c1f-4b63-8e4d-5b7c9f3a2d81';

describe('descritores auxiliares (T-0123)', () => {
  it('RN-CAD-07: movimento de entrada vira quantidade x10^4; zero e ilegível são recusados; ajuste aceita sinal', () => {
    const base = { filial_id: F, produto_id: P, tipo: 'entrada', quantidade: '12,5', motivo: 'Contagem' };
    expect(validarMovimentoEstoque(base, 'gerente')).toEqual({});
    expect(corpoMovimentoEstoque(base)).toMatchObject({ quantidade: 125_000, tipo: 'entrada' });
    expect(validarMovimentoEstoque({ ...base, quantidade: '0' }, 'gerente').quantidade).toBeDefined();
    expect(validarMovimentoEstoque({ ...base, quantidade: 'abc' }, 'gerente').quantidade).toBeDefined();
    expect(validarMovimentoEstoque({ ...base, tipo: 'ajuste', quantidade: '-3' }, 'gerente')).toEqual({});
    expect(corpoMovimentoEstoque({ ...base, tipo: 'ajuste', quantidade: '-3' })?.quantidade).toBe(-30_000);
  });

  it('RN-CAD-06: o item da tabela de preço leva o preço em centavos e o desconto em pontos-base, sem external_id', () => {
    const v = { filial_id: F, produto_id: P, preco_centavos: '1.234,56', desconto_maximo_bp: '5,5' };
    expect(validarItemPreco(v, 'gerente')).toEqual({});
    expect(corpoItemPreco(v)).toEqual({ filial_id: F, produto_id: P, preco_centavos: 123_456, desconto_maximo_bp: 550 });
    expect(corpoItemPreco({ ...v, desconto_maximo_bp: '' })?.desconto_maximo_bp).toBe(0);
    expect(validarItemPreco({ ...v, desconto_maximo_bp: '100,01' }, 'gerente').desconto_maximo_bp).toBeDefined();
    expect(validarItemPreco({ ...v, preco_centavos: '12,345' }, 'gerente').preco_centavos).toBeDefined();
    expect(CAMPOS_ITEM_PRECO.map((c) => c.nome)).not.toContain('external_id');
  });

  it('RN-CAD-06: o lote recusa produto repetido na mesma filial e é igual ao reenviar (idempotente)', () => {
    const v = { filial_id: F, produto_id: P, preco_centavos: '10,00', desconto_maximo_bp: '' };
    expect(corpoLotePreco([v, v]).erros['itens.1']).toBeDefined();
    const a = corpoLotePreco([v]);
    expect(a.corpo).toEqual(corpoLotePreco([v]).corpo);
    expect(a.corpo?.itens[0]?.preco_centavos).toBe(1000);
  });

  it('RF-CAD-07: vendedor exige filial; o PATCH leva só o que mudou', () => {
    expect(validarVendedor({ codigo: '1', nome: 'Ana', filial_id: 'x' }, 'criar', 'gerente').filial_id).toBeDefined();
    const v = { codigo: '1', nome: 'Ana', filial_id: F };
    expect(corpoCriarVendedor(v)).toMatchObject({ codigo: '1', filial_id: F });
    const original = { id: P, codigo: '1', nome: 'Ana', filial_id: F, usuario_id: null, external_id: null, inativo: false };
    expect(corpoAlterarVendedor({ ...v, nome: 'Ana Maria' }, original)).toEqual({ nome: 'Ana Maria' });
    expect(corpoAlterarVendedor(v, original)).toBeNull();
  });

  it('D7: a transferência de carteira recusa origem igual ao destino e só aparece a quem pode transferir', () => {
    expect(validarTransferencia({ de: F, para: F }, 'gerente').para).toBeDefined();
    expect(corpoTransferencia({ de: F, para: P })).toEqual({ de: F, para: P });
    expect(camposDaTransferencia('vendedor')).toEqual([]);
    expect(camposDaTransferencia('gerente')).toHaveLength(2);
  });

  it('RN-CAD-15: a condição usa a regra do prazo e as listas apontam para a API certa', () => {
    expect(corpoCriarCondicao({ ...formularioPrazoVazio(), codigo: '30', descricao: '30 dias', forma_tpag: '15', parcelas: ['30'] })).toMatchObject({ prazos_dias: [30] });
    expect(paginaCondicoes.api).toBe('/v1/cadastros/condicoes-pagamento');
    expect(paginaEstoque.chaves).toContain('filial_id');
    expect(paginaEquipe.chaves).toContain('filial_id');
    expect(paginaIbge.api).toBe('/v1/cadastros/oficiais/municipios');
    expect(Object.keys(paginasOficiais)).toEqual(['ncm', 'cest', 'cfop', 'ibge']);
  });
});
