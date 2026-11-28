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
  /**
   * Fuso IANA do tenant (`core.tenant.fuso`, ex.: `America/Sao_Paulo`), o mesmo do `/v1/auth/eu`: a apps/api sempre
   * preenche. Opcional só para os dublês de teste dos módulos que montam o contexto à mão; leia com `fusoDaRota(c)`,
   * que cai em `FUSO_PADRAO` ('America/Manaus') quando falta. Regra 4: data em UTC, exibição no fuso do tenant.
   */
  fuso?: string;
  /** Grava o evento na outbox da transação e devolve o envelope com a versão real do agregado. */
  publicar(evento: {
    nome: string;
    agregado_id: string;
    /** @deprecated ignorada: a versão vem sempre da outbox (T-0034); pode omitir (T-0042). */
    versao?: number;
    payload: Record<string, unknown>;
  }): Promise<EnvelopeEvento>;
  auditar(dados: DadosAuditoria): Promise<void>;
  /** Enfileira trabalho do próprio módulo para o worker (rotas que respondem 202, D5). */
  enfileirar(pedido: Omit<PedidoTrabalho, 'tenant_id'>): Promise<{ id: string }>;
}

/** Fuso de quem não tem o do tenant (dublê de teste): o padrão do `core.tenant.fuso`. */
export const FUSO_PADRAO = 'America/Manaus';

/** Fuso do tenant da rota (`c.fuso`) ou `FUSO_PADRAO` no dublê sem fuso. */
export function fusoDaRota(c: Pick<ContextoRota, 'fuso'>): string {
  return c.fuso ?? FUSO_PADRAO;
}

export interface EntradaRota<TC, TQ> {
  /** JSON validado pelo `corpo`; na rota multipart, os campos de texto validados pelo mesmo `corpo`. */
  corpo: TC;
  consulta: TQ;
  params: Record<string, string>;
  /** Cabeçalhos do pedido em minúsculas, sem `authorization`, `cookie` e `proxy-authorization` (`if-match`, `idempotency-key`). */
  cabecalhos: Readonly<Record<string, string>>;
  /** Arquivos da rota multipart, por campo: o 1º de cada campo (vazio nas rotas JSON). */
  arquivos: Readonly<Record<string, ArquivoRecebido>>;
  /** Todos os arquivos de cada campo, na ordem do envio (campo com `quantidadeMaxima` > 1, ex.: a carga de CSV). */
  todosArquivos: Readonly<Record<string, readonly ArquivoRecebido[]>>;
}

/** O que quem chama a rota passa: a API passa tudo; o teste de rota do módulo pode omitir cabeçalhos e arquivos (vazios). */
export type EntradaChamada<TC, TQ> = Omit<EntradaRota<TC, TQ>, 'cabecalhos' | 'arquivos' | 'todosArquivos'> &
  Partial<Pick<EntradaRota<TC, TQ>, 'cabecalhos' | 'arquivos' | 'todosArquivos'>>;

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
  /** Bytes por arquivo, de 1 a `TAMANHO_MAXIMO_MULTIPART`. */
  tamanhoMaximo: number;
  /** Padrão `true`. */
  obrigatorio?: boolean;
  /** Quantos arquivos o campo aceita (padrão 1, até `QUANTIDADE_MAXIMA_ARQUIVOS`). Acima disso, 400 `VALIDACAO`. */
  quantidadeMaxima?: number;
}

/** Teto do corpo JSON (bodyLimit da API). */
export const TAMANHO_MAXIMO_ARQUIVO = 1_048_576;
/** Teto de uma rota multipart: cada arquivo e a soma deles (a carga de CSV da T-0026 usa o teto, D7). */
export const TAMANHO_MAXIMO_MULTIPART = 10 * 1_048_576;
export const QUANTIDADE_MAXIMA_ARQUIVOS = 32;
/** Teto do tempo de uma rota (`tempoMaximoMs`; carga síncrona de CSV, D7 da T-0026). */
export const TEMPO_MAXIMO_ROTA_MS = 120_000;

/** Multipart da rota: arquivos esperados e o limite da soma (padrão: soma dos limites dos campos, até o teto). */
export interface MultipartRota {
  arquivos: readonly ArquivoEsperado[];
  tamanhoMaximoTotal?: number;
}

/** Soma de bytes aceita na rota multipart. */
export function tamanhoMaximoTotal(m: MultipartRota): number {
  const soma = m.arquivos.reduce((t, a) => t + a.tamanhoMaximo * (a.quantidadeMaxima ?? 1), 0);
  return Math.min(m.tamanhoMaximoTotal ?? soma, TAMANHO_MAXIMO_MULTIPART);
}

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
  /**
   * Mensagem do 403 `PERFIL_SEM_PERMISSAO` quando o perfil não tem a `acao` (T-0129), escrita pelo módulo para o
   * usuário: frase completa, sem rótulo na frente (ex.: "Seu perfil só consulta clientes."). Ausente = a genérica.
   */
  semPermissao?: string;
  corpo?: z.ZodType<TC, z.ZodTypeDef, unknown>;
  consulta?: z.ZodType<TQ, z.ZodTypeDef, unknown>;
  /** Rota `multipart/form-data` (POST, PUT ou PATCH): os campos de texto passam pelo `corpo`; os arquivos, por aqui. */
  multipart?: MultipartRota;
  /**
   * `Idempotency-Key` (RN-CORE-05; T-0002 §2), só em POST, PUT e PATCH: com a chave, o 1º pedido executa e guarda a
   * resposta em `plataforma.idempotencia` por 24 h, na mesma transação; o reenvio com o mesmo pedido devolve a resposta
   * guardada sem executar, e com pedido diferente é 409 `CONFLITO`. `obrigatoria`: sem a chave é 400.
   * A resposta repetida leva só status e corpo (JSON): a rota idempotente não depende de cabeçalho de resposta.
   */
  idempotencia?: 'opcional' | 'obrigatoria';
  /** Tempo máximo (ms, até `TEMPO_MAXIMO_ROTA_MS`): passou, a próxima consulta falha com 503 e a transação é desfeita. */
  tempoMaximoMs?: number;
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
  const rota: RotaModulo<TC, TQ> = {
    ...r,
    executar: (c, e) => {
      const arquivos = e.arquivos ?? {};
      const todosArquivos = e.todosArquivos ?? Object.fromEntries(Object.entries(arquivos).map(([k, a]) => [k, [a]]));
      return r.executar(c, { ...e, cabecalhos: e.cabecalhos ?? {}, arquivos, todosArquivos });
    },
  };
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

/** Regras do multipart da rota (de módulo e de plataforma): método de escrita, campos, limites e quantidade. */
export function validarMultipartDaRota(modulo: string, id: string, r: Pick<RotaModulo, 'metodo' | 'multipart'>): void {
  if (!r.multipart) return;
  if (r.metodo === 'GET' || r.metodo === 'DELETE') throw new PluginInvalido(`${modulo}: multipart só em POST, PUT ou PATCH (${id})`);
  const campos = new Set<string>();
  for (const a of r.multipart.arquivos) {
    if (!CAMPO_ARQUIVO.test(a.campo) || campos.has(a.campo)) throw new PluginInvalido(`${modulo}: campo de arquivo "${a.campo}" inválido ou repetido em ${id}`);
    if (!inteiroEntre(a.tamanhoMaximo, 1, TAMANHO_MAXIMO_MULTIPART)) {
      throw new PluginInvalido(`${modulo}: tamanhoMaximo de "${a.campo}" fora de 1 a ${TAMANHO_MAXIMO_MULTIPART} bytes em ${id}`);
    }
    if (a.quantidadeMaxima !== undefined && !inteiroEntre(a.quantidadeMaxima, 1, QUANTIDADE_MAXIMA_ARQUIVOS)) {
      throw new PluginInvalido(`${modulo}: quantidadeMaxima de "${a.campo}" fora de 1 a ${QUANTIDADE_MAXIMA_ARQUIVOS} em ${id}`);
    }
    campos.add(a.campo);
  }
  if (campos.size === 0) throw new PluginInvalido(`${modulo}: multipart sem arquivo em ${id}`);
  const total = r.multipart.tamanhoMaximoTotal;
  if (total !== undefined && !inteiroEntre(total, 1, TAMANHO_MAXIMO_MULTIPART)) {
    throw new PluginInvalido(`${modulo}: tamanhoMaximoTotal fora de 1 a ${TAMANHO_MAXIMO_MULTIPART} bytes em ${id}`);
  }
}

const inteiroEntre = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/** Limite do `tempoMaximoMs` da rota (de módulo e de plataforma): inteiro de 1000 a `TEMPO_MAXIMO_ROTA_MS`, se houver. */
export function validarTempoMaximoDaRota(modulo: string, id: string, r: Pick<RotaModulo, 'tempoMaximoMs'>): void {
  if (r.tempoMaximoMs !== undefined && !inteiroEntre(r.tempoMaximoMs, 1_000, TEMPO_MAXIMO_ROTA_MS)) {
    throw new PluginInvalido(`${modulo}: tempoMaximoMs fora de 1000 a ${TEMPO_MAXIMO_ROTA_MS} em ${id}`);
  }
}

function validarExtras(modulo: string, id: string, r: RotaModulo): void {
  if (r.idempotencia && r.metodo !== 'POST' && r.metodo !== 'PUT' && r.metodo !== 'PATCH') {
    throw new PluginInvalido(`${modulo}: Idempotency-Key só em POST, PUT ou PATCH (${id})`);
  }
  validarTempoMaximoDaRota(modulo, id, r);
  if (r.semPermissao !== undefined && !textoDeMensagem(r.semPermissao)) {
    throw new PluginInvalido(`${modulo}: semPermissao vazio, com espaço nas pontas ou acima de ${MENSAGEM_MAXIMA} caracteres (${id})`);
  }
}

const MENSAGEM_MAXIMA = 200;
const textoDeMensagem = (s: string) => s.length > 0 && s.length <= MENSAGEM_MAXIMA && s.trim() === s;

/**
 * Valida o plugin no carregamento: caminho com `/`, ação do próprio módulo, multipart, idempotência e tempo coerentes
 * e sem rota repetida.
 */
export function definirPlugin(manifesto: ManifestoModulo, rotas: readonly RotaModulo[]): PluginModulo {
  const vistas = new Set<string>();
  for (const r of rotas) {
    const id = `${r.metodo} ${r.caminho}`;
    if (!r.caminho.startsWith('/')) throw new PluginInvalido(`${manifesto.id}: caminho "${r.caminho}" sem "/" inicial`);
    if (moduloDaAcao(r.acao) !== manifesto.id) throw new PluginInvalido(`${manifesto.id}: ação "${r.acao}" de outro módulo em ${id}`);
    validarMultipartDaRota(manifesto.id, id, r);
    validarExtras(manifesto.id, id, r);
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
