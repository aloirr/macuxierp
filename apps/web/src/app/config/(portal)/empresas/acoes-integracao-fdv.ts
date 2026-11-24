'use server';
import { ConfigurarIntegracaoPlataformaEntrada, DefinirCredencialPlataformaEntrada, EntidadeEnvioFdv, type IntegracaoFdvPlataforma, type LogCadastroFdvPlataforma, type MonitorConectorFdv, type RespostaReprocessarFdv } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { cargaCompletaFdv, configurarIntegracaoFdv,definirCredencialFdv, lerLogFdv, lerMonitorFdv, reprocessarFdv, retomarFdv, testarConexaoFdv } from '@/lib/config/api';
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

/** Carga completa (aba Dados, decisão do PO em 24/11): reenvia tudo do cadastro; o domain recusa cadastro desligado ou com lote em voo. */
export async function cargaCompletaFdvAcao(id: string, entidade: string, chave: string): Promise<Resultado<null>> {
  if (!EntidadeEnvioFdv.safeParse(entidade).success) return falha('Cadastro desconhecido.');
  const r = await executarConfig('integracao_fdv', (t) => cargaCompletaFdv(t, id, entidade, chave));
  if (r.ok) atualizar(id);
  return r.ok ? { ok: true, valor: null } : r;
}

/** Reprocessar (T-0086): só falhas e pendentes. Com lote em voo a API responde 409 `CONFLITO` e a tela mostra a mensagem. */
export async function reprocessarFdvAcao(id: string, entidade: string, chave: string): Promise<Resultado<RespostaReprocessarFdv>> {
  if (!EntidadeEnvioFdv.safeParse(entidade).success) return falha('Cadastro desconhecido.');
  const r = await executarConfig('integracao_fdv', (t) => reprocessarFdv(t, id, entidade, chave));
  if (r.ok) atualizar(id);
  return r;
}

/** Atualizar (T-0086): relê o Monitor; a tela mostra `lido_em` em "Atualizado às hh:mm". Só leitura. */
export async function lerMonitorFdvAcao(id: string): Promise<Resultado<MonitorConectorFdv>> {
  return executarConfig('integracao_fdv', (t) => lerMonitorFdv(t, id));
}

/** Log do cadastro (T-0086): só códigos, campos e contagens. */
export async function lerLogFdvAcao(id: string, entidade: string): Promise<Resultado<LogCadastroFdvPlataforma>> {
  if (!EntidadeEnvioFdv.safeParse(entidade).success) return falha('Cadastro desconhecido.');
  return executarConfig('integracao_fdv', (t) => lerLogFdv(t, id, entidade));
}

export async function retomarFdvAcao(id: string, entidade: string, chave: string): Promise<Resultado<{ retomada: boolean }>> {
  if (!EntidadeEnvioFdv.safeParse(entidade).success) return falha('Cadastro desconhecido.');
  const r = await executarConfig('integracao_fdv', (t) => retomarFdv(t, id, entidade, chave));
  if (r.ok) atualizar(id);
  return r;
}
