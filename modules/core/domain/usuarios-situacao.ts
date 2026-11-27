/** Situação e ações do usuário (v0.3.28, RN-CORE-01 e RN-CORE-17), iguais na Config do superadmin e no BKO do tenant. */
import type { AcaoUsuario, SituacaoUsuario } from '../contracts';
import { avaliarAlteracaoUsuario, type AvaliacaoUsuario, type UsuarioAtual } from './usuarios';

/**
 * RN-CORE-17: inativo (ativo = false) vence a trava do login; trava vigente (`bloqueado_ate` > agora) = bloqueado;
 * senão ativo. Mesma regra da `plataforma.usuario_situacao` (0078); excluído não chega aqui (sai da lista).
 */
export function situacaoDoUsuario(u: { ativo: boolean; bloqueado_ate: Date | null }, agora: Date): SituacaoUsuario {
  if (!u.ativo) return 'inativo';
  if (u.bloqueado_ate && u.bloqueado_ate.getTime() > agora.getTime()) return 'bloqueado';
  return 'ativo';
}

/**
 * Itens do menu "Ações ▾" (52 A). RN-CORE-17: Inativar é reversível (o inativo ganha Reativar). RN-CORE-01: no último
 * administrador ativo o Excluir some; o Inativar fica no menu e a API recusa (MXU01, 422), com a etiqueta (46 A) na linha.
 */
export function acoesDoUsuario(u: { situacao: SituacaoUsuario; ultimo_admin_ativo: boolean }): AcaoUsuario[] {
  const acoes: AcaoUsuario[] = u.situacao === 'inativo' ? ['editar', 'reativar'] : ['editar', 'redefinir_senha', 'inativar'];
  if (!u.ultimo_admin_ativo) acoes.push('excluir');
  return acoes;
}

/** RN-CORE-01: Excluir tira o usuário dos ativos, como o Inativar; o último administrador ativo não sai. */
export function avaliarExclusaoUsuario(p: { atual: UsuarioAtual; outrosAdministradoresAtivos: number }): AvaliacaoUsuario {
  return avaliarAlteracaoUsuario({ atual: p.atual, alteracao: { ativo: false }, outrosAdministradoresAtivos: p.outrosAdministradoresAtivos });
}
