/**
 * Rotas de módulo sem depender do Fastify: o módulo declara método, caminho, ação, Zod de entrada e o `executar`; a API
 * (apps/api) monta em `/v1/<modulo>` com a ordem de checagem (RN-CORE-02), a validação (400 VALIDACAO) e a transação
 * do tenant. Assim nenhuma rota escapa da checagem de perfil, tenant e licença.
 */
import type { z } from 'zod';
import type { Sessao } from './acesso';
import type { DadosAuditoria } from './auditoria';
import type { Transacao } from './banco';
import type { EnvelopeEvento } from './eventos';
import { PADRAO_TIPO_TRABALHO, type PedidoTrabalho } from './trabalhos';
import { PADRAO_EVENTO, type ManifestoModulo } from './modulo';
import { moduloDaAcao, type Acao } from './permissoes';

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** O que a rota recebe pronto: sessão, transação do tenant e os atalhos de outbox e auditoria nela. */
export interface ContextoRota {
  sessao: Sessao;
  tx: Transacao;
  request_id: string;
  agora: Date;
  publicar(evento: { nome: string; agregado_id: string; versao: number; payload: Record<string, unknown> }): Promise<EnvelopeEvento>;
  auditar(dados: DadosAuditoria): Promise<void>;
  /** Enfileira trabalho do próprio módulo para o worker (rotas que respondem 202, D5). */
  enfileirar(pedido: Omit<PedidoTrabalho, 'tenant_id'>): Promise<{ id: string }>;
}

export interface EntradaRota<TC, TQ> {
  corpo: TC;
  consulta: TQ;
  params: Record<string, string>;
}

export interface RespostaRota {
  status?: number;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

export interface RotaModulo<TC = unknown, TQ = unknown> {
  metodo: MetodoHttp;
  /** Relativo a `/v1/<modulo>`, começando com `/` (ex.: `/clientes/:id`). */
  caminho: string;
  acao: Acao;
  corpo?: z.ZodType<TC, z.ZodTypeDef, unknown>;
  consulta?: z.ZodType<TQ, z.ZodTypeDef, unknown>;
  executar(c: ContextoRota, e: EntradaRota<TC, TQ>): Promise<RespostaRota>;
}

/**
 * Ajuda de tipo: infere corpo e consulta dos schemas Zod e devolve a rota "apagada" para o plugin. É seguro: a API
 * passa ao `executar` exatamente a saída do `corpo`/`consulta` da própria rota.
 */
export function definirRota<TC = undefined, TQ = undefined>(r: RotaModulo<TC, TQ>): RotaModulo {
  return r as unknown as RotaModulo;
}

export interface PluginModulo {
  manifesto: ManifestoModulo;
  rotas: readonly RotaModulo[];
}

export class PluginInvalido extends Error {
  override readonly name = 'PluginInvalido';
}

/** Valida o plugin no carregamento: caminho com `/`, ação do próprio módulo e sem rota repetida. */
export function definirPlugin(manifesto: ManifestoModulo, rotas: readonly RotaModulo[]): PluginModulo {
  const vistas = new Set<string>();
  for (const r of rotas) {
    const id = `${r.metodo} ${r.caminho}`;
    if (!r.caminho.startsWith('/')) throw new PluginInvalido(`${manifesto.id}: caminho "${r.caminho}" sem "/" inicial`);
    if (moduloDaAcao(r.acao) !== manifesto.id) throw new PluginInvalido(`${manifesto.id}: ação "${r.acao}" de outro módulo em ${id}`);
    if (vistas.has(id)) throw new PluginInvalido(`${manifesto.id}: rota repetida ${id}`);
    vistas.add(id);
  }
  return Object.freeze({ manifesto, rotas });
}

/** Evento publicado pela rota é do próprio módulo (o worker não confere de novo). */
export function eventoDoModulo(modulo: string, nome: string): boolean {
  return PADRAO_EVENTO.test(nome) && nome.startsWith(`${modulo}.`);
}

/** Trabalho enfileirado pela rota é do próprio módulo (`<modulo>.<tarefa>`). */
export function trabalhoDoModulo(modulo: string, tipo: string): boolean {
  return PADRAO_TIPO_TRABALHO.test(tipo) && tipo.startsWith(`${modulo}.`);
}
