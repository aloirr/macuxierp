/** Chaves do worker com o Hub do FDV (trava de 22/11/2026, ver envio-fdv.ts; desenho T-0002 §2). */
import { describe, expect, it } from 'vitest';
import { configurarEnvioFdv } from './envio-fdv';
import { configurarRecebimentoFdv } from './pedidos-fdv';

describe.each([
  ['MACUXIERP_FDV_ENVIO', configurarEnvioFdv],
  ['MACUXIERP_FDV_RECEBIMENTO', configurarRecebimentoFdv],
] as const)('%s (desligado até a produção conferida e o ok do PO)', (nome, configurar) => {
  it('ausente, vazio ou desligado = desligado; ligado (sem caixa nem espaço) = ligado; outro valor derruba a partida citando só o nome', () => {
    expect(configurar({})).toBe('desligado');
    for (const v of ['', '  ', 'desligado']) expect(configurar({ [nome]: v })).toBe('desligado');
    expect(configurar({ [nome]: ' Ligado ' })).toBe('ligado');
    for (const v of ['sim', '1', 'true', 'segredo-123']) {
      expect(() => configurar({ [nome]: v })).toThrow(new RegExp(`^configuração inválida: ${nome} \\(ligado ou desligado\\)$`));
    }
  });
});
