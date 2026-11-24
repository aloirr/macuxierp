/**
 * RN-CAD-09: condições de pagamento ligadas a uma forma que o ERP não aceita (cheque, depósito, transferência, tPag 99…)
 * são DESATIVADAS (`deleted_at`, RN-CAD-08), nunca apagadas. Dois caminhos usam esta mesma função: a linha de forma
 * recusada na carga e o comando do administrador (`POST /condicoes-pagamento/desativar-formas-recusadas`).
 */
import type { ContextoRota } from '@macuxierp/platform-sdk';
import type { CondicaoPagamento } from '../contracts';
import { derivarParcelasCartao } from '../domain/condicao';
import { eventoSimples, publicarPronto } from './eventos';
import type { Repositorios } from './portas';

/** Desativa as condições da lista (quem chama já filtra as ativas); devolve os `id` desativados (sem dado pessoal). Auditoria e evento por condição. */
export async function desativarCondicoesRecusadas(c: ContextoRota, r: Repositorios, condicoes: readonly CondicaoPagamento[]): Promise<string[]> {
  const ids: string[] = [];
  for (const cond of condicoes) {
    const depois = await r.condicoesPagamento.inativar(cond.id);
    if (!depois) continue;
    await publicarPronto(c, eventoSimples('cadastros.condicao_pagamento.alterada@1', depois));
    await c.auditar({
      acao: 'condicao_pagamento.inativar', entidade: 'condicao_pagamento', entidade_id: cond.id,
      antes: { inativo: false }, depois: { inativo: true, regra: 'RN-CAD-09' },
    });
    ids.push(cond.id);
  }
  return ids;
}

export interface ResultadoLimpeza {
  desativadas: { total: number; ids: string[] };
  preenchidas: { total: number; ids: string[] };
}

/**
 * RN-CAD-09 (antes da migração estrita): condição ATIVA de cartão (tPag 03) sem `parcelas_cartao`.
 * Se os prazos são válidos (1 a 12 parcelas de 0 a 999 dias, RN-CAD-09 emendada pela RN-CAD-15), preenche `parcelas_cartao = N` derivada
 * (`derivarParcelasCartao`) no mesmo UPDATE (auditoria e evento alterada@1); senão desativa (RN-CAD-08, com auditoria e evento). Nada fica "03 sem parcelas".
 */
export async function tratarCartaoSemParcelas(c: ContextoRota, r: Repositorios, condicoes: readonly CondicaoPagamento[]): Promise<ResultadoLimpeza> {
  const preenchidas: string[] = [];
  const paraDesativar: CondicaoPagamento[] = [];
  for (const cond of condicoes) {
    const n = derivarParcelasCartao(cond);
    if (n === null) { paraDesativar.push(cond); continue; }
    const depois = await r.condicoesPagamento.atualizar(cond.id, { parcelas_cartao: n });
    if (!depois) continue;
    await publicarPronto(c, eventoSimples('cadastros.condicao_pagamento.alterada@1', depois));
    await c.auditar({
      acao: 'condicao_pagamento.preencher_parcelas', entidade: 'condicao_pagamento', entidade_id: cond.id,
      antes: { parcelas_cartao: null }, depois: { parcelas_cartao: n, regra: 'RN-CAD-09' },
    });
    preenchidas.push(cond.id);
  }
  const ids = await desativarCondicoesRecusadas(c, r, paraDesativar);
  return { desativadas: { total: ids.length, ids }, preenchidas: { total: preenchidas.length, ids: preenchidas } };
}
