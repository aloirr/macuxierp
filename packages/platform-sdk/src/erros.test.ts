import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { violacao, type Violacao } from './erros';

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
