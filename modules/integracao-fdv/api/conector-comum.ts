/**
 * Peças comuns da agenda do conector (envio, sinal, reconciliação): credencial ativa (leitura, abertura e pausa), pausa por
 * motivo, regravação do `proximo*_em` presa à posse da reserva (`adiarPresoAPosse`) e leitura tolerante das respostas do Hub.
 * `tenant_id` explícito em todo SQL (as tabelas da agenda têm a política `worker_global`: o papel do worker as enxerga de
 * todos os tenants). Sem `SELECT *`. A chave do conector só existe em memória, dentro de `abrirOuPausar`: nunca vai a log,
 * erro, banco nem evento.
 */
import { ErroClienteHub, type ContextoAgenda, type CredencialHub, type ItemAgenda, type Outbox, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { AmbienteHub, CursorHub, type MotivoPausa } from '../contracts';
import { ESTADOS_EM_VOO, proximaReconciliacaoEm } from '../domain';

export const UMA_HORA_S = 3600;
export { ESTADOS_EM_VOO };

export const mais = (d: Date, segundos: number): Date => new Date(d.getTime() + segundos * 1000);

/** Dependências da agenda do conector (e do envio, que roda dentro dela). */
export interface DepsAgendaConector {
  /** Outbox da plataforma (`OutboxPg` no worker): `lote.enviado@1` e `lote.falhou@1` saem na transação do lote. */
  outbox: Outbox;
}

/** Credencial ativa do tenant, ainda cifrada. Só colunas nomeadas (recado R-20261121-221350). */
interface CredencialAtiva {
  id: string;
  conector_id: string;
  ambiente: AmbienteHub;
  chave_cifrada: Uint8Array;
  chave_mestra_versao: number;
  /** Entidades que o conector envia (0015); vazia = publicação desligada. */
  entidades_habilitadas: string[];
  /** Teto de registros por lote da credencial (1 a 5.000, 0015); `limiteRegistrosDoLote` aplica o teto do contrato. */
  limite_registros_lote: number;
}

async function lerCredencialAtiva(tx: Transacao, tenantId: string): Promise<CredencialAtiva | null> {
  const [c] = await tx.consultar<CredencialAtiva>(
    `SELECT id, conector_id, ambiente, chave_cifrada, chave_mestra_versao, entidades_habilitadas::text[] AS entidades_habilitadas, limite_registros_lote
       FROM integracao_fdv.credencial
      WHERE tenant_id = $1 AND substituida_em IS NULL AND deleted_at IS NULL AND chave_cifrada IS NOT NULL`,
    [tenantId],
  );
  return c ?? null;
}

/**
 * Credencial pronta para chamar o Hub: lida e ainda cifrada. Sem credencial ativa chama `semCredencial`; com a credencial
 * já recusada pelo Hub (pausa de credencial ou de licença do FDV) chama `recusada`: nada é chamado de novo (limite de falhas
 * por IP). Em ambos os casos devolve `null`; cada tarefa decide o que fazer (adiar, pausar).
 */
export async function prepararCredencial(
  tx: Transacao,
  tenantId: string,
  aoFaltar: { semCredencial: () => Promise<void>; recusada: (c: CredencialAtiva) => Promise<void> },
): Promise<CredencialAtiva | null> {
  const c = await lerCredencialAtiva(tx, tenantId);
  if (!c) {
    await aoFaltar.semCredencial();
    return null;
  }
  if (await credencialJaRecusada(tx, tenantId, c.id)) {
    await aoFaltar.recusada(c);
    return null;
  }
  return c;
}

/** A chave não abriu (versão desconhecida, adulterada ou de outro tenant): defeito de configuração, a credencial pausa. */
class CredencialIlegivel extends Error {
  override readonly name = 'CredencialIlegivel';
}

function abrirCredencial(ctx: Pick<ContextoAgenda, 'decifrarCredencial'>, c: CredencialAtiva, tenantId: string): CredencialHub {
  try {
    return { conectorId: c.conector_id, chave: ctx.decifrarCredencial(c.chave_cifrada, tenantId, c.chave_mestra_versao), ambiente: AmbienteHub.parse(c.ambiente) };
  } catch {
    // mensagem fixa: a original da cifra não vai adiante
    throw new CredencialIlegivel('credencial ilegível');
  }
}

/** Abre a chave só em memória, na hora da chamada. Se não abrir, pausa a credencial (todas as entidades) e devolve `null`. */
export async function abrirOuPausar(ctx: ContextoAgenda, tenantId: string, c: CredencialAtiva): Promise<CredencialHub | null> {
  try {
    return abrirCredencial(ctx, c, tenantId);
  } catch (e) {
    if (!(e instanceof CredencialIlegivel)) throw e;
    await ctx.emTransacao((tx) => pausarEntidades(tx, tenantId, null, 'credencial', c.id, ctx.agora));
    return null;
  }
}

/** Erro de uso da porta que repetir não conserta (defeito do ERP): código do catálogo e se a credencial é a culpada. */
export function defeitoDoCliente(e: unknown): { codigo: string; credencial: boolean } | null {
  if (!(e instanceof ErroClienteHub)) return null;
  return e.codigo === 'credencial_invalida' || e.codigo === 'ambiente_invalido' ? { codigo: 'credencial_invalida', credencial: true } : { codigo: e.codigo, credencial: false };
}

/** Onde mora o `proximo*_em` da tarefa: a linha da entidade em `cursor_entidade` ou uma coluna da linha única de `sinal`. */
export type ColunaSinalAgenda = 'proximo_sinal_em' | 'proxima_reconciliacao_em' | 'proxima_busca_pedidos_em' | 'proximo_retorno_em' | 'proxima_busca_clientes_em' | 'proximo_retorno_clientes_em';
type AlvoAgenda = { entidade: string } | { sinal: ColunaSinalAgenda };

/**
 * Regrava o `proximo*_em` da tarefa presa à posse: só muda se ainda for o `posseAte` desta reserva (se outro processo já
 * mexeu, a regravação não desfaz o que ele fez). Este é o único caminho de regravação presa à posse (sem `null`: desligar é do envio de retornos, que o faz com a fila vazia). As colunas vêm de uma união fechada, nunca de texto externo.
 */
export async function adiarPresoAPosse(tx: Transacao, tenantId: string, alvo: AlvoAgenda, posseAte: Date, para: Date): Promise<void> {
  if ('entidade' in alvo) {
    await tx.consultar(
      `UPDATE integracao_fdv.cursor_entidade SET proximo_em = $4 WHERE tenant_id = $1 AND entidade = $2 AND proximo_em = $3`,
      [tenantId, alvo.entidade, posseAte, para],
    );
    return;
  }
  const c = alvo.sinal;
  await tx.consultar(`UPDATE integracao_fdv.sinal SET ${c} = $3 WHERE tenant_id = $1 AND ${c} = $2`, [tenantId, posseAte, para]);
}

/**
 * Reserva das agendas que vivem numa coluna de `sinal` (`FOR NO KEY UPDATE SKIP LOCKED`, adiando a coluna para `posseAte` na
 * mesma transação). `coluna` vem de uma união fechada, nunca de texto externo. Em `semTenant` o papel do worker enxerga todos
 * os tenants.
 */
export async function reservarSinal(tx: Transacao, coluna: ColunaSinalAgenda, tarefa: string, limite: number, agora: Date, posseAte: Date): Promise<ItemAgenda[]> {
  const l = await tx.consultar<{ tenant_id: string }>(
    `WITH v AS (
       SELECT id FROM integracao_fdv.sinal WHERE ${coluna} <= $1 AND deleted_at IS NULL ORDER BY ${coluna} LIMIT $2 FOR NO KEY UPDATE SKIP LOCKED)
     UPDATE integracao_fdv.sinal s SET ${coluna} = $3 FROM v WHERE s.id = v.id RETURNING s.tenant_id`,
    [agora, limite, posseAte],
  );
  return l.map((x) => ({ tenant_id: x.tenant_id, tarefa, chave: null }));
}

/** Módulo sem licença: a tarefa de `sinal` volta a olhar em `para`. Não liga o que está desligado (coluna nula) nem linha apagada. */
export async function adiarSinalSemLicenca(tx: Transacao, tenantId: string, coluna: ColunaSinalAgenda, para: Date): Promise<void> {
  await tx.consultar(`UPDATE integracao_fdv.sinal SET ${coluna} = $2 WHERE tenant_id = $1 AND ${coluna} IS NOT NULL AND deleted_at IS NULL`, [tenantId, para]);
}

/**
 * Garante a linha única de `sinal` do tenant (nunca duas): sem ela a agenda não reserva o sinal de vida nem a reconciliação.
 * Nasce com sinal e busca de pedidos já (o retorno nasce desligado: `agendarRetorno` o liga com o primeiro retorno), e a reconciliação no próximo 06h00 UTC (02h00 de Manaus). Linha que já existe:
 * liga a busca de pedidos desligada (nula; quem a mantém desligada é o worker) e nunca adia o que já está mais
 * perto (`least`). Com `anteciparSinal` também traz o próximo sinal para já. É o único `INSERT` em `sinal`; o `ON CONFLICT ... DO
 * UPDATE` trava a linha até o fim da transação, então quem chama primeiro serializa os concorrentes (`PUT /credencial`).
 * `updated_at` fica com o trigger da tabela.
 */
export async function garantirLinhaDoSinal(tx: Transacao, tenantId: string, agora: Date, o: { anteciparSinal?: boolean } = {}): Promise<void> {
  await tx.consultar(
    `INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proxima_busca_clientes_em)
     VALUES ($1, $2, $3, $2, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET
       proximo_sinal_em = CASE WHEN $4::boolean THEN least(integracao_fdv.sinal.proximo_sinal_em, EXCLUDED.proximo_sinal_em) ELSE integracao_fdv.sinal.proximo_sinal_em END,
       proxima_reconciliacao_em = least(integracao_fdv.sinal.proxima_reconciliacao_em, EXCLUDED.proxima_reconciliacao_em),
       proxima_busca_pedidos_em = coalesce(integracao_fdv.sinal.proxima_busca_pedidos_em, EXCLUDED.proxima_busca_pedidos_em),
       proxima_busca_clientes_em = coalesce(integracao_fdv.sinal.proxima_busca_clientes_em, EXCLUDED.proxima_busca_clientes_em)`,
    [tenantId, agora, proximaReconciliacaoEm(agora), o.anteciparSinal ?? false],
  );
}

/**
 * Antecipa o envio das entidades para já (`least`: nunca adia), criando a linha do cursor que faltar. O `least` desfaz de propósito
 * a posse de uma reserva em andamento: quem a tem regrava o `proximo_em` só se ainda for o `posseAte` (`adiarPresoAPosse`).
 */
export async function anteciparEntidades(tx: Transacao, tenantId: string, entidades: readonly string[], agora: Date): Promise<void> {
  if (entidades.length === 0) return;
  await tx.consultar(
    `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em)
     SELECT $1, e::integracao_fdv.entidade_hub, $3 FROM unnest($2::text[]) AS e
     ON CONFLICT (tenant_id, entidade) DO UPDATE SET proximo_em = least(integracao_fdv.cursor_entidade.proximo_em, EXCLUDED.proximo_em)`,
    [tenantId, [...entidades], agora],
  );
}

/** Pausa a(s) entidade(s) do tenant. `entidade = null` = todas as linhas ainda não pausadas. Idempotente. */
export async function pausarEntidades(tx: Transacao, tenantId: string, entidade: string | null, motivo: MotivoPausa, credencialId: string | null, agora: Date): Promise<void> {
  // ordem de bloqueios da 0038: credencial antes do cursor (o `credencial_id` do cursor aponta para a linha travada aqui)
  if (credencialId) await tx.consultar(`SELECT 1 FROM integracao_fdv.credencial WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [tenantId, credencialId]);
  await tx.consultar(
    `UPDATE integracao_fdv.cursor_entidade
        SET pausada_motivo = $3, pausada_em = $4, credencial_id = coalesce($5::uuid, credencial_id)
      WHERE tenant_id = $1 AND ($2::text IS NULL OR entidade::text = $2) AND pausada_motivo IS NULL AND deleted_at IS NULL`,
    [tenantId, entidade, motivo, agora, credencialId],
  );
}

/** Já há pausa de credencial (ou licença do FDV) para esta mesma credencial? Então nada é chamado (limite de falhas por IP). */
async function credencialJaRecusada(tx: Transacao, tenantId: string, credencialId: string): Promise<boolean> {
  const l = await tx.consultar(
    `SELECT 1 FROM integracao_fdv.cursor_entidade
      WHERE tenant_id = $1 AND credencial_id = $2 AND pausada_motivo IN ('credencial', 'licenca_fdv') AND deleted_at IS NULL LIMIT 1`,
    [tenantId, credencialId],
  );
  return l.length > 0;
}

export async function marcarUsoDaCredencial(tx: Transacao, tenantId: string, credencialId: string, agora: Date): Promise<void> {
  await tx.consultar('UPDATE integracao_fdv.credencial SET ultimo_uso_em = $3 WHERE tenant_id = $1 AND id = $2', [tenantId, credencialId, agora]);
}

// ---- leitura tolerante das respostas do Hub (campo novo não derruba) ----
export const RespostaCursorLida = z.object({ cursor: CursorHub.nullable() }).passthrough();
export const LoteAceitoLido = z.object({ lote_id: z.string().uuid(), repetido: z.boolean().optional() }).passthrough();
const ErroLinhaLido = z
  .object({
    indice: z.number().int().min(0),
    external_id: z.string().min(1).max(200),
    codigo: z.string(),
    campo: z.string().nullish(),
    reprocessavel: z.boolean().optional(),
    origem: z.string().nullish(),
  })
  .passthrough();
export const LoteResultadoLido = z
  .object({
    status: z.string(),
    contagens: z.record(z.unknown()).optional(),
    /** Sem teto: o Hub pode listar menos erros que `contagens.com_erro` (o envio confere), nunca derruba a leitura. */
    erros: z.array(ErroLinhaLido).optional(),
    cursor: CursorHub.nullish(),
  })
  .passthrough();
export type LoteResultadoLido = z.infer<typeof LoteResultadoLido>;
export const RespostaSinalLida = z.object({ politica_versao: z.record(z.unknown()).nullish() }).passthrough();
