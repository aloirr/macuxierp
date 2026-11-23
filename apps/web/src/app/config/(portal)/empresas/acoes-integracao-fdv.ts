'use server';
import { ConfigurarIntegracaoPlataformaEntrada, DefinirCredencialPlataformaEntrada, EntidadeEnvioFdv, type IntegracaoFdvPlataforma } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { cargaCompletaFdv, configurarIntegracaoFdv, definirCredencialFdv, retomarFdv, testarConexaoFdv } from '@/lib/config/api';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';

/**
 * Ações da aba Integração do /config (T-0056, ADR 0013). Revalidam o contrato (a API revalida de novo, regra 2). A chave do
 * conector só existe no corpo do pedido: nunca vai a log, URL, estado persistente nem à resposta (a resposta traz só o prefixo).
 */
const atualizar = (id: string) => revalidatePath(`/config/empresas/${id}`);

/** Campo e mensagem FIXA do contrato: nunca o valor digitado. */
function camposDe(erro: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const i of erro.issues) {
    const c = String(i.path[0] ?? 'geral');
    campos[c] ??= i.message;
  }
  return campos;
}

export async function salvarCredencialFdvAcao(id: string, entrada: { conector_id: string; chave: string; ambiente: string }): Promise<Resultado<IntegracaoFdvPlataforma>> {
  const p = DefinirCredencialPlataformaEntrada.safeParse({ conector_id: entrada.conector_id.trim(), chave: entrada.chave, ambiente: entrada.ambiente });
  if (!p.success) return falha('', camposDe(p.error));
  const r = await executarConfig('integracao_fdv', (t) => definirCredencialFdv(t, id, p.data));
  if (r.ok) atualizar(id);
  return r;
}

export async function testarConexaoFdvAcao(id: string, chave: string): Promise<Resultado<{ pedido_em: string }>> {
  const r = await executarConfig('integracao_fdv', (t) => testarConexaoFdv(t, id, chave));
  if (r.ok) atualizar(id);
  return r.ok ? { ok: true, valor: { pedido_em: r.valor.pedido_em } } : r;
}

export async function configurarFdvAcao(id: string, entrada: { entidades_habilitadas: string[]; limite_registros_lote: number }, chave: string): Promise<Resultado<IntegracaoFdvPlataforma>> {
  const p = ConfigurarIntegracaoPlataformaEntrada.safeParse(entrada);
  if (!p.success) return falha('', camposDe(p.error));
  const r = await executarConfig('integracao_fdv', (t) => configurarIntegracaoFdv(t, id, p.data, chave));
  if (r.ok) atualizar(id);
  return r;
}

export async function cargaCompletaFdvAcao(id: string, entidade: string, chave: string): Promise<Resultado<null>> {
  if (!EntidadeEnvioFdv.safeParse(entidade).success) return falha('Cadastro desconhecido.');
  const r = await executarConfig('integracao_fdv', (t) => cargaCompletaFdv(t, id, entidade, chave));
  if (r.ok) atualizar(id);
  return r.ok ? { ok: true, valor: null } : r;
}

export async function retomarFdvAcao(id: string, entidade: string, chave: string): Promise<Resultado<{ retomada: boolean }>> {
  if (!EntidadeEnvioFdv.safeParse(entidade).success) return falha('Cadastro desconhecido.');
  const r = await executarConfig('integracao_fdv', (t) => retomarFdv(t, id, entidade, chave));
  if (r.ok) atualizar(id);
  return r;
}
