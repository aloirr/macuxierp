/**
 * T-0059 (PF-1 do plano da v0.3.13): o pré-cadastro de cliente no dublê do Hub — `GET /clientes/pendentes` e
 * `POST /clientes/{cliente_uuid}/retorno`, registrados pelo ponto de extensão `rotasExtras` do dublê da T-0012, como as
 * rotas de pedidos (`hub-pedidos.ts`). O estado fica em `estado.extras` do tenant.
 *
 * Oráculo do Hub (desenho `docs/desenho/T-0059.md` §2 e §5.3, hub-api §6.6b e ADR 0069 do FDV, lidos pelo desenho):
 * - `versao: 'v1.0.32'` (padrão; ADR 0069 desde a v1.0.30): o pendente leva `codigo_fdv`, `revisao`, `hash` e `tentativa`;
 *   o retorno aceita `revisao` e `erros`; o 200 leva `revisao`; a recusa de revisão anterior responde 200 `obsoleto`.
 * - `versao: 'v1.0.28'`: o pendente sai sem os aditivos; o retorno com `revisao` ou `erros` é 400 (o Hub antigo não os
 *   conhece; prova que o ERP com a opção desligada manda só o `motivo`); o 200 não leva `revisao`.
 * - Falha injetável: 5xx e 429 com `Retry-After` pelo `programarFalha` do dublê (`rota: 'POST /clientes'` ou
 *   `'GET /clientes'`); 403 `acesso_negado` com o `semRecebePedidos` de `hub-pedidos.ts` (a permissão é uma só); resposta perdida (o Hub aplica e devolve 503)
 *   com `perderRespostaDoRetornoCliente`; vínculo com outro código com `vincularNoFdv` (422 `external_id_divergente`).
 */
import { createHash } from 'node:crypto';
import {
  ERROS_RECUSA_CLIENTE_MAX_FDV,
  LIMITE_CLIENTES_PENDENTES_FDV,
  LIMITES_ERRO_CAMPO_CLIENTE_FDV,
  type CodigoRecusaRetornoClienteFdv,
} from '../../../packages/platform-sdk/src/index';
import { VERSAO_CONTRATO } from './contrato-hub';
import type { ContextoRota, DubleHub, EstadoTenantDuble, RespostaRota, RotaExtra } from './duble-hub';
import { conectorSemRecebe, erroHub as erro, PRAZO_REENTREGA_MS, UUID_HUB as UUID } from './hub-pedidos';

/** Teto do `motivo` que o Hub aceita (o ERP manda até 300). */
const MAX_MOTIVO_HUB = 1000;

export type VersaoHubClientes = 'v1.0.28' | 'v1.0.32';
type EstadoClienteHub = 'pendente' | 'enviado' | 'vinculado' | 'rejeitado';

/** O pré-cadastro como o vendedor o grava no FDV (sem os campos que o Hub põe: `revisao`, `hash`, `tentativa`). */
export type PreCadastroFdv = Record<string, unknown> & { cliente_uuid: string; razao_social: string; recebido_em: string };

export interface RetornoNoHub {
  status: 'vinculado' | 'rejeitado_erp';
  revisao: number;
  external_id: string | null;
  motivo: string | null;
  erros: number;
  em: string;
}

export interface ClienteNaFila {
  dados: PreCadastroFdv;
  codigoFdv: string;
  estado: EstadoClienteHub;
  revisao: number;
  hash: string;
  tentativas: number;
  enviadoEm: number | null;
  externalId: string | null;
  retornos: RetornoNoHub[];
  /** Respostas do retorno (status HTTP, `repetido`, `obsoleto`, código do erro), na ordem. Sem corpo. */
  respostas: { status: number; repetido: boolean | null; obsoleto: boolean; codigo: string | null }[];
  removido: boolean;
  ordem: number;
}

interface FilaClientes {
  versao: VersaoHubClientes;
  clientes: Map<string, ClienteNaFila>;
  perderResposta: Map<string, number>;
  ordem: number;
  codigo: number;
}

const CHAVE_EXTRA = 't0059:clientes';
const INSTANTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function filaDe(estado: EstadoTenantDuble): FilaClientes {
  let f = estado.extras.get(CHAVE_EXTRA) as FilaClientes | undefined;
  if (!f) {
    f = { versao: 'v1.0.32', clientes: new Map(), perderResposta: new Map(), ordem: 0, codigo: 41 };
    estado.extras.set(CHAVE_EXTRA, f);
  }
  return f;
}

/** Hash do pré-cadastro como o Hub o calcula (sha256 do conteúdo canônico). */
function hashDe(dados: PreCadastroFdv): string {
  const chaves = Object.keys(dados).sort();
  return createHash('sha256').update(JSON.stringify(chaves.map((k) => [k, dados[k]]))).digest('hex');
}

function saida(c: ClienteNaFila, versao: VersaoHubClientes): Record<string, unknown> {
  if (versao === 'v1.0.28') return { ...c.dados };
  return { ...c.dados, codigo_fdv: c.codigoFdv, revisao: c.revisao, hash: c.hash, tentativa: c.tentativas };
}

function pendentes(ctx: ContextoRota): RespostaRota {
  const fila = filaDe(ctx.estado);
  if (conectorSemRecebe(ctx.estado, ctx.conector.conectorId))
    return erro(403, 'acesso_negado', 'Este Conector não recebe pedidos (cadastro do Conector no BKO).');
  const bruto = ctx.consulta.get('limite');
  const limite = bruto === null ? LIMITE_CLIENTES_PENDENTES_FDV.padrao : Number(bruto);
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_CLIENTES_PENDENTES_FDV.max)
    return erro(422, 'valor_fora_da_faixa', `O limite vai de 1 a ${LIMITE_CLIENTES_PENDENTES_FDV.max}.`, 'limite');
  const agora = ctx.agora.getTime();
  for (const c of fila.clientes.values()) {
    if (c.estado === 'enviado' && c.enviadoEm !== null && agora - c.enviadoEm >= PRAZO_REENTREGA_MS) c.estado = 'pendente';
  }
  const lista = [...fila.clientes.values()]
    .filter((c) => c.estado === 'pendente' && !c.removido)
    .sort((a, b) => a.ordem - b.ordem)
    .slice(0, limite);
  for (const c of lista) {
    c.estado = 'enviado';
    c.tentativas += 1;
    c.enviadoEm = agora;
  }
  return { status: 200, corpo: { clientes: lista.map((c) => saida(c, fila.versao)) } };
}

/** Valida o corpo como o Hub (400 `requisicao_invalida` com o campo); nulo = corpo válido. */
function corpoInvalido(c: Record<string, unknown>, uuid: string, versao: VersaoHubClientes): RespostaRota | null {
  const r400 = (campo: string, msg: string) => erro(400, 'requisicao_invalida', msg, campo);
  if (c.versao_contrato !== VERSAO_CONTRATO)
    return erro(422, 'versao_nao_suportada', `versao_contrato deve ser "${VERSAO_CONTRATO}".`, 'versao_contrato');
  if (typeof c.cliente_uuid !== 'string' || c.cliente_uuid.toLowerCase() !== uuid.toLowerCase())
    return r400('cliente_uuid', 'O cliente_uuid do corpo difere do caminho.');
  if (c.status !== 'vinculado' && c.status !== 'rejeitado_erp') return r400('status', 'Status de retorno desconhecido.');
  if (typeof c.ocorrido_em !== 'string' || !INSTANTE_UTC.test(c.ocorrido_em)) return r400('ocorrido_em', 'ocorrido_em é data e hora UTC.');
  if (c.status === 'vinculado') {
    if (typeof c.external_id !== 'string' || c.external_id.length < 1 || c.external_id.length > 200)
      return r400('external_id', 'O retorno vinculado leva o external_id.');
    if (c.motivo !== undefined || c.erros !== undefined) return r400('motivo', 'O retorno vinculado não leva motivo nem erros.');
  } else {
    if (typeof c.motivo !== 'string' || !c.motivo.trim() || c.motivo.length > MAX_MOTIVO_HUB)
      return r400('motivo', `O retorno rejeitado_erp exige o motivo (até ${MAX_MOTIVO_HUB}).`);
    if (c.external_id !== undefined) return r400('external_id', 'O retorno rejeitado_erp não leva external_id.');
  }
  if (versao === 'v1.0.28') {
    // O Hub da v1.0.28 não conhece os aditivos da ADR 0069: campo desconhecido no corpo é 400.
    for (const k of ['revisao', 'erros'] as const) if (c[k] !== undefined) return r400(k, `Campo desconhecido: ${k}.`);
    return null;
  }
  if (c.revisao !== undefined && (!Number.isInteger(c.revisao) || (c.revisao as number) < 1)) return r400('revisao', 'revisao é inteiro ≥ 1.');
  if (c.erros !== undefined) {
    if (c.status !== 'rejeitado_erp') return r400('erros', 'erros só no rejeitado_erp.');
    if (!Array.isArray(c.erros) || c.erros.length < 1 || c.erros.length > ERROS_RECUSA_CLIENTE_MAX_FDV)
      return r400('erros', `erros vai de 1 a ${ERROS_RECUSA_CLIENTE_MAX_FDV} itens.`);
    for (const [i, e] of (c.erros as unknown[]).entries()) {
      const x = (e ?? {}) as Record<string, unknown>;
      for (const k of ['campo', 'codigo', 'mensagem'] as const) {
        const v = x[k];
        if (typeof v !== 'string' || !v.trim() || v.length > LIMITES_ERRO_CAMPO_CLIENTE_FDV[k]) return r400(`erros[${i}].${k}`, `erros[${i}].${k} fora do limite.`);
      }
    }
  }
  return null;
}

function retorno(ctx: ContextoRota): RespostaRota {
  const fila = filaDe(ctx.estado);
  const uuid = ctx.caminho.split('/')[2] ?? '';
  if (!UUID.test(uuid)) return erro(400, 'requisicao_invalida', 'O cliente_uuid do caminho precisa ser um UUID.', 'cliente_uuid');
  const c = (ctx.corpo ?? {}) as Record<string, unknown>;
  const invalido = corpoInvalido(c, uuid, fila.versao);
  if (invalido) return invalido;

  const item = fila.clientes.get(uuid.toLowerCase());
  const comRevisao = (corpo: Record<string, unknown>, rev: number) => (fila.versao === 'v1.0.28' ? corpo : { ...corpo, revisao: rev });
  const registrar = (r: RespostaRota): RespostaRota => {
    const corpo = (r.corpo ?? {}) as { repetido?: boolean; obsoleto?: boolean; codigo?: string };
    item?.respostas.push({ status: r.status, repetido: corpo.repetido ?? null, obsoleto: corpo.obsoleto === true, codigo: corpo.codigo ?? null });
    return r;
  };
  const recusa = (codigo: CodigoRecusaRetornoClienteFdv, msg: string, campo: string) => registrar(erro(422, codigo, msg, campo));
  if (!item || item.removido) return recusa('cliente_desconhecido', 'O Hub não conhece este pré-cadastro.', 'cliente_uuid');
  if (item.tentativas === 0) return recusa('cliente_nao_entregue', 'Este pré-cadastro ainda não saiu em /clientes/pendentes.', 'cliente_uuid');

  const status = c.status as 'vinculado' | 'rejeitado_erp';
  const rev = fila.versao === 'v1.0.28' ? item.revisao : ((c.revisao as number | undefined) ?? 1);
  if (rev > item.revisao) return recusa('revisao_desconhecida', 'O Hub não conhece esta revisão.', 'revisao');
  if (rev < item.revisao) {
    // Recusa de revisão anterior: o FDV já tem a correção; responde 200 obsoleto e não muda nada.
    if (status === 'rejeitado_erp')
      return registrar({ status: 200, corpo: comRevisao({ cliente_uuid: uuid, estado: item.estado, repetido: false, obsoleto: true }, item.revisao) });
    return recusa('transicao_invalida', 'Vínculo de revisão anterior.', 'revisao');
  }
  const externalId = typeof c.external_id === 'string' ? c.external_id : null;
  if (status === 'vinculado' && item.externalId !== null && externalId !== item.externalId)
    return recusa('external_id_divergente', 'Este pré-cadastro já está vinculado a outro código.', 'external_id');
  const destino: EstadoClienteHub = status === 'vinculado' ? 'vinculado' : 'rejeitado';
  if (item.estado === destino)
    return registrar({ status: 200, corpo: comRevisao({ cliente_uuid: uuid, estado: item.estado, repetido: true }, item.revisao) });
  if (item.estado === 'vinculado' || item.estado === 'rejeitado')
    return recusa('transicao_invalida', `O pré-cadastro está ${item.estado}.`, 'status');

  item.estado = destino;
  if (destino === 'vinculado') item.externalId = externalId;
  item.retornos.push({
    status,
    revisao: item.revisao,
    external_id: externalId,
    motivo: typeof c.motivo === 'string' ? c.motivo : null,
    erros: Array.isArray(c.erros) ? c.erros.length : 0,
    em: ctx.agora.toISOString(),
  });
  const perder = fila.perderResposta.get(uuid.toLowerCase()) ?? 0;
  if (perder > 0) {
    fila.perderResposta.set(uuid.toLowerCase(), perder - 1);
    return registrar({ ...erro(503, 'servico_indisponivel', 'Resposta perdida (dublê).'), cabecalhos: { 'retry-after': '1' } });
  }
  return registrar({ status: 200, corpo: comRevisao({ cliente_uuid: uuid, estado: item.estado, repetido: false }, item.revisao) });
}

/** As duas rotas do pré-cadastro, para `criarDubleHub({ rotasExtras })`; juntam-se às de pedidos sem conflito. */
export function rotasClientesDuble(): RotaExtra[] {
  return [
    { metodo: 'GET', padrao: /^\/clientes\/pendentes$/, tratar: pendentes },
    { metodo: 'POST', padrao: /^\/clientes\/[^/]+\/retorno$/, tratar: retorno },
  ];
}

// ---------------------------------------------------------------- o lado do FDV, sob comando do teste ------------------

/** Versão do Hub que o tenant simula (padrão `v1.0.32`); chame antes do primeiro pré-cadastro do tenant. */
export function versaoDoHubClientes(duble: DubleHub, tenant: string, versao: VersaoHubClientes): void {
  filaDe(duble.estado(tenant)).versao = versao;
}

/** O vendedor grava o pré-cadastro no FDV: entra na fila do ERP como `pendente`, revisão 1. */
export function cadastrarNoFdv(duble: DubleHub, tenant: string, dados: PreCadastroFdv): ClienteNaFila {
  const fila = filaDe(duble.estado(tenant));
  const item: ClienteNaFila = {
    dados,
    codigoFdv: String(++fila.codigo).padStart(5, '0'),
    estado: 'pendente',
    revisao: 1,
    hash: hashDe(dados),
    tentativas: 0,
    enviadoEm: null,
    externalId: null,
    retornos: [],
    respostas: [],
    removido: false,
    ordem: ++fila.ordem,
  };
  fila.clientes.set(dados.cliente_uuid.toLowerCase(), item);
  return item;
}

/** O vendedor corrige um recusado no FDV e reenvia (ADR 0069 do FDV): mesma linha, `revisao + 1`, hash novo, `pendente`. */
export function reenviarCorrigidoNoFdv(duble: DubleHub, tenant: string, uuid: string, mudancas: Record<string, unknown>): ClienteNaFila {
  const c = clienteNoHub(duble, tenant, uuid);
  if (!c || c.estado !== 'rejeitado') throw new Error('Só o pré-cadastro rejeitado é reenviado.');
  c.dados = { ...c.dados, ...mudancas, cliente_uuid: c.dados.cliente_uuid };
  c.revisao += 1;
  c.hash = hashDe(c.dados);
  c.estado = 'pendente';
  c.tentativas = 0;
  c.enviadoEm = null;
  c.ordem = ++filaDe(duble.estado(tenant)).ordem;
  return c;
}

/** A linha do FDV já está vinculada com outro código: o próximo `vinculado` diferente dá 422 `external_id_divergente`. */
export function vincularNoFdv(duble: DubleHub, tenant: string, uuid: string, externalId: string): void {
  const c = clienteNoHub(duble, tenant, uuid);
  if (c) c.externalId = externalId;
}

export function clienteNoHub(duble: DubleHub, tenant: string, uuid: string): ClienteNaFila | null {
  return filaDe(duble.estado(tenant)).clientes.get(uuid.toLowerCase()) ?? null;
}


/** O Hub aplica os próximos `vezes` retornos do pré-cadastro e a resposta se perde (503 com `Retry-After: 1`). */
export function perderRespostaDoRetornoCliente(duble: DubleHub, tenant: string, uuid: string, vezes = 1): void {
  filaDe(duble.estado(tenant)).perderResposta.set(uuid.toLowerCase(), vezes);
}

/** O pré-cadastro some do FDV: o retorno seguinte dá 422 `cliente_desconhecido`. */
export function removerClienteNoFdv(duble: DubleHub, tenant: string, uuid: string): void {
  const c = clienteNoHub(duble, tenant, uuid);
  if (c) c.removido = true;
}
