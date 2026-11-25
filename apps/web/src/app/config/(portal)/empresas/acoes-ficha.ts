'use server';
import { CampoContato, type FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { revalidatePath } from 'next/cache';
import { atualizarReceita, revelarContato } from '@/lib/config/api';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';

/**
 * Ações da ficha da Receita (T-0101, ADR 0012 emenda da ficha). A API revalida e audita. O e-mail ou o telefone mostrado
 * sai só no `valor`: nada de log, URL ou armazenamento. A fonte pode falhar sem derrubar a tela (a ficha anterior fica);
 * a `mensagem` da falha é a do core, exibida como vem.
 */
export async function atualizarReceitaAcao(id: string, chave: string): Promise<Resultado<{ campos_alterados: string[]; ficha: FichaReceitaPlanaMascarada | null }>> {
  const r = await executarConfig('receita', (t) => atualizarReceita(t, id, chave));
  if (!r.ok) return r;
  if (r.valor.estado === 'erro') return { ok: false, erro: r.valor.mensagem, campos: {}, chaveNova: true };
  revalidatePath(`/config/empresas/${id}`);
  return { ok: true, valor: { campos_alterados: r.valor.campos_alterados, ficha: r.valor.ficha } };
}

export async function revelarContatoAcao(id: string, campo: string): Promise<Resultado<{ valor: string | null }>> {
  const c = CampoContato.safeParse(campo);
  if (!c.success) return falha('Escolha e-mail ou telefone.');
  return executarConfig('receita', (t) => revelarContato(t, id, c.data));
}
