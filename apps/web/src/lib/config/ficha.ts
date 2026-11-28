import type { FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { formatarDataHora } from '@macuxierp/platform-sdk';

/** Ficha da empresa pela Receita (T-0101): textos da aba Empresa. Só dado da ficha MASCARADA; nada vai a log. O formulário editável (RN-CORE-16) fica em `ficha-edicao.ts`. */

/** "4781400" → "4781-4/00"; fora de 7 dígitos, como veio. */
export const formatarCnae = (c: string): string => (/^\d{7}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4, 5)}/${c.slice(5)}` : c);

/** Texto de um CNAE: "4781-4/00 · Descrição" (a descrição como a tabela oficial traz); sem descrição, só o código formatado. */
export function textoCnae(codigo: string, descricao?: string | null): string {
  const d = descricao?.trim();
  return d ? `${formatarCnae(codigo)} · ${d}` : formatarCnae(codigo);
}

/** Os CNAE secundários no campo da ficha: um por linha, formatados ("4781-4/00"); a edição aceita com ou sem máscara. */
export const cnaesSecundariosNoCampo = (codigos: readonly string[] | null | undefined): string => (codigos ?? []).map(formatarCnae).join('\n');

/** A descrição dos CNAE secundários sob o campo: só os que têm descrição (o código já está no campo, formatado; T-0134). */
export function textosCnaeSecundarios(f: Pick<FichaReceitaPlanaMascarada, 'cnae_secundarios_descritos'>): string[] {
  return (f.cnae_secundarios_descritos ?? []).filter((c) => c.descricao?.trim()).map((c) => textoCnae(c.codigo, c.descricao));
}

export type EstadoFicha = 'nunca' | 'sem_dados' | 'com_dados';

/**
 * Três estados (RD-2201): nunca consultada (sem ficha ou sem data da consulta); consultada sem dados (data preenchida e todo
 * campo de dado vazio; `receita_fonte` e `receita_consultada_em` são metadado); com dados.
 */
export function estadoDaFicha(f: FichaReceitaPlanaMascarada | null): EstadoFicha {
  if (!f || !f.receita_consultada_em) return 'nunca';
  const { receita_fonte: fonte, receita_consultada_em: consultadaEm, ...dados } = f;
  void fonte;
  void consultadaEm;
  const vazio = Object.values(dados).every((v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0));
  return vazio ? 'sem_dados' : 'com_dados';
}

/** Texto do estado vazio da ficha, por estado. */
export const TEXTO_FICHA_VAZIA: Record<Exclude<EstadoFicha, 'com_dados'>, string> = {
  nunca: 'Ainda não consultada.',
  sem_dados: 'Sem dados na Receita.',
};

/** "Consultada em 24/11/2026 12:00", no fuso da empresa; sem a data, nada. */
export const origemDaConsulta = (f: FichaReceitaPlanaMascarada, fuso: string): string | null => (f.receita_consultada_em ? `Consultada em ${formatarDataHora(f.receita_consultada_em, fuso)}` : null);
