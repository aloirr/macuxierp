'use server';
import { UsuarioConfigCriar, UsuarioConfigEditar } from '@macuxierp/core/contracts';
import { PADRAO_UUID } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { criarUsuario, editarUsuario, excluirUsuario, inativarUsuario, reativarUsuario, redefinirSenhaUsuario } from '@/lib/config/api';
import { USUARIO_NAO_ENCONTRADO } from '@/lib/config/erros';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';

/**
 * Usuários da empresa na Config (v0.3.29, RN-CORE-01, RN-CORE-17). Cada ação refaz a validação do contrato (a API revalida de novo,
 * regra 2) e a tela só obedece a `acoes` e `ultimo_admin_ativo` da linha. A senha provisória sai só no `valor` da resposta: nada de
 * log, URL ou armazenamento, e a repetição da Idempotency-Key dá 409 (mensagem própria).
 */
const atualizar = (id: string) => revalidatePath(`/config/empresas/${id}`);
const semUsuario = () => falha(USUARIO_NAO_ENCONTRADO);

/** Mensagens de campo em português (o texto do Zod é em inglês). */
const MSG: Readonly<Record<string, string>> = {
  nome: 'Informe o nome, de 2 a 80 caracteres.',
  email: 'E-mail inválido. Confira o endereço.',
  perfil: 'Escolha o perfil.',
  filial_ids: 'Escolha a filial.',
};
const camposDe = (erro: { issues: readonly { path: readonly (string | number)[] }[] }): Record<string, string> =>
  Object.fromEntries(erro.issues.map((i) => [String(i.path[0] ?? 'nome'), MSG[String(i.path[0])] ?? 'Confira este campo.']));
const invalido = (erro: Parameters<typeof camposDe>[0]) => falha('Confira os dados e tente de novo.', camposDe(erro));

export async function criarUsuarioAcao(id: string, entrada: { nome: string; email: string; perfil: string; filial_ids?: string[] }, chave: string) {
  const p = UsuarioConfigCriar.safeParse({ nome: entrada.nome, email: entrada.email.trim(), perfil: entrada.perfil, filial_ids: entrada.filial_ids ?? [] });
  if (!p.success) return invalido(p.error);
  const r = await executarConfig('usuario', (t) => criarUsuario(t, id, p.data, chave));
  if (r.ok) atualizar(id);
  return r;
}

export async function editarUsuarioAcao(id: string, usuario: string, entrada: { nome?: string; perfil?: string; filial_ids?: string[] }) {
  if (!PADRAO_UUID.test(usuario)) return semUsuario();
  const p = UsuarioConfigEditar.safeParse(entrada);
  if (!p.success) return invalido(p.error);
  const r = await executarConfig('usuario', (t) => editarUsuario(t, id, usuario, p.data));
  if (r.ok) atualizar(id);
  return r;
}

export async function redefinirSenhaUsuarioAcao(id: string, usuario: string, chave: string) {
  if (!PADRAO_UUID.test(usuario)) return semUsuario();
  const r = await executarConfig('usuario', (t) => redefinirSenhaUsuario(t, id, usuario, chave));
  if (r.ok) atualizar(id);
  return r;
}

export async function inativarUsuarioAcao(id: string, usuario: string) {
  if (!PADRAO_UUID.test(usuario)) return semUsuario();
  const r = await executarConfig('usuario', (t) => inativarUsuario(t, id, usuario));
  if (r.ok) atualizar(id);
  return r;
}

export async function reativarUsuarioAcao(id: string, usuario: string) {
  if (!PADRAO_UUID.test(usuario)) return semUsuario();
  const r = await executarConfig('usuario', (t) => reativarUsuario(t, id, usuario));
  if (r.ok) atualizar(id);
  return r;
}

export async function excluirUsuarioAcao(id: string, usuario: string): Promise<Resultado<{ id: string; situacao: 'excluido' }>> {
  if (!PADRAO_UUID.test(usuario)) return semUsuario();
  const r = await executarConfig('usuario', (t) => excluirUsuario(t, id, usuario));
  if (r.ok) atualizar(id);
  return r;
}
