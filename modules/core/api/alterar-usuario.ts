/**
 * Sequência única de alteração de usuário (RN-CORE-01), usada pela rota e pelo teste de banco de concorrência:
 * trava os administradores ativos, lê o `atual` já sob a trava, conta os outros, avalia o domain e só então grava.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { avaliarAlteracaoUsuario } from '../domain';
import type { LinhaUsuario, PatchUsuario, RepositorioCore } from './portas';

export interface OpcoesAlterarUsuario {
  token?: Date;
  somenteSeAtivo?: boolean;
}

export type ResultadoAlterarUsuario =
  | { tipo: 'nao_encontrado' }
  | { tipo: 'sem_mudanca'; atual: LinhaUsuario }
  | { tipo: 'recusado'; mensagem: string }
  | { tipo: 'conflito' }
  | { tipo: 'ok'; antes: LinhaUsuario; depois: LinhaUsuario };

export async function alterarUsuarioComTrava(
  repo: Pick<RepositorioCore, 'travarAdministradoresAtivos' | 'usuarioPorId' | 'contarAdministradoresAtivos' | 'atualizarUsuario'>,
  tx: Transacao,
  id: string,
  patch: PatchUsuario,
  agora: Date,
  opcoes: OpcoesAlterarUsuario = {},
): Promise<ResultadoAlterarUsuario> {
  await repo.travarAdministradoresAtivos(tx);
  const atual = await repo.usuarioPorId(tx, id);
  if (!atual) return { tipo: 'nao_encontrado' };
  if (opcoes.somenteSeAtivo && !atual.ativo) return { tipo: 'sem_mudanca', atual };
  const outros = await repo.contarAdministradoresAtivos(tx, id);
  const r = avaliarAlteracaoUsuario({ atual, alteracao: patch, outrosAdministradoresAtivos: outros });
  if (!r.ok) return { tipo: 'recusado', mensagem: r.mensagem };
  const depois = await repo.atualizarUsuario(tx, id, patch, agora, opcoes.token);
  return depois ? { tipo: 'ok', antes: atual, depois } : { tipo: 'conflito' };
}
