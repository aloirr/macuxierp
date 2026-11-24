/**
 * Gravação das linhas internas já mapeadas e validadas (T-0026; ADR 0014 §1). Ponto comum das duas entradas: a carga de CSV
 * (`executarCarga`, depois de ler e mapear) e a /entrada/v1 (`adaptarLote` do domain, pelo worker). Faz: agrupamento do cliente,
 * duplicados, forma da condição (RN-CAD-09), referências (banco e lote), vigência do preço, diferença, SAVEPOINT por linha,
 * aplicar, contagens e limpeza do cartão sem parcelas, na ordem D13. A transação é a do contexto. Os erros levam linha, campo,
 * código e motivo, nunca o valor do dado (LGPD).
 */
import { ErroApi, pode, type ContextoRota } from '@macuxierp/platform-sdk';
import { ENTIDADES_CARGA, type EntidadeCarga, type LinhasCarga, type ModoCarga } from '../contracts';
import {
  REFS_CARGA, acrescentarIdsDoLote, agruparClientes, alvoCriado, conferirFormasDoLote, conferirReferencias, conferirVigenciaDaTabela,
  erroLinha, idsVazios, separarDuplicados, type ErroLinha, type FormaDoLote,
} from '../domain';
import { TRATADORES, estadoVazio, planejarEstoque, planejarIrmasDaForma, type Estado, type Saida } from './carga-entidades';
import { tratarCartaoSemParcelas } from './formas-recusadas';
import type { Dependencias, Repositorios, TabelaChave } from './portas';
import { dataIso, violacaoExternalId } from './util';

type Linha = LinhasCarga[EntidadeCarga];

/** Linhas mapeadas de uma entidade, na ordem do lote (as de `mapearLinha` da carga ou as `linhas` de `adaptarLote`). */
export interface EntradaGravacao {
  entidade: EntidadeCarga;
  linhas: readonly Linha[];
}

export interface ResultadoGravacao {
  inseridas: number;
  atualizadas: number;
  sem_mudanca: number;
  avisos: string[];
}

export interface ErroGravacao {
  entidade: EntidadeCarga;
  erro: ErroLinha;
}

export interface SaidaGravacao {
  /** Uma chave por entidade recebida. */
  resultados: Partial<Record<EntidadeCarga, ResultadoGravacao>>;
  /** Erros por linha, na ordem em que surgiram (agrupamento primeiro; depois a gravação, na ordem D13). */
  erros: ErroGravacao[];
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
 * `entradas` na ordem em que os erros devem sair; a gravação segue a ordem D13 (`ENTIDADES_CARGA`). Em `validar` nada é aplicado.
 * `loteId` identifica o lote nas linhas gravadas (o mesmo da auditoria do chamador).
 */
export async function gravarLinhas(
  deps: Dependencias, c: ContextoRota, modo: ModoCarga, loteId: string, entradas: readonly EntradaGravacao[],
): Promise<SaidaGravacao> {
  const r = deps.repositorios(c.tx);
  const hoje = dataIso(c.agora);
  const saida: SaidaGravacao = { resultados: {}, erros: [] };
  const erro = (entidade: EntidadeCarga, e: ErroLinha): void => { saida.erros.push({ entidade, erro: e }); };
  const st = estadoVazio({
    c, r, gravar: modo === 'gravar', hoje, loteId, conhecidos: idsVazios(),
    podeCredito: pode(c.sessao.perfil, 'cadastros.cliente.credito'), podeNegativo: pode(c.sessao.perfil, 'cadastros.estoque.negativo'),
  });

  // 1. Agrupamento (T-0058): cliente (uma linha por endereço), duplicados e forma da condição (RN-CAD-09).
  const preparadas = new Map<EntidadeCarga, { linhas: Linha[]; formas: FormaDoLote[] }>();
  for (const e of entradas) {
    saida.resultados[e.entidade] = { inseridas: 0, atualizadas: 0, sem_mudanca: 0, avisos: [] };
    if (e.entidade === 'cliente') {
      const g = agruparClientes(e.linhas as LinhasCarga['cliente'][]);
      g.erros.forEach((x) => erro(e.entidade, x));
      preparadas.set(e.entidade, { linhas: g.clientes, formas: [] });
      continue;
    }
    const { unicas, erros: dup } = separarDuplicados([...e.linhas]);
    dup.forEach((x) => erro(e.entidade, x));
    if (e.entidade === 'condicao_pagamento') {
      // A forma vem na linha da condição; a 1ª linha que a traz vale para as outras da mesma forma.
      const f = conferirFormasDoLote(unicas as LinhasCarga['condicao_pagamento'][]);
      f.erros.forEach((x) => erro(e.entidade, x));
      preparadas.set(e.entidade, { linhas: f.linhas, formas: f.formas });
    } else preparadas.set(e.entidade, { linhas: unicas, formas: [] });
  }

  // 2. Referências e gravação na ordem D13.
  for (const entidade of ENTIDADES_CARGA) {
    const a = preparadas.get(entidade);
    const res = saida.resultados[entidade];
    if (!a || !res) continue;
    await carregarReferencias(st, entidade, a.linhas);
    const ref = conferirReferencias(entidade, a.linhas as never[], st.conhecidos) as { validas: Linha[]; erros: ErroLinha[] };
    ref.erros.forEach((e) => erro(entidade, e));
    let linhas = ref.validas;
    if (entidade === 'preco') {
      const vig = conferirVigenciaDaTabela(linhas as LinhasCarga['preco'][]);
      vig.forEach((e) => erro(entidade, e));
      const ruins = new Set(vig.map((e) => e.linha));
      linhas = linhas.filter((l) => !ruins.has(l.linha));
    }
    const boas: Linha[] = [];
    const avisos = new Set<string>();
    const contar = (efeito: 'inserida' | 'atualizada' | 'sem_mudanca', n = 1) => {
      if (efeito === 'inserida') res.inseridas += n;
      else if (efeito === 'atualizada') res.atualizadas += n;
      else res.sem_mudanca += n;
    };
    const executar = async (s: Saida, numeros: number[], externo: string | undefined): Promise<boolean> => {
      // Cliente com várias linhas (T-0058): o erro do cliente sai na 1ª linha dele; as outras linhas contam como recusadas.
      const alvosDoErro = entidade === 'cliente' ? numeros.slice(0, 1) : numeros;
      if ('erros' in s) {
        for (const e of s.erros) for (const n of alvosDoErro) erro(entidade, { ...e, linha: n });
        return false;
      }
      const parciais = s.errosParciais ?? [];
      parciais.forEach((e) => erro(entidade, e));
      const recusadasDoGrupo = new Set(parciais.map((e) => e.linha));
      let id = s.alvo?.id;
      if (st.gravar && s.aplicar) {
        try {
          const aplicar = s.aplicar;
          const novo = await r.carga.comSavepoint(() => aplicar());
          if (typeof novo === 'string') id = novo;
        } catch (e) {
          const ex = erroDeExcecao(numeros[0] as number, e);
          for (const n of alvosDoErro) erro(entidade, { ...ex, linha: n });
          return false;
        }
      } else if (s.efeito === 'inserida') id = '';
      const alvo = alvoCriado(entidade);
      if (alvo && id !== undefined && externo !== undefined) st.ids[alvo].set(externo, id);
      contar(s.efeito, numeros.filter((n) => !recusadasDoGrupo.has(n)).length);
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
          plano.erros.forEach((e) => erro(entidade, e));
          plano.avisos.forEach((x) => avisos.add(x));
          if (st.gravar && plano.aplicar && plano.erros.length === 0) {
            try {
              const aplicar = plano.aplicar;
              await r.carga.comSavepoint(() => aplicar());
            } catch (e) {
              erro(entidade, { ...erroDeExcecao(f.linha, e), linha: f.linha });
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
    res.avisos = [...avisos].map((x) => x.slice(0, 200)).slice(0, 50);
  }
  const preco = saida.resultados.preco;
  if (preco && st.precosSemDesconto > 0) {
    preco.avisos.push(`${st.precosSemDesconto} item(ns) de preço sem desconto máximo (nem no produto nem no preço)`);
  }
  if (st.gravar) {
    // RN-CAD-09: nada fica "cartão sem parcelas" (preenche quando os prazos são 30×N; senão desativa).
    const limpeza = await tratarCartaoSemParcelas(c, r, await r.carga.condicoesAtivasCartaoSemParcelas());
    const destino = saida.resultados.condicao_pagamento;
    if (destino && limpeza.preenchidas.total + limpeza.desativadas.total > 0) {
      destino.avisos.push(`Cartão sem parcelas: ${limpeza.preenchidas.total} preenchida(s), ${limpeza.desativadas.total} desativada(s)`);
    }
  }
  return saida;
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
