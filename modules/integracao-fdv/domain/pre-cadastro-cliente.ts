/**
 * Pré-cadastro de cliente do FDV (T-0059, desenho §5; RN-INF-06). Funções puras: leitura e validação do pendente do Hub,
 * situação de chegada (recebido ou reenviado), a decisão gravada, o tratamento da resposta do retorno (§5.3), o corte do
 * expurgo e a linha da rota do BKO. Sem banco, sem rede e sem dado pessoal em mensagem ou código.
 * A validação das regras de cliente (documento, IE, município...) é da porta `CriadorClienteFdv` do `cadastros` (§4); aqui
 * só o que é do Hub: o contrato do pendente, a revisão, o hash e o que fazer com cada resposta.
 */
import {
  ClienteParaErpFdv,
  DocumentoMascaradoFdv,
  mascararDocumentoFdv,
  revisaoDoPreCadastro,
  sha256Hex,
  type ClienteRecebidoFdv,
  type DecisaoPreCadastroFdv,
  type ErroCampoClienteFdv,
} from '@macuxierp/platform-sdk';
import { jsonCanonico } from './canonico';

/** RN-INF-06: o payload do pré-cadastro recusado é apagado 180 dias depois da última recusa. */
export const PRAZO_EXPURGO_PRE_CADASTRO_DIAS = 180;
/** Folga contra a diferença de relógio entre o worker e o banco: a função do banco recusa corte mais novo que agora − 180 dias. */
const FOLGA_CORTE_MS = 5 * 60_000;
const DIA_MS = 86_400_000;

/** Texto fixo da linha expurgada na rota (sem dado pessoal): a razão social e o documento saem do banco no expurgo. */
export const TEXTO_LINHA_EXPURGADA = '—';

export type LeituraPreCadastro =
  | {
      ok: true;
      pre: ClienteParaErpFdv;
      revisao: number;
      hash: string;
      /** O documento só sai mascarado; nulo quando não tem 11 nem 14 posições. */
      documento_mascarado: string | null;
      /** Aditivo do FDV v1.0.34: nulo quando ausente, nulo ou vazio (a tela mostra "—"). */
      vendedor_external_id: string | null;
      codigo_fdv: string | null;
      /** O que se guarda em `cliente_recebido.payload`: o pendente sem a `tentativa` (muda a cada entrega do Hub). */
      payload: Record<string, unknown>;
    }
  | { ok: false; campos: string[] };

/**
 * Lê um item do `GET /clientes/pendentes`. Fora do contrato: só o nome dos campos volta (nunca o valor; LGPD). O hash é o
 * do Hub (ADR 0069 do FDV) ou, antes da v1.0.30, o do ERP sobre o payload canônico (sem `tentativa`).
 */
export function lerPreCadastroFdv(bruto: unknown): LeituraPreCadastro {
  const r = ClienteParaErpFdv.safeParse(bruto);
  if (!r.success) return { ok: false, campos: [...new Set(r.error.issues.map((i) => String(i.path[0] ?? 'raiz')))].slice(0, 10) };
  const { tentativa: _t, ...payload } = r.data as Record<string, unknown>;
  void _t;
  const pre = r.data;
  const vendedor = typeof pre.vendedor_external_id === 'string' ? pre.vendedor_external_id.trim() : '';
  return {
    ok: true,
    pre,
    revisao: revisaoDoPreCadastro(pre),
    hash: pre.hash ?? sha256Hex(jsonCanonico(payload)),
    documento_mascarado: mascararDocumentoFdv(pre.documento),
    vendedor_external_id: vendedor === '' ? null : vendedor,
    codigo_fdv: pre.codigo_fdv ?? null,
    payload,
  };
}

export type SituacaoDeChegada = 'recebido' | 'reenviado';

/**
 * Situação da revisão que acaba de chegar (RN do reenvio, ADR 0069 do FDV): `reenviado` é a revisão nova depois de uma
 * recusa; qualquer outro caso (primeira vez, ou revisão nova depois de um aceito) entra como `recebido`.
 */
export function situacaoDeChegada(revisao: number, anterior: { revisao: number; situacao: string } | null): SituacaoDeChegada {
  return anterior !== null && anterior.situacao === 'recusado' && revisao > anterior.revisao && revisao > 1 ? 'reenviado' : 'recebido';
}

/** O que `cliente_recebido` grava depois da decisão da porta (os CHECKs da 0057: aceito ⇔ `cliente_id`; recusado ⇔ `motivo`). */
export type DecisaoGravada =
  | { situacao: 'aceito'; cliente_id: string; motivo: null; erros: null; ultima_recusa_em: null }
  | { situacao: 'recusado'; cliente_id: null; motivo: string; erros: ErroCampoClienteFdv[] | null; ultima_recusa_em: Date };

export type DecisaoDaPorta = DecisaoPreCadastroFdv & { cliente_id?: string };

export function decisaoParaGravar(d: DecisaoDaPorta, agora: Date): DecisaoGravada {
  if (d.status === 'vinculado') {
    if (!d.cliente_id) throw new Error('decisão vinculado sem cliente_id');
    return { situacao: 'aceito', cliente_id: d.cliente_id, motivo: null, erros: null, ultima_recusa_em: null };
  }
  const motivo = d.motivo.trim();
  if (motivo === '') throw new Error('recusa sem motivo');
  return { situacao: 'recusado', cliente_id: null, motivo: motivo.slice(0, 300), erros: d.erros.length > 0 ? d.erros.slice(0, 50).map((e) => ({ ...e })) : null, ultima_recusa_em: agora };
}

/** Hash do corpo do retorno sem `ocorrido_em` (chave de idempotência do retorno; a mesma decisão nunca vira dois retornos). */
export function hashDoRetornoCliente(corpo: { ocorrido_em?: unknown } & Record<string, unknown>): string {
  const { ocorrido_em: _o, ...resto } = corpo;
  void _o;
  return sha256Hex(jsonCanonico(resto));
}

// ---- tratamento da resposta do retorno (§5.3) ----

export type AcaoRetornoCliente =
  /** 200 (inclusive `repetido` e `obsoleto`). */
  | { acao: 'enviado' }
  /** 422 `external_id_divergente` no `vinculado`: abre `conflito_chave` `vinculo_divergente`; o cliente continua retido. */
  | { acao: 'conflito_vinculo'; codigo: string }
  /** Falha terminal: o retorno fica `falhou`; `alertar` é o código do monitor (sem dado pessoal). */
  | { acao: 'falhou'; codigo: string; alertar: 'retorno_cliente_recusado_pelo_hub' | 'retorno_cliente_defeito_do_erp' }
  /** 401, 403 e 426: a credencial pausa. */
  | { acao: 'pausa' }
  /** 408, 429, 5xx, rede e qualquer resposta inesperada: continua `pendente`, com nova tentativa. */
  | { acao: 'retentar'; inesperado: boolean };

const CODIGOS_422_COM_ALERTA = new Set(['cliente_desconhecido', 'cliente_nao_entregue', 'transicao_invalida', 'revisao_desconhecida']);

/** Tabela do desenho §5.3. `status` 0 = rede. `statusRetorno` é o do corpo enviado (o conflito só vale no `vinculado`). */
export function tratarRespostaRetornoCliente(r: { status: number; codigo?: string | null }, statusRetorno: 'vinculado' | 'rejeitado_erp'): AcaoRetornoCliente {
  if (r.status >= 200 && r.status < 300) return { acao: 'enviado' };
  if (r.status === 401 || r.status === 403 || r.status === 426) return { acao: 'pausa' };
  const codigo = typeof r.codigo === 'string' && /^[a-z][a-z0-9_]{0,59}$/.test(r.codigo) ? r.codigo : 'desconhecido';
  if (r.status === 422) {
    if (codigo === 'external_id_divergente' && statusRetorno === 'vinculado') return { acao: 'conflito_vinculo', codigo };
    return { acao: 'falhou', codigo, alertar: 'retorno_cliente_recusado_pelo_hub' };
  }
  if (r.status === 400) return { acao: 'falhou', codigo, alertar: 'retorno_cliente_defeito_do_erp' };
  const esperado = r.status === 0 || r.status === 408 || r.status === 429 || r.status >= 500;
  return { acao: 'retentar', inesperado: !esperado };
}

/** O código do 422 que a tabela guarda (`codigo_recusa`): só os cinco do Hub; outro texto vira `desconhecido`. */
export function codigoRecusaGravavel(codigo: string): string {
  return CODIGOS_422_COM_ALERTA.has(codigo) || codigo === 'external_id_divergente' ? codigo : 'desconhecido';
}

// ---- expurgo (RN-INF-06) ----

/** Corte do expurgo: agora − 180 dias (− folga de relógio). A função do banco recusa corte mais novo que isso. */
export function corteDoExpurgoPreCadastro(agora: Date): Date {
  return new Date(agora.getTime() - PRAZO_EXPURGO_PRE_CADASTRO_DIAS * DIA_MS - FOLGA_CORTE_MS);
}

// ---- rota do BKO ----

export interface LinhaClienteRecebido {
  id: string;
  cliente_uuid: string;
  codigo_fdv: string | null;
  razao_social: string | null;
  documento_mascarado: string | null;
  vendedor_external_id: string | null;
  recebido_em: Date;
  revisao: number;
  situacao: ClienteRecebidoFdv['situacao'];
  motivo: string | null;
  erros: unknown;
  cliente_id: string | null;
  payload_expurgado_em: Date | null;
  retorno: ClienteRecebidoFdv['retorno'];
}

/**
 * Linha da seção "Clientes recebidos do FDV" (decisão (c) do Alexandre, RN-INF-06). O documento só sai mascarado, e o
 * `payload` nunca é lido. Linha expurgada: razão social "—" (texto fixo) e documento nulo (o Zod do SDK só aceita a máscara,
 * e `null` é válido: a tela mostra "—"); ficam a situação, a data, o motivo, os códigos de erro e as contagens. Os erros
 * por campo trazem só campo, código e mensagem do catálogo, nunca o valor.
 */
export function linhaDaRotaClienteRecebido(l: LinhaClienteRecebido): ClienteRecebidoFdv {
  const expurgada = l.payload_expurgado_em !== null;
  const erros = Array.isArray(l.erros) ? (l.erros as ErroCampoClienteFdv[]) : [];
  const documento = !expurgada && l.documento_mascarado !== null && DocumentoMascaradoFdv.safeParse(l.documento_mascarado).success ? l.documento_mascarado : null;
  return {
    id: l.id,
    cliente_uuid: l.cliente_uuid,
    codigo_fdv: l.codigo_fdv,
    razao_social: expurgada || !l.razao_social ? TEXTO_LINHA_EXPURGADA : l.razao_social,
    documento_mascarado: documento,
    vendedor_external_id: l.vendedor_external_id ?? null,
    recebido_em: l.recebido_em.toISOString(),
    revisao: l.revisao,
    situacao: l.situacao,
    motivo: l.motivo,
    erros: erros.map((e) => ({ campo: e.campo, codigo: e.codigo, mensagem: e.mensagem })),
    cliente_id: l.cliente_id,
    retorno: l.retorno,
  };
}
