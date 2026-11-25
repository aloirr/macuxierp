/**
 * Busca e decisão dos pré-cadastros de cliente do FDV (T-0059 §5.1; RN-INT-22 do FDV; RN-INF-06). Uma transação por
 * pré-cadastro: grava a revisão em `cliente_recebido`, chama a porta `CriadorClienteFdv` (que valida pelas RN de cliente e,
 * se aceita, cria o cliente), grava a decisão e enfileira o retorno em `cliente_retorno`, tudo na mesma transação.
 * - A mesma revisão entregue de novo (o FDV não viu o retorno) não revalida: soma `tentativas_fdv` e o retorno volta a `pendente`.
 * - Revisão nova de um recusado vira `reenviado`; as revisões anteriores ficam como histórico.
 * - Exceção na decisão desfaz a transação inteira: o FDV devolve o pendente em 10 min (sem retorno parcial).
 * Nunca lê tabela do FDV (só a API do Hub). Log só com ids e códigos: nem nome, nem documento, nem o payload (LGPD).
 */
import { LIMITE_CLIENTES_PENDENTES_FDV, MARGEM_POSSE_AGENDA_MS, montarRetornoClienteFdv, type Banco, type Relogio, type Transacao } from '@macuxierp/platform-sdk';
import type { MotivoPausa } from '../contracts';
import { decisaoParaGravar, hashDoRetornoCliente, lerPreCadastroFdv, situacaoDeChegada } from '../domain';
import type { Alertar, ClienteHubClientes, CriadorClienteFdv, LogPedidos } from './portas';
import { agendarRetornoCliente } from './util-clientes';
import { motivoDaRecusa } from './util-pedidos';

/** Teto de páginas por execução (desenho §2): o Hub marca `enviado` a cada GET, então a busca repete até a lista vir vazia. */
export const MAX_PAGINAS_BUSCA_CLIENTES = 10;

export interface DepsRecebimentoClientes {
  banco: Pick<Banco, 'comTenant'>;
  hub: ClienteHubClientes;
  criador: CriadorClienteFdv;
  relogio: Relogio;
  log: LogPedidos;
  alertar: Alertar;
  /** `MACUXIERP_FDV_CLIENTE_REVISAO` (`aditivosClienteFdvLigados`): com ele o retorno leva `revisao` e `erros`. */
  aditivos: boolean;
  /** Fim da posse da reserva da agenda: a busca para antes dele (`MARGEM_POSSE_AGENDA_MS`). */
  posseAte?: Date;
}

export interface ResumoBuscaClientes {
  /** `imediata` = sobrou página (teto de páginas ou posse curta); `pausa` = 401/403/426; `erro` = Hub fora; `intervalo` = fim normal. */
  proxima: 'imediata' | 'intervalo' | 'pausa' | 'erro';
  buscados: number;
  aceitos: number;
  recusados: number;
  repetidos: number;
  ignorados: number;
  erros: number;
  retryAfterS?: number;
  motivoPausa?: MotivoPausa;
  posseCurta?: boolean;
}

type Desfecho = 'aceito' | 'recusado' | 'repetido' | 'ignorado';

async function processar(tx: Transacao, d: DepsRecebimentoClientes, tenantId: string, bruto: unknown): Promise<Desfecho> {
  const l = lerPreCadastroFdv(bruto);
  if (!l.ok) {
    // Só o nome dos campos: nunca o valor (LGPD). O Hub devolve o pendente em 10 min; o monitor recebe o alerta.
    d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', codigo: 'pre_cadastro_fora_do_contrato', campos: l.campos }, 'pré-cadastro do Hub fora do contrato: ignorado');
    d.alertar(tenantId, 'pre_cadastro_fora_do_contrato');
    return 'ignorado';
  }
  const agora = d.relogio.agora();
  const uuid = l.pre.cliente_uuid;

  const [existente] = await tx.consultar<{ id: string; situacao: string; hash: string }>(
    `SELECT id, situacao, hash FROM integracao_fdv.cliente_recebido
      WHERE tenant_id = $1 AND cliente_uuid = $2 AND revisao = $3 AND deleted_at IS NULL FOR UPDATE`,
    [tenantId, uuid, l.revisao],
  );
  if (existente) {
    if (existente.hash !== l.hash) d.alertar(tenantId, 'pre_cadastro_conteudo_divergente', { cliente_uuid: uuid });
    await tx.consultar(`UPDATE integracao_fdv.cliente_recebido SET tentativas_fdv = tentativas_fdv + 1 WHERE tenant_id = $1 AND id = $2`, [tenantId, existente.id]);
    if (existente.situacao === 'aceito' || existente.situacao === 'recusado') {
      // O FDV não viu o retorno: o mesmo retorno sai de novo (o Hub responde `repetido`). `falhou` é terminal e fica como está.
      await tx.consultar(
        `UPDATE integracao_fdv.cliente_retorno SET estado = 'pendente'
          WHERE tenant_id = $1 AND cliente_uuid = $2 AND revisao = $3 AND estado = 'enviado'`,
        [tenantId, uuid, l.revisao],
      );
      await agendarRetornoCliente(tx, tenantId, agora);
      return 'repetido';
    }
  } else {
    const [anterior] = await tx.consultar<{ revisao: number; situacao: string }>(
      `SELECT revisao, situacao FROM integracao_fdv.cliente_recebido
        WHERE tenant_id = $1 AND cliente_uuid = $2 AND deleted_at IS NULL ORDER BY revisao DESC LIMIT 1`,
      [tenantId, uuid],
    );
    const criada = await tx.consultar<{ id: string }>(
      `INSERT INTO integracao_fdv.cliente_recebido
         (tenant_id, cliente_uuid, revisao, hash, codigo_fdv, razao_social, documento_mascarado, vendedor_external_id, payload, recebido_em, situacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (tenant_id, cliente_uuid, revisao) DO NOTHING RETURNING id`,
      [tenantId, uuid, l.revisao, l.hash, l.codigo_fdv, l.pre.razao_social, l.documento_mascarado, l.vendedor_external_id, JSON.stringify(l.payload), new Date(l.pre.recebido_em), situacaoDeChegada(l.revisao, anterior ?? null)],
    );
    if (criada.length === 0) {
      // outra execução gravou esta revisão no meio: ela decide; aqui só soma a tentativa
      await tx.consultar(`UPDATE integracao_fdv.cliente_recebido SET tentativas_fdv = tentativas_fdv + 1 WHERE tenant_id = $1 AND cliente_uuid = $2 AND revisao = $3`, [tenantId, uuid, l.revisao]);
      return 'repetido';
    }
  }

  const decisao = await d.criador.decidir(tx, tenantId, l.pre);
  const g = decisaoParaGravar(decisao, agora);
  await tx.consultar(
    `UPDATE integracao_fdv.cliente_recebido
        SET situacao = $4, motivo = $5, erros = $6::jsonb, cliente_id = $7, decidido_em = $8, ultima_recusa_em = $9,
            payload = CASE WHEN $4 = 'aceito' THEN NULL ELSE payload END
      WHERE tenant_id = $1 AND cliente_uuid = $2 AND revisao = $3`,
    [tenantId, uuid, l.revisao, g.situacao, g.motivo, g.erros ? JSON.stringify(g.erros) : null, g.cliente_id, agora, g.ultima_recusa_em],
  );
  const corpo = montarRetornoClienteFdv({ cliente_uuid: uuid, revisao: l.pre.revisao }, decisao, { aditivos: d.aditivos, ocorrido_em: agora.toISOString() });
  await tx.consultar(
    `INSERT INTO integracao_fdv.cliente_retorno (tenant_id, cliente_uuid, revisao, status, corpo, hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (tenant_id, cliente_uuid, revisao, status, hash) DO NOTHING`,
    [tenantId, uuid, l.revisao, corpo.status, JSON.stringify(corpo), hashDoRetornoCliente(corpo)],
  );
  await agendarRetornoCliente(tx, tenantId, agora);
  return g.situacao === 'aceito' ? 'aceito' : 'recusado';
}

/** Busca no Hub e decide cada pré-cadastro, numa transação por pré-cadastro. */
export async function buscarClientesPendentes(d: DepsRecebimentoClientes, tenantId: string): Promise<ResumoBuscaClientes> {
  const r: ResumoBuscaClientes = { proxima: 'intervalo', buscados: 0, aceitos: 0, recusados: 0, repetidos: 0, ignorados: 0, erros: 0 };
  const curta = (): boolean => d.posseAte != null && d.relogio.agora().getTime() >= d.posseAte.getTime() - MARGEM_POSSE_AGENDA_MS;
  const limite = LIMITE_CLIENTES_PENDENTES_FDV.padrao;
  for (let pagina = 0; pagina < MAX_PAGINAS_BUSCA_CLIENTES; pagina++) {
    if (curta()) return { ...r, proxima: 'imediata', posseCurta: true };
    const resp = await d.hub.pendentes(limite);
    const motivoPausa = motivoDaRecusa(resp.status, resp.codigo);
    if (motivoPausa) return { ...r, proxima: 'pausa', motivoPausa };
    if (resp.status < 200 || resp.status >= 300 || !resp.clientes) {
      d.log.warn({ tenant_id: tenantId, modulo: 'integracao-fdv', http: resp.status }, 'busca de pré-cadastros no Hub falhou');
      return { ...r, proxima: 'erro', ...(resp.retryAfterS != null ? { retryAfterS: resp.retryAfterS } : {}) };
    }
    r.buscados += resp.clientes.length;
    for (const bruto of resp.clientes) {
      if (curta()) return { ...r, proxima: 'imediata', posseCurta: true };
      try {
        const desfecho = await d.banco.comTenant(tenantId, (tx) => processar(tx, d, tenantId, bruto));
        if (desfecho === 'aceito') r.aceitos++;
        else if (desfecho === 'recusado') r.recusados++;
        else if (desfecho === 'repetido') r.repetidos++;
        else r.ignorados++;
      } catch (e) {
        // Só o tipo do erro: a mensagem pode carregar valor do pré-cadastro (LGPD). A transação foi desfeita; o Hub devolve em 10 min.
        r.erros++;
        d.log.error({ tenant_id: tenantId, modulo: 'integracao-fdv', codigo: 'pre_cadastro_falha_interna', erro: e instanceof Error ? e.name : 'erro' }, 'falha ao decidir o pré-cadastro do FDV');
        d.alertar(tenantId, 'pre_cadastro_falha_interna');
      }
    }
    if (resp.clientes.length < limite) return r;
  }
  return { ...r, proxima: 'imediata' };
}
