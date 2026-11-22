import { describe, expect, it } from 'vitest';
import { interpretarRetornoEvento, interpretarRetornoInutilizacao } from './retorno-evento';

describe('retorno da SEFAZ para eventos e inutilização', () => {
  it('RN-FAT-02: 135, 136 e 155 registram o evento (155 = cancelamento homologado fora do prazo)', () => {
    for (const c of ['135', '136', '155']) expect(interpretarRetornoEvento(c)).toBe('registrado');
  });
  it('RN-FAT-03: 573 (duplicidade de evento) pede a consulta do protocolo, nunca vira rejeição direta', () => {
    expect(interpretarRetornoEvento('573')).toBe('duplicado');
  });
  it('RN-FAT-02: qualquer outro código (501 prazo, 494 chave inexistente, 215 schema) rejeita o evento', () => {
    for (const c of ['501', '494', '215', '128', '999']) expect(interpretarRetornoEvento(c)).toBe('rejeitado');
  });
  it('RN-FAT-01: só 102 registra a inutilização; os demais (256 cruza outra, 241 número usado, 215 schema) a rejeitam', () => {
    expect(interpretarRetornoInutilizacao('102')).toBe('registrada');
    for (const c of ['256', '241', '215']) expect(interpretarRetornoInutilizacao(c)).toBe('rejeitada');
  });
  it('RN-FAT-01: 563 (faixa já inutilizada na SEFAZ) nunca é rejeição: é divergência, a faixa segue pendente até o ProcInut', () => {
    expect(interpretarRetornoInutilizacao('563')).toBe('ja_inutilizada');
  });
});
