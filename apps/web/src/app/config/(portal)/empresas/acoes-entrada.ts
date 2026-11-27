'use server';
import { CriarCredencialEntrada, type CredencialEntradaCriada } from '@macuxierp/platform-sdk';
import { revalidatePath } from 'next/cache';
import { criarCredencialEntrada, revogarCredencialEntrada } from '@/lib/config/entrada-api';
import { ERRO_CODIGO_REGRA, ERRO_REVOGAR } from '@/lib/config/entrada-textos';
import { executarConfig, falha, type Resultado } from '@/lib/config/executar';

/**
 * Ações do bloco "Integração via API" da aba Integração (T-0057 A1, ADR 0014 §3). A chave nova só existe na resposta da
 * ação de gerar: a tela a guarda no estado do diálogo e nunca a loga. A geração não é idempotente: sem Idempotency-Key.
 */
const atualizar = (id: string) => revalidatePath(`/config/empresas/${id}`);

export async function gerarChaveEntradaAcao(id: string, conectorId: string): Promise<Resultado<CredencialEntradaCriada>> {
  const p = CriarCredencialEntrada.safeParse({ conector_id: conectorId.trim() });
  if (!p.success) return falha('', { conector_id: ERRO_CODIGO_REGRA });
  const r = await executarConfig('entrada', (t) => criarCredencialEntrada(t, id, p.data));
  if (r.ok) atualizar(id);
  return r;
}

export async function revogarChaveEntradaAcao(id: string, conectorId: string): Promise<Resultado<null>> {
  const p = CriarCredencialEntrada.safeParse({ conector_id: conectorId.trim() });
  if (!p.success) return falha(ERRO_REVOGAR);
  const r = await executarConfig('entrada_revogar', (t) => revogarCredencialEntrada(t, id, p.data.conector_id));
  if (r.ok) atualizar(id);
  return r.ok ? { ok: true, valor: null } : r;
}
