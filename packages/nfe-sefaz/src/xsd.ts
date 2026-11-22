/**
 * Validação XSD da NF-e 55 (layout 4.00), dos eventos 110110/110111, da inutilização e dos retornos da SEFAZ, nos
 * schemas **PL_010g** (grupos IBS, CBS e IS da NT 2025.002-RTC). Reutilizável: o simulador confere o que recebe e o
 * emissor (T-0018) confere o que monta. Desenho T-0045 §5, etapa 3; ADR 0008.
 *
 * - Validador em WebAssembly puro (`xmllint-wasm`, o libxml2 compilado para WASM): sem binário nativo, sem rede. Os
 *   schemas entram no sistema de arquivos em memória do WASM; nada é lido fora de `schemas/PL_010g`.
 * - Os schemas são uma cópia do espelho do sped-nfe (commit 4596b89), **a conferir com o ZIP oficial na T-0046**
 *   (`schemas/PL_010g/README.md`).
 * - As mensagens de erro saem sem os valores do documento (podem trazer CPF, nome ou endereço do destinatário):
 *   ficam o elemento e a regra violada, nunca o conteúdo (regra 8).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { validateXML, type XMLFileInfo } from 'xmllint-wasm';
import { temDoctype } from './xmldsig';

/** Pacote de schemas em uso (ADR 0002 e ADR 0008). Mudou o pacote, muda aqui e no README da pasta. */
export const PACOTE_SCHEMAS = 'PL_010g' as const;

/** Raiz de cada documento que o ERP envia ou recebe, com o arquivo de entrada do schema. */
export const ESQUEMAS_XSD = Object.freeze({
  /** `<NFe>` assinada (uma nota). */
  nfe: 'nfe_v4.00.xsd',
  /** `<enviNFe>`: o lote de autorização. */
  enviNFe: 'enviNFe_v4.00.xsd',
  /** `<nfeProc>`: a NF-e com o `protNFe`, o XML que se guarda (regra 7). */
  procNFe: 'procNFe_v4.00.xsd',
  /** `<envEvento>` de cancelamento (110111). */
  envEventoCancNFe: 'envEventoCancNFe_v1.00.xsd',
  /** `<envEvento>` de carta de correção (110110). */
  envCCe: 'envCCe_v1.00.xsd',
  /** `<inutNFe>` assinada. */
  inutNFe: 'inutNFe_v4.00.xsd',
  retEnviNFe: 'retEnviNFe_v4.00.xsd',
  retConsReciNFe: 'retConsReciNFe_v4.00.xsd',
  retConsSitNFe: 'retConsSitNFe_v4.00.xsd',
  retConsStatServ: 'retConsStatServ_v4.00.xsd',
  retEnvEventoCancNFe: 'retEnvEventoCancNFe_v1.00.xsd',
  retEnvCCe: 'retEnvCCe_v1.00.xsd',
  retInutNFe: 'retInutNFe_v4.00.xsd',
} as const);
export type EsquemaXsd = keyof typeof ESQUEMAS_XSD;

export interface ResultadoXsd {
  readonly valido: boolean;
  /** Uma linha por violação, sem os valores do documento. Vazio quando `valido`. */
  readonly erros: readonly string[];
}

const PASTA = new URL(`../schemas/${PACOTE_SCHEMAS}/`, import.meta.url);
let arquivos: readonly XMLFileInfo[] | null = null;

/** Lê os `.xsd` uma vez (bytes crus: o `xmldsig-core-schema` vem com BOM). */
function schemas(): readonly XMLFileInfo[] {
  arquivos ??= readdirSync(PASTA)
    .filter((n) => n.endsWith('.xsd'))
    .sort()
    .map((fileName) => ({ fileName, contents: new Uint8Array(readFileSync(new URL(fileName, PASTA))) }));
  return arquivos;
}

const NS_NFE = /\{http:\/\/www\.portalfiscal\.inf\.br\/nfe\}/g;
const NS_DSIG = /\{http:\/\/www\.w3\.org\/2000\/09\/xmldsig#\}/g;

/** Tira do texto do libxml2 os valores do documento (`The value '...'`, `'texto' is not a valid value`). */
function semValores(mensagem: string): string {
  return mensagem
    .replace(NS_NFE, '')
    .replace(NS_DSIG, 'ds:')
    .replace(/[Tt]he value '[^']*'/g, "The value '(omitido)'")
    .replace(/'[^']*' is not a valid value/g, "'(omitido)' is not a valid value")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Valida o XML contra o schema da raiz pedida. Não lança por XML inválido nem mal formado: devolve `valido: false`
 * com os erros (sem valores). Lança só se o esquema pedido não existir. `<!DOCTYPE` é recusado antes do libxml2.
 */
export async function validarXsd(xml: string, esquema: EsquemaXsd): Promise<ResultadoXsd> {
  const entrada = ESQUEMAS_XSD[esquema];
  if (!entrada) throw new RangeError(`validarXsd: esquema desconhecido (${String(esquema)})`);
  const todos = schemas();
  const principal = todos.find((a) => a.fileName === entrada);
  if (!principal) throw new Error(`validarXsd: ${entrada} ausente em schemas/${PACOTE_SCHEMAS}`);
  if (temDoctype(xml)) return { valido: false, erros: ['DOCTYPE não é aceito (a NF-e não usa DTD)'] };
  const r = await validateXML({
    xml: { fileName: 'documento.xml', contents: xml },
    schema: principal,
    preload: todos.filter((a) => a !== principal),
  });
  if (r.valid) return { valido: true, erros: [] };
  // Só as linhas de erro do libxml2: as linhas de contexto que ele imprime repetem trechos do documento.
  const erros = r.errors.map((e) => semValores(e.message)).filter((m) => /\berror\b/i.test(m));
  return { valido: false, erros: erros.length > 0 ? erros : ['documento fora do schema'] };
}
