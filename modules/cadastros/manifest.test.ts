import { describe, expect, it } from 'vitest';
import { PERFIS } from '@macuxierp/platform-sdk';
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
  it('RN-CORE-09: os perfis do manifesto são os do SDK', () => {
    expect(manifest.perfis).toEqual([...PERFIS]);
  });
  it('RN-CAD-10 (T-0058): a carga saiu do BKO: o menu "Carga de cadastros" não está no manifesto (é do /config, só superadmin)', () => {
    expect(manifest.web?.menus).not.toContain('Carga de cadastros');
    expect(manifest.web?.menus).toContain('Clientes');
  });
});
