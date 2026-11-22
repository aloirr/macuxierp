import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo cadastros', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('cadastros');
    expect(manifest.publica.every((e) => e.startsWith('cadastros.'))).toBe(true);
  });
  it('C-2 e C-4: publica a tabela de preço e consome a carga inicial do integracao-fdv', () => {
    expect(manifest.publica).toContain('cadastros.tabela_preco.alterada@1');
    expect(manifest.consome).toEqual(['integracao-fdv.carga_inicial.solicitada@1', 'faturamento.nota.autorizada@1', 'faturamento.nota.cancelada@1']);
  });
});
