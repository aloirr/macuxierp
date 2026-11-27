'use server';
import { CampoContato, MENSAGENS_BLOQUEIO_CNPJ, type FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { cnpjValido, normalizarDocumento } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { previaReceita, revelarContato, salvarFicha, trocarCnpj } from '@/lib/config/api';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';
import { ERRO_CAMPOS } from '@/lib/textos';
import { validarFicha, type FormFicha } from '@/lib/config/ficha-edicao';

/**
 * Ações da ficha da Receita (T-0101; editável na v0.3.24, RN-CORE-16). A API revalida e audita (só nomes de campo). O e-mail
 * ou o telefone mostrado sai só no `valor`: nada de log, URL ou armazenamento. A `mensagem` de falha é a do core, como vem.
 */

/** "Atualizar pela Receita": só a prévia, para preencher o formulário. Nada é gravado. */
export async function previaReceitaAcao(id: string, chave: string): Promise<Resultado<{ previa: FichaReceitaPlanaMascarada; diferentes: string[]; consultado_em: string }>> {
  const r = await executarConfig('receita', (t) => previaReceita(t, id, chave));
  if (!r.ok) return r;
  if (r.valor.estado === 'erro') return { ok: false, erro: r.valor.mensagem, campos: {}, chaveNova: true };
  return { ok: true, valor: { previa: r.valor.previa, diferentes: r.valor.diferentes, consultado_em: r.valor.consultado_em } };
}

/** "Salvar": revalida o formulário com o contrato e grava. Erro de campo volta junto do campo. */
export async function salvarFichaAcao(id: string, form: FormFicha, origem: 'manual' | 'receita', consultadoEm: string | undefined, chave: string): Promise<Resultado<{ campos_alterados: string[] }>> {
  const v = validarFicha(form, origem, consultadoEm);
  if (!v.ok) return falha(ERRO_CAMPOS, v.campos as Record<string, string>);
  const r = await executarConfig('ficha', (t) => salvarFicha(t, id, v.edicao, chave));
  if (!r.ok) return r;
  revalidatePath(`/config/empresas/${id}`);
  return { ok: true, valor: { campos_alterados: r.valor.estado === 'ok' ? r.valor.campos_alterados : [] } };
}

/** Troca do CNPJ (só superadmin; bloqueada com NF-e autorizada em produção). O motivo do bloqueio é o texto do core. */
export async function trocarCnpjAcao(id: string, cnpj: string, chave: string): Promise<Resultado<{ cnpj: string }>> {
  const novo = normalizarDocumento(cnpj);
  if (!cnpjValido(novo)) return falha('', { cnpj_novo: MENSAGENS_BLOQUEIO_CNPJ.cnpj_invalido });
  const r = await executarConfig('ficha', (t) => trocarCnpj(t, id, { cnpj_novo: novo, confirmacao: true }, chave));
  if (!r.ok) return r;
  if (r.valor.estado === 'bloqueado') return { ok: false, erro: r.valor.mensagem, campos: {}, chaveNova: true };
  revalidatePath(`/config/empresas/${id}`);
  return { ok: true, valor: { cnpj: r.valor.cnpj } };
}

export async function revelarContatoAcao(id: string, campo: string): Promise<Resultado<{ valor: string | null }>> {
  const c = CampoContato.safeParse(campo);
  if (!c.success) return falha('Escolha e-mail ou telefone.');
  return executarConfig('receita', (t) => revelarContato(t, id, c.data));
}
