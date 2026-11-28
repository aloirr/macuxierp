import { describe, expect, it } from 'vitest';
import { CAMPOS_TABELA_PRECO, validarTabelaPreco } from './precos';

describe('descritor da tabela de preço', () => {
  it('RN-CAD-06: Início e Fim da vigência são campos do tipo data (seletor de data, AAAA-MM-DD)', () => {
    const tipo = (nome: string) => CAMPOS_TABELA_PRECO.find((c) => c.nome === nome)?.tipo;
    expect(tipo('vigencia_inicio')).toBe('data');
    expect(tipo('vigencia_fim')).toBe('data');
  });

  it('RN-CAD-06: a vigência não traz dica de formato; o Fim diz só que vazio é sem fim (v0.3.30)', () => {
    const ajuda = (nome: string) => CAMPOS_TABELA_PRECO.find((c) => c.nome === nome)?.ajuda;
    expect(ajuda('vigencia_inicio')).toBeUndefined();
    expect(ajuda('vigencia_fim')).toBe('Vazio = sem fim.');
  });

  it('RN-CAD-06: data inválida na vigência mostra "Informe uma data válida."', () => {
    const v = { nome: 'Varejo', vigencia_inicio: '01/01/2026', vigencia_fim: '31/12/2026', padrao: 'false' };
    const e = validarTabelaPreco(v, 'criar', 'gerente');
    expect(e.vigencia_inicio).toBe('Informe uma data válida.');
    expect(e.vigencia_fim).toBe('Informe uma data válida.');
  });
});
