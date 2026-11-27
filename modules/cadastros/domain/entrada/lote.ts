/**
 * T-0057 C3 (ADR 0014 §3): regras puras do lote da `/entrada/v1` depois do processamento: código por linha do Hub, erros sem o
 * dado (RN-INT-01, LGPD), cursor do delta, estado final e o `LoteResultado` do contrato do SDK (campo `status`, nunca `estado`).
 */
import { CODIGOS_ERRO_LINHA_HUB, type CursorHub, type EstadoLoteHub, type LoteResultado } from '@macuxierp/platform-sdk/hub-v1';
import type { ErroLinha } from '../carga';

export type CodigoLinhaHub = (typeof CODIGOS_ERRO_LINHA_HUB)[number];

/** Teto de `entrada_lote.erros` (0071) e de `LIMITE_ERROS_RESPOSTA_MAX` do Hub. */
export const LIMITE_ERROS_GUARDADOS = 5500;

const DA_CARGA: Readonly<Record<string, CodigoLinhaHub>> = {
  CARGA_OBRIGATORIO: 'campo_obrigatorio',
  CARGA_FORMATO: 'formato_invalido',
  CARGA_TAMANHO: 'valor_fora_da_faixa',
  CARGA_REFERENCIA: 'referencia_ausente',
  CARGA_DEPENDENCIA: 'referencia_ausente',
  CARGA_DUPLICADO: 'regra_invalida',
  CARGA_CONFLITO: 'regra_invalida',
  CARGA_BANCO: 'falha_processamento',
};

/** Código da carga (`CARGA_*`, `RN-*`, `D8`) → código por linha do Hub. Sem código próprio: `valor_nao_permitido`. */
export function codigoLinhaHub(codigo: string): CodigoLinhaHub {
  const direto = DA_CARGA[codigo];
  if (direto) return direto;
  if (/^RN-[A-Z]+-\d{2}$/.test(codigo) || codigo === 'D8') return 'regra_invalida';
  return 'valor_nao_permitido';
}

/** Os dois últimos da lista do Hub: o Conector reenvia a linha depois. */
export const reprocessavel = (c: CodigoLinhaHub): boolean => c === 'referencia_ausente' || c === 'falha_processamento';

const MENSAGENS: Readonly<Record<CodigoLinhaHub, string>> = {
  registro_invalido: 'Registro inválido',
  external_id_invalido: 'Identificador externo inválido',
  campo_obrigatorio: 'Campo obrigatório ausente',
  tipo_invalido: 'Tipo de valor inválido',
  formato_invalido: 'Valor fora do formato do contrato',
  valor_fora_da_faixa: 'Valor fora da faixa permitida',
  valor_nao_permitido: 'Valor não permitido',
  campo_desconhecido: 'Campo desconhecido',
  regra_invalida: 'Regra de negócio violada',
  referencia_ausente: 'Cadastro referenciado ainda não existe no ERP',
  falha_processamento: 'Falha ao gravar a linha: tente reenviar',
};

/** Erro por linha como o lote o guarda: só código e campo, nunca o valor nem o texto da linha. */
export interface ErroGuardado {
  indice: number;
  external_id: string | null;
  campo: string | null;
  codigo: CodigoLinhaHub;
  /** Ausente = validada no Hub (`hub`); `conector` = veio em `linhas_invalidas`. */
  origem?: 'conector';
}

/** Linha do kit (a 1 é o cabeçalho) → índice do registro no lote (base 0). Fora do lote vira 0. */
export const indiceDaLinha = (linha: number): number => Math.max(0, linha - 2);

export interface ErrosDoLote {
  erros: ErroGuardado[];
  /** Todos os erros distintos, mesmo os que passaram do limite guardado. */
  total: number;
  omitidos: number;
  indicesComErro: Set<number>;
}

/** Converte os erros da validação e da gravação (`linha` do kit) em erros por registro, sem o dado, sem repetir e até o limite. */
export function errosDoLote(entrada: readonly ErroLinha[], externos: readonly (string | null)[], limite = LIMITE_ERROS_GUARDADOS): ErrosDoLote {
  const vistos = new Set<string>();
  const erros: ErroGuardado[] = [];
  const indicesComErro = new Set<number>();
  let total = 0;
  for (const e of entrada) {
    const indice = Math.min(indiceDaLinha(e.linha), Math.max(0, externos.length - 1));
    const codigo = codigoLinhaHub(e.codigo);
    const chave = `${indice}|${e.campo ?? ''}|${codigo}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    indicesComErro.add(indice);
    total += 1;
    if (erros.length < limite) erros.push({ indice, external_id: externos[indice] ?? null, campo: e.campo, codigo });
  }
  return { erros, total, omitidos: total - erros.length, indicesComErro };
}

/** `a` é mais novo que `b` pelo par (`alterado_em`, `external_id`), na ordem de bytes do `external_id` (collation C do banco). `b` nulo = qualquer `a`. */
export function maisNovoQue(a: CursorHub, b: CursorHub | null): boolean {
  if (b === null) return true;
  const ta = Date.parse(a.alterado_em);
  const tb = Date.parse(b.alterado_em);
  if (ta !== tb) return ta > tb;
  return a.external_id > b.external_id;
}

/** Cursor do delta: o maior (`alterado_em`, `external_id`) entre os registros do lote sem erro; sem nenhum, não há cursor. */
export function cursorDoLote(registros: readonly { indice: number; alterado_em: string; external_id: string }[], indicesComErro: ReadonlySet<number>): CursorHub | null {
  let cursor: CursorHub | null = null;
  for (const r of registros) {
    if (indicesComErro.has(r.indice)) continue;
    const c = { alterado_em: new Date(r.alterado_em).toISOString(), external_id: r.external_id };
    if (maisNovoQue(c, cursor)) cursor = c;
  }
  return cursor;
}

/** Índices dos registros que um posterior do mesmo lote, com o mesmo `external_id`, substitui: vale o último (ordem do lote). */
export function repetidosNoLote(registros: readonly { indice: number; external_id: string }[]): Set<number> {
  const ultimo = new Map<string, number>();
  for (const r of registros) ultimo.set(r.external_id, r.indice);
  return new Set(registros.filter((r) => ultimo.get(r.external_id) !== r.indice).map((r) => r.indice));
}

export const estadoFinalDoLote = (comErro: number): 'concluido' | 'concluido_com_erros' => (comErro > 0 ? 'concluido_com_erros' : 'concluido');

/** A linha de `cadastros.entrada_lote` que o resultado precisa (instantes já em ISO). */
export interface LoteGuardado {
  id: string;
  entidade: string;
  modo: 'completo' | 'delta';
  estado: EstadoLoteHub;
  contagens: Readonly<Record<string, number | undefined>>;
  erros: readonly ErroGuardado[];
  cursor_alterado_em: string | null;
  cursor_external_id: string | null;
  recebido_em: string;
  concluido_em: string | null;
  erro_codigo: string | null;
}

/** `GET /entrada/v1/lotes/:id`: o `LoteResultado` do SDK. O limite de erros é o `?limite_erros=` (o resto vira `erros_omitidos`). */
export function resultadoDoLote(l: LoteGuardado, limiteErros: number): LoteResultado {
  const n = (k: string): number => l.contagens[k] ?? 0;
  const erros = l.erros.slice(0, limiteErros);
  const total = Math.max(n('erros_total'), l.erros.length);
  return {
    lote_id: l.id,
    entidade: l.entidade as LoteResultado['entidade'],
    modo: l.modo,
    status: l.estado,
    contagens: {
      recebidas: n('recebidas'), duplicadas_no_lote: n('duplicadas_no_lote'), com_erro: n('com_erro'), novas: n('novas'),
      atualizadas: n('atualizadas'), inalteradas: n('inalteradas'), obsoletas: n('obsoletas'),
    },
    erros: erros.map((e) => ({
      indice: e.indice, external_id: e.external_id, codigo: e.codigo, campo: e.campo, mensagem: MENSAGENS[e.codigo],
      reprocessavel: reprocessavel(e.codigo), origem: e.origem ?? 'hub',
    })),
    avisos: [],
    cursor: l.cursor_alterado_em !== null && l.cursor_external_id !== null ? { alterado_em: l.cursor_alterado_em, external_id: l.cursor_external_id } : null,
    invalidas_omitidas: n('invalidas_omitidas'),
    erros_total: total,
    erros_omitidos: total - erros.length,
    inativacao: null,
    inativadas: 0,
    recebido_em: l.recebido_em,
    concluido_em: l.concluido_em,
  };
}
