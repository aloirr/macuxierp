import { describe, expect, it } from 'vitest';
import { avaliarPrimeiroAdmin, avaliarRedefinirSenhaPrimeiroAdmin, avaliarSituacaoEmpresa, MENSAGEM_JA_TEM_ADMIN } from './portal';

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', ativo: true, bloqueado: false };

describe('RN-CORE-01: 1º administrador pelo portal /config (T-0050)', () => {
  it('RN-CORE-01: cria em empresa ativa sem administrador', () => {
    expect(avaliarPrimeiroAdmin({ situacao: 'ativo', primeiro_admin: null })).toEqual([]);
  });
  it('RN-CORE-01: recusa o segundo (o reenvio vira 409, sem senha nova)', () => {
    expect(avaliarPrimeiroAdmin({ situacao: 'ativo', primeiro_admin: ADMIN })).toEqual([
      { rn: 'RN-CORE-01', campo: 'primeiro_admin', mensagem: MENSAGEM_JA_TEM_ADMIN },
    ]);
  });
  it('RN-CORE-01: recusa em empresa suspensa', () => {
    expect(avaliarPrimeiroAdmin({ situacao: 'suspenso', primeiro_admin: null })).toMatchObject([{ campo: 'situacao' }]);
  });
});

describe('RN-CORE-01: redefinir a senha do 1º administrador (T-0050)', () => {
  it('RN-CORE-01: redefine quando há administrador ativo e recusa sem ele', () => {
    expect(avaliarRedefinirSenhaPrimeiroAdmin({ situacao: 'ativo', primeiro_admin: ADMIN })).toEqual([]);
    expect(avaliarRedefinirSenhaPrimeiroAdmin({ situacao: 'ativo', primeiro_admin: null })).toMatchObject([{ campo: 'primeiro_admin' }]);
  });
});

describe('T-0050: suspender e reativar a empresa', () => {
  it('suspender e reativar mudam a situação', () => {
    expect(avaliarSituacaoEmpresa({ atual: 'ativo', nova: 'suspenso' })).toEqual({ mudou: true, violacoes: [] });
    expect(avaliarSituacaoEmpresa({ atual: 'suspenso', nova: 'ativo' })).toEqual({ mudou: true, violacoes: [] });
  });
  it('repetir a situação atual não grava nada', () => {
    expect(avaliarSituacaoEmpresa({ atual: 'suspenso', nova: 'suspenso' })).toEqual({ mudou: false, violacoes: [] });
  });
  it('empresa encerrada não muda pelo portal', () => {
    expect(avaliarSituacaoEmpresa({ atual: 'encerrado', nova: 'ativo' })).toMatchObject({ mudou: false, violacoes: [{ campo: 'situacao' }] });
  });
});
