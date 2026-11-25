/**
 * Retorno do pré-cadastro de cliente ao Hub (T-0059 §5.2 a §5.4): `POST /integracao/v1/clientes/{cliente_uuid}/retorno`
 * com `vinculado` ou `rejeitado_erp` e os erros por campo. Envia os `pendente` de `cliente_retorno` por ordem de
 * `created_at`, uma revisão por vez em cada `cliente_uuid`. A resposta segue `tratarRespostaRetornoCliente` (domain).
 * - 200 do `vinculado`: libera o cliente aceito e os endereços no espelho (`aguarda_vinculo` = false, na mesma transação) e acorda
 *   o envio; o próximo ciclo delta manda o cliente com o mesmo `external_id` (§5.4).
 * - 422 `external_id_divergente` no `vinculado`: o retorno fica `falhou`, abre `conflito_chave` `vinculo_divergente` e o cliente
 *   continua retido (não vai ao FDV) até alguém resolver.
 * Só código e uuid em log e alerta: nunca nome, documento nem corpo (LGPD).
 */
import { MARGEM_POSSE_AGENDA_MS, type Banco, type Relogio, type RetornoClienteFdv, type Transacao } from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';
import { atrasoRetentativaSegundos, codigoRecusaGravavel, tratarRespostaRetornoCliente } from '../domain';
import { adiarPresoAPosse } from './conector-comum';
import { agendarEnvio, registrarConflito } from './espelho';
import type { Alertar, ClienteHubClientes, LogPedidos } from './portas';
import { motivoDaRecusa } from './util-pedidos';

export interface DepsEnvioRetornoClientes {
  banco: Pick<Banco, 'comTenant'>;
  hub: ClienteHubClientes;
  relogio: Relogio;
  log: LogPedidos;
  alertar: Alertar;
  posseAte?: Date;
}

export interface ResumoEnvioClientes {
  enviados: number;
  falhou: number;
  conflitos: number;
  reagendados: number;
  motivoPausa?: MotivoPausa;
  posseCurta?: boolean;
  possePerdida?: boolean;
}

const COLUNA = 'proximo_retorno_clientes_em';
const RODADAS_MAX = 20;
const LOTE = 50;

interface ItemFila {
  id: string;
  cliente_uuid: string;
  revisao: number;
  status: 'vinculado' | 'rejeitado_erp';
  corpo: RetornoClienteFdv;
  tentativas: number;
  cliente_id: string | null;
}

/** Regrava `proximo_retorno_clientes_em`: presa à posse quando há `posseAte`; sem ela, incondicional. */
async function gravarProximo(tx: Transacao, tenantId: string, para: Date, posseAte?: Date): Promise<void> {
  if (posseAte) return adiarPresoAPosse(tx, tenantId, { sinal: COLUNA }, posseAte, para);
  await tx.consultar(`UPDATE integracao_fdv.sinal SET ${COLUNA} = $2 WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId, para]);
}

/** Cliente (e endereços) do espelho: retido ou liberado do lote (`aguarda_vinculo`). */
export async function marcarAguardaVinculo(tx: Transacao, tenantId: string, clienteId: string, aguarda: boolean): Promise<void> {
  await tx.consultar(
    `UPDATE integracao_fdv.registro_publicado SET aguarda_vinculo = $3
      WHERE tenant_id = $1 AND deleted_at IS NULL AND aguarda_vinculo <> $3
        AND ((entidade = 'cliente' AND erp_id = $2) OR (entidade = 'cliente_endereco' AND fonte_refs ->> 'cliente_id' = $2::text))`,
    [tenantId, clienteId, aguarda],
  );
}

/**
 * O cliente acabou de entrar no espelho: se veio de um pré-cadastro aceito cujo retorno `vinculado` ainda não teve 200
 * (na fila, em retentativa ou `falhou`), fica retido (§5.4). Depois do 200 ou para qualquer outro cliente, nada muda.
 */
export async function reterSeAguardaVinculo(tx: Transacao, tenantId: string, clienteId: string): Promise<void> {
  const [aguarda] = await tx.consultar<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM integracao_fdv.cliente_recebido c
                     WHERE c.tenant_id = $1 AND c.cliente_id = $2 AND c.situacao = 'aceito' AND c.deleted_at IS NULL
                       AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_retorno r
                                        WHERE r.tenant_id = c.tenant_id AND r.cliente_uuid = c.cliente_uuid AND r.revisao = c.revisao
                                          AND r.status = 'vinculado' AND r.estado = 'enviado' AND r.deleted_at IS NULL)) AS ok`,
    [tenantId, clienteId],
  );
  if (aguarda?.ok) await marcarAguardaVinculo(tx, tenantId, clienteId, true);
}

export async function enviarRetornosClientes(d: DepsEnvioRetornoClientes, tenantId: string): Promise<ResumoEnvioClientes> {
  const r: ResumoEnvioClientes = { enviados: 0, falhou: 0, conflitos: 0, reagendados: 0 };
  for (let rodada = 0; rodada < RODADAS_MAX; rodada++) {
    const lido = await d.banco.comTenant(tenantId, async (tx) => {
      if (d.posseAte) {
        const [p] = await tx.consultar<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM integracao_fdv.sinal WHERE tenant_id = $1 AND ${COLUNA} = $2) AS ok`, [tenantId, d.posseAte]);
        if (!p?.ok) return 'posse_perdida' as const;
      }
      const linhas = await tx.consultar<ItemFila>(
        `SELECT r.id, r.cliente_uuid, r.revisao, r.status, r.corpo, r.tentativas, c.cliente_id
           FROM integracao_fdv.cliente_retorno r
           JOIN integracao_fdv.cliente_recebido c ON c.tenant_id = r.tenant_id AND c.cliente_uuid = r.cliente_uuid AND c.revisao = r.revisao
          WHERE r.tenant_id = $1 AND r.estado = 'pendente' AND r.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_retorno a
                             WHERE a.tenant_id = r.tenant_id AND a.cliente_uuid = r.cliente_uuid AND a.estado = 'pendente'
                               AND a.deleted_at IS NULL AND (a.created_at, a.id) < (r.created_at, r.id))
          ORDER BY r.created_at, r.id LIMIT $2`,
        [tenantId, LOTE],
      );
      if (linhas.length === 0) {
        await tx.consultar(
          `UPDATE integracao_fdv.sinal SET ${COLUNA} = NULL
            WHERE tenant_id = $1 AND deleted_at IS NULL AND ($2::timestamptz IS NULL OR ${COLUNA} = $2)
              AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_retorno WHERE tenant_id = $1 AND estado = 'pendente' AND deleted_at IS NULL)`,
          [tenantId, d.posseAte ?? null],
        );
      }
      return linhas;
    });
    if (lido === 'posse_perdida') return { ...r, possePerdida: true };
    if (lido.length === 0) return r;
    let progresso = false;
    for (const item of lido) {
      if (d.posseAte && d.relogio.agora().getTime() >= d.posseAte.getTime() - MARGEM_POSSE_AGENDA_MS) {
        await d.banco.comTenant(tenantId, (tx) => gravarProximo(tx, tenantId, d.relogio.agora(), d.posseAte));
        return { ...r, posseCurta: true };
      }
      const resp = await d.hub.enviarRetorno(item.cliente_uuid, item.corpo);
      const agora = d.relogio.agora();
      const motivoPausa = motivoDaRecusa(resp.status, resp.codigo);
      if (motivoPausa) return { ...r, motivoPausa };
      const acao = tratarRespostaRetornoCliente(resp, item.status);

      if (acao.acao === 'enviado') {
        await d.banco.comTenant(tenantId, async (tx) => {
          const [mudou] = await tx.consultar<{ id: string }>(
            `UPDATE integracao_fdv.cliente_retorno SET estado = 'enviado', enviado_em = $3, resposta_http = $4, tentativas = tentativas + 1
              WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente' RETURNING id`,
            [tenantId, item.id, agora, resp.status],
          );
          // `vinculado` aceito pelo Hub: o cliente deixa de ficar retido e o próximo ciclo delta o manda (§5.4). Outro worker já resolvido = nada.
          if (mudou && item.status === 'vinculado' && item.cliente_id) {
            await marcarAguardaVinculo(tx, tenantId, item.cliente_id, false);
            await tx.consultar(
              `UPDATE integracao_fdv.conflito_chave SET resolvido_em = now()
                WHERE tenant_id = $1 AND entidade = 'cliente' AND erp_id = $2 AND codigo = 'vinculo_divergente' AND resolvido_em IS NULL`,
              [tenantId, item.cliente_id],
            );
            await agendarEnvio(tx, tenantId, new Set(['cliente', 'cliente_endereco'] as const), agora);
          }
        });
        r.enviados++;
        progresso = true;
      } else if (acao.acao === 'pausa') {
        return { ...r, motivoPausa: 'credencial' }; // 401/403/426 sem classificação própria: a credencial pausa
      } else if (acao.acao === 'retentar') {
        const espera = atrasoRetentativaSegundos(item.tentativas + 1, resp.retryAfterS) * 1000;
        await d.banco.comTenant(tenantId, async (tx) => {
          await tx.consultar(
            `UPDATE integracao_fdv.cliente_retorno SET tentativas = tentativas + 1, resposta_http = $3 WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente'`,
            [tenantId, item.id, resp.status === 0 ? null : resp.status],
          );
          await gravarProximo(tx, tenantId, new Date(agora.getTime() + espera), d.posseAte);
        });
        if (acao.inesperado) d.alertar(tenantId, 'retorno_cliente_status_inesperado', { cliente_uuid: item.cliente_uuid });
        d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', cliente_uuid: item.cliente_uuid, http: resp.status, espera_ms: espera }, 'retorno do pré-cadastro reagendado');
        r.reagendados++;
        return r; // Hub fora do ar ou resposta inesperada: não adianta insistir nos outros agora
      } else if (acao.acao === 'conflito_vinculo') {
        await d.banco.comTenant(tenantId, async (tx) => {
          await tx.consultar(
            `UPDATE integracao_fdv.cliente_retorno SET estado = 'falhou', resposta_http = 422, codigo_recusa = $3, tentativas = tentativas + 1
              WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente'`,
            [tenantId, item.id, codigoRecusaGravavel(acao.codigo)],
          );
          if (item.cliente_id) {
            // o cliente continua retido: sem o conflito resolvido, o espelho não o manda
            await marcarAguardaVinculo(tx, tenantId, item.cliente_id, true);
            await registrarConflito(tx, tenantId, 'cliente', item.cliente_id, String(item.corpo.external_id ?? item.cliente_uuid).slice(0, 200), 'vinculo_divergente');
          }
        });
        d.alertar(tenantId, 'cliente_vinculo_divergente', { cliente_uuid: item.cliente_uuid });
        r.conflitos++;
        r.falhou++;
        progresso = true;
      } else if (acao.acao === 'falhou') {
        await d.banco.comTenant(tenantId, (tx) =>
          tx.consultar(
            `UPDATE integracao_fdv.cliente_retorno SET estado = 'falhou', resposta_http = $3, codigo_recusa = $4, tentativas = tentativas + 1
              WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente'`,
            [tenantId, item.id, resp.status, resp.status === 422 ? codigoRecusaGravavel(acao.codigo) : null],
          ),
        );
        d.alertar(tenantId, acao.alertar, { cliente_uuid: item.cliente_uuid, codigo: acao.codigo });
        r.falhou++;
        progresso = true;
      }
    }
    if (!progresso) return r;
  }
  await d.banco.comTenant(tenantId, (tx) => gravarProximo(tx, tenantId, d.relogio.agora(), d.posseAte));
  return r;
}
