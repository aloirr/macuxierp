'use server';
import { AlterarModulosEntrada, CriarEmpresaEntrada, PrimeiroAdminEntrada, SituacaoEmpresaEntrada } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { alterarModulos, alterarSituacao, criarEmpresa, criarPrimeiroAdmin, redefinirSenhaPrimeiroAdmin } from '@/lib/config/api';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';
import { MOTIVO_INVALIDO, traduzirCriarEmpresa } from '@/lib/config/formularios';

/**
 * Ações do portal. Cada uma refaz a validação do contrato (a API revalida de novo, regra 2) e manda a Idempotency-Key.
 * A senha provisória sai só no `valor` da resposta: nada vai a log, URL ou armazenamento.
 */
const atualizar = (id: string) => {
  revalidatePath('/config');
  revalidatePath(`/config/empresas/${id}`);
};

export async function criarEmpresaAcao(entrada: { slug: string; nome: string; fuso: string }, chave: string): Promise<Resultado<never>> {
  const p = CriarEmpresaEntrada.safeParse({ slug: entrada.slug.trim(), nome: entrada.nome, fuso: entrada.fuso.trim() || undefined });
  if (!p.success) return falha('', traduzirCriarEmpresa(p.error));
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

export async function criarAdminAcao(id: string, entrada: { email: string; nome: string }, chave: string) {
  const p = PrimeiroAdminEntrada.safeParse({ email: entrada.email, nome: entrada.nome || undefined });
  if (!p.success) {
    const nome = p.error.issues.some((i) => i.path[0] === 'nome');
    return falha('', nome ? { nome: 'Informe o nome (2 a 80 caracteres).' } : { email: 'E-mail inválido. Confira o endereço.' });
  }
  const r = await executarConfig('criar_admin', (t) => criarPrimeiroAdmin(t, id, p.data, chave));
  if (r.ok) atualizar(id);
  return r.ok ? ({ ok: true, valor: { senha: r.valor.senha_provisoria } } as const) : r;
}

export async function redefinirSenhaAcao(id: string, chave: string) {
  const r = await executarConfig('redefinir', (t) => redefinirSenhaPrimeiroAdmin(t, id, chave));
  if (r.ok) atualizar(id);
  return r.ok ? ({ ok: true, valor: { senha: r.valor.senha_provisoria } } as const) : r;
}

export async function situacaoAcao(id: string, situacao: string, motivo: string, chave: string) {
  const p = SituacaoEmpresaEntrada.safeParse({ situacao, motivo });
  if (!p.success) return falha('', { motivo: MOTIVO_INVALIDO });
  const r = await executarConfig('situacao', (t) => alterarSituacao(t, id, p.data, chave));
  if (r.ok) atualizar(id);
  return r.ok ? ({ ok: true, valor: null } as const) : r;
}
