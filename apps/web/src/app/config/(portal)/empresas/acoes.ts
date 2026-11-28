'use server';
import { AlterarModulosEntrada, CriarEmpresaEntrada, SituacaoEmpresaEntrada } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { alterarModulos, alterarSituacao, criarEmpresa, listarEmpresas } from '@/lib/config/api';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';
import { MOTIVO_INVALIDO, traduzirCriarEmpresa } from '@/lib/config/formularios';

/**
 * Ações do portal. Cada uma refaz a validação do contrato (a API revalida de novo, regra 2) e manda a Idempotency-Key.
 * O 1º administrador saiu na Config v4: os usuários da empresa ficam em `acoes-usuarios.ts`.
 */
const atualizar = (id: string) => {
  revalidatePath('/config');
  revalidatePath(`/config/empresas/${id}`);
};

export async function criarEmpresaAcao(entrada: { codigo: string; nome: string; fuso: string }, chave: string): Promise<Resultado<never>> {
  const p = CriarEmpresaEntrada.safeParse({ codigo: entrada.codigo.trim() || undefined, nome: entrada.nome, fuso: entrada.fuso.trim() || undefined });
  if (entrada.codigo.trim() === '' || !p.success) return falha('', traduzirCriarEmpresa(p.success ? null : p.error, entrada.codigo));
  const r = await executarConfig('criar_empresa', (t) => criarEmpresa(t, p.data, chave));
  if (!r.ok) return r;
  revalidatePath('/config');
  return redirect(`/config/empresas/${r.valor.id}?criada=1`);
}

export async function alterarModulosAcao(id: string, modulos: unknown) {
  const p = AlterarModulosEntrada.safeParse({ modulos });
  if (!p.success) return falha('Escolha ao menos um módulo para mudar.');
  const r = await executarConfig('modulos', (t) => alterarModulos(t, id, p.data));
  if (r.ok) atualizar(id);
  return r.ok ? ({ ok: true, valor: null } as const) : r;
}

export async function situacaoAcao(id: string, situacao: string, motivo: string, chave: string) {
  const p = SituacaoEmpresaEntrada.safeParse({ situacao, motivo });
  if (!p.success) return falha('', { motivo: MOTIVO_INVALIDO });
  const r = await executarConfig('situacao', (t) => alterarSituacao(t, id, p.data, chave));
  if (r.ok) atualizar(id);
  return r.ok ? ({ ok: true, valor: null } as const) : r;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Próxima página da lista (botão "Carregar mais"). O cursor é validado aqui; a API revalida. */
export async function maisEmpresasAcao(busca: string, cursor: string) {
  if (!UUID.test(cursor)) return falha('Não foi possível carregar mais. Tente de novo.');
  const b = busca.trim().slice(0, 80);
  return executarConfig('carregar', (t) => listarEmpresas(t, { busca: b || undefined, cursor }));
}
