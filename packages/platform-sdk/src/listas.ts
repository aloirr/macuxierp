/**
 * Listas do BKO num lugar só (RD-0002 e RD-0003; contrato em `.coord/contratos/listas.md`): paginação por cursor,
 * filtros na URL e CSV. Sem dependência de Node: o shell (`apps/web`) importa por `@macuxierp/platform-sdk/listas`.
 *
 * Paginação única (desenho T-0002, seção 2): `?limite=50` (1 a 200) e `?cursor=<id do último item>`, ordem estável por
 * `id`; a resposta é `{ itens, proximo_cursor }`, com `proximo_cursor` nulo na última página. Nada de `pagina`/`por_pagina`.
 */
import { z } from 'zod';
import type { RespostaRota } from './rotas';

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

export const ConsultaPaginada = z.object({
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
  cursor: z.string().uuid().optional(),
});
export type ConsultaPaginada = z.infer<typeof ConsultaPaginada>;

/** Consulta das listas de cadastro: paginação, `?busca=` e `?inativos=true`. O módulo estende com os filtros dele. */
export const ConsultaLista = ConsultaPaginada.extend({
  busca: z.string().trim().max(80).optional(),
  inativos: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type ConsultaLista = z.infer<typeof ConsultaLista>;

export interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

/** Schema da resposta paginada de um item (`paginaDe(Cliente)`). */
export function paginaDe<T extends z.ZodTypeAny>(item: T) {
  return z.object({ itens: z.array(item), proximo_cursor: z.string().uuid().nullable() });
}

/**
 * O repositório busca `limite + 1` linhas com `id > cursor ORDER BY id`; aqui corta no limite e, se sobrou linha,
 * o `proximo_cursor` é o `id` do último item devolvido.
 */
export function paginar<T extends { id: string }>(linhas: readonly T[], limite: number): Pagina<T> {
  const itens = linhas.slice(0, limite);
  return { itens, proximo_cursor: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
}

// ---- Filtros na URL: recarregar ou compartilhar o link mantém o filtro ----

/** Só as chaves permitidas da página, aparadas, sem vazio; chave repetida fica com a primeira. */
export function lerFiltros(busca: string | URLSearchParams, permitidos: readonly string[]): Record<string, string> {
  const p = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const saida: Record<string, string> = {};
  for (const k of permitidos) {
    const v = p.get(k)?.trim();
    if (v) saida[k] = v;
  }
  return saida;
}

/** Query string estável (chaves em ordem, sem vazio), igual para a rota do shell e para a API. */
export function paraQuery(filtros: Readonly<Record<string, string | number | boolean | undefined | null>>): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(filtros).sort()) {
    const v = filtros[k];
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- CSV no padrão do Excel em pt-BR: separador `;`, BOM UTF-8 e CRLF ----

export type ValorCsv = string | number | boolean | null | undefined;

export interface ColunaCsv<L> {
  titulo: string;
  valor(linha: L): ValorCsv;
}

export const TIPO_CSV = 'text/csv; charset=utf-8';
/** Constantes do CSV, as mesmas na escrita (`paraCsv`) e na leitura (`lerCsv`, D11 da T-0026). */
const BOM = String.fromCharCode(0xfeff);
const SEPARADOR_PADRAO = ';';
const ASPAS = '"';
const PRECISA_ASPAS = new RegExp(`[${SEPARADOR_PADRAO}${ASPAS}\\r\\n]`);
const FORMULA = /^[=+\-@\t\r]/;

function celula(v: ValorCsv): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Injeção de fórmula em planilha: texto que começa com = + - @ ganha apóstrofo; número negativo continua número.
  if (typeof v === 'string' && FORMULA.test(s)) s = `'${s}`;
  return PRECISA_ASPAS.test(s) ? `${ASPAS}${s.replaceAll(ASPAS, ASPAS + ASPAS)}${ASPAS}` : s;
}

export function paraCsv<L>(colunas: readonly ColunaCsv<L>[], linhas: readonly L[]): string {
  const cab = colunas.map((c) => celula(c.titulo)).join(SEPARADOR_PADRAO);
  const corpo = linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(SEPARADOR_PADRAO));
  return `${BOM}${[cab, ...corpo].join('\r\n')}\r\n`;
}

/** Resposta de rota com o CSV para baixar (`clientes.csv`). O nome fica só com letras, dígitos, `.`, `_` e `-`. */
export function respostaCsv(nomeArquivo: string, csv: string): RespostaRota {
  const nome = nomeArquivo.replace(/[^A-Za-z0-9._-]/g, '_') || 'dados.csv';
  return { corpo: csv, cabecalhos: { 'content-type': TIPO_CSV, 'content-disposition': `attachment; filename="${nome}"`, 'cache-control': 'no-store' } };
}

// ---- Leitura de CSV (D11 da T-0026): só o genérico; layout, mapeamento e RN ficam no domain do módulo ----

export type SeparadorCsv = ';' | ',';

/**
 * Arquivo recusado por inteiro. `coluna` é o nome do cabeçalho só quando ele parece nome de coluna (`^[a-z][a-z0-9_.]{0,59}$`);
 * fora disso, só a posição ("coluna 3"): num CSV sem cabeçalho, a 1ª linha é dado (LGPD). Nunca o valor de uma célula.
 */
export interface ErroArquivoCsv {
  codigo: 'CSV_CODIFICACAO' | 'CSV_VAZIO' | 'CSV_ASPAS' | 'CSV_COLUNA_DESCONHECIDA' | 'CSV_COLUNA_REPETIDA' | 'CSV_COLUNA_AUSENTE';
  /** Linha física (1 = cabeçalho); `null` quando não se aplica. */
  linha: number | null;
  coluna: string | null;
  motivo: string;
}

/** Linha recusada pela leitura (as demais seguem). */
export interface ErroLinhaCsv {
  codigo: 'CSV_CELULAS_A_MAIS';
  linha: number;
  motivo: string;
}

/** Linha lida: `numero` é a linha física onde o registro começa (1 = cabeçalho); célula ausente ou vazia = `''`. */
export interface LinhaCsv {
  numero: number;
  celulas: Readonly<Record<string, string>>;
}

export interface CsvLido {
  separador: SeparadorCsv;
  /** Colunas do arquivo, em minúsculas, na ordem do cabeçalho. */
  colunas: readonly string[];
  linhas: readonly LinhaCsv[];
  errosLinha: readonly ErroLinhaCsv[];
}

export type ResultadoLeituraCsv = ({ ok: true } & CsvLido) | { ok: false; erro: ErroArquivoCsv };

export interface OpcoesLeituraCsv {
  /** Todas as colunas aceitas (minúsculas). Outra coluna recusa o arquivo. */
  aceitas: readonly string[];
  /** Colunas que precisam estar no cabeçalho (o conteúdo vazio é regra do domain). */
  obrigatorias?: readonly string[];
}

const MOTIVO_UTF8 = 'O arquivo não está em UTF-8: no Excel, use "Salvar como" > "CSV UTF-8"';
// Começa por letra: CPF ou CNPJ sem máscara (só dígitos) também cairia em `[a-z0-9_.]` e seria ecoado.
const NOME_COLUNA = /^[a-z][a-z0-9_.]{0,59}$/;
/** O nome do cabeçalho, se parece nome de coluna; senão a posição (1 = primeira), sem ecoar o texto. */
const nomeColuna = (s: string, indice: number) => (NOME_COLUNA.test(s) ? s : `coluna ${indice + 1}`);

function textoDoArquivo(entrada: Uint8Array | string): string | null {
  let texto: string;
  if (typeof entrada === 'string') texto = entrada;
  else {
    try {
      texto = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entrada);
    } catch {
      return null;
    }
  }
  return texto.startsWith(BOM) ? texto.slice(1) : texto;
}

/** Separador da 1ª linha: vence o mais frequente fora de aspas; empate dá `;`. */
export function detectarSeparador(primeiraLinha: string): SeparadorCsv {
  let pv = 0;
  let vi = 0;
  let dentro = false;
  for (const ch of primeiraLinha) {
    if (ch === ASPAS) dentro = !dentro;
    else if (!dentro && ch === ';') pv++;
    else if (!dentro && ch === ',') vi++;
  }
  return vi > pv ? ',' : ';';
}

interface RegistroBruto {
  numero: number;
  celulas: string[];
}

/** RFC 4180: aspas duplas, `""` dentro de aspas e quebra de linha dentro de aspas; CRLF, LF ou CR. */
function registros(texto: string, sep: SeparadorCsv): RegistroBruto[] | { aspasAbertasNaLinha: number } {
  const saida: RegistroBruto[] = [];
  let linhaFisica = 1;
  let inicio = 1;
  let celulas: string[] = [];
  let atual = '';
  let dentro = false;
  let houveConteudo = false;
  const fechar = () => {
    celulas.push(atual);
    saida.push({ numero: inicio, celulas });
    celulas = [];
    atual = '';
    houveConteudo = false;
  };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (dentro) {
      if (ch === ASPAS) {
        if (texto[i + 1] === ASPAS) {
          atual += ASPAS;
          i++;
        } else dentro = false;
      } else {
        if (ch === '\n' || (ch === '\r' && texto[i + 1] !== '\n')) linhaFisica++;
        atual += ch;
      }
      continue;
    }
    if (ch === ASPAS && atual.trim() === '') {
      dentro = true;
      atual = '';
      houveConteudo = true;
    } else if (ch === sep) {
      celulas.push(atual);
      atual = '';
      houveConteudo = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fechar();
      linhaFisica++;
      inicio = linhaFisica;
    } else {
      atual += ch;
      houveConteudo = true;
    }
  }
  if (dentro) return { aspasAbertasNaLinha: inicio };
  if (houveConteudo || atual !== '' || celulas.length) fechar();
  return saida;
}

/**
 * Lê um CSV (UTF-8 com ou sem BOM; separador `;` ou `,` pela 1ª linha; aspas da RFC 4180; células aparadas). O
 * cabeçalho é por nome, sem diferença de maiúsculas, em qualquer ordem. Coluna fora de `aceitas`, repetida ou
 * obrigatória ausente recusa o arquivo. Linha em branco (ou só com separadores) é ignorada e conta na numeração.
 * Linha com mais células preenchidas que o cabeçalho vai para `errosLinha`. Nenhum valor de célula vai para os erros.
 */
export function lerCsv(entrada: Uint8Array | string, opcoes: OpcoesLeituraCsv): ResultadoLeituraCsv {
  const falha = (codigo: ErroArquivoCsv['codigo'], motivo: string, linha: number | null = null, coluna: string | null = null): ResultadoLeituraCsv => ({
    ok: false,
    erro: { codigo, linha, coluna, motivo },
  });
  const texto = textoDoArquivo(entrada);
  if (texto === null) return falha('CSV_CODIFICACAO', MOTIVO_UTF8);
  const separador = detectarSeparador(texto.slice(0, texto.search(/\r|\n|$/)));
  const brutos = registros(texto, separador);
  if (!Array.isArray(brutos)) return falha('CSV_ASPAS', 'Aspas abertas e não fechadas', brutos.aspasAbertasNaLinha);
  const vazia = (r: RegistroBruto) => r.celulas.every((c) => c.trim() === '');
  const cab = brutos.find((r) => !vazia(r));
  if (!cab) return falha('CSV_VAZIO', 'Arquivo vazio: falta o cabeçalho');
  const colunas = cab.celulas.map((c) => c.trim().toLowerCase());
  while (colunas.length && colunas.at(-1) === '') colunas.pop(); // `;` sobrando no fim do cabeçalho (Excel)
  const aceitas = new Set(opcoes.aceitas.map((c) => c.toLowerCase()));
  const vistas = new Set<string>();
  for (const [i, c] of colunas.entries()) {
    if (!aceitas.has(c)) return falha('CSV_COLUNA_DESCONHECIDA', c ? 'Coluna desconhecida no cabeçalho' : 'Coluna sem nome no cabeçalho', cab.numero, nomeColuna(c, i));
    if (vistas.has(c)) return falha('CSV_COLUNA_REPETIDA', 'Coluna repetida no cabeçalho', cab.numero, nomeColuna(c, i));
    vistas.add(c);
  }
  for (const c of opcoes.obrigatorias ?? []) {
    // O nome vem do layout do módulo (não do arquivo); a posição não se aplica.
    if (!vistas.has(c.toLowerCase())) return falha('CSV_COLUNA_AUSENTE', 'Coluna obrigatória ausente no cabeçalho', cab.numero, nomeColuna(c.toLowerCase(), -1));
  }
  const linhas: LinhaCsv[] = [];
  const errosLinha: ErroLinhaCsv[] = [];
  for (const r of brutos) {
    if (r.numero <= cab.numero || vazia(r)) continue;
    if (r.celulas.slice(colunas.length).some((c) => c.trim() !== '')) {
      errosLinha.push({ codigo: 'CSV_CELULAS_A_MAIS', linha: r.numero, motivo: `Linha com mais células que as ${colunas.length} colunas do cabeçalho` });
      continue;
    }
    const celulas: Record<string, string> = {};
    colunas.forEach((c, i) => (celulas[c] = (r.celulas[i] ?? '').trim()));
    linhas.push({ numero: r.numero, celulas });
  }
  return { ok: true, separador, colunas, linhas, errosLinha };
}

// ---- Conversores de célula: célula vazia = `undefined` (não altera nada); o motivo nunca repete o valor ----

export type CelulaConvertida<T> = { ok: true; valor: T | undefined } | { ok: false; motivo: string };

const vazio = <T>(): CelulaConvertida<T> => ({ ok: true, valor: undefined });
const ok = <T>(valor: T): CelulaConvertida<T> => ({ ok: true, valor });
const recusa = <T>(motivo: string): CelulaConvertida<T> => ({ ok: false, motivo });

const SIM = new Set(['sim', 's', 'true', '1', 'verdadeiro']);
const NAO = new Set(['não', 'nao', 'n', 'false', '0', 'falso']);

/** sim/não: `sim s true 1 verdadeiro` / `não nao n false 0 falso`, sem diferença de maiúsculas. */
export function celulaBooleana(celula: string): CelulaConvertida<boolean> {
  const s = celula.trim().toLowerCase();
  if (!s) return vazio();
  if (SIM.has(s)) return ok(true);
  if (NAO.has(s)) return ok(false);
  return recusa('Use sim ou não');
}

function dataValida(a: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Data `AAAA-MM-DD`, conferida no calendário; devolve a mesma `AAAA-MM-DD`. */
export function celulaData(celula: string): CelulaConvertida<string> {
  const s = celula.trim();
  if (!s) return vazio();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return recusa('Data no formato AAAA-MM-DD');
  if (!dataValida(Number(m[1]), Number(m[2]), Number(m[3]))) return recusa('Data inexistente');
  return ok(s);
}

/** Data-hora em UTC: `AAAA-MM-DDTHH:MM:SS[.mmm]Z`. Devolve o ISO normalizado (`toISOString`). */
export function celulaDataHora(celula: string): CelulaConvertida<string> {
  const s = celula.trim();
  if (!s) return vazio();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/.exec(s);
  if (!m) return recusa('Data-hora em UTC no formato AAAA-MM-DDTHH:MM:SSZ');
  if (!dataValida(Number(m[1]), Number(m[2]), Number(m[3])) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59) return recusa('Data-hora inexistente');
  return ok(new Date(s).toISOString());
}

/** Inteiro (sem casas nem milhar), com faixa opcional. */
export function celulaInteiro(celula: string, faixa: { min?: number; max?: number } = {}): CelulaConvertida<number> {
  const s = celula.trim();
  if (!s) return vazio();
  if (!/^-?\d+$/.test(s)) return recusa('Número inteiro, sem casas nem separador de milhar');
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return recusa('Número fora da faixa');
  if ((faixa.min !== undefined && n < faixa.min) || (faixa.max !== undefined && n > faixa.max)) {
    return recusa(`Número fora da faixa ${faixa.min ?? '...'} a ${faixa.max ?? '...'}`);
  }
  return ok(n);
}

/** Centavos (`*_cents`): inteiro ≥ 0. */
export function celulaCentavos(celula: string): CelulaConvertida<number> {
  const s = celula.trim();
  if (!s) return vazio();
  if (!/^\d+$/.test(s)) return recusa('Valor em centavos: inteiro sem casas, sem sinal e sem separador');
  const n = Number(s);
  return Number.isSafeInteger(n) ? ok(n) : recusa('Valor fora da faixa');
}

/**
 * Decimal com vírgula ou ponto, sem separador de milhar, devolvido como inteiro na escala de `casas`
 * (`celulaDecimal('12,5', 2)` → 1250; Qtd4: `celulaDecimal('1.25', 4)` → 12500). Sem arredondar: mais casas que o
 * permitido é recusado (zeros à direita são aceitos). `1.500` e `1,500` são ambíguos (milhar ou decimal?) e recusados.
 */
export function celulaDecimal(celula: string, casas: number, opcoes: { negativo?: boolean } = {}): CelulaConvertida<number> {
  if (!Number.isInteger(casas) || casas < 0 || casas > 6) throw new RangeError('celulaDecimal: casas de 0 a 6');
  const s = celula.trim();
  if (!s) return vazio();
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return recusa('Número com vírgula ou ponto decimal, sem separador de milhar');
  const [, sinal, inteira, fracao = ''] = m;
  if (/^[1-9]\d{0,2}$/.test(inteira!) && fracao.length === 3) return recusa('Número ambíguo (milhar ou decimal?): escreva sem separador de milhar, ex.: 1500 ou 1,5');
  if (sinal && !opcoes.negativo) return recusa('Número negativo não é aceito');
  const significativa = fracao.replace(/0+$/, '');
  if (significativa.length > casas) return recusa(`No máximo ${casas} casas decimais`);
  const n = Number(`${inteira}${significativa.padEnd(casas, '0')}`);
  if (!Number.isSafeInteger(n)) return recusa('Número fora da faixa');
  return ok(sinal && n !== 0 ? -n : n);
}

/** Lista separada por `/` (ex.: `0/30/60`), itens aparados; item vazio recusa a célula. */
export function celulaLista(celula: string): CelulaConvertida<string[]> {
  const s = celula.trim();
  if (!s) return vazio();
  const itens = s.split('/').map((i) => i.trim());
  return itens.some((i) => !i) ? recusa('Lista separada por / com item vazio') : ok(itens);
}
