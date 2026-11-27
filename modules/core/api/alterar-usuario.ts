/**
 * Sequência única de alteração de usuário (RN-CORE-01), usada pela rota e pelo teste de banco de concorrência:
 * trava os administradores ativos, lê o `atual` já sob a trava, conta os outros, avalia o domain e só então grava.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { avaliarAlteracaoUsuario, avaliarExclusaoUsuario } from '../domain';
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

type RepoTrava = Pick<RepositorioCore, 'travarAdministradoresAtivos' | 'usuarioPorId' | 'contarAdministradoresAtivos'>;

/** RN-CORE-01: trava os administradores ativos, lê o alvo já sob a trava e conta os outros (ordem única, sem corrida). */
async function lerSobTrava(repo: RepoTrava, tx: Transacao, id: string): Promise<{ atual: LinhaUsuario; outros: number } | null> {
  await repo.travarAdministradoresAtivos(tx);
  const atual = await repo.usuarioPorId(tx, id);
  if (!atual) return null;
  return { atual, outros: await repo.contarAdministradoresAtivos(tx, id) };
}

export async function alterarUsuarioComTrava(
  repo: Pick<RepositorioCore, 'travarAdministradoresAtivos' | 'usuarioPorId' | 'contarAdministradoresAtivos' | 'atualizarUsuario'>,
  tx: Transacao,
  id: string,
  patch: PatchUsuario,
  agora: Date,
  opcoes: OpcoesAlterarUsuario = {},
): Promise<ResultadoAlterarUsuario> {
  const lido = await lerSobTrava(repo, tx, id);
  if (!lido) return { tipo: 'nao_encontrado' };
  const { atual, outros } = lido;
  if (opcoes.somenteSeAtivo && !atual.ativo) return { tipo: 'sem_mudanca', atual };
  const r = avaliarAlteracaoUsuario({ atual, alteracao: patch, outrosAdministradoresAtivos: outros });
  if (!r.ok) return { tipo: 'recusado', mensagem: r.mensagem };
  const depois = await repo.atualizarUsuario(tx, id, patch, agora, opcoes.token);
  return depois ? { tipo: 'ok', antes: atual, depois } : { tipo: 'conflito' };
}

export type ResultadoExcluirUsuario =
  | { tipo: 'nao_encontrado' }
  | { tipo: 'recusado'; mensagem: string }
  | { tipo: 'ok'; antes: LinhaUsuario; depois: LinhaUsuario };

/** RN-CORE-01 e RN-CORE-17: a mesma sequência (trava, leitura, contagem, domain) antes da exclusão lógica. */
export async function excluirUsuarioComTrava(
  repo: Pick<RepositorioCore, 'travarAdministradoresAtivos' | 'usuarioPorId' | 'contarAdministradoresAtivos' | 'excluirUsuario'>,
  tx: Transacao,
  id: string,
  agora: Date,
): Promise<ResultadoExcluirUsuario> {
  const lido = await lerSobTrava(repo, tx, id);
  if (!lido) return { tipo: 'nao_encontrado' };
  const { atual, outros } = lido;
  const r = avaliarExclusaoUsuario({ atual, outrosAdministradoresAtivos: outros });
  if (!r.ok) return { tipo: 'recusado', mensagem: r.mensagem };
  const depois = await repo.excluirUsuario(tx, id, agora);
  return depois ? { tipo: 'ok', antes: atual, depois } : { tipo: 'nao_encontrado' };
}
