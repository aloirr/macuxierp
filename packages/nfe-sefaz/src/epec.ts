/**
 * Dados da EPEC (evento 110140, leiaute `leiauteEPEC_v1.00`, Manual de Orientação do Contribuinte): o resumo da NF-e
 * que vai ao Ambiente Nacional antes da nota. Fonte única para quem monta o evento a partir da NF-e (emissor) e para
 * quem confere a NF-e transmitida na volta contra o evento registrado (simulador; na SEFAZ real, rejeição 467).
 * ADR 0011. Só leitura de XML: nada de log (o `dest` traz CPF/CNPJ do destinatário).
 */
import { TIPO_EVENTO } from './porta';
import { filhoNfe, lerXml, textoNfe } from './xmldsig';

/** Documento do destinatário no `dest` da EPEC (o `choice` do leiaute). */
export interface DocumentoDestEpec {
  readonly tag: 'CNPJ' | 'CPF' | 'idEstrangeiro';
  readonly valor: string;
}

/** O que a EPEC resume da NF-e, como texto do XML (os valores com 2 casas, como na NF-e). */
export interface DadosEpec {
  readonly chNFe: string;
  readonly tpAmb: string;
  /** CNPJ do emitente (autor do evento). */
  readonly cnpj: string;
  /** `cUF` do emitente (vai no `cOrgaoAutor`). */
  readonly cOrgaoAutor: string;
  /** `verProc` da NF-e (vai no `verAplic` do evento; não é conferido na volta). */
  readonly verAplic: string;
  readonly dhEmi: string;
  readonly tpNF: string;
  /** IE do emitente. */
  readonly IE: string;
  readonly dest: { readonly UF: string; readonly documento: DocumentoDestEpec; readonly IE: string | null };
  readonly vNF: string;
  readonly vICMS: string;
  readonly vST: string;
}

function documentoDe(pai: Element | null | undefined): DocumentoDestEpec | null {
  for (const tag of ['CNPJ', 'CPF', 'idEstrangeiro'] as const) {
    const el = filhoNfe(pai, tag);
    if (el) return { tag, valor: el.textContent ?? '' };
  }
  return null;
}

/**
 * Lê da NF-e (assinada ou não) os dados da EPEC. `null` se o XML não for uma NF-e legível, sem `dest`, sem documento
 * do destinatário ou sem o total. Não confere o `tpEmis` (quem monta confere: `tpEmisDaNFe`).
 */
export function dadosEpecDaNFe(nfeXml: string): DadosEpec | null {
  const raiz = lerXml(nfeXml)?.documentElement;
  const inf = filhoNfe(raiz, 'infNFe');
  const ide = filhoNfe(inf, 'ide');
  const emit = filhoNfe(inf, 'emit');
  const dest = filhoNfe(inf, 'dest');
  const tot = filhoNfe(filhoNfe(inf, 'total'), 'ICMSTot');
  const documento = documentoDe(dest);
  if (!inf || !ide || !emit || !dest || !tot || !documento) return null;
  const ieDest = textoNfe(dest, 'IE');
  return {
    chNFe: (inf.getAttribute('Id') ?? '').replace(/^NFe/, ''),
    tpAmb: textoNfe(ide, 'tpAmb'),
    cnpj: textoNfe(emit, 'CNPJ'),
    cOrgaoAutor: textoNfe(ide, 'cUF'),
    verAplic: textoNfe(ide, 'verProc'),
    dhEmi: textoNfe(ide, 'dhEmi'),
    tpNF: textoNfe(ide, 'tpNF'),
    IE: textoNfe(emit, 'IE'),
    dest: { UF: textoNfe(dest, 'enderDest', 'UF'), documento, IE: ieDest || null },
    vNF: textoNfe(tot, 'vNF'),
    vICMS: textoNfe(tot, 'vICMS'),
    vST: textoNfe(tot, 'vST'),
  };
}

/** `tpEmis` do `ide` da NF-e (0 se ausente ou ilegível). */
export function tpEmisDaNFe(nfeXml: string): number {
  return Number(textoNfe(filhoNfe(filhoNfe(lerXml(nfeXml)?.documentElement, 'infNFe'), 'ide'), 'tpEmis')) || 0;
}

/** Lê do `<evento>` 110140 os mesmos dados. `null` se não for um evento EPEC legível. */
export function dadosEpecDoEvento(eventoXml: string): DadosEpec | null {
  const inf = filhoNfe(lerXml(eventoXml)?.documentElement, 'infEvento');
  const det = filhoNfe(inf, 'detEvento');
  const dest = filhoNfe(det, 'dest');
  const documento = documentoDe(dest);
  if (!inf || !det || !dest || !documento || textoNfe(inf, 'tpEvento') !== TIPO_EVENTO.epec) return null;
  const ieDest = textoNfe(dest, 'IE');
  return {
    chNFe: textoNfe(inf, 'chNFe'),
    tpAmb: textoNfe(inf, 'tpAmb'),
    cnpj: textoNfe(inf, 'CNPJ'),
    cOrgaoAutor: textoNfe(det, 'cOrgaoAutor'),
    verAplic: textoNfe(det, 'verAplic'),
    dhEmi: textoNfe(det, 'dhEmi'),
    tpNF: textoNfe(det, 'tpNF'),
    IE: textoNfe(det, 'IE'),
    dest: { UF: textoNfe(dest, 'UF'), documento, IE: ieDest || null },
    vNF: textoNfe(dest, 'vNF'),
    vICMS: textoNfe(dest, 'vICMS'),
    vST: textoNfe(dest, 'vST'),
  };
}

/**
 * Campos em que a NF-e diverge da EPEC registrada (vazio = confere). Compara tudo o que a EPEC resume, menos o
 * `verAplic`. Só os NOMES dos campos, nunca os valores (o destinatário é dado pessoal).
 */
export function divergenciasEpec(nfe: DadosEpec, epec: DadosEpec): string[] {
  const pares: Array<[string, string | null, string | null]> = [
    ['chNFe', nfe.chNFe, epec.chNFe],
    ['tpAmb', nfe.tpAmb, epec.tpAmb],
    ['CNPJ', nfe.cnpj, epec.cnpj],
    ['cOrgaoAutor', nfe.cOrgaoAutor, epec.cOrgaoAutor],
    ['dhEmi', nfe.dhEmi, epec.dhEmi],
    ['tpNF', nfe.tpNF, epec.tpNF],
    ['IE', nfe.IE, epec.IE],
    ['dest.UF', nfe.dest.UF, epec.dest.UF],
    ['dest.documento', `${nfe.dest.documento.tag}:${nfe.dest.documento.valor}`, `${epec.dest.documento.tag}:${epec.dest.documento.valor}`],
    ['dest.IE', nfe.dest.IE, epec.dest.IE],
    ['vNF', nfe.vNF, epec.vNF],
    ['vICMS', nfe.vICMS, epec.vICMS],
    ['vST', nfe.vST, epec.vST],
  ];
  return pares.filter(([, a, b]) => a !== b).map(([campo]) => campo);
}
