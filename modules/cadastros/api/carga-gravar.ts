/**
 * Gravação das linhas já mapeadas e validadas (C1 da T-0057; extraída de `executarCarga`, T-0026/T-0058). É o único caminho que
 * grava cadastro por lote: a carga de CSV (`executarCarga`) e o worker do lote da `/entrada/v1` (ADR 0014 §1) chamam esta função,
 * sem regra repetida. Confere as referências (banco e lote), grava na ordem D13 com SAVEPOINT por linha (D7) e só no modo `gravar`
 * do estado. Nunca leva o valor de uma célula para o relatório (D9).
 */
import { ErroApi } from '@macuxierp/platform-sdk';
import { ENTIDADES_CARGA, type EntidadeCarga, type LinhasCarga, type ResultadoEntidade } from '../contracts';
import {
  REFS_CARGA, acrescentarIdsDoLote, alvoCriado, conferirReferencias, conferirVigenciaDaTabela, erroLinha, type ErroLinha, type FormaDoLote,
} from '../domain';
import { TRATADORES, planejarEstoque, planejarIrmasDaForma, type Estado, type Saida } from './carga-entidades';
import { tratarCartaoSemParcelas } from './formas-recusadas';
import type { Repositorios, TabelaChave } from './portas';
import { violacaoExternalId } from './util';

type Linha = LinhasCarga[EntidadeCarga];

/** Onde os erros por linha vão: o relatório da carga ou o resultado do lote (quem chama decide). */
export interface DestinoErros {
  erroLinha(arquivo: string, e: ErroLinha): void;
}

/** Uma entidade a gravar: as linhas já mapeadas, no formato de `LinhasCarga`, e o resultado que recebe as contagens. */
export interface ItemGravacao {
  entidade: EntidadeCarga;
  /** Nome que identifica a origem nos erros (o arquivo da carga ou o rótulo do lote). */
  nome: string;
  linhas: Linha[];
  /** Formas de pagamento da condição (T-0058, RN-CAD-09); vazio nas outras entidades. */
  formas: FormaDoLote[];
  resultado: ResultadoEntidade;
}

/** Erro do banco numa linha: o SAVEPOINT já desfez só ela. O tempo esgotado (503) derruba a chamada inteira. */
function erroDeExcecao(linha: number, e: unknown): ErroLinha {
  if (e instanceof ErroApi) {
    if (e.status === 503) throw e;
    if (e.status === 422 && e.codigo === 'RN-CAD-09') return erroLinha(linha, 'parcelas_cartao', 'RN-CAD-09', e.message);
    if (e.status === 409) return erroLinha(linha, null, 'CARGA_CONFLITO', 'Conflito com um cadastro existente (documento, código ou identificador externo)');
  }
  return erroLinha(linha, null, 'CARGA_BANCO', 'Erro do banco ao gravar a linha: nada foi gravado para ela');
}

/**
 * Grava os itens na ordem D13 e fecha as contagens (`recusadas`). `lidas` já vem preenchida em cada `resultado`.
 * Depois de gravar, normaliza o cartão sem parcelas (RN-CAD-09) e avisa os preços sem desconto máximo (RN-CAD-11).
 */
export async function gravarLinhas(st: Estado, itens: readonly ItemGravacao[], rel: DestinoErros): Promise<void> {
  const { c, r } = st;
  for (const entidade of ENTIDADES_CARGA) {
    const a = itens.find((x) => x.entidade === entidade);
    if (!a) continue;
    await carregarReferencias(st, entidade, a.linhas);
    const ref = conferirReferencias(entidade, a.linhas as never[], st.conhecidos) as { validas: Linha[]; erros: ErroLinha[] };
    ref.erros.forEach((e) => rel.erroLinha(a.nome, e));
    let linhas = ref.validas;
    if (entidade === 'preco') {
      const vig = conferirVigenciaDaTabela(linhas as LinhasCarga['preco'][]);
      vig.forEach((e) => rel.erroLinha(a.nome, e));
      const ruins = new Set(vig.map((e) => e.linha));
      linhas = linhas.filter((l) => !ruins.has(l.linha));
    }
    const boas: Linha[] = [];
    const avisos = new Set<string>();
    const contar = (efeito: 'inserida' | 'atualizada' | 'sem_mudanca', n = 1) => {
      if (efeito === 'inserida') a.resultado.inseridas += n;
      else if (efeito === 'atualizada') a.resultado.atualizadas += n;
      else a.resultado.sem_mudanca += n;
    };
    const executar = async (saida: Saida, numeros: number[], externo: string | undefined): Promise<boolean> => {
      // Cliente com várias linhas (T-0058): o erro do cliente sai na 1ª linha dele; as outras linhas contam como recusadas.
      const alvosDoErro = entidade === 'cliente' ? numeros.slice(0, 1) : numeros;
      if ('erros' in saida) {
        for (const e of saida.erros) for (const n of alvosDoErro) rel.erroLinha(a.nome, { ...e, linha: n });
        return false;
      }
      const parciais = saida.errosParciais ?? [];
      parciais.forEach((e) => rel.erroLinha(a.nome, e));
      const recusadasDoGrupo = new Set(parciais.map((e) => e.linha));
      let id = saida.alvo?.id;
      if (st.gravar && saida.aplicar) {
        try {
          const aplicar = saida.aplicar;
          const novo = await r.carga.comSavepoint(() => aplicar());
          if (typeof novo === 'string') id = novo;
        } catch (e) {
          const erro = erroDeExcecao(numeros[0] as number, e);
          for (const n of alvosDoErro) rel.erroLinha(a.nome, { ...erro, linha: n });
          return false;
        }
      } else if (saida.efeito === 'inserida') id = '';
      const alvo = alvoCriado(entidade);
      if (alvo && id !== undefined && externo !== undefined) st.ids[alvo].set(externo, id);
      contar(saida.efeito, numeros.filter((n) => !recusadasDoGrupo.has(n)).length);
      return true;
    };
    if (entidade === 'estoque') {
      const porLinha = new Map(linhas.map((l) => [l.linha, l]));
      for (const g of await planejarEstoque(linhas as LinhasCarga['estoque'][], st)) {
        if (await executar(g.saida, g.linhas, undefined)) for (const n of g.linhas) boas.push(porLinha.get(n) as Linha);
      }
    } else {
      if (entidade === 'condicao_pagamento') {
        for (const f of a.formas) {
          const plano = await planejarIrmasDaForma(f, st);
          plano.erros.forEach((e) => rel.erroLinha(a.nome, e));
          plano.avisos.forEach((x) => avisos.add(x));
          if (st.gravar && plano.aplicar && plano.erros.length === 0) {
            try {
              const aplicar = plano.aplicar;
              await r.carga.comSavepoint(() => aplicar());
            } catch (e) {
              rel.erroLinha(a.nome, { ...erroDeExcecao(f.linha, e), linha: f.linha });
            }
          }
        }
      }
      for (const l of linhas) {
        const tratar = TRATADORES[entidade] as (l: Linha, st: Estado) => Promise<Saida>;
        const colisao = await colisaoComId(r, entidade, l.external_id);
        const ok = await executar(colisao ?? (await tratar(l, st)), (l as { linhas?: number[] }).linhas ?? [l.linha], l.external_id);
        l.avisos.forEach((x) => avisos.add(x));
        if (ok) boas.push(l);
      }
    }
    acrescentarIdsDoLote(st.conhecidos, entidade, boas as never[]);
    a.resultado.avisos = [...avisos].map((x) => x.slice(0, 200)).slice(0, 50);
  }
  const arquivoPreco = itens.find((x) => x.entidade === 'preco');
  if (arquivoPreco && st.precosSemDesconto > 0) {
    arquivoPreco.resultado.avisos.push(`${st.precosSemDesconto} item(ns) de preço sem desconto máximo (nem no produto nem no preço)`);
  }
  if (st.gravar) {
    // RN-CAD-09: nada fica "cartão sem parcelas" (preenche quando os prazos são 30×N; senão desativa).
    const limpeza = await tratarCartaoSemParcelas(c, r, await r.carga.condicoesAtivasCartaoSemParcelas());
    const destino = itens.find((x) => x.entidade === 'condicao_pagamento');
    if (destino && limpeza.preenchidas.total + limpeza.desativadas.total > 0) {
      destino.resultado.avisos.push(`Cartão sem parcelas: ${limpeza.preenchidas.total} preenchida(s), ${limpeza.desativadas.total} desativada(s)`);
    }
  }
  for (const a of itens) a.resultado.recusadas = Math.max(0, a.resultado.lidas - a.resultado.inseridas - a.resultado.atualizadas - a.resultado.sem_mudanca);
}

/** Tabela de cada entidade da carga que grava `external_id` (o estoque não tem tabela própria). */
const TABELA_DA_ENTIDADE: Partial<Record<EntidadeCarga, TabelaChave>> = {
  filial: 'filial', vendedor: 'vendedor', condicao_pagamento: 'condicao_pagamento', produto: 'produto', cliente: 'cliente', produto_unidade: 'produto_unidade', preco: 'tabela_preco_item',
};

/** Guarda RD-0317 (ver domain/external-id.ts): vira `CARGA_CONFLITO` da linha. */
async function colisaoComId(r: Repositorios, entidade: EntidadeCarga, externalId: unknown): Promise<Saida | null> {
  const tabela = TABELA_DA_ENTIDADE[entidade];
  const v = tabela ? await violacaoExternalId(r, tabela, externalId) : null;
  return v ? { erros: [erroLinha(0, 'external_id', 'CARGA_CONFLITO', v.mensagem)] } : null;
}

/** Referências que a entidade cita e ainda não são conhecidas (nem do lote, nem do banco): uma consulta por alvo. */
async function carregarReferencias(st: Estado, entidade: EntidadeCarga, linhas: readonly Linha[]): Promise<void> {
  for (const [campo, alvo] of Object.entries(REFS_CARGA[entidade])) {
    const faltam = new Set<string>();
    for (const l of linhas) {
      const v = ((l as { refs?: Record<string, string | undefined> }).refs ?? {})[campo];
      if (v !== undefined && !st.conhecidos[alvo].has(v)) faltam.add(v);
    }
    if (faltam.size === 0) continue;
    for (const [ext, id] of await st.r.chaves.idsPorExternalId(alvo, [...faltam], true)) {
      st.ids[alvo].set(ext, id);
      st.conhecidos[alvo].add(ext);
    }
  }
}

