import { describe, expect, it } from 'vitest';
import { MENSAGENS_PAUSA, MENSAGEM_ERRO_DESCONHECIDO, MSG_SEM_LICENCA, mensagemDaPausa } from './pausa';

describe('catálogo único dos motivos de pausa (RD-2321)', () => {
  it('RN-INF-04: os textos batem com a linha "Motivos de pausa" de nomes-integracao.md', () => {
    expect(MENSAGENS_PAUSA).toEqual({
      credencial: 'O FDV recusou a chave do conector. Use "Trocar chave".',
      licenca_fdv: MSG_SEM_LICENCA,
      licenca_erp: MSG_SEM_LICENCA,
      versao: 'O FDV não aceita mais esta versão do conector. Fale com a Macuxi.',
      envelope: 'O FDV recusou o formato do envio. Fale com a Macuxi.',
      idempotencia: 'O FDV recusou um envio repetido. Fale com a Macuxi.',
      topologia: 'Outro conector já envia este cadastro ao FDV. Fale com a Macuxi.',
    });
    expect(MENSAGEM_ERRO_DESCONHECIDO).toBe('Erro desconhecido. Fale com a Macuxi.');
  });

  it('RN-INF-04: motivo vazio sai vazio e motivo desconhecido cai no texto genérico, sem jargão', () => {
    expect(mensagemDaPausa(null)).toBe('');
    expect(mensagemDaPausa('inventado')).toBe(MENSAGEM_ERRO_DESCONHECIDO);
    for (const t of Object.values(MENSAGENS_PAUSA)) expect(t).not.toMatch(/entidade|idempot[eê]ncia|código/i);
  });
});
