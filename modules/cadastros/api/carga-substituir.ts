/**
 * Substituir tudo do cliente (com endereços) e da condição (RN-CAD-10). Regras: docs/modulos/cadastros/README.md, seção 'Carga: 8 arquivos'.
 */
import type { ArquivoRecebido, CadastroCargaPortal, ContextoRota } from '@macuxierp/platform-sdk';
import { EntidadeCarga } from '../contracts';
import { externosEnderecoDoArquivo, planoSubstituicao, planoSubstituicaoCliente, type PlanoSubstituicao, type PlanoSubstituicaoCliente } from '../domain';
import { lerCsvDoLayout } from './carga-reativar';
import { eventoCliente, eventoFilial, eventoPreco, eventoProduto, eventoSimples, publicarPronto } from './eventos';
import type { Dependencias, TabelaSubstituivel } from './portas';

/** Nome de cadastro do portal: o do SDK (hoje 10, na v0.3.6 8) mais os nomes da carga de 8 arquivos, para compilar com os dois. */
type NomeCadastroPortal = CadastroCargaPortal | 'condicao_pagamento' | 'forma_pagamento' | 'prazo_pagamento' | 'cliente_endereco';

/**
 * Tabela que o "Substituir tudo" inativa em cada cadastro do portal (a ÚNICA fonte; o `carga-portal.ts` importa daqui).
 * Sem chave = nada a inativar (estoque é saldo, não cadastro; a forma vive na condição, RN-CAD-09). O cliente leva os endereços
 * juntos (o plano trata `cliente_endereco`); `prazo_pagamento` é o nome antigo da condição.
 */
export const TABELA_SUBSTITUIVEL: Readonly<Partial<Record<NomeCadastroPortal, TabelaSubstituivel>>> = {
  filial: 'filial', vendedor: 'vendedor', condicao_pagamento: 'condicao_pagamento', prazo_pagamento: 'condicao_pagamento',
  produto: 'produto', produto_unidade: 'produto_unidade', preco: 'tabela_preco_item', cliente: 'cliente',
};

/** Nome do portal -> `EntidadeCarga` (forma/prazo = a condição; endereço = o cliente, que vem no mesmo arquivo); `null` se não é da carga. */
export function paraEntidadeCarga(cadastro: string): EntidadeCarga | null {
  if (cadastro === 'forma_pagamento' || cadastro === 'prazo_pagamento') return 'condicao_pagamento';
  if (cadastro === 'cliente_endereco') return 'cliente';
  const e = EntidadeCarga.safeParse(cadastro);
  return e.success ? e.data : null;
}

/** Dos ids, os que estão em uso por outro módulo (continuam no histórico). Sem a consulta ligada, ninguém está. */
export type ConsultaEmUso = (ids: readonly string[]) => Promise<ReadonlySet<string>>;

export interface ResultadoSubstituicao {
  plano: PlanoSubstituicao;
  /** Total de ativos COM chave antes da gravação (base do percentual do efeito). */
  total: number;
  /** Ids inativados (o cadastro principal). */
  inativados: string[];
  /** Só no cliente: ids de endereço inativados. */
  enderecos_inativados: string[];
  enderecos_sem_chave: number;
}

export interface PrevistoSubstituicao {
  plano: PlanoSubstituicaoCliente;
  /** Total de ativos COM chave antes da gravação. */
  total: number;
  /** Cadastro-pai de cada registro lido (endereço -> cliente, unidade -> produto, item -> tabela), para republicar o pai. */
  paiDe: ReadonlyMap<string, string | null>;
}

const semUso: ConsultaEmUso = async () => new Set();

function linhasDoArquivo(cadastro: EntidadeCarga, a: ArquivoRecebido) {
  const lido = lerCsvDoLayout(cadastro, a.conteudo());
  return lido.ok ? lido.linhas : [];
}

/** Os `external_id` do arquivo, de TODA linha lida (a recusada também protege o existente de ser inativado). */
const externosDoArquivo = (linhas: readonly { celulas: Readonly<Record<string, string | undefined>> }[]): string[] =>
  linhas.map((l) => (l.celulas.external_id ?? '').trim()).filter((x) => x !== '');

/** O plano do cliente (com endereços) ou o genérico, antes da gravação. Só lê (serve ao validar e ao gravar). */
export async function planejarSubstituicao(deps: Dependencias, c: ContextoRota, cadastro: EntidadeCarga, a: ArquivoRecebido, emUso: ConsultaEmUso = semUso): Promise<PrevistoSubstituicao> {
  const tabela = TABELA_SUBSTITUIVEL[cadastro] ?? null;
  const r = deps.repositorios(c.tx);
  const linhas = linhasDoArquivo(cadastro, a);
  const externos = externosDoArquivo(linhas);
  const existentes = tabela ? await r.substituicao.existentes(tabela) : [];
  const dosExistentes = existentes.map((e) => ({ id: e.id, external_id: e.external_id, inativo: e.inativo }));
  const total = existentes.filter((e) => !e.inativo && e.external_id !== null).length;
  // O plano sem uso decide o que será inativado; o "em uso" só é consultado se houver o que inativar.
  const comUso = async <P extends { inativar: string[] }>(f: (uso: ReadonlySet<string>) => P): Promise<P> => {
    const inicial = f(new Set());
    return inicial.inativar.length > 0 ? f(await emUso(inicial.inativar)) : inicial;
  };
  if (cadastro === 'cliente') {
    const enderecos = await r.substituicao.existentes('cliente_endereco');
    const base = { modo: 'substituir_tudo', externos_cliente: externos, externos_endereco: externosEnderecoDoArquivo(linhas), clientes: dosExistentes, enderecos } as const;
    const plano = await comUso((uso) => planoSubstituicaoCliente({ ...base, em_uso: uso }));
    return { plano, total, paiDe: new Map(enderecos.map((e) => [e.id, e.pai_id])) };
  }
  const base = { modo: 'substituir_tudo', entidade: cadastro, externos_do_arquivo: externos, existentes: dosExistentes } as const;
  const plano = await comUso((uso) => ({ ...planoSubstituicao({ ...base, em_uso: uso }), enderecos_inativar: [], enderecos_sem_chave: 0 }));
  return { plano, total, paiDe: new Map(existentes.map((e) => [e.id, e.pai_id])) };
}

/** Publica `cadastros.*.alterado@1` com `inativo: true` dos inativados (o que leva a inativação ao FDV). Filha: republica o pai uma vez. */
async function publicarInativados(deps: Dependencias, c: ContextoRota, tabela: TabelaSubstituivel, ids: readonly string[], paiDe: ReadonlyMap<string, string | null>): Promise<void> {
  const r = deps.repositorios(c.tx);
  const paisUnicos = [...new Set(ids.map((id) => paiDe.get(id)).filter((x): x is string => !!x))];
  switch (tabela) {
    case 'filial':
      for (const id of ids) { const f = await r.filiais.obter(id); if (f) await publicarPronto(c, await eventoFilial(r, f)); }
      break;
    case 'vendedor':
      for (const id of ids) { const v = await r.vendedores.obter(id); if (v) await publicarPronto(c, eventoSimples('cadastros.vendedor.alterado@1', v as { id: string; inativo: boolean })); }
      break;
    case 'condicao_pagamento':
      for (const id of ids) { const v = await r.condicoesPagamento.obter(id); if (v) await publicarPronto(c, eventoSimples('cadastros.condicao_pagamento.alterada@1', v)); }
      break;
    case 'produto':
      for (const id of ids) { const p = await r.produtos.obter(id); if (p) await publicarPronto(c, await eventoProduto(r, p)); }
      break;
    case 'produto_unidade':
      for (const id of paisUnicos) { const p = await r.produtos.obter(id); if (p) await publicarPronto(c, await eventoProduto(r, p)); }
      break;
    case 'cliente':
      for (const id of ids) { const x = await r.clientes.obter(id); if (x) await publicarPronto(c, await eventoCliente(r, x)); }
      break;
    case 'tabela_preco_item':
      for (const item of await r.substituicao.itensPreco(ids)) {
        const t = await r.tabelasPreco.obter(item.tabela_preco_id);
        if (t) await publicarPronto(c, eventoPreco(item, { ...t, inativo: true }));
      }
      break;
  }
}

/**
 * Inativa o plano (na transação do `c`, depois da gravação da carga) e publica os eventos com `inativo: true`. Vale para todo
 * cadastro; no cliente os endereços ausentes também são inativados e o cliente afetado republica uma vez, com todos os endereços.
 */
export async function aplicarSubstituicao(deps: Dependencias, c: ContextoRota, cadastro: EntidadeCarga, previsto: PrevistoSubstituicao): Promise<ResultadoSubstituicao> {
  const tabela = TABELA_SUBSTITUIVEL[cadastro] ?? null;
  const { plano, total, paiDe } = previsto;
  const r = deps.repositorios(c.tx);
  const inativados = tabela ? await r.substituicao.inativarEmLote(tabela, plano.inativar) : [];
  let enderecos: string[] = [];
  if (cadastro === 'cliente') {
    enderecos = await r.substituicao.inativarEmLote('cliente_endereco', plano.enderecos_inativar);
    // os inativados e os que só perderam endereço: um evento por cliente
    const afetados = new Set<string>(inativados);
    for (const id of enderecos) { const pai = paiDe.get(id); if (pai) afetados.add(pai); }
    await publicarInativados(deps, c, 'cliente', [...afetados], paiDe);
  } else if (tabela) {
    await publicarInativados(deps, c, tabela, inativados, paiDe);
  }
  return { plano, total, inativados, enderecos_inativados: enderecos, enderecos_sem_chave: plano.enderecos_sem_chave };
}
