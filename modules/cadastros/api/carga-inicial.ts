/**
 * Carga inicial (C-4, desenho T-0009 seção 4): o `integracao-fdv` pede `integracao-fdv.carga_inicial.solicitada@1` e o
 * cadastros republica o `alterado@1` de cada entidade pedida, do tenant, por trabalho paginado (cursor, inativos incluídos).
 * - Consumidor: leitor tolerante (Zod local, `passthrough`); entidade desconhecida é ignorada; um trabalho por entidade.
 * - Executor: uma página por execução (publica na outbox, na transação do tenant) e enfileira a seguinte.
 * Idempotência: o `external_id` de cada trabalho deriva da solicitação, da entidade e do cursor; reprocessar não duplica
 * trabalho, e o `integracao-fdv` já ignora a republicação de registro sem mudança (hash, RN-INF-03).
 */
import {
  criarEvento, paginar, type ConsumidorEvento, type ExecutorTrabalho, type FilaDeTrabalhos, type Outbox, type Transacao,
} from '@macuxierp/platform-sdk';
import {
  ENTIDADES_CARGA, EVENTO_CARGA_INICIAL, PayloadCargaInicial, SolicitacaoCargaInicial, TRABALHO_CARGA_INICIAL, type EntidadeCarga,
} from '../contracts';
import {
  eventoCliente, eventoEstoque, eventoFilial, eventoPreco, eventoProduto, eventoSimples, eventoTabelaPreco, type EventoPronto,
} from './eventos';
import type { Repositorios } from './portas';
import { agregadoEstoque, uuidV5 } from './uuid';

export const TAMANHO_PAGINA_CARGA = 200;
const PAGINA_ITENS_PRECO = 1000;

/** Nomes do Hub e do ERP que levam à mesma entidade; o resto é ignorado. */
const APELIDOS: Record<string, EntidadeCarga> = {
  filial: 'filial', vendedor: 'vendedor',
  condicao_pagamento: 'condicao_pagamento', forma_pagamento: 'condicao_pagamento', prazo_pagamento: 'condicao_pagamento',
  produto: 'produto', produto_unidade: 'produto',
  tabela_preco: 'tabela_preco', preco: 'preco', estoque: 'estoque',
  cliente: 'cliente', cliente_endereco: 'cliente',
};

/** Entidades distintas, na ordem de `ENTIDADES_CARGA` (a do Hub: referências antes de quem as usa). */
export function entidadesPedidas(nomes: readonly string[]): EntidadeCarga[] {
  const pedidas = new Set(nomes.map((n) => APELIDOS[n]).filter((e): e is EntidadeCarga => e !== undefined));
  return ENTIDADES_CARGA.filter((e) => pedidas.has(e));
}

/** UUID v5 da chave (solicitação, entidade, cursor, tabela, página): cabe no limite de 64 caracteres do `external_id` e é estável. */
const NS_CARGA = '7d0c6a52-2f1e-5b8a-9c47-1e3a5b7d9f21';
export const externalDoTrabalho = (p: PayloadCargaInicial): string =>
  uuidV5(`carga:${p.origem}:${p.entidade}:${p.apos ?? 'inicio'}:${p.tabela_id ?? '-'}:${p.cursor_itens ?? '-'}`, NS_CARGA);

export function criarConsumidorCargaInicial(deps: { fila: FilaDeTrabalhos }): ConsumidorEvento {
  return {
    id: 'cadastros.carga-inicial',
    eventos: [EVENTO_CARGA_INICIAL],
    async tratar(evento, tx) {
      const lido = SolicitacaoCargaInicial.safeParse(evento.payload);
      if (!lido.success) return;
      for (const entidade of entidadesPedidas(lido.data.entidades)) {
        const payload: PayloadCargaInicial = { origem: evento.id, entidade, apos: null, tabela_id: null, pagina: 1, cursor_itens: null };
        await deps.fila.enfileirar(tx, { tipo: TRABALHO_CARGA_INICIAL, tenant_id: evento.tenant_id, payload, external_id: externalDoTrabalho(payload) });
      }
    },
  };
}

export function criarExecutorCargaInicial(deps: {
  repositorios(tx: Transacao): Repositorios;
  fila: FilaDeTrabalhos;
  outbox: Outbox;
  agora?: () => Date;
}): ExecutorTrabalho {
  return {
    tipo: TRABALHO_CARGA_INICIAL,
    async executar(trabalho, tx) {
      const p = PayloadCargaInicial.parse(trabalho.payload);
      const r = deps.repositorios(tx);
      const { eventos, proximo } = await pagina(r, p);
      const agora = (deps.agora ?? (() => new Date()))();
      for (const e of eventos) {
        await deps.outbox.gravar(tx, criarEvento(
          { nome: e.nome, tenant_id: trabalho.tenant_id, agregado_id: e.agregado_id, versao: 1, ator: 'sistema', request_id: trabalho.id, payload: e.payload },
          agora,
        ));
      }
      if (proximo) await deps.fila.enfileirar(tx, { tipo: TRABALHO_CARGA_INICIAL, tenant_id: trabalho.tenant_id, payload: proximo, external_id: externalDoTrabalho(proximo) });
      return { entidade: p.entidade, publicados: eventos.length, terminou: proximo === null };
    },
  };
}

async function pagina(r: Repositorios, p: PayloadCargaInicial): Promise<{ eventos: EventoPronto[]; proximo: PayloadCargaInicial | null }> {
  const seguinte = (apos: string | null, extra: Partial<PayloadCargaInicial> = {}): PayloadCargaInicial => ({ ...p, apos, tabela_id: null, pagina: 1, cursor_itens: null, ...extra });
  const porCursor = async <E extends { id: string }>(
    repo: { paginaPorCursor(apos: string | null, limite: number): Promise<E[]> },
    montar: (e: E) => Promise<EventoPronto> | EventoPronto,
  ) => {
    const { itens, proximo_cursor } = paginar(await repo.paginaPorCursor(p.apos, TAMANHO_PAGINA_CARGA + 1), TAMANHO_PAGINA_CARGA);
    const eventos: EventoPronto[] = [];
    for (const e of itens) eventos.push(await montar(e));
    return { eventos, proximo: proximo_cursor ? seguinte(proximo_cursor) : null };
  };

  switch (p.entidade) {
    case 'filial': return porCursor(r.filiais, (f) => eventoFilial(r, f));
    case 'cliente': return porCursor(r.clientes, (c) => eventoCliente(r, c));
    case 'produto': return porCursor(r.produtos, (x) => eventoProduto(r, x));
    case 'tabela_preco': return porCursor(r.tabelasPreco, eventoTabelaPreco);
    case 'vendedor': return porCursor(r.vendedores, (v) => eventoSimples('cadastros.vendedor.alterado@1', v));
    case 'condicao_pagamento': return porCursor(r.condicoesPagamento, (c) => eventoSimples('cadastros.condicao_pagamento.alterada@1', c));
    case 'estoque': {
      const [filial_id = '', produto_id = ''] = (p.apos ?? '').split('|');
      const lote = await r.estoque.paginaPorCursor(p.apos ? { filial_id, produto_id } : null, TAMANHO_PAGINA_CARGA + 1);
      const itens = lote.slice(0, TAMANHO_PAGINA_CARGA);
      const ultimo = itens[itens.length - 1]; // o cursor do estoque é composto (não há `id`): sem `paginar` do SDK
      return {
        eventos: itens.map((s) => eventoEstoque(agregadoEstoque(s.filial_id, s.produto_id), s)),
        proximo: lote.length > TAMANHO_PAGINA_CARGA && ultimo ? seguinte(`${ultimo.filial_id}|${ultimo.produto_id}`) : null,
      };
    }
    case 'preco': {
      // Uma tabela por vez, PAGINA_ITENS_PRECO itens por execução; `apos` = última tabela começada.
      const t = p.tabela_id ? await r.tabelasPreco.obter(p.tabela_id) : ((await r.tabelasPreco.paginaPorCursor(p.apos, 1))[0] ?? null);
      if (!t) return { eventos: [], proximo: p.tabela_id ? seguinte(p.tabela_id) : null };
      const { itens, proximo_cursor } = await r.tabelasPreco.itens(t.id, { limite: PAGINA_ITENS_PRECO, cursor: p.tabela_id ? (p.cursor_itens ?? undefined) : undefined });
      const eventos = itens.map((i) => eventoPreco(i, t));
      return { eventos, proximo: proximo_cursor ? seguinte(t.id, { tabela_id: t.id, cursor_itens: proximo_cursor }) : seguinte(t.id) };
    }
  }
}
