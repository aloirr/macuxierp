import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { corpoErroApi, ErroApi, erros, violacao, type Violacao } from './erros';

describe('Violacao (RD-0235)', () => {
  it('violacao(rn, campo, mensagem) monta o formato que cadastros e pedido já usam', () => {
    const v: Violacao = violacao('RN-PED-03', 'itens[0].desconto_centavos', 'O desconto não pode passar do valor do item');
    expect(v).toEqual({ rn: 'RN-PED-03', campo: 'itens[0].desconto_centavos', mensagem: 'O desconto não pode passar do valor do item' });
  });

  it('aceita decisão de desenho (D7, REF) além de RN: quem decide 422 ou 400 é a API', () => {
    expect(violacao('REF', 'filial_id', 'Filial inexistente').rn).toBe('REF');
  });

  it('erros.ts e dinheiro.ts não importam nada do Node (usáveis no domain e no web)', () => {
    for (const f of ['./erros.ts', './dinheiro.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from ['"](node:|pg['"])/);
    }
  });
});

describe('detalhes no ErroApi (T-0016, pedido do modulo-pedido)', () => {
  it('RN-PED-02: erros.regra leva os detalhes estruturados ao corpo, ao lado dos campos', () => {
    const e = erros.regra('RN-PED-02', 'Transição não permitida', undefined, { possiveis: ['aprovado', 'recusado'] });
    expect(e).toMatchObject({ status: 422, codigo: 'RN-PED-02', detalhes: { possiveis: ['aprovado', 'recusado'] } });
    expect(corpoErroApi(e)).toEqual({ codigo: 'RN-PED-02', mensagem: 'Transição não permitida', detalhes: { possiveis: ['aprovado', 'recusado'] } });
  });

  it('sem campos nem detalhes, o corpo continua { codigo, mensagem } (compatível com o que já existe)', () => {
    expect(corpoErroApi(new ErroApi(404, 'NAO_ENCONTRADO', 'Cliente não encontrado'))).toEqual({ codigo: 'NAO_ENCONTRADO', mensagem: 'Cliente não encontrado' });
    expect(corpoErroApi(erros.validacao({ nome: 'obrigatório' }))).toEqual({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { nome: 'obrigatório' } });
  });
});
