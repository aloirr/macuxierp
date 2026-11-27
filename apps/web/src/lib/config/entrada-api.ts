import { CAMINHOS_ENTRADA_PLATAFORMA, CredencialEntradaCriada, PortalEntradaLeitura, type CriarCredencialEntrada } from '@macuxierp/platform-sdk';
import { chamar, idEmpresa, recusar, validado } from './api';

/**
 * Cliente das rotas do portal da entrada (T-0057, contrato `CAMINHOS_ENTRADA_PLATAFORMA` do SDK), sob `/v1/plataforma`. Só no servidor.
 * A chave devolvida pelo POST vai só à resposta da ação: não é logada nem guardada. O POST não é idempotente (cada um gera
 * chave nova e invalida a anterior): por isso sem Idempotency-Key e sem repetição automática.
 */
const rota = (modelo: string, id: string) => modelo.replace(':id', idEmpresa(id));

export async function lerEntrada(token: string, id: string): Promise<PortalEntradaLeitura> {
  return validado(await chamar('GET', rota(CAMINHOS_ENTRADA_PLATAFORMA.ler, id), { token }), PortalEntradaLeitura);
}

/** Cria ou troca a chave do conector. */
export async function criarCredencialEntrada(token: string, id: string, corpo: CriarCredencialEntrada): Promise<CredencialEntradaCriada> {
  return validado(await chamar('POST', rota(CAMINHOS_ENTRADA_PLATAFORMA.credencial, id), { token, corpo }), CredencialEntradaCriada);
}

/** `DELETE ...?conector_id=`: a resposta de sucesso não tem corpo que a tela use. */
export async function revogarCredencialEntrada(token: string, id: string, conectorId: string): Promise<void> {
  const r = await chamar('DELETE', `${rota(CAMINHOS_ENTRADA_PLATAFORMA.credencial, id)}?conector_id=${encodeURIComponent(conectorId)}`, { token });
  if (!r.ok) return recusar(r);
}
