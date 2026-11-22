/**
 * Rotas de módulo sem depender do Fastify: o módulo declara método, caminho, ação, Zod de entrada e o `executar`; a API
 * (apps/api) monta em `/v1/<modulo>` com a ordem de checagem (RN-CORE-02), a validação (400 VALIDACAO) e a transação
 * do tenant. Assim nenhuma rota escapa da checagem de perfil, tenant e licença.
 */
import { inspect } from 'node:util';
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
  /** Grava o evento na outbox da transação e devolve o envelope com a versão real do agregado. */
  publicar(evento: {
    nome: string;
    agregado_id: string;
    /** @deprecated ignorada; a versão vem da outbox (T-0034). */
    versao: number;
    payload: Record<string, unknown>;
  }): Promise<EnvelopeEvento>;
  auditar(dados: DadosAuditoria): Promise<void>;
  /** Enfileira trabalho do próprio módulo para o worker (rotas que respondem 202, D5). */
  enfileirar(pedido: Omit<PedidoTrabalho, 'tenant_id'>): Promise<{ id: string }>;
}

export interface EntradaRota<TC, TQ> {
  /** JSON validado pelo `corpo`; na rota multipart, os campos de texto validados pelo mesmo `corpo`. */
  corpo: TC;
  consulta: TQ;
  params: Record<string, string>;
  /** Cabeçalhos do pedido em minúsculas, sem `authorization`, `cookie` e `proxy-authorization` (`if-match`, `idempotency-key`). */
  cabecalhos: Readonly<Record<string, string>>;
  /** Arquivos da rota multipart, por campo (vazio nas rotas JSON). */
  arquivos: Readonly<Record<string, ArquivoRecebido>>;
}

/** O que quem chama a rota passa: a API passa tudo; o teste de rota do módulo pode omitir cabeçalhos e arquivos (vazios). */
export type EntradaChamada<TC, TQ> = Omit<EntradaRota<TC, TQ>, 'cabecalhos' | 'arquivos'> & Partial<Pick<EntradaRota<TC, TQ>, 'cabecalhos' | 'arquivos'>>;

/**
 * Arquivo recebido em multipart (ex.: o `.pfx` do A1, RF-CORE-04). O conteúdo fica num campo privado: `JSON.stringify`,
 * o pino e o `console.log` só veem campo, tipo e tamanho, nunca os bytes nem o nome original (pode ter dado pessoal).
 */
export class ArquivoRecebido {
  readonly #conteudo: Buffer;
  constructor(
    readonly campo: string,
    readonly nome: string,
    readonly tipo: string,
    conteudo: Buffer,
  ) {
    this.#conteudo = conteudo;
  }
  get tamanho(): number {
    return this.#conteudo.byteLength;
  }
  conteudo(): Buffer {
    return this.#conteudo;
  }
  toJSON(): { campo: string; tipo: string; tamanho: number } {
    return { campo: this.campo, tipo: this.tipo, tamanho: this.tamanho };
  }
  [inspect.custom](): string {
    return `ArquivoRecebido(${this.campo}, ${this.tipo}, ${this.tamanho} bytes)`;
  }
}

/** Arquivo que a rota multipart aceita. Acima de `tamanhoMaximo`, 413 `ARQUIVO_GRANDE`; faltando, 400 `VALIDACAO`. */
export interface ArquivoEsperado {
  campo: string;
  tamanhoMaximo: number;
  /** Padrão `true`. */
  obrigatorio?: boolean;
}

/** Teto de qualquer arquivo de rota (igual ao `bodyLimit` da API). */
export const TAMANHO_MAXIMO_ARQUIVO = 1_048_576;

const SEM_REPASSE = new Set(['authorization', 'cookie', 'proxy-authorization']);

/** Cabeçalhos que a rota recebe: minúsculas, lista unida por `, ` e sem credencial (o token e o cookie são da API). */
export function cabecalhosDaRota(brutos: Readonly<Record<string, string | readonly string[] | undefined>>): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(brutos)) {
    const nome = k.toLowerCase();
    if (v === undefined || SEM_REPASSE.has(nome)) continue;
    saida[nome] = typeof v === 'string' ? v : v.join(', ');
  }
  return saida;
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
  /** Rota `multipart/form-data` (POST, PUT ou PATCH): os campos de texto passam pelo `corpo`; os arquivos, por aqui. */
  multipart?: { arquivos: readonly ArquivoEsperado[] };
  executar(c: ContextoRota, e: EntradaChamada<TC, TQ>): Promise<RespostaRota>;
}

/** A rota como o módulo a declara: o `executar` recebe a entrada completa (cabeçalhos e arquivos sempre presentes). */
export interface DefinicaoRota<TC, TQ> extends Omit<RotaModulo<TC, TQ>, 'executar'> {
  executar(c: ContextoRota, e: EntradaRota<TC, TQ>): Promise<RespostaRota>;
}

/**
 * Ajuda de tipo: infere corpo e consulta dos schemas Zod e devolve a rota "apagada" para o plugin. É seguro: a API
 * passa ao `executar` exatamente a saída do `corpo`/`consulta` da própria rota. Cabeçalhos e arquivos omitidos pelo
 * chamador chegam vazios.
 */
export function definirRota<TC = undefined, TQ = undefined>(r: DefinicaoRota<TC, TQ>): RotaModulo {
  const rota: RotaModulo<TC, TQ> = { ...r, executar: (c, e) => r.executar(c, { ...e, cabecalhos: e.cabecalhos ?? {}, arquivos: e.arquivos ?? {} }) };
  return rota as unknown as RotaModulo;
}

export interface PluginModulo {
  manifesto: ManifestoModulo;
  rotas: readonly RotaModulo[];
}

export class PluginInvalido extends Error {
  override readonly name = 'PluginInvalido';
}

const CAMPO_ARQUIVO = /^[a-z][a-z0-9_]{0,39}$/;

function validarMultipart(modulo: string, id: string, r: RotaModulo): void {
  if (!r.multipart) return;
  if (r.metodo === 'GET' || r.metodo === 'DELETE') throw new PluginInvalido(`${modulo}: multipart só em POST, PUT ou PATCH (${id})`);
  const campos = new Set<string>();
  for (const a of r.multipart.arquivos) {
    if (!CAMPO_ARQUIVO.test(a.campo) || campos.has(a.campo)) throw new PluginInvalido(`${modulo}: campo de arquivo "${a.campo}" inválido ou repetido em ${id}`);
    if (!Number.isInteger(a.tamanhoMaximo) || a.tamanhoMaximo < 1 || a.tamanhoMaximo > TAMANHO_MAXIMO_ARQUIVO) {
      throw new PluginInvalido(`${modulo}: tamanhoMaximo de "${a.campo}" fora de 1 a ${TAMANHO_MAXIMO_ARQUIVO} bytes em ${id}`);
    }
    campos.add(a.campo);
  }
  if (campos.size === 0) throw new PluginInvalido(`${modulo}: multipart sem arquivo em ${id}`);
}

/** Valida o plugin no carregamento: caminho com `/`, ação do próprio módulo, multipart coerente e sem rota repetida. */
export function definirPlugin(manifesto: ManifestoModulo, rotas: readonly RotaModulo[]): PluginModulo {
  const vistas = new Set<string>();
  for (const r of rotas) {
    const id = `${r.metodo} ${r.caminho}`;
    if (!r.caminho.startsWith('/')) throw new PluginInvalido(`${manifesto.id}: caminho "${r.caminho}" sem "/" inicial`);
    if (moduloDaAcao(r.acao) !== manifesto.id) throw new PluginInvalido(`${manifesto.id}: ação "${r.acao}" de outro módulo em ${id}`);
    validarMultipart(manifesto.id, id, r);
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
