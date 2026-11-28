import { describe, expect, it } from 'vitest';
import { MENSAGEM_FILIAL_DO_USUARIO, MENSAGEM_FILIAL_FORA_DA_EMPRESA } from '../contracts';
import { avaliarFiliaisDoUsuario } from './usuarios-filiais';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('RN-CORE-40: o usuário fica com pelo menos uma filial', () => {
  it('RN-CORE-40: criar com filial_ids vazio ou ausente é recusado', () => {
    expect(avaliarFiliaisDoUsuario({ operacao: 'criar', filial_ids: [] })).toEqual({ ok: false, mensagem: 'Escolha ao menos uma filial.' });
    expect(avaliarFiliaisDoUsuario({ operacao: 'criar' })).toEqual({ ok: false, mensagem: MENSAGEM_FILIAL_DO_USUARIO });
  });
  it('RN-CORE-40: editar com filial_ids [] é recusado', () => {
    expect(avaliarFiliaisDoUsuario({ operacao: 'editar', filial_ids: [] })).toEqual({ ok: false, mensagem: MENSAGEM_FILIAL_DO_USUARIO });
  });
  it('RN-CORE-40: editar sem o campo mantém as filiais atuais', () => {
    expect(avaliarFiliaisDoUsuario({ operacao: 'editar' })).toEqual({ ok: true });
  });
  it('RN-CORE-40: criar e editar com ao menos uma filial da empresa passam', () => {
    expect(avaliarFiliaisDoUsuario({ operacao: 'criar', filial_ids: [A], filiais_da_empresa: [A, B] })).toEqual({ ok: true });
    expect(avaliarFiliaisDoUsuario({ operacao: 'editar', filial_ids: [A, B], filiais_da_empresa: [A, B] })).toEqual({ ok: true });
  });
  it('RN-CORE-40: filial de outro tenant ou excluída (fora da lista viva da empresa) é recusada', () => {
    expect(avaliarFiliaisDoUsuario({ operacao: 'criar', filial_ids: [A, B], filiais_da_empresa: [A] })).toEqual({ ok: false, mensagem: MENSAGEM_FILIAL_FORA_DA_EMPRESA });
  });
});
