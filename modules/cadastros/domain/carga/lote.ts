import type { LinhaEstoque, LinhaPreco } from '../../contracts';
import { aplicarMovimento } from '../estoque';
import { erroDeViolacao, erroLinha, type ErroLinha } from './erros';

/** RN-CAD-07: o arquivo é a foto completa; o saldo de (filial, produto) é a soma das linhas (depósitos do kit). */
export function somarSaldos(linhas: readonly LinhaEstoque[]): { filial: string | undefined; produto: string; saldo: number; linhas: number[] }[] {
  const mapa = new Map<string, { filial: string | undefined; produto: string; saldo: number; linhas: number[] }>();
  for (const l of linhas) {
    const produto = l.refs.produto as string;
    const chave = `${l.refs.filial ?? ''}|${produto}`;
    const g = mapa.get(chave) ?? { filial: l.refs.filial, produto, saldo: 0, linhas: [] };
    g.saldo += l.saldo;
    g.linhas.push(l.linha);
    mapa.set(chave, g);
  }
  return [...mapa.values()];
}

/** RN-CAD-07: diferença para o saldo atual vira `ajuste` (0 = sem mudança); saldo negativo exige `podeNegativo` (D8). */
export function ajusteDeCarga(p: { atual: number; novo: number; podeNegativo: boolean; linha: number }): { ok: true; delta: number } | { ok: false; erro: ErroLinha } {
  if (p.novo < 0 && !p.podeNegativo) {
    const r = aplicarMovimento({ saldo: 0, tipo: 'ajuste', quantidade: p.novo, podeNegativo: false });
    return r.ok ? { ok: true, delta: 0 } : { ok: false, erro: erroDeViolacao(p.linha, r.violacao, 'saldo') };
  }
  return { ok: true, delta: p.novo - p.atual };
}

/** RN-CAD-06: a vigência é da tabela; linha com vigência diferente das outras da mesma tabela é recusada. */
export function conferirVigenciaDaTabela(linhas: readonly LinhaPreco[]): ErroLinha[] {
  const primeira = new Map<string, LinhaPreco['tabela']>();
  const erros: ErroLinha[] = [];
  for (const l of linhas) {
    const ref = primeira.get(l.tabela.external_id);
    if (!ref) primeira.set(l.tabela.external_id, l.tabela);
    else if (ref.vigencia_inicio !== l.tabela.vigencia_inicio || ref.vigencia_fim !== l.tabela.vigencia_fim) {
      erros.push(erroLinha(l.linha, 'vigencia_inicio', 'RN-CAD-06', 'Vigência diferente das outras linhas da mesma tabela'));
    }
  }
  return erros;
}
