/**
 * Sinal de vida (1 min) e reconciliação diária (06h00 UTC) do conector (T-0009 seção 6; RF-INF-04). Sem dado pessoal: o corpo
 * leva só contagens, datas e a situação por entidade (`domain/corpo.ts`, formato conferido contra o Hub do FDV). A chamada
 * HTTP nunca segura transação. Credencial já recusada nunca é chamada de novo (o limite de falhas de autenticação do Hub é
 * por IP, compartilhado por todos os tenants da VM).
 */
import { ehMotivoSondavelFdv, type ContextoAgenda, type ItemAgenda, type Transacao } from '@macuxierp/platform-sdk';
import { ENTIDADES_HUB_F2, type EntidadeHub, type MotivoPausa } from '../contracts';
import { atrasoRetentativaSegundos, classificarResposta, deveSondarCredencial, dataReferenciaReconciliacao, montarCorpoReconciliacao, montarCorpoSinal, proximaReconciliacaoEm, retryAfterSegundos } from '../domain';
import {
  ESTADOS_EM_VOO,
  RespostaSinalLida,
  UMA_HORA_S,
  abrirOuPausar,
  adiarPresoAPosse,
  avisarAgenda,
  limparPausasSondaveis,
  pausaSondavelMaisAntiga,
  renovarPausaSondavel,
  type CredencialAtiva,
  defeitoDoCliente,
  marcarUsoDaCredencial,
  mais,
  pausarEntidades,
  prepararCredencial,
  type ColunaSinalAgenda,
} from './conector-comum';

const INTERVALO_SINAL_S = 60;
const ESPERA_CREDENCIAL_RECUSADA_S = 300;
/** O que o sinal registra no log da agenda (sem chave nem corpo). */
type LogSondagem = { motivo: string; codigo: string | null; resultado: string };

type ColunaSinal = Extract<ColunaSinalAgenda, 'proximo_sinal_em' | 'proxima_reconciliacao_em'>;
const adiarSinal = (tx: Transacao, tenant: string, coluna: ColunaSinal, posseAte: Date, para: Date): Promise<void> => adiarPresoAPosse(tx, tenant, { sinal: coluna }, posseAte, para);

// ---- sinal ----

export async function executarSinal(item: ItemAgenda, ctx: ContextoAgenda): Promise<void> {
  const tenant = item.tenant_id;
  const agora = ctx.agora;
  const base = await ctx.emTransacao(async (tx) => {
    // credencial já recusada: só o sinal sonda o Hub, 1 chamada após 30 min da pausa mais antiga (decisão 25 B); antes disso não chama
    let paraSondar = null as { c: CredencialAtiva; motivo: MotivoPausa } | null;
    const pronta = await prepararCredencial(tx, tenant, {
      semCredencial: () => adiarSinal(tx, tenant, 'proximo_sinal_em', ctx.posseAte, mais(agora, UMA_HORA_S)),
      recusada: async (c) => {
        const pausa = await pausaSondavelMaisAntiga(tx, tenant);
        if (pausa && deveSondarCredencial(pausa.pausada_em, agora)) paraSondar = { c, motivo: pausa.motivo };
        else await adiarSinal(tx, tenant, 'proximo_sinal_em', ctx.posseAte, mais(agora, ESPERA_CREDENCIAL_RECUSADA_S));
      },
    });
    const credencial = pronta ?? paraSondar?.c ?? null;
    if (!credencial) return null;
    const sondagem = pronta ? null : (paraSondar?.motivo ?? null);
    const pendentes = await tx.consultar<{ entidade: EntidadeHub; registros: number; mais_antigo: Date | null }>(
      `SELECT entidade, count(*)::int AS registros, min(alterado_em) AS mais_antigo
         FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND pendente AND deleted_at IS NULL GROUP BY entidade`,
      [tenant],
    );
    const emVoo = await tx.consultar<{ entidade: EntidadeHub; lotes: number; registros: number }>(
      `SELECT entidade, count(*)::int AS lotes, coalesce(sum(jsonb_array_length(corpo -> 'registros')), 0)::int AS registros
         FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND estado = ANY($2::text[]) AND deleted_at IS NULL GROUP BY entidade`,
      [tenant, [...ESTADOS_EM_VOO]],
    );
    const entidades = await tx.consultar<{ entidade: EntidadeHub; ultimo_sucesso_em: Date | null; completa: boolean; pausada_motivo: MotivoPausa | null }>(
      `SELECT entidade, ultimo_sucesso_em, (cursor_alterado_em IS NULL OR sessao_aberta_id IS NOT NULL) AS completa, pausada_motivo
         FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY entidade`,
      [tenant],
    );
    return { credencial, sondagem, pendentes, emVoo, entidades };
  });
  if (!base) return;
  const cred = await abrirOuPausar(ctx, tenant, base.credencial);
  if (!cred) return;
  const paradoPorVersao = base.entidades.some((x) => x.pausada_motivo === 'versao');
  const corpo = montarCorpoSinal({
    conectorId: cred.conectorId,
    em: agora.toISOString(),
    pendentes: Object.fromEntries(base.pendentes.map((p) => [p.entidade, { registros: p.registros, maisAntigo: p.mais_antigo?.toISOString() ?? null }])),
    emVoo: Object.fromEntries(base.emVoo.map((v) => [v.entidade, { lotes: v.lotes, registros: v.registros }])),
    entidades: base.entidades.map((x) => ({ entidade: x.entidade, ultimo_sucesso_em: x.ultimo_sucesso_em?.toISOString() ?? null, completa: x.completa, pausada_motivo: x.pausada_motivo })),
    paradoPorVersao,
    limiteRegistrosLote: base.credencial.limite_registros_lote,
  });
  let resp;
  try {
    resp = await ctx.hub.chamar(cred, { metodo: 'POST', caminho: '/sinal', corpo });
  } catch (e) {
    const d = defeitoDoCliente(e);
    if (!d) throw e;
    await ctx.emTransacao((tx) => adiarSinal(tx, tenant, 'proximo_sinal_em', ctx.posseAte, mais(agora, ESPERA_CREDENCIAL_RECUSADA_S)));
    if (d.credencial) {
      await ctx.emTransacao((tx) => (base.sondagem ? renovarPausaSondavel(tx, tenant, 'credencial', base.credencial.id, agora) : pausarEntidades(tx, tenant, null, 'credencial', base.credencial.id, agora)));
      avisarAgenda(ctx, { tenant_id: tenant, entidade: 'todas', motivo: 'credencial', codigo_hub: d.codigo, http: null, resultado: base.sondagem ? 'sondagem_recusada' : 'pausada' }, 'conector: sinal recusado');
    }
    return;
  }
  let log: LogSondagem | null = null;
  await ctx.emTransacao(async (tx) => {
    const status = resp.status;
    if (resp.tipo === 'ok') {
      const lida = RespostaSinalLida.safeParse(resp.corpo);
      await tx.consultar(
        `UPDATE integracao_fdv.sinal
            SET ultimo_envio_em = $2, ultimo_aceito_em = $2, ultimo_http = $3, politica_versao = $4::jsonb, parado_por_versao = $5, ultimo_codigo = NULL
          WHERE tenant_id = $1`,
        [tenant, agora, status, lida.success && lida.data.politica_versao ? JSON.stringify(lida.data.politica_versao) : null, paradoPorVersao],
      );
      await marcarUsoDaCredencial(tx, tenant, base.credencial.id, agora);
      if (base.sondagem) {
        await limparPausasSondaveis(tx, tenant, base.credencial.id, agora);
        log = { motivo: base.sondagem, codigo: null, resultado: 'sondagem_retomada' };
      }
      await adiarSinal(tx, tenant, 'proximo_sinal_em', ctx.posseAte, mais(agora, INTERVALO_SINAL_S));
      return;
    }
    const acao = classificarResposta(resp);
    // código do Hub (ou `http_<status>`); sem status (rede) mantém o anterior
    const codigoHub = 'codigo' in acao ? acao.codigo : status != null ? `http_${status}` : null;
    await tx.consultar(
      `UPDATE integracao_fdv.sinal SET ultimo_envio_em = $2, ultimo_http = coalesce($3::int, ultimo_http), parado_por_versao = $4, ultimo_codigo = coalesce($5::text, ultimo_codigo) WHERE tenant_id = $1`,
      [tenant, agora, status, paradoPorVersao, codigoHub],
    );
    if (acao.acao === 'pausar' && ehMotivoSondavelFdv(acao.motivo)) {
      if (base.sondagem) await renovarPausaSondavel(tx, tenant, acao.motivo, base.credencial.id, agora);
      else await pausarEntidades(tx, tenant, null, acao.motivo, base.credencial.id, agora);
      log = { motivo: acao.motivo, codigo: acao.codigo, resultado: base.sondagem ? 'sondagem_recusada' : 'pausada' };
      await adiarSinal(tx, tenant, 'proximo_sinal_em', ctx.posseAte, mais(agora, ESPERA_CREDENCIAL_RECUSADA_S));
      return;
    }
    if (base.sondagem) log = { motivo: base.sondagem, codigo: codigoHub, resultado: 'sondagem_sem_resposta' };
    const espera = acao.acao === 'retentar' ? Math.max(INTERVALO_SINAL_S, acao.retryAfterSegundos ?? 0) : ESPERA_CREDENCIAL_RECUSADA_S;
    await adiarSinal(tx, tenant, 'proximo_sinal_em', ctx.posseAte, mais(agora, espera));
  });
  const l = log as LogSondagem | null;
  if (l) avisarAgenda(ctx, { tenant_id: tenant, entidade: 'todas', motivo: l.motivo, codigo_hub: l.codigo, http: resp.status, resultado: l.resultado }, 'conector: pausa da credencial');
}

// ---- reconciliação ----

export async function executarReconciliacao(item: ItemAgenda, ctx: ContextoAgenda): Promise<void> {
  const tenant = item.tenant_id;
  const agora = ctx.agora;
  const dia = dataReferenciaReconciliacao(agora);
  const base = await ctx.emTransacao(async (tx) => {
    // sem credencial ou com a credencial já recusada: nada é chamado, volta a olhar em 1 h
    const adiarUmaHora = (): Promise<void> => adiarSinal(tx, tenant, 'proxima_reconciliacao_em', ctx.posseAte, mais(agora, UMA_HORA_S));
    const credencial = await prepararCredencial(tx, tenant, { semCredencial: adiarUmaHora, recusada: adiarUmaHora });
    if (!credencial) return null;
    // só entidades que já tiveram um lote concluído (o Hub tem o que comparar) e ainda sem reconciliação do dia
    const contagens = await tx.consultar<{ entidade: EntidadeHub; contagem: number }>(
      `SELECT c.entidade, (SELECT count(*)::int FROM integracao_fdv.registro_publicado r
                            WHERE r.tenant_id = $1 AND r.entidade = c.entidade AND r.ativo AND r.deleted_at IS NULL) AS contagem
         FROM integracao_fdv.cursor_entidade c
        WHERE c.tenant_id = $1 AND c.ultimo_sucesso_em IS NOT NULL AND c.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM integracao_fdv.reconciliacao x
                           WHERE x.tenant_id = $1 AND x.entidade = c.entidade AND x.data_referencia = $2::date AND x.resposta_http IS NOT NULL AND x.resposta_http < 500)
        ORDER BY c.entidade`,
      [tenant, dia],
    );
    return { credencial, contagens };
  });
  if (!base) return;
  const cred = await abrirOuPausar(ctx, tenant, base.credencial);
  if (!cred) return;
  const ordem = new Map(ENTIDADES_HUB_F2.map((e, i) => [e, i]));
  let proxima = proximaReconciliacaoEm(agora);
  for (const c of [...base.contagens].sort((a, b) => (ordem.get(a.entidade) ?? 99) - (ordem.get(b.entidade) ?? 99))) {
    let resp;
    try {
      resp = await ctx.hub.chamar(cred, { metodo: 'POST', caminho: '/reconciliacoes', corpo: montarCorpoReconciliacao(c.entidade, dia, c.contagem) });
    } catch (e) {
      // defeito do ERP no uso da porta (`ErroClienteHub`): repetir não conserta; adia para a próxima reconciliação e, se a
      // credencial é a culpada, pausa (como o sinal)
      const d = defeitoDoCliente(e);
      if (!d) throw e;
      if (d.credencial) await ctx.emTransacao((tx) => pausarEntidades(tx, tenant, null, 'credencial', base.credencial.id, agora));
      break;
    }
    if (resp.tipo === 'retentavel') {
      proxima = mais(agora, atrasoRetentativaSegundos(1, retryAfterSegundos(resp.retryAfterMs)) + 60);
      break;
    }
    const acao = classificarResposta(resp);
    if (acao.acao === 'pausar' && ehMotivoSondavelFdv(acao.motivo)) {
      await ctx.emTransacao((tx) => pausarEntidades(tx, tenant, null, acao.motivo, base.credencial.id, agora));
      avisarAgenda(ctx, { tenant_id: tenant, entidade: 'todas', motivo: acao.motivo, codigo_hub: acao.codigo, http: resp.status, resultado: 'pausada' }, 'conector: pausa da credencial');
      break;
    }
    await ctx.emTransacao((tx) =>
      tx.consultar(
        `INSERT INTO integracao_fdv.reconciliacao (tenant_id, entidade, data_referencia, contagem, resposta_http, enviado_em)
         VALUES ($1, $2, $3::date, $4, $5, $6)
         ON CONFLICT (tenant_id, entidade, data_referencia) DO UPDATE
            SET contagem = EXCLUDED.contagem, resposta_http = EXCLUDED.resposta_http, enviado_em = EXCLUDED.enviado_em, deleted_at = NULL`,
        [tenant, c.entidade, dia, c.contagem, resp.status, resp.tipo === 'ok' ? agora : null],
      ),
    );
  }
  await ctx.emTransacao((tx) => adiarSinal(tx, tenant, 'proxima_reconciliacao_em', ctx.posseAte, proxima));
}
