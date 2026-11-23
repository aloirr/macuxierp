/**
 * T-0058, RN-CAD-09: condição e forma de pagamento na mesma linha do condicoes_pagamento.csv. A forma (código, nome, tPag) é
 * criada ou atualizada pela 1ª linha que a traz; outra linha da mesma forma com dado diferente é recusada. Funções puras.
 */
import type { LinhaCondicaoPagamento } from '../../contracts';
import { erroLinha, type ErroLinha } from './erros';

export interface FormaDoLote {
  /** `forma_external_id` ou, sem ele, `codigo:<forma_codigo em maiúsculas>`. */
  chave: string;
  external_id?: string;
  codigo?: string;
  nome?: string;
  tpag?: string;
  /** 1ª linha que trouxe dado da forma. */
  linha: number;
  /** `external_id` das condições do arquivo que usam a forma. */
  condicoes: string[];
}

const chaveDaForma = (l: LinhaCondicaoPagamento): string | undefined =>
  l.dados.forma_external_id ?? (l.dados.forma_codigo === undefined ? undefined : `codigo:${l.dados.forma_codigo.toUpperCase()}`);

const CAMPOS = [['forma_codigo', 'codigo'], ['forma_nome', 'nome'], ['forma_tpag', 'tpag']] as const;

/** Os campos `forma_*` que a forma já tem (os que faltam não entram). */
export const dadosDaForma = (f: Pick<FormaDoLote, 'codigo' | 'nome' | 'tpag'>): { forma_codigo?: string; forma_nome?: string; forma_tpag?: string } => ({
  ...(f.codigo === undefined ? {} : { forma_codigo: f.codigo }),
  ...(f.nome === undefined ? {} : { forma_nome: f.nome }),
  ...(f.tpag === undefined ? {} : { forma_tpag: f.tpag }),
});

/** Confere as formas do arquivo e completa cada linha com os dados da forma (as linhas recusadas saem de `linhas`). */
export function conferirFormasDoLote(linhas: readonly LinhaCondicaoPagamento[]): { linhas: LinhaCondicaoPagamento[]; formas: FormaDoLote[]; erros: ErroLinha[] } {
  const formas = new Map<string, FormaDoLote>();
  const erros: ErroLinha[] = [];
  const bons: LinhaCondicaoPagamento[] = [];
  for (const l of linhas) {
    const chave = chaveDaForma(l);
    if (chave === undefined) {
      bons.push(l);
      continue;
    }
    let f = formas.get(chave);
    if (!f) {
      f = { chave, linha: l.linha, condicoes: [] };
      if (l.dados.forma_external_id !== undefined) f.external_id = l.dados.forma_external_id;
      formas.set(chave, f);
    }
    const igual = (campo: (typeof CAMPOS)[number]): boolean => {
      const novo = l.dados[campo[0]];
      const atual = f[campo[1]];
      return novo === undefined || atual === undefined || (campo[0] === 'forma_codigo' ? novo.toUpperCase() === atual.toUpperCase() : novo === atual);
    };
    const diferente = CAMPOS.find((c) => !igual(c));
    if (diferente) {
      erros.push(erroLinha(l.linha, diferente[0], 'CARGA_CONFLITO', `Dados da forma diferentes da linha ${f.linha}: deixe iguais em todas as linhas da forma`));
      continue;
    }
    const semDado = CAMPOS.every((c) => f[c[1]] === undefined);
    for (const c of CAMPOS) {
      const novo = l.dados[c[0]];
      if (f[c[1]] === undefined && novo !== undefined) f[c[1]] = novo;
    }
    if (semDado && CAMPOS.some((c) => l.dados[c[0]] !== undefined)) f.linha = l.linha;
    f.condicoes.push(l.external_id);
    bons.push({
      ...l,
      dados: { ...l.dados, ...dadosDaForma(f) },
    });
  }
  return { linhas: bons, formas: [...formas.values()], erros };
}
