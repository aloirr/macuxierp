/**
 * Itens da tabela de preço no BKO (T-0123, v0.3.32, lote C): grade editável com o `PUT /v1/cadastros/tabelas-preco/:id/itens` em lote.
 * Parte pura (sem React): a tela declarada, as linhas em texto, a validação por linha (RN-CAD-06, do módulo) e o corpo do lote.
 * Preço em centavos inteiros (o texto em reais vira inteiro pelo módulo, nunca ponto flutuante) e desconto em pontos-base. A API revalida;
 * o PUT só grava o que difere (idempotente), então reenviar o mesmo lote não muda nada. Não remove item: só cria e altera.
 */
import {
  ROTA_TABELA_PRECO, ROTA_TABELAS_PRECO, apiItensPreco, corpoLotePreco, validarItemPreco, type Erros, type Valores,
} from '@macuxierp/cadastros/web';
import { formatarPontosBase, formatarValorCentavos } from '@macuxierp/platform-sdk/formatar';
import type { Perfil } from '@macuxierp/platform-sdk';
import type { TelaQuadro } from '../../descritor/tipos';
import { novaChave } from '../comum';

export const ROTA_ITENS_PRECO = `${ROTA_TABELA_PRECO}/itens`;
/** Rota da tabela (edição do cabeçalho) e a da grade, com o `id` da tabela já preenchido. */
export const rotaDaTabela = (id: string): string => ROTA_TABELA_PRECO.replace(':id', id);
export const rotaDosItens = (id: string): string => ROTA_ITENS_PRECO.replace(':id', id);
export { ROTA_TABELAS_PRECO };

/** Quadro da grade: declara a escrita (PUT em lote) que o shell aceita; o corpo vem de `lotePorLinha`. */
export const TELA_ITENS_PRECO: TelaQuadro = {
  tipo: 'quadro',
  escritas: [{ metodo: 'PUT', caminho: apiItensPreco(':id') }],
  novaChave,
  validarAcao: () => ({ ok: false, erro: 'A grade de preços envia pelo próprio botão Salvar.' }),
};

/** Linha da grade em texto digitado: `chave` é local (a linha nova ainda não tem `id`). */
export interface LinhaPreco { chave: string; filial_id: string; produto_id: string; preco_centavos: string; desconto_maximo_bp: string }
export type ErrosPorLinha = Readonly<Record<string, Erros>>;

const CAMPOS = ['filial_id', 'produto_id', 'preco_centavos', 'desconto_maximo_bp'] as const;
const valoresDe = (l: LinhaPreco): Valores => ({ filial_id: l.filial_id, produto_id: l.produto_id, preco_centavos: l.preco_centavos, desconto_maximo_bp: l.desconto_maximo_bp });

/** Item da lista (centavos e pontos-base inteiros) na linha em texto: "12,50" e "5,5" (sem o %). */
export function linhaDoItem(i: { id: string; filial_id: string; produto_id: string; preco_centavos: number; desconto_maximo_bp: number }): LinhaPreco {
  return {
    chave: i.id, filial_id: i.filial_id, produto_id: i.produto_id, preco_centavos: formatarValorCentavos(i.preco_centavos),
    desconto_maximo_bp: i.desconto_maximo_bp === 0 ? '' : formatarPontosBase(i.desconto_maximo_bp).replace('%', ''),
  };
}

export const linhaVazia = (chave: string): LinhaPreco => ({ chave, filial_id: '', produto_id: '', preco_centavos: '', desconto_maximo_bp: '' });

const mudou = (a: LinhaPreco, o: LinhaPreco | undefined): boolean => o === undefined || CAMPOS.some((c) => a[c].trim() !== o[c].trim());
/** Linha totalmente em branco (a linha nova que ninguém preencheu não entra no lote nem vira erro). */
const vazia = (l: LinhaPreco): boolean => CAMPOS.every((c) => l[c].trim() === '');

export interface LoteDeTela {
  /** Corpo do PUT (só linhas novas ou alteradas); `null` se há erro ou nada a enviar. */
  corpo: { itens: unknown[] } | null;
  /** Erros por `chave` da linha (campo → mensagem); a linha com erro de lote usa o campo `linha`. */
  erros: ErrosPorLinha;
  /** Chave de cada item do corpo, na ordem (para devolver o erro da API à linha certa). */
  chaves: readonly string[];
  /** Nenhuma linha nova ou alterada. */
  nada: boolean;
}

/** Valida linha a linha (regras do módulo) e monta o lote com o que mudou. RN-CAD-06: sem produto repetido na mesma filial. */
export function lotePorLinha(linhas: readonly LinhaPreco[], originais: readonly LinhaPreco[], perfil: Perfil): LoteDeTela {
  const porChave = new Map(originais.map((o) => [o.chave, o]));
  const candidatas = linhas.filter((l) => !vazia(l) && mudou(l, porChave.get(l.chave)));
  const erros: Record<string, Erros> = {};
  for (const l of candidatas) {
    const e = validarItemPreco(valoresDe(l), perfil);
    if (Object.keys(e).length > 0) erros[l.chave] = e;
  }
  if (candidatas.length === 0) return { corpo: null, erros, chaves: [], nada: true };
  if (Object.keys(erros).length > 0) return { corpo: null, erros, chaves: [], nada: false };
  // Repetição conta com TODAS as linhas preenchidas, não só as alteradas (a linha antiga também ocupa a filial e o produto).
  const preenchidas = linhas.filter((l) => !vazia(l));
  const todas = corpoLotePreco(preenchidas.map(valoresDe));
  if (!todas.corpo) {
    for (const [campo, mensagem] of Object.entries(todas.erros)) {
      const n = /^itens\.(\d+)$/.exec(campo)?.[1];
      const l = n === undefined ? undefined : preenchidas[Number(n)];
      if (l) erros[l.chave] = { ...erros[l.chave], linha: mensagem };
    }
    if (Object.keys(erros).length > 0) return { corpo: null, erros, chaves: [], nada: false };
  }
  const lote = corpoLotePreco(candidatas.map(valoresDe));
  return lote.corpo
    ? { corpo: lote.corpo, erros, chaves: candidatas.map((l) => l.chave), nada: false }
    : { corpo: null, erros: { ...erros, [candidatas[0]?.chave ?? '']: { linha: 'Há item com dado inválido' } }, chaves: [], nada: false };
}

/** Erros da API (`itens.N` ou `itens.N.campo`, N = posição no lote enviado) devolvidos à linha da grade. O erro sem posição vai em `geral`. */
export function errosDaApiPorLinha(campos: Readonly<Record<string, string>> | undefined, chaves: readonly string[]): { porLinha: ErrosPorLinha; geral: string | null } {
  const porLinha: Record<string, Erros> = {};
  const gerais: string[] = [];
  for (const [campo, mensagem] of Object.entries(campos ?? {})) {
    const m = /^itens\.(\d+)(?:\.(\w+))?$/.exec(campo);
    const chave = m ? chaves[Number(m[1])] : undefined;
    if (chave === undefined) { gerais.push(mensagem); continue; }
    const alvo = m?.[2] && (CAMPOS as readonly string[]).includes(m[2]) ? m[2] : 'linha';
    porLinha[chave] = { ...porLinha[chave], [alvo]: mensagem };
  }
  return { porLinha, geral: gerais.length > 0 ? gerais.join('; ') : null };
}
