import { PERMISSOES } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { rotuloDaAcao, ROTULO_ACAO } from './textos-permissoes';

describe('rótulos das permissões (código → nome)', () => {
  it('RN-CORE-09: toda ação da matriz tem nome em português e nenhum nome mostra o código cru', () => {
    for (const acao of Object.keys(PERMISSOES)) {
      const nome = ROTULO_ACAO[acao as keyof typeof PERMISSOES];
      expect(nome, acao).toBeTruthy();
      expect(nome, acao).not.toMatch(/^[a-z-]+\.[a-z_.-]+$/);
    }
  });
  it('RN-CORE-09: cadastros.carga.executar aparece como "Executar carga de dados"; ação desconhecida sai como veio', () => {
    expect(rotuloDaAcao('cadastros.carga.executar')).toBe('Executar carga de dados');
    expect(rotuloDaAcao('x.nova.acao')).toBe('x.nova.acao');
  });
});
