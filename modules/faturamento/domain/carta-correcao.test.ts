import { describe, expect, it } from 'vitest';
import { avisosCartaCorrecao, proximaSequenciaCce, validarCartaCorrecao } from './carta-correcao';

const base = { status: 'autorizada' as const, texto: 'Corrigir o endereço de entrega no campo de informações', sequenciasRegistradas: [] as number[] };

describe('carta de correção', () => {
  it('RN-FAT-02: nota autorizada, texto válido e nenhuma CC-e antes: sem violação e a sequência é 1', () => {
    expect(validarCartaCorrecao(base)).toEqual([]);
    expect(proximaSequenciaCce([])).toBe(1);
  });
  it('RN-FAT-02: só autorizada; cancelada tem mensagem própria', () => {
    expect(validarCartaCorrecao({ ...base, status: 'rejeitada' }).map((v) => v.campo)).toContain('status');
    expect(validarCartaCorrecao({ ...base, status: 'cancelada' })[0]?.mensagem).toContain('cancelada');
  });
  it('RN-FAT-02: texto de 15 a 1000 caracteres', () => {
    expect(validarCartaCorrecao({ ...base, texto: 'x'.repeat(14) }).map((v) => v.campo)).toEqual(['texto']);
    expect(validarCartaCorrecao({ ...base, texto: 'x'.repeat(1000) })).toEqual([]);
    expect(validarCartaCorrecao({ ...base, texto: 'x'.repeat(1001) }).map((v) => v.campo)).toEqual(['texto']);
  });
  it('RN-FAT-02: nSeqEvento é o próximo depois do maior, de 1 a 20', () => {
    expect(proximaSequenciaCce([1, 3, 2])).toBe(4);
    expect(validarCartaCorrecao({ ...base, sequenciasRegistradas: [19] })).toEqual([]);
    expect(validarCartaCorrecao({ ...base, sequenciasRegistradas: [20] }).map((v) => v.campo)).toContain('nSeqEvento');
  });
  it('RN-FAT-02: palavras de valor, remetente/destinatário e datas geram aviso sem bloquear', () => {
    const t = 'Corrigir o valor do imposto e a data de emissão; trocar a razão social do destinatário';
    expect(avisosCartaCorrecao(t).map((a) => a.grupo).sort()).toEqual(['dados_parte', 'data', 'valor']);
    expect(validarCartaCorrecao({ ...base, texto: t })).toEqual([]);
    expect(avisosCartaCorrecao('Corrigir o endereço de entrega no campo de informações')).toEqual([]);
  });
  it('RN-FAT-02: aviso ignora acentos e caixa', () => {
    expect(avisosCartaCorrecao('ALIQUOTA errada no item 1, favor ajustar').map((a) => a.grupo)).toEqual(['valor']);
  });
});
