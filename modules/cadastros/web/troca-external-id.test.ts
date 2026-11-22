import { describe, expect, it } from 'vitest';
import { TrocaExternalId } from '../contracts';
import { TROCA_EXTERNAL_ID, podeTrocarExternalId } from './troca-external-id';

describe('troca controlada do external_id no BKO', () => {
  it('RD-0317: só o administrador vê a troca (ação cadastros.external_id.trocar do SDK)', () => {
    expect(podeTrocarExternalId('administrador')).toBe(true);
    expect(podeTrocarExternalId('gerente')).toBe(false);
  });
  it('a rota é a da API e os limites dos campos batem com o contrato TrocaExternalId', () => {
    expect(TROCA_EXTERNAL_ID.api('clientes', 'abc')).toBe('/v1/cadastros/clientes/abc/external-id');
    expect(TROCA_EXTERNAL_ID.campos.map((c) => c.chave)).toEqual(['external_id', 'motivo']);
    expect(TROCA_EXTERNAL_ID.campos.map((c) => c.max)).toEqual([
      TrocaExternalId.shape.external_id.maxLength,
      TrocaExternalId.shape.motivo.maxLength,
    ]);
  });
  it('o aviso, a dica do motivo (sem dado pessoal) e o botão têm o texto combinado', () => {
    expect(TROCA_EXTERNAL_ID.aviso).toBe(
      'Trocar a chave de integração faz o Macuxi FDV ver este cadastro como um registro novo. No Macuxi FDV, o cadastro com a chave antiga deixa de receber atualizações.',
    );
    expect(TROCA_EXTERNAL_ID.campos[1]?.dica).toContain('Não escreva dado pessoal');
    expect(TROCA_EXTERNAL_ID.confirmar).toBe('Trocar a chave');
  });
});
