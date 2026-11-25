/**
 * Retorno do status do pedido ao Hub (RN-PED-05; T-0013 §6). O consumidor `integracao-fdv.retorno-pedido` grava o
 * retorno de forma idempotente (`retorno_enviado`); o envio roda pela agenda `sinal.proximo_retorno_em`, em ordem
 * por pedido. Sem XML e sem dado pessoal em log ou alerta (só código e uuid do pedido).
 */
import { MARGEM_POSSE_AGENDA_MS, type Banco, type ConsumidorEvento, type EnvelopeEvento, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import type { MotivoPausa, RetornoErp, StatusRetornoHub } from '../contracts';
import { atrasoRetentativaSegundos } from '../domain';
import { EVENTOS_DE_RETORNO, ORDEM_HUB, PayloadPedidoLido, retornoDoPedido } from '../domain/retorno-pedido';
import type { Alertar, ClienteHubPedidos, LogPedidos } from './portas';
import { adiarPresoAPosse } from './conector-comum';
import { codigoSeguro, gravarRetorno, motivoDaRecusa } from './util-pedidos';

/** Mensagem fixa: o despachante registra o nome e a tentativa e repete com backoff até o espelho ter o produto. */
export class ChaveDoProdutoAusente extends Error {
  override readonly name = 'ChaveDoProdutoAusente';
  constructor() {
    super('produto faturado sem chave do Hub no espelho');
  }
}

/**
 * Chave do Hub dos produtos pelo `erp_id` do espelho (ADR 0010, item 1). Só colunas nomeadas; produto fora do espelho fica fora do
 * mapa. Produto inativo também tem chave (o faturado de um produto depois inativado não pode ficar sem retorno): a linha ativa vem
 * primeiro e, entre as demais, a mais recente.
 */
async function chavesHubDosProdutos(tx: Transacao, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const l = await tx.consultar<{ erp_id: string; chave: string }>(
    `SELECT DISTINCT ON (erp_id) erp_id, registro_external_id AS chave FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = 'produto' AND erp_id = ANY($2::uuid[]) AND deleted_at IS NULL
      ORDER BY erp_id, ativo DESC, alterado_em DESC`,
    [tenantId, [...new Set(ids)]],
  );
  return new Map(l.map((x) => [x.erp_id, x.chave]));
}

/** `CASE` do degrau de cada status no Hub, montado de `ORDEM_HUB` (única fonte; sem números à mão). Só chaves da constante entram no SQL. */
function casoOrdemHub(coluna: string): string {
  const quando = Object.entries(ORDEM_HUB).map(([status, n]) => `WHEN '${status}' THEN ${n}`);
  return `CASE ${coluna} ${quando.join(' ')} END`;
}

export function criarConsumidorRetornoPedido(deps: { log: LogPedidos; relogio: Relogio; alertar?: Alertar }): ConsumidorEvento {
  return {
    id: 'integracao-fdv.retorno-pedido',
    eventos: EVENTOS_DE_RETORNO,
    async tratar(evento: EnvelopeEvento, tx) {
      const payload = PayloadPedidoLido.safeParse(evento.payload);
      if (!payload.success) {
        deps.log.warn({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', evento: evento.nome, codigo: 'payload_fora_do_contrato' }, 'evento de pedido ignorado');
        return;
      }
      const uuid = payload.data.pedido_uuid;
      if (payload.data.origem !== 'fdv' || !uuid) return;
      const recebido = await tx.consultar(
        `SELECT 1 FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2 AND deleted_at IS NULL`,
        [evento.tenant_id, uuid],
      );
      if (recebido.length === 0) {
        deps.log.warn({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', pedido_uuid: uuid, codigo: 'pedido_nao_recebido_pelo_conector' }, 'evento de pedido sem pedido_recebido');
        return;
      }
      // Último status ACEITO pelo Hub (estado 'enviado'; falhou e pendente não contam): o mais avançado segundo `ORDEM_HUB`, e o mais recente no empate.
      const ultimo = await tx.consultar<{ status: StatusRetornoHub; chave_nota: string | null }>(
        `SELECT status, corpo #>> '{nota,chave}' AS chave_nota FROM integracao_fdv.retorno_enviado
          WHERE tenant_id = $1 AND pedido_uuid = $2 AND estado = 'enviado' AND deleted_at IS NULL
          ORDER BY ${casoOrdemHub('status')} DESC, enviado_em DESC, id DESC LIMIT 1`,
        [evento.tenant_id, uuid],
      );
      const chavesProduto = evento.nome === 'pedido.pedido.faturado@1' ? await chavesHubDosProdutos(tx, evento.tenant_id, (payload.data.itens_faturados ?? []).map((i) => i.produto_id)) : new Map<string, string>();
      const agora = deps.relogio.agora();
      const decisao = retornoDoPedido({ nome: evento.nome, ocorrido_em: evento.ocorrido_em, payload: payload.data }, ultimo[0]?.status ?? null, chavesProduto, agora, ultimo[0]?.chave_nota ?? null);
      if (decisao.acao === 'descartar_sem_chave') {
        // Prazo vencido (RN-PED-05): o evento termina sem erro (o despachante não repete mais). O registro `falhou` leva só os UUIDs dos produtos sem chave.
        const criou = await gravarRetorno(tx, evento.tenant_id, decisao.corpo, agora, { produtos: decisao.produtos });
        if (criou) {
          deps.log.error({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', pedido_uuid: uuid, codigo: 'retorno_sem_chave_produto', produtos: decisao.produtos.length }, 'retorno faturado descartado: produto sem chave do Hub');
          deps.alertar?.(evento.tenant_id, 'retorno_sem_chave_produto', { pedido_uuid: uuid });
        }
        return;
      }
      if (decisao.acao === 'aguardar_chave') {
        deps.log.warn({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', pedido_uuid: uuid, codigo: 'produto_sem_chave_no_espelho', produtos: decisao.produtos.length }, 'retorno faturado aguarda a chave do produto');
        throw new ChaveDoProdutoAusente();
      }
      if (decisao.acao === 'enviar') {
        if (decisao.itens_fracionarios?.length) {
          // T-0085: só sequência e contagem no log, nunca o valor da quantidade
          deps.log.warn({ tenant_id: evento.tenant_id, modulo: 'integracao-fdv', pedido_uuid: uuid, codigo: 'quantidade_fracionaria', sequencias: decisao.itens_fracionarios }, 'item faturado fracionário fora do retorno: o FDV só aceita inteiro');
        }
        await gravarRetorno(tx, evento.tenant_id, decisao.corpo, agora);
      }
    },
  };
}

export interface DepsEnvioRetorno {
  /** Só o que o envio usa: o HTTP nunca roda dentro destas transações. */
  banco: Pick<Banco, 'comTenant'>;
  hub: ClienteHubPedidos;
  relogio: Relogio;
  log: LogPedidos;
  alertar: Alertar;
  /**
   * Fim da posse da reserva da agenda (`ContextoAgenda.posseAte`). Com ele: o envio para quando falta menos que a
   * `MARGEM_POSSE_AGENDA_MS` e toda regravação de `proximo_retorno_em` só vale se ele ainda for este valor. Sem ele
   * (chamada fora da agenda) a regravação é incondicional.
   */
  posseAte?: Date;
}
export interface ResumoEnvio {
  enviados: number;
  falhou: number;
  reagendados: number;
  /** 401/403/426: a credencial pausa o conector, com o motivo (401: `credencial`; 403: `credencial` ou `licenca_fdv`; 426: `versao`). */
  motivoPausa?: MotivoPausa;
  /** O envio parou antes do fim da posse da reserva (o que sobrou volta já, se a posse ainda for desta reserva). */
  posseCurta?: boolean;
  /** A posse se perdeu (outra reserva ou um `agendarRetorno` mexeu em `proximo_retorno_em`): o envio parou sem regravar nada. */
  possePerdida?: boolean;
}

/** Regrava `sinal.proximo_retorno_em`: presa à posse (`adiarPresoAPosse`, o único caminho) quando há `posseAte`; sem ela, incondicional. */
async function gravarProximoRetorno(tx: Transacao, tenantId: string, para: Date, posseAte?: Date): Promise<void> {
  if (posseAte) return adiarPresoAPosse(tx, tenantId, { sinal: 'proximo_retorno_em' }, posseAte, para);
  await tx.consultar(`UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId, para]);
}

const RODADAS_MAX = 20;
const LOTE = 50;

export async function enviarRetornosPendentes(d: DepsEnvioRetorno, tenantId: string): Promise<ResumoEnvio> {
  const r: ResumoEnvio = { enviados: 0, falhou: 0, reagendados: 0 };
  for (let rodada = 0; rodada < RODADAS_MAX; rodada++) {
    // Na mesma transação: a posse ainda é desta reserva? A cabeça da fila de cada pedido: um retorno pendente antigo segura os seguintes.
    const lido = await d.banco.comTenant(tenantId, async (tx) => {
      if (d.posseAte) {
        const [p] = await tx.consultar<{ ok: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM integracao_fdv.sinal WHERE tenant_id = $1 AND proximo_retorno_em = $2) AS ok`,
          [tenantId, d.posseAte],
        );
        if (!p?.ok) return 'posse_perdida' as const; // outro processo mexeu na coluna: a decisão é dele, não se regrava nada
      }
      const linhas = await tx.consultar<{ id: string; pedido_uuid: string; corpo: RetornoErp; tentativas: number }>(
        `SELECT r.id, r.pedido_uuid, r.corpo, r.tentativas FROM integracao_fdv.retorno_enviado r
          WHERE r.tenant_id = $1 AND r.estado = 'pendente' AND r.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM integracao_fdv.retorno_enviado a
                             WHERE a.tenant_id = r.tenant_id AND a.pedido_uuid = r.pedido_uuid AND a.estado = 'pendente'
                               AND a.deleted_at IS NULL AND (a.created_at, a.id) < (r.created_at, r.id))
          ORDER BY r.created_at, r.id LIMIT $2`,
        [tenantId, LOTE],
      );
      if (linhas.length === 0) {
        // Só zera se nada ficou pendente e, com posse, só se ela ainda é desta reserva: um retorno gravado depois da leitura não perde o wakeup.
        await tx.consultar(
          `UPDATE integracao_fdv.sinal SET proximo_retorno_em = NULL
            WHERE tenant_id = $1 AND deleted_at IS NULL
              AND ($2::timestamptz IS NULL OR proximo_retorno_em = $2)
              AND NOT EXISTS (SELECT 1 FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1 AND estado = 'pendente' AND deleted_at IS NULL)`,
          [tenantId, d.posseAte ?? null],
        );
      }
      return linhas;
    });
    if (lido === 'posse_perdida') return { ...r, possePerdida: true };
    const fila = lido;
    if (fila.length === 0) return r;
    let progresso = false;
    for (const item of fila) {
      if (d.posseAte && d.relogio.agora().getTime() >= d.posseAte.getTime() - MARGEM_POSSE_AGENDA_MS) {
        // falta pouco para a posse vencer: o que sobrou volta já (só se o `proximo_retorno_em` ainda for o desta reserva)
        await d.banco.comTenant(tenantId, (tx) => gravarProximoRetorno(tx, tenantId, d.relogio.agora(), d.posseAte));
        return { ...r, posseCurta: true };
      }
      const resp = await d.hub.enviarRetorno(item.pedido_uuid, item.corpo);
      const agora = d.relogio.agora();
      const motivoPausa = motivoDaRecusa(resp.status, resp.codigo);
      if (motivoPausa) return { ...r, motivoPausa };
      if (resp.status >= 200 && resp.status < 300) {
        const descartados = resp.itens_descartados ?? [];
        // Preso ao estado: zero linhas = outro worker já resolveu este retorno; o envio segue.
        await d.banco.comTenant(tenantId, (tx) =>
          tx.consultar(
            `UPDATE integracao_fdv.retorno_enviado SET estado = 'enviado', enviado_em = $3, resposta_http = $4,
                    itens_descartados = $5::jsonb, tentativas = tentativas + 1
              WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente'`,
            [tenantId, item.id, agora, resp.status, descartados.length ? JSON.stringify(descartados) : null],
          ),
        );
        if (descartados.length) d.alertar(tenantId, 'retorno_itens_descartados', { pedido_uuid: item.pedido_uuid });
        r.enviados++;
        progresso = true;
      } else if (resp.status !== 400 && resp.status !== 422) {
        // Rede (0), 429, 5xx e qualquer outro status que não seja 2xx nem 400/422 (3xx, 404, 409...): o Hub pode se corrigir, reagenda pela curva.
        const inesperado = !(resp.status === 0 || resp.status === 429 || resp.status >= 500);
        const espera = atrasoRetentativaSegundos(item.tentativas + 1, resp.retryAfterS) * 1000;
        await d.banco.comTenant(tenantId, async (tx) => {
          await tx.consultar(
            `UPDATE integracao_fdv.retorno_enviado SET tentativas = tentativas + 1, resposta_http = $3
              WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente'`,
            [tenantId, item.id, resp.status === 0 ? null : resp.status],
          );
          await gravarProximoRetorno(tx, tenantId, new Date(agora.getTime() + espera), d.posseAte);
        });
        if (inesperado) d.alertar(tenantId, 'retorno_hub_status_inesperado', { pedido_uuid: item.pedido_uuid, codigo: codigoSeguro(resp.codigo, resp.status) });
        d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', pedido_uuid: item.pedido_uuid, http: resp.status, espera_ms: espera }, 'retorno ao Hub reagendado');
        r.reagendados++;
        return r; // Hub fora do ar ou resposta inesperada: não adianta insistir nos outros agora
      } else {
        // 400 e 422: definitivos (o Hub recusou o retorno; sem estado 'ignorado' no CHECK: fica 'falhou'). Só o código do Hub vai ao monitor.
        // 422 transicao_invalida só é silenciado com PROVA LOCAL de regressão (RN-PED-05): na mesma transação do UPDATE, um retorno ACEITO ('enviado')
        // do mesmo pedido de ordem >= à deste (`ORDEM_HUB`; terminal incluso, e parcial aceito vale para parcial, com nota igual ou diferente).
        // Sem a prova, o alerta `retorno_recusado_pelo_hub` segue como antes.
        const candidato = resp.status === 422 && resp.codigo === 'transicao_invalida';
        const regressao = await d.banco.comTenant(tenantId, async (tx) => {
          let prova = false;
          if (candidato) {
            const [p] = await tx.consultar<{ ok: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM integracao_fdv.retorno_enviado
                               WHERE tenant_id = $1 AND pedido_uuid = $2 AND estado = 'enviado' AND deleted_at IS NULL
                                 AND ${casoOrdemHub('status')} >= ${casoOrdemHub('$3::text')}) AS ok`,
              [tenantId, item.pedido_uuid, item.corpo.status],
            );
            prova = p?.ok === true;
          }
          await tx.consultar(
            `UPDATE integracao_fdv.retorno_enviado SET estado = 'falhou', resposta_http = $3, tentativas = tentativas + 1
              WHERE tenant_id = $1 AND id = $2 AND estado = 'pendente'`,
            [tenantId, item.id, resp.status],
          );
          return prova;
        });
        if (regressao) d.log.info({ tenant_id: tenantId, modulo: 'integracao-fdv', pedido_uuid: item.pedido_uuid, http: 422, codigo: 'transicao_invalida' }, 'retorno ignorado: o Hub já está adiante (prova local)');
        else d.alertar(tenantId, 'retorno_recusado_pelo_hub', { pedido_uuid: item.pedido_uuid, codigo: codigoSeguro(resp.codigo, resp.status) });
        r.falhou++;
        progresso = true;
      }
    }
    if (!progresso) return r;
  }
  // rodadas esgotadas com fila: volta já
  await d.banco.comTenant(tenantId, (tx) => gravarProximoRetorno(tx, tenantId, d.relogio.agora(), d.posseAte));
  return r;
}
