import { describe, expect, it } from 'vitest';
import { ACOES_REJEICAO, interpretarRetorno } from './retorno';

describe('retorno da SEFAZ', () => {
  it('RN-FAT-03: 100 é autorizada, sem ação pendente', () => {
    expect(interpretarRetorno('100', 'Autorizado o uso da NF-e')).toEqual({ situacao: 'autorizada', codigo: '100', mensagem: 'Autorizado o uso da NF-e', acao: '' });
  });
  it('RN-FAT-07: 110, 301, 302 e 303 são denegadas (sem reenvio)', () => {
    for (const c of ['110', '301', '302', '303']) expect(interpretarRetorno(c, 'Uso Denegado').situacao).toBe('denegada');
  });
  it('RN-FAT-03: 104 (lote processado) não é rejeição: o resultado vem do cStat do protNFe', () => {
    const r = interpretarRetorno('104', 'Lote processado');
    expect(r.situacao).toBe('lote_processado');
    expect(r.acao).toContain('protNFe');
    expect(interpretarRetorno('100', 'Autorizado').situacao).toBe('autorizada');
  });
  it('RN-FAT-03: 204 e 539 são duplicidade e exigem consultarProtocolo antes de mudar o status (nunca rejeitada)', () => {
    for (const c of ['204', '539']) {
      const r = interpretarRetorno(c, 'Rejeição: Duplicidade');
      expect(r.situacao).toBe('duplicidade');
      expect(r.acao).toContain('consulte o protocolo');
    }
  });
  it('RN-FAT-07: 103 e 105 ficam em processamento, sem reenvio', () => {
    for (const c of ['103', '105']) expect(interpretarRetorno(c, 'Lote').situacao).toBe('processamento');
  });
  it('RN-FAT-05: 108 e 109 indicam SEFAZ indisponível (candidata à contingência)', () => {
    expect(interpretarRetorno('109', 'Serviço Paralisado sem Previsão').situacao).toBe('indisponivel');
  });
  it('RN-FAT-07: rejeição traz código, mensagem e ação sugerida; código desconhecido usa a ação padrão', () => {
    const r = interpretarRetorno(' 225 ', ' Rejeição: Falha no Schema XML ');
    expect(r).toMatchObject({ situacao: 'rejeitada', codigo: '225', mensagem: 'Rejeição: Falha no Schema XML' });
    const x = interpretarRetorno('999', 'Erro não catalogado');
    expect(x.situacao).toBe('rejeitada');
    expect(x.acao).toContain('mesmo número');
  });
  it('RF-FAT-08: toda rejeição catalogada tem ação preenchida', () => {
    for (const [c, acao] of Object.entries(ACOES_REJEICAO)) {
      expect(interpretarRetorno(c, 'm').acao).toBe(acao);
      expect(acao.length).toBeGreaterThan(10);
    }
  });
});
