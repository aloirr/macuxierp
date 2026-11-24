/**
 * Operação da Integração FDV nas telas (T-0086, `docs/desenho/T-0086.md`): situação do registro no espelho, plano do
 * Reprocessar, origem do lote, Log por cadastro e Monitor do conector. Funções puras: a API só lê e grava.
 *
 * ADR 0013: o `/config` nunca vê dado de negócio. `montarLogPlataforma` devolve só código, campo e quantidade, e o resultado
 * passa pelo Zod do SDK (que descarta qualquer chave a mais). O texto do motivo e da ação sai do catálogo pelo código
 * (RN-INF-04), nunca da mensagem do Hub.
 */
import {
  LIMITE_ENVIOS_LOG_FDV,
  LIMITE_ERROS_LOG_FDV,
  LogCadastroFdvPlataforma,
  LogCadastroFdvTenant,
  MonitorConectorFdv,
  REPROCESSAVEIS_FDV,
  VERSAO_CONECTOR_HUB,
  situacaoConectorFdv,
  type EntidadeEnvioFdv,
  type EnvioLogFdv,
  type MotivoFalhaEnvioFdv,
  type OrigemEnvioFdv,
  type SituacaoRegistroFdv,
} from '@macuxierp/platform-sdk';
import type { EstadoLote } from '../contracts';
import { acaoDoErro, motivoDoErro } from './mensagens';

// ---- situação do registro e Reprocessar ----

export interface EstadoRegistro {
  pendente: boolean;
  hash: string;
  hash_confirmado: string | null;
  /** Há erro por linha aberto (`lote_erro` sem `resolvido_em`) para o registro. */
  erro_aberto: boolean;
}

/** RN-INF-03: `falha` (erro aberto), `pendente` (não confirmado ou mudou depois do aceite) ou `integrado` (o Hub confirmou o hash atual). */
export function situacaoRegistro(r: EstadoRegistro): SituacaoRegistroFdv {
  if (r.erro_aberto) return 'falha';
  if (r.pendente || r.hash_confirmado !== r.hash) return 'pendente';
  return 'integrado';
}

export interface PlanoReprocessar {
  /** Registros a marcar para envio: só falha e pendente. */
  ids: string[];
  falhas: number;
  pendentes: number;
}

/** O Reprocessar reenvia só `REPROCESSAVEIS_FDV`: nunca o integrado, sem carga completa e sem inativação nova. */
export function planejarReprocessar(registros: ReadonlyArray<EstadoRegistro & { id: string }>): PlanoReprocessar {
  const plano: PlanoReprocessar = { ids: [], falhas: 0, pendentes: 0 };
  for (const r of registros) {
    const s = situacaoRegistro(r);
    if (!REPROCESSAVEIS_FDV.includes(s)) continue;
    plano.ids.push(r.id);
    if (s === 'falha') plano.falhas += 1;
    else plano.pendentes += 1;
  }
  return plano;
}

// ---- origem do lote ----

/**
 * Marcas em `registro_publicado.fonte_refs` que dizem de onde veio o reenvio. O consumidor regrava `fonte_refs` a cada evento
 * novo do cadastro, então a marca some quando o registro volta pela carga (o registro volta ativo, como o desenho manda).
 * A marca `zerar` é gravada pela `integracao_fdv.portal_inativar_espelho` (banco-dados, 0053); `reprocessar`, pelo Reprocessar.
 */
export const MARCA_REENVIO = Object.freeze({
  zerar: { chave: 'inativado_por', valor: 'zerar' },
  reprocessar: { chave: 'reenvio', valor: 'reprocessar' },
});

type Refs = Readonly<Record<string, string>>;
const temMarca = (refs: Refs, m: { chave: string; valor: string }): boolean => refs[m.chave] === m.valor;

/** Origem do lote pelas marcas dos registros que ele leva: todos do Zerar = `zerar`; algum do Reprocessar (e nenhum misturado ao Zerar) = `reprocessar`; o resto = `ciclo`. */
export function origemDoLote(refs: readonly Refs[]): OrigemEnvioFdv {
  if (refs.length === 0) return 'ciclo';
  if (refs.every((r) => temMarca(r, MARCA_REENVIO.zerar))) return 'zerar';
  if (refs.some((r) => temMarca(r, MARCA_REENVIO.zerar))) return 'ciclo';
  return refs.some((r) => temMarca(r, MARCA_REENVIO.reprocessar)) ? 'reprocessar' : 'ciclo';
}

// ---- Log ----

/** Estados do lote que ainda não chegaram ao fim: no máximo um por entidade (RN-INF-03). */
export const ESTADOS_EM_VOO = ['montado', 'enviando', 'aceito'] as const satisfies readonly EstadoLote[];

/** Situação do envio na tela: estados em voo = `enviando`; `concluido_com_erros` = `com_erros`; `falhou` e `recusado` = `falhou`. */
export function situacaoDoEnvio(estado: string): EnvioLogFdv['situacao'] {
  if ((ESTADOS_EM_VOO as readonly string[]).includes(estado)) return 'enviando';
  if (estado === 'concluido') return 'concluido';
  if (estado === 'concluido_com_erros') return 'com_erros';
  return 'falhou';
}

/** Nome para o administrador da empresa reconhecer o registro: nome, razão social ou descrição, cortado em 120. Só vai ao Log do BKO. */
export function nomeCurto(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  for (const campo of ['nome', 'razao_social', 'descricao']) {
    const v = payload[campo];
    if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, 120);
  }
  return null;
}

const ROTA_CADASTRO: Readonly<Record<EntidadeEnvioFdv, string>> = {
  filial: '/cadastros/filiais',
  vendedor: '/cadastros/equipe',
  forma_pagamento: '/cadastros/condicoes-pagamento',
  prazo_pagamento: '/cadastros/condicoes-pagamento',
  produto: '/cadastros/produtos',
  produto_unidade: '/cadastros/produtos',
  preco: '/cadastros/tabelas-preco',
  estoque: '/cadastros/estoque',
  cliente: '/cadastros/clientes',
  cliente_endereco: '/cadastros/clientes',
};

/** Tela do cadastro no BKO, filtrada pelo código do registro. Nulo quando o registro foi apagado pelo Zerar. */
export function corrigirHref(entidade: EntidadeEnvioFdv, registroExternalId: string, refs: Refs): string | null {
  if (temMarca(refs, MARCA_REENVIO.zerar)) return null;
  return `${ROTA_CADASTRO[entidade]}?busca=${encodeURIComponent(registroExternalId)}`;
}

export interface EnvioBruto {
  em: Date;
  estado: string;
  registros: number;
  com_erro: number;
  origem: OrigemEnvioFdv;
}

/** Erro por linha aberto. No `/config` só `codigo`, `campo` e (se já agrupado) `quantidade` são lidos; o resto nem entra na resposta. */
export interface ErroBruto {
  registro_external_id: string;
  entidade: EntidadeEnvioFdv;
  codigo: string;
  campo: string | null;
  payload: Record<string, unknown> | null;
  fonte_refs: Refs;
  quantidade?: number;
}

interface EntradaLog<E> {
  entidade: EntidadeEnvioFdv;
  lidoEm: Date;
  envios: readonly EnvioBruto[];
  erros: readonly E[];
  /** Total de erros abertos, quando a lista veio cortada; padrão: o tamanho da lista. */
  totalErros?: number;
  motivo: MotivoFalhaEnvioFdv | null;
}

const enviosDoLog = (envios: readonly EnvioBruto[]) =>
  [...envios]
    .sort((a, b) => b.em.getTime() - a.em.getTime())
    .slice(0, LIMITE_ENVIOS_LOG_FDV)
    .map((e) => ({ em: e.em.toISOString(), origem: e.origem, situacao: situacaoDoEnvio(e.estado), registros: e.registros, com_erro: Math.min(e.com_erro, e.registros) }));

/** Log do `/config` (ADR 0013): grupos por código e campo com a contagem. Nada do registro. */
export function montarLogPlataforma(e: EntradaLog<Pick<ErroBruto, 'codigo' | 'campo'> & { quantidade?: number }>): LogCadastroFdvPlataforma {
  const grupos = new Map<string, { codigo: string; campo: string | null; quantidade: number }>();
  let soma = 0;
  for (const x of e.erros) {
    const q = x.quantidade ?? 1;
    soma += q;
    const chave = `${x.codigo}|${x.campo ?? ''}`;
    const g = grupos.get(chave);
    if (g) g.quantidade += q;
    else grupos.set(chave, { codigo: x.codigo, campo: x.campo, quantidade: q });
  }
  return LogCadastroFdvPlataforma.parse({
    entidade: e.entidade,
    lido_em: e.lidoEm.toISOString(),
    envios: enviosDoLog(e.envios),
    total_erros: Math.max(e.totalErros ?? soma, soma),
    motivo: e.motivo,
    erros: [...grupos.values()].slice(0, LIMITE_ERROS_LOG_FDV),
  });
}

/** Log do BKO: um item por registro com erro aberto (até 200), com o texto do catálogo e o `corrigir_href`. */
export function montarLogTenant(e: EntradaLog<ErroBruto>): LogCadastroFdvTenant {
  return LogCadastroFdvTenant.parse({
    entidade: e.entidade,
    lido_em: e.lidoEm.toISOString(),
    envios: enviosDoLog(e.envios),
    total_erros: Math.max(e.totalErros ?? e.erros.length, e.erros.length),
    motivo: e.motivo,
    erros: e.erros.slice(0, LIMITE_ERROS_LOG_FDV).map(itemDoLogTenant),
  });
}

/** Um erro aberto como o BKO mostra (e como sai no CSV): registro, nome curto, campo, texto do catálogo e `corrigir_href`. */
export function itemDoLogTenant(x: ErroBruto) {
  return {
    registro_external_id: x.registro_external_id,
    nome_curto: nomeCurto(x.payload),
    campo: x.campo,
    codigo: x.codigo,
    motivo_texto: motivoDoErro(x.codigo),
    acao_texto: acaoDoErro(x.codigo),
    corrigir_href: corrigirHref(x.entidade, x.registro_external_id, x.fonte_refs),
  };
}

// ---- Monitor ----

export interface EntradaMonitor {
  credencial_ativa: boolean;
  conector_id: string | null;
  habilitadas: number;
  ultimo_sinal_aceito_em: Date | null;
  fila: { lotes: number; linhas: number };
  agora: Date;
}

/** Monitor do conector (T-0086 §2). Sem credencial: identificador e versão nulos e fila zerada. */
export function montarMonitor(e: EntradaMonitor): MonitorConectorFdv {
  const sinal = e.ultimo_sinal_aceito_em?.toISOString() ?? null;
  const situacao = situacaoConectorFdv({ credencial_ativa: e.credencial_ativa, habilitadas: e.habilitadas, ultimo_sinal_em: sinal, agora: e.agora });
  const com = e.credencial_ativa && e.conector_id !== null;
  return MonitorConectorFdv.parse({
    identificador: com ? e.conector_id : null,
    situacao,
    versao: com && sinal !== null ? VERSAO_CONECTOR_HUB : null,
    ultimo_sinal_em: com ? sinal : null,
    fila: com ? e.fila : { lotes: 0, linhas: 0 },
    lido_em: e.agora.toISOString(),
  });
}
