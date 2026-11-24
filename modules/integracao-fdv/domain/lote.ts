/**
 * Montagem de lote, Idempotency-Key e regra de geração (RN-INF-03, T-0009 seções 3 e 4).
 * Funções puras: o relógio (`enviado_em`) e o id da sessão chegam por parâmetro.
 */
import { LIMITE_REGISTROS_LOTE, VERSAO_CONTRATO_HUB, VERSAO_CONTRATO_PRAZO_V2, type CorpoLote, type CursorHub, type EntidadeHub, type EstadoLote, type LinhaInvalida, type ModoLote, type RegistroLote } from '../contracts';
import { utf8 } from './hash';
import { paraLinhaHub } from './linhas';
import { compararBinario, jsonCanonico, sha256HexTexto } from './canonico';

const tamanhoUtf8 = (t: string): number => utf8(t).length;

/** Registros por lote: o teto da credencial (1 a 5.000, 0015) limitado ao do contrato; sem credencial vale o do contrato. */
export function limiteRegistrosDoLote(daCredencial?: number): number {
  return Math.min(daCredencial ?? LIMITE_REGISTROS_LOTE, LIMITE_REGISTROS_LOTE);
}
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
  /** Só no modo completo: número da parte do primeiro lote montado (padrão 1; a sessão continua de partes já enviadas). */
  sessaoParteInicial?: number;
  /** Só no modo completo: ainda há registros da sessão depois destes (a última parte montada não leva `ultimo: true`). */
  sessaoContinua?: boolean;
  /**
   * T-0061. Registro já aceito pelo Hub (o último enviado e aceito nesta sessão, com o payload e o hash que o Hub já tem), que
   * fecha a sessão como parte final quando não há registros válidos (`precisaFechamento`), porque o Hub recusa parte vazia
   * (`lote_vazio`). Como é de antes do cursor local, o reenvio não muda nada no Hub. Sem ele, devolve `[]` (o chamador fecha a
   * sessão localmente). Linhas inválidas, se houver, vão junto.
   */
  registroDeFechamento?: RegistroLote;
  /** T-0061. Cursor local da sessão: é o `cursor` do lote de fechamento (o cursor não recua para o do registro). */
  cursorDeFechamento?: CursorHub;
  limiteRegistros?: number;
  limiteBytes?: number;
  /** T-0085 lote 2: manda o `prazo_pagamento` no envelope v2 (`PRAZO_CONTRATO_V2_LIGADO`). Padrão: v1. */
  contratoPrazoV2?: boolean;
}

/** Versão do envelope: v2 só para `prazo_pagamento` e só com a opção ligada; todo o resto é v1. */
export function versaoContratoDoLote(entidade: EntidadeHub, contratoPrazoV2: boolean | undefined): CorpoLote['versao_contrato'] {
  return entidade === 'prazo_pagamento' && contratoPrazoV2 === true ? VERSAO_CONTRATO_PRAZO_V2 : VERSAO_CONTRATO_HUB;
}

/**
 * T-0061. A parte final precisa do registro de fechamento: carga completa com sessão em andamento (parte > 1), sem continuação e
 * sem registros válidos (o Hub recusa parte vazia). Regra única, usada pelo `montarLotes` e pela API.
 */
export function precisaFechamento(e: { modo: ModoLote; sessaoParteInicial?: number; sessaoContinua?: boolean; registrosValidos: number }): boolean {
  return e.modo === 'completo' && (e.sessaoParteInicial ?? 1) > 1 && !e.sessaoContinua && e.registrosValidos === 0;
}

/**
 * Monta os lotes da entidade. Delta: sem sessão. Completo: uma sessão com partes 1..n, a última com `ultimo: true`
 * (T-0009 seção 4). Sem registros e sem linhas inválidas devolve `[]` no delta e na carga completa que ainda não enviou parte (o Hub recusa `lote_vazio`); nunca monta parte final vazia com `ultimo: true`: numa sessão em andamento (`sessaoParteInicial` > 1) que ficou sem registros válidos (inativados ou apagados entre as partes), a parte final leva só o `registroDeFechamento` (T-0061); sem ele, `[]` (o chamador fecha a sessão localmente). Linhas inválidas (M5) vão no primeiro lote: até 500 detalhadas, o resto só na contagem.
 */
export function montarLotes(e: EntradaMontagem): LoteMontado[] {
  if (e.modo === 'completo' && !e.sessaoId) throw new Error('carga completa exige o id da sessão');
  const geracao = e.geracao ?? 1;
  const maxReg = limiteRegistrosDoLote(e.limiteRegistros);
  const maxBytes = e.limiteBytes ?? LIMITE_BYTES_LOTE;
  // T-0061: parte final leva o último aceito (ver registroDeFechamento)
  const fecho = precisaFechamento({ modo: e.modo, sessaoParteInicial: e.sessaoParteInicial, sessaoContinua: e.sessaoContinua, registrosValidos: e.registros.length }) ? e.registroDeFechamento : undefined;
  const ordenados = ordenarRegistros(fecho ? [fecho] : e.registros);
  const invalidas = e.linhas_invalidas ?? [];
  const detalhadas = invalidas.slice(0, LIMITE_LINHAS_INVALIDAS_DETALHADAS).map(paraLinhaHub);
  const omitidas = invalidas.length - detalhadas.length;

  if (ordenados.length === 0 && invalidas.length === 0) return [];

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
      versao_contrato: versaoContratoDoLote(e.entidade, e.contratoPrazoV2),
      entidade: e.entidade,
      modo: e.modo,
      enviado_em: e.enviadoEm,
      cursor: fecho && e.cursorDeFechamento ? e.cursorDeFechamento : ultimo ? cursorDoRegistro(ultimo) : null,
      ...(e.modo === 'completo'
        ? { sessao: { id: e.sessaoId!, parte: (e.sessaoParteInicial ?? 1) + i, ultimo: i === grupos.length - 1 && !e.sessaoContinua } }
        : {}),
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
