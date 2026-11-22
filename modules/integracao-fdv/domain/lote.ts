/**
 * Montagem de lote, Idempotency-Key e regra de geração (RN-INF-03, T-0009 seções 3 e 4).
 * Funções puras: o relógio (`enviado_em`) e o id da sessão chegam por parâmetro.
 */
import { VERSAO_CONTRATO_HUB, type CorpoLote, type CursorHub, type EntidadeHub, type EstadoLote, type LinhaInvalida, type ModoLote, type RegistroLote } from '../contracts';
import { utf8 } from './hash';
import { compararBinario, jsonCanonico, sha256HexTexto } from './canonico';

const tamanhoUtf8 = (t: string): number => utf8(t).length;

export const LIMITE_REGISTROS_LOTE = 5000;
/** O Hub recusa acima de 8 MiB (413); o ERP monta até 4 MiB. */
export const LIMITE_BYTES_LOTE = 4 * 1024 * 1024;
export const LIMITE_LINHAS_INVALIDAS_DETALHADAS = 500;

/** Ordem do Hub: (alterado_em, external_id em ordem binária "C"). */
export function compararRegistros(a: Pick<RegistroLote, 'alterado_em' | 'external_id'>, b: Pick<RegistroLote, 'alterado_em' | 'external_id'>): number {
  const dt = Date.parse(a.alterado_em) - Date.parse(b.alterado_em);
  if (dt !== 0) return dt < 0 ? -1 : 1;
  return compararBinario(a.external_id, b.external_id);
}

export function ordenarRegistros<T extends Pick<RegistroLote, 'alterado_em' | 'external_id'>>(registros: readonly T[]): T[] {
  return [...registros].sort(compararRegistros);
}

export function cursorDoRegistro(r: Pick<RegistroLote, 'alterado_em' | 'external_id'>): CursorHub {
  return { alterado_em: r.alterado_em, external_id: r.external_id };
}

/** Conteúdo que define a identidade do lote (mesma definição do Hub): sem `enviado_em`, cursor, conector nem versão do ERP. */
export function conteudoCanonicoLote(c: Pick<CorpoLote, 'versao_contrato' | 'entidade' | 'modo' | 'sessao' | 'registros' | 'linhas_invalidas' | 'linhas_invalidas_omitidas'>): string {
  return jsonCanonico({
    versao: c.versao_contrato,
    entidade: c.entidade,
    modo: c.modo,
    sessao: c.sessao ?? null,
    registros: c.registros,
    linhas_invalidas: c.linhas_invalidas,
    linhas_invalidas_omitidas: c.linhas_invalidas_omitidas,
  });
}

/** `Idempotency-Key`: SHA-256 hex do conteúdo canônico + a `geracao` (M6). */
export function chaveIdempotencia(corpo: CorpoLote, geracao: number): string {
  return sha256HexTexto(`${conteudoCanonicoLote(corpo)}\ngeracao:${geracao}`);
}

export function tamanhoCorpoBytes(corpo: CorpoLote): number {
  return tamanhoUtf8(JSON.stringify(corpo));
}

export interface LoteMontado {
  corpo: CorpoLote;
  geracao: number;
  chave_idempotencia: string;
  /** Cursor declarado = par do último registro do lote (`null` em lote sem registros). */
  cursor_declarado: CursorHub | null;
  bytes: number;
}

function fechar(corpo: CorpoLote, geracao: number): LoteMontado {
  return { corpo, geracao, chave_idempotencia: chaveIdempotencia(corpo, geracao), cursor_declarado: corpo.cursor, bytes: tamanhoCorpoBytes(corpo) };
}

export interface EntradaMontagem {
  entidade: EntidadeHub;
  modo: ModoLote;
  registros: readonly RegistroLote[];
  linhas_invalidas?: readonly LinhaInvalida[];
  enviadoEm: string;
  geracao?: number;
  /** Só no modo completo: id da sessão (UUID). */
  sessaoId?: string;
  limiteRegistros?: number;
  limiteBytes?: number;
}

/**
 * Monta os lotes da entidade. Delta: sem sessão. Completo: uma sessão com partes 1..n, a última com `ultimo: true`
 * (T-0009 seção 4). Delta sem registros e sem linhas inválidas devolve `[]` (lote vazio só na sessão completa). Linhas inválidas (M5) vão no primeiro lote: até 500 detalhadas, o resto só na contagem.
 */
export function montarLotes(e: EntradaMontagem): LoteMontado[] {
  if (e.modo === 'completo' && !e.sessaoId) throw new Error('carga completa exige o id da sessão');
  const geracao = e.geracao ?? 1;
  const maxReg = Math.min(e.limiteRegistros ?? LIMITE_REGISTROS_LOTE, LIMITE_REGISTROS_LOTE);
  const maxBytes = e.limiteBytes ?? LIMITE_BYTES_LOTE;
  const ordenados = ordenarRegistros(e.registros);
  const invalidas = e.linhas_invalidas ?? [];
  const detalhadas = invalidas.slice(0, LIMITE_LINHAS_INVALIDAS_DETALHADAS);
  const omitidas = invalidas.length - detalhadas.length;

  if (e.modo === 'delta' && ordenados.length === 0 && invalidas.length === 0) return [];

  const grupos: RegistroLote[][] = [];
  let atual: RegistroLote[] = [];
  let bytes = 0;
  const sobra = 512 + tamanhoUtf8(JSON.stringify(detalhadas));
  for (const r of ordenados) {
    const b = tamanhoUtf8(JSON.stringify(r)) + 1;
    if (atual.length > 0 && (atual.length >= maxReg || sobra + bytes + b > maxBytes)) {
      grupos.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push(r);
    bytes += b;
  }
  if (atual.length > 0 || grupos.length === 0) grupos.push(atual);

  return grupos.map((registros, i) => {
    const ultimo = registros[registros.length - 1];
    const corpo: CorpoLote = {
      versao_contrato: VERSAO_CONTRATO_HUB,
      entidade: e.entidade,
      modo: e.modo,
      enviado_em: e.enviadoEm,
      cursor: ultimo ? cursorDoRegistro(ultimo) : null,
      ...(e.modo === 'completo' ? { sessao: { id: e.sessaoId!, parte: i + 1, ultimo: i === grupos.length - 1 } } : {}),
      registros: [...registros],
      linhas_invalidas: i === 0 ? [...detalhadas] : [],
      linhas_invalidas_omitidas: i === 0 ? omitidas : 0,
    };
    return fechar(corpo, geracao);
  });
}

/**
 * 413: divide o lote ao meio, cada metade com `geracao` nova (M6). Na sessão, a primeira metade mantém a parte e a segunda
 * é `parte + 1` com o `ultimo` original; as partes seguintes ainda não foram montadas e são renumeradas pelo chamador.
 * Lote de 1 registro não divide (`null`: pausa por `envelope`).
 */
export function dividirAoMeio(lote: LoteMontado): [LoteMontado, LoteMontado] | null {
  const regs = lote.corpo.registros;
  if (regs.length < 2) return null;
  const meio = Math.ceil(regs.length / 2);
  const geracao = lote.geracao + 1;
  const a = regs.slice(0, meio);
  const b = regs.slice(meio);
  const sessao = lote.corpo.sessao;
  const corpoA: CorpoLote = {
    ...lote.corpo,
    cursor: cursorDoRegistro(a[a.length - 1]!),
    registros: a,
    ...(sessao ? { sessao: { ...sessao, ultimo: false } } : {}),
  };
  const corpoB: CorpoLote = {
    ...lote.corpo,
    cursor: cursorDoRegistro(b[b.length - 1]!),
    registros: b,
    linhas_invalidas: [],
    linhas_invalidas_omitidas: 0,
    ...(sessao ? { sessao: { ...sessao, parte: sessao.parte + 1 } } : {}),
  };
  return [fechar(corpoA, geracao), fechar(corpoB, geracao)];
}

const ESTADOS_FINAIS: readonly EstadoLote[] = ['concluido', 'concluido_com_erros', 'falhou', 'recusado'];

/**
 * Regra de geração (recado R-20261121-221350): a chave antiga de um lote em estado final (`concluido`,
 * `concluido_com_erros`, `falhou`, `recusado`) já está gravada no Hub; reenviar o mesmo conteúdo depois dela exige
 * `geracao` nova. Só a retentativa do mesmo lote em voo (`montado`, `enviando`, `aceito`: rede, 5xx, 429) mantém a chave.
 * O worker parte da última geração usada para a entidade ao montar o lote seguinte.
 */
export function geracaoDoReenvio(estadoAnterior: EstadoLote, geracaoAnterior: number): number {
  return ESTADOS_FINAIS.includes(estadoAnterior) ? geracaoAnterior + 1 : geracaoAnterior;
}
