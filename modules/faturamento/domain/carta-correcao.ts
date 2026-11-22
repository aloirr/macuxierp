import type { StatusNota } from '../contracts';
import { violacao, type Violacao } from './violacao';

export const TAMANHO_TEXTO_CCE = { min: 15, max: 1000 } as const;
export const MAX_SEQUENCIA_CCE = 20;

export interface EntradaCartaCorrecao {
  status: StatusNota;
  texto: string;
  /** nSeqEvento das CC-e já registradas para a nota. */
  sequenciasRegistradas: readonly number[];
}

export type GrupoAviso = 'valor' | 'dados_parte' | 'data';
export interface AvisoCartaCorrecao { grupo: GrupoAviso; palavra: string; mensagem: string }

const PALAVRAS: ReadonlyArray<{ grupo: GrupoAviso; mensagem: string; re: RegExp }> = [
  { grupo: 'valor', mensagem: 'A CC-e não corrige valores (base, alíquota, imposto, quantidade, preço, total).', re: /\b(valor(?:es)?|base de calculo|aliquotas?|imposto|icms|ipi|pis|cofins|ibs|cbs|quantidades?|qtd|preco|total)\b/ },
  { grupo: 'dados_parte', mensagem: 'A CC-e não corrige dado cadastral que mude o remetente ou o destinatário.', re: /\b(razao social|cnpj|cpf|inscricao estadual|destinatario|remetente|emitente)\b/ },
  { grupo: 'data', mensagem: 'A CC-e não corrige a data de emissão nem a de saída.', re: /\b(data de emissao|data de saida|emissao|dhemi|dhsaient)\b/ },
];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Orientação por palavra-chave (o texto é livre, então nunca bloqueia): um aviso por grupo, com a primeira palavra achada. */
export function avisosCartaCorrecao(texto: string): AvisoCartaCorrecao[] {
  const t = semAcento(texto);
  const avisos: AvisoCartaCorrecao[] = [];
  for (const p of PALAVRAS) {
    const m = p.re.exec(t);
    if (m) avisos.push({ grupo: p.grupo, palavra: m[0], mensagem: p.mensagem });
  }
  return avisos;
}

export const proximaSequenciaCce = (registradas: readonly number[]): number => (registradas.length ? Math.max(...registradas) : 0) + 1;

export function validarCartaCorrecao(e: EntradaCartaCorrecao): Violacao[] {
  const v: Violacao[] = [];
  if (e.status === 'cancelada') v.push(violacao('RN-FAT-02', 'status', 'Nota cancelada não recebe carta de correção.'));
  else if (e.status !== 'autorizada') v.push(violacao('RN-FAT-02', 'status', `Só nota autorizada recebe carta de correção (status atual: ${e.status}).`));
  const t = e.texto.trim().length;
  if (t < TAMANHO_TEXTO_CCE.min || t > TAMANHO_TEXTO_CCE.max)
    v.push(violacao('RN-FAT-02', 'texto', `O texto da correção deve ter de ${TAMANHO_TEXTO_CCE.min} a ${TAMANHO_TEXTO_CCE.max} caracteres.`));
  if (proximaSequenciaCce(e.sequenciasRegistradas) > MAX_SEQUENCIA_CCE)
    v.push(violacao('RN-FAT-02', 'nSeqEvento', `Limite de ${MAX_SEQUENCIA_CCE} cartas de correção por nota atingido.`));
  return v;
}
