/**
 * Porta `RecebedorPedidoFdv` (T-0013 §5.3, P1): o `integracao-fdv` chama `receber(tx, entrada)` na mesma transação em que
 * grava `pedido_recebido`. Ator `sistema`. Ligada pelo `apps/worker`.
 * 1. licença do módulo `pedido` primeiro (sem ela, `recusado` com `modulo_pedido_inativo` e nada é lido nem gravado);
 * 2. repetido (mesmo `pedido_uuid`) devolve o pedido existente, sem evento novo;
 * 3. problema de cadastro recusa (cliente, filial, condição, produto, item); o resto entra `aprovado` (decisão de 21/11/2026, 23h10);
 * 4. corrida no índice único (`pedido_external_id_uq`) = repetido (o `INSERT … ON CONFLICT` do `sql.ts` a resolve sem abortar a transação).
 */
import { auditar, criarEvento, moduloLicenciado, type DestinoAuditoria, type FonteLicencas, type Outbox, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import { PedidoFdvEntrada, type ResultadoRecebimentoFdv } from '../contracts';
import type { Dependencias } from './portas';
import { criarServico, type Efeitos } from './servico';

export interface DependenciasRecebedor extends Dependencias {
  licencas: FonteLicencas;
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  relogio: Relogio;
}

/** O que o `integracao-fdv` conhece: a interface dele (`RecebedorPedidoFdv`) é esta, com os tipos de `contracts`. */
export interface RecebedorPedidoFdv {
  receber(tx: Transacao, entrada: PedidoFdvEntrada): Promise<ResultadoRecebimentoFdv>;
}

export function criarRecebedorFdv(d: DependenciasRecebedor): RecebedorPedidoFdv {
  const servico = criarServico(d);
  return {
    async receber(tx, bruta) {
      const repo = d.repositorios(tx);
      const agora = d.relogio.agora();
      const tenantId = await repo.tenantId();
      if (!moduloLicenciado(await d.licencas.ler(tx, tenantId), 'pedido', agora)) {
        d.log?.warn({ modulo: 'pedido', tenant_id: tenantId, codigo: 'modulo_pedido_inativo' }, 'pedido do FDV recusado');
        return { resultado: 'recusado', codigo: 'modulo_pedido_inativo' };
      }
      const entrada = PedidoFdvEntrada.parse(bruta);
      const requestId = `fdv-${entrada.pedido_uuid}`;
      const fx: Efeitos = {
        tenant_id: tenantId,
        ator: { tipo: 'sistema' },
        agora,
        publicar: async (e) => {
          const evento = criarEvento({ nome: e.nome, tenant_id: tenantId, agregado_id: e.agregado_id, ator: 'sistema', request_id: requestId, payload: e.payload }, agora);
          await d.outbox.gravar(tx, evento);
          return evento.id;
        },
        auditar: async (dados) => {
          await auditar(d.auditoria, tx, { tenant_id: tenantId, usuario_id: null, request_id: requestId }, dados, agora);
        },
      };
      const r = await servico.receberFdv(tx, fx, entrada);
      if (r.resultado === 'recusado') d.log?.warn({ modulo: 'pedido', tenant_id: tenantId, codigo: r.codigo }, 'pedido do FDV recusado');
      return r;
    },
  };
}
