/**
 * Identificadores e textos fixos dos eventos (110110, 110111, 110140) e da inutilização (Manual de Orientação do
 * Contribuinte; leiaute dos eventos 1.00 e da inutilização 4.00). Fonte única para quem monta (emissor, T-0018),
 * para quem confere (simulador) e para os documentos de teste: ninguém refaz o `Id`.
 */
import { ErroSefaz } from './erros';
import { TIPO_EVENTO, type TipoEvento } from './porta';
import { filhoNfe, lerXml, textoNfe } from './xmldsig';

/** `descEvento` de cada evento, como o schema exige (sem acento). */
export const DESC_EVENTO = Object.freeze({
  [TIPO_EVENTO.cancelamento]: 'Cancelamento',
  [TIPO_EVENTO.cartaCorrecao]: 'Carta de Correcao',
  [TIPO_EVENTO.epec]: 'EPEC',
} as const satisfies Record<TipoEvento, string>);

/** `xCondUso` da CC-e: texto fixo do leiaute (o schema só aceita este, sem acento). */
export const X_COND_USO_CCE =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para ' +
  'regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que ' +
  'determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; ' +
  'II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

/** `Id` do `infEvento`: `ID` + tpEvento(6) + chave(44) + nSeqEvento(2). */
export function idEvento(tpEvento: TipoEvento, chNFe: string, nSeqEvento: number): string {
  return `ID${tpEvento}${chNFe}${String(nSeqEvento).padStart(2, '0')}`;
}

export interface CamposIdInutilizacao {
  cUF: number;
  /** Ano com 2 dígitos. */
  ano: string;
  cnpj: string;
  serie: number;
  nNFIni: number;
  nNFFin: number;
}

/** `Id` do `infInut`: `ID` + cUF(2) + ano(2) + CNPJ(14) + mod(2) + serie(3) + nNFIni(9) + nNFFin(9). */
export function idInutilizacao(c: CamposIdInutilizacao): string {
  const n = (v: number, t: number) => String(v).padStart(t, '0');
  return `ID${n(c.cUF, 2)}${c.ano}${c.cnpj}55${n(c.serie, 3)}${n(c.nNFIni, 9)}${n(c.nNFFin, 9)}`;
}

/**
 * O `tpEvento` do `<evento>` é o da operação chamada (`cancelar` → 110111, `cartaCorrecao` → 110110, `epec` → 110140)? Senão, é erro de
 * quem chama (`SEFAZ_PEDIDO_INVALIDO`), não rejeição. XML ilegível ou sem `tpEvento` passa: o schema decide (215).
 */
export function garantirTipoEvento(eventoXml: string, esperado: TipoEvento): void {
  const tpEvento = textoNfe(filhoNfe(lerXml(eventoXml)?.documentElement, 'infEvento'), 'tpEvento');
  if (tpEvento && tpEvento !== esperado) {
    throw new ErroSefaz('SEFAZ_PEDIDO_INVALIDO', `Evento ${tpEvento} enviado pela operação do evento ${esperado}`);
  }
}
