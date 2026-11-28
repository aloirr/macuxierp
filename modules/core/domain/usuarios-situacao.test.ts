import { describe, expect, it } from 'vitest';
import { MENSAGEM_ULTIMO_ADMIN } from '../contracts';
import { acoesDoUsuario, avaliarExclusaoUsuario, situacaoDoUsuario } from './usuarios-situacao';

const agora = new Date('2026-11-27T23:00:00Z');

describe('RN-CORE-17: situação do usuário', () => {
  it('inativo vence a trava; trava vigente = bloqueado; senão ativo', () => {
    expect(situacaoDoUsuario({ ativo: false, bloqueado_ate: new Date('2026-11-28T00:00:00Z') }, agora)).toBe('inativo');
    expect(situacaoDoUsuario({ ativo: true, bloqueado_ate: new Date('2026-11-27T23:10:00Z') }, agora)).toBe('bloqueado');
    expect(situacaoDoUsuario({ ativo: true, bloqueado_ate: new Date('2026-11-27T22:59:00Z') }, agora)).toBe('ativo');
    expect(situacaoDoUsuario({ ativo: true, bloqueado_ate: null }, agora)).toBe('ativo');
  });
});

describe('RN-CORE-01 e RN-CORE-17: ações do menu "Ações ▾" (52 A)', () => {
  it('ativo e bloqueado: Editar, Redefinir senha, Inativar e Excluir', () => {
    expect(acoesDoUsuario({ situacao: 'ativo', ultimo_admin_ativo: false })).toEqual(['editar', 'redefinir_senha', 'inativar', 'excluir']);
    expect(acoesDoUsuario({ situacao: 'bloqueado', ultimo_admin_ativo: false })).toEqual(['editar', 'redefinir_senha', 'inativar', 'excluir']);
  });
  it('inativo: Editar, Reativar e Excluir (Inativar é reversível)', () => {
    expect(acoesDoUsuario({ situacao: 'inativo', ultimo_admin_ativo: false })).toEqual(['editar', 'reativar', 'excluir']);
  });
  it('último administrador ativo: o Excluir some do menu; o Inativar fica e a API recusa', () => {
    expect(acoesDoUsuario({ situacao: 'ativo', ultimo_admin_ativo: true })).toEqual(['editar', 'redefinir_senha', 'inativar']);
  });
});

describe('RN-CORE-01: Excluir o último administrador ativo é recusado', () => {
  const adm = { id: 'a', perfil: 'administrador' as const, ativo: true };
  it('sem outro administrador ativo, recusa', () => {
    expect(avaliarExclusaoUsuario({ atual: adm, outrosAdministradoresAtivos: 0 })).toEqual({
      ok: false,
      mensagem: MENSAGEM_ULTIMO_ADMIN,
    });
  });
  it('com outro administrador ativo, ou se o alvo já está inativo ou não é admin, aceita', () => {
    expect(avaliarExclusaoUsuario({ atual: adm, outrosAdministradoresAtivos: 1 })).toEqual({ ok: true });
    expect(avaliarExclusaoUsuario({ atual: { ...adm, ativo: false }, outrosAdministradoresAtivos: 0 })).toEqual({ ok: true });
    expect(avaliarExclusaoUsuario({ atual: { ...adm, perfil: 'gerente' }, outrosAdministradoresAtivos: 0 })).toEqual({ ok: true });
  });
});
