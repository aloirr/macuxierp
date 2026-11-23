import { ArquivoRecebido, lerCsv } from '@macuxierp/platform-sdk';
import { LAYOUT } from '../domain';
import type { EntidadeCarga } from '../contracts';

/** Lê o CSV com as colunas do layout do cadastro (usadas e ignoradas) e as obrigatórias: um só lugar para a carga do BKO, do CLI e do portal. */
export function lerCsvDoLayout(cadastro: EntidadeCarga, conteudo: Buffer | string): ReturnType<typeof lerCsv> {
  const layout = LAYOUT[cadastro];
  return lerCsv(conteudo, { aceitas: [...layout.usadas, ...layout.ignoradas], obrigatorias: layout.obrigatorias });
}

const aspar = (c: string, sep: string): string => (/["\r\n]/.test(c) || c.includes(sep) ? `"${c.replace(/"/g, '""')}"` : c);

/**
 * Ponto comum de TODA carga (portal, BKO e CLI), chamado no começo do `executarCarga` (decisão do PO, 23/11 15h49: vale no
 * adicionar e no substituir_tudo). O arquivo é a lista do que fica ATIVO. Linha com `ativo` vazio (ou arquivo sem a coluna) passa a
 * `ativo=sim`, para que um cadastro inativado por um Substituir tudo anterior volte a ser reativado (mesmo external_id, uma linha
 * só; RN-CAD-08/10, D6). `ativo` explícito (sim ou não) é respeitado. Preserva a numeração das linhas (erros citam a linha).
 * Layout sem `ativo` (estoque) e CSV ilegível ficam como vieram (o executarCarga recusa o ilegível).
 */
export function reativarPorPadrao(cadastro: EntidadeCarga, a: ArquivoRecebido): ArquivoRecebido {
  const layout = LAYOUT[cadastro];
  if (!layout.usadas.includes('ativo')) return a;
  const lido = lerCsvDoLayout(cadastro, a.conteudo());
  if (!lido.ok) return a;
  const sep = lido.separador;
  const colunas = lido.colunas.includes('ativo') ? lido.colunas : [...lido.colunas, 'ativo'];
  const saida: string[] = [colunas.map((c) => aspar(c, sep)).join(sep)];
  let linhaAtual = 2;
  for (const l of lido.linhas) {
    while (linhaAtual < l.numero) { saida.push(''); linhaAtual += 1; }
    const celulas = colunas.map((c) => (c === 'ativo' && (l.celulas.ativo ?? '') === '' ? 'sim' : (l.celulas[c] ?? '')));
    const linha = celulas.map((c) => aspar(c, sep)).join(sep);
    saida.push(linha);
    linhaAtual += 1 + (linha.match(/\n/g)?.length ?? 0);
  }
  return new ArquivoRecebido(a.campo, a.nome, a.tipo, Buffer.from(`${saida.join('\n')}\n`, 'utf8'));
}
