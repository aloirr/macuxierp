/**
 * T-0108 e v0.3.18 (D1 A), RN-CAD-15: ajusta o prazo médio das condições JÁ gravadas com ele vazio (completa) ou fora da faixa
 * [menor parcela, maior parcela] (corrige), pela regra pura `decidirPrazoMedioGravado`; o valor novo é a média das parcelas e a marca
 * `prazo_medio_calculado` fica true. `completarPrazosMedios(deps)(tx, tenant)` roda na transação do tenant; seleciona as ativas (`FOR UPDATE`),
 * grava pelo mesmo repositório do PATCH e emite o mesmo evento. Auditoria: UMA por condição alterada (id, prazo médio antes e depois, só números)
 * e UMA por tenant com as contagens (nenhuma se nada mudou). `clientes_afetados` (RN-CAD-16) soma os clientes com prazo médio na faixa em que a
 * permissão de uso da condição muda (`faixaClientesAfetados`); `null` só quando o papel não pode ler clientes (SEM_PERMISSAO_LEITURA, 42501; avisa por `log`); outro erro da contagem sobe. Idempotente.
 */
import { auditar, criarEvento, type DestinoAuditoria, type Outbox, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import { decidirPrazoMedioGravado, faixaClientesAfetados } from '../domain';
import { eventoSimples } from './eventos';
import type { Dependencias } from './portas';
import { SEM_PERMISSAO_LEITURA } from './util';

export interface DependenciasCompletarPrazosMedios {
  repositorios: Dependencias['repositorios'];
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  relogio: Relogio;
  /** Opcional: avisa (só tenant_id e código, sem dado de cliente) quando a contagem de clientes fica indisponível. */
  log?: { warn: (o: Record<string, unknown>, msg: string) => void };
}

export interface ResultadoCompletarPrazosMedios {
  completadas: number;
  corrigidas: number;
  clientes_afetados: number | null;
}

export function completarPrazosMedios(d: DependenciasCompletarPrazosMedios) {
  return async (tx: Transacao, tenant: string): Promise<ResultadoCompletarPrazosMedios> => {
    const r = d.repositorios(tx);
    const agora = d.relogio.agora();
    const requestId = `completar-prazos-medios-${tenant}`;
    const contexto = { tenant_id: tenant, usuario_id: null, request_id: requestId };
    let completadas = 0;
    let corrigidas = 0;
    let clientes: number | null = 0;
    for (const c of await r.carga.condicoesAtivasParaAjustePrazoMedio()) {
      const decisao = decidirPrazoMedioGravado(c);
      if (decisao.acao === 'nenhuma') continue;
      const depois = await r.condicoesPagamento.atualizar(c.id, { prazo_medio_dias: decisao.depois, prazo_medio_calculado: true } as never);
      if (!depois) continue;
      const ev = eventoSimples('cadastros.condicao_pagamento.alterada@1', depois);
      await d.outbox.gravar(tx, criarEvento({ nome: ev.nome, tenant_id: tenant, agregado_id: ev.agregado_id, ator: 'sistema', request_id: requestId, payload: ev.payload }, agora));
      const faixa = faixaClientesAfetados(c.forma_tpag, decisao.antes, decisao.depois);
      const afetados = faixa === null ? 0 : await r.carga.contarClientesPorPrazoMedio(faixa.de, faixa.ate);
      if (afetados === null) d.log?.warn({ tenant_id: tenant, condicao_id: c.id, codigo: SEM_PERMISSAO_LEITURA }, 'clientes_afetados indisponível: sem permissão de leitura em cadastros.cliente');
      clientes = clientes === null || afetados === null ? null : clientes + afetados;
      await auditar(d.auditoria, tx, contexto, {
        acao: 'condicao_pagamento.ajustar_prazo_medio', entidade: 'condicao_pagamento', entidade_id: c.id,
        antes: { prazo_medio_dias: decisao.antes }, depois: { prazo_medio_dias: decisao.depois, acao: decisao.acao, ...(afetados === null ? {} : { clientes_afetados: afetados }) },
      }, agora);
      if (decisao.acao === 'completar') completadas += 1;
      else corrigidas += 1;
    }
    if (completadas > 0 || corrigidas > 0) {
      await auditar(d.auditoria, tx, contexto, {
        acao: 'condicao_pagamento.completar_prazos_medios', entidade: 'condicao_pagamento', entidade_id: tenant,
        depois: { completadas, ...(corrigidas > 0 ? { corrigidas } : {}), ...(corrigidas > 0 && clientes !== null ? { clientes_afetados: clientes } : {}) },
      }, agora);
    }
    return { completadas, corrigidas, clientes_afetados: clientes };
  };
}
