import { describe, expect, it } from 'vitest';
import { CAMPOS_TABELA_PRECO } from './precos';

describe('descritor da tabela de preço', () => {
  it('RN-CAD-06: Início e Fim da vigência são campos do tipo data (seletor de data, AAAA-MM-DD)', () => {
    const tipo = (nome: string) => CAMPOS_TABELA_PRECO.find((c) => c.nome === nome)?.tipo;
    expect(tipo('vigencia_inicio')).toBe('data');
    expect(tipo('vigencia_fim')).toBe('data');
  });
});
