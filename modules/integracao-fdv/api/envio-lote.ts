/**
 * Envio de lotes ao Hub e consulta do resultado (T-0009 seções 3 a 5 e 6.1; RF-INF-02/03, RN-INF-02/03/04). Roda na agenda do
 * worker (`ContextoAgenda`): a chamada HTTP nunca segura transação (`ctx.emTransacao` são transações curtas) e a posse do
 * item (`ctx.posseAte`) trava a regravação final do `cursor_entidade.proximo_em`.
 *
 * Ciclo de um lote (`lote_envio`): `montado` → `enviando` → `aceito` → `concluido` | `concluido_com_erros` | `falhou`, ou
 * `recusado` (pausa). O corpo fica congelado até o estado final (M6): a retentativa reenvia o mesmo corpo com a mesma chave.
 * Uma chamada de `executarEnvio` faz um passo: envia o lote montado, consulta o aceito ou monta e envia um novo.
 *
 * Premissas (o que não cabe no schema 0007; `entidades_habilitadas` e `limite_registros_lote` vêm da credencial, 0015): (1) o modo e a sessão da carga completa são `cursor nulo` no Hub e no ERP ou `sessao_aberta_id`
 * preenchido (o BKO o preenche na ação "carga completa"); (2) o avanço local do cursor fica em `lote_envio.contagens.avanco`
 * até o lote concluir; (3) o limite por lote é `limiteRegistrosDoLote` (o menor entre `limite_registros_lote` da credencial e 5.000 registros), e 4 MiB;
 * (4) `ultimo_erro_codigo` do lote guarda o último erro de HTTP ou o motivo da recusa; o do registro, a tabela `lote_erro`;
 * (5) linha inválida firme (erro do próprio registro, sem remédio por referência) já declarada sai da fila ao fim do lote
 * (`pendente = false`, guardada pelo hash, lista em `contagens.firmes`): só um evento novo, com conteúdo diferente, a recoloca;
 * assim as inválidas na frente da fila não travam os válidos; (6) o Hub que lista menos erros que `contagens.com_erro` (lista
 * cortada): nada fora da lista é confirmado, o lote inteiro volta pela curva longa.
 */
import { criarEvento, type OrigemEnvioFdv, type ContextoAgenda, type CredencialHub, type ItemAgenda, type RespostaHub, type Transacao } from '@macuxierp/platform-sdk';
import { randomUUID } from 'node:crypto';
import {
  EVENTOS,
  EVENTO_LOTE_ENVIADO,
  EVENTO_LOTE_FALHOU,
  ENTIDADES_HUB_F2,
  PRAZO_CONTRATO_V2_LIGADO,
  EntidadeHub,
  type CorpoLote,
  type CursorHub,
  type EntidadeHub as Entidade,
  type LinhaInvalida,
  type ModoLote,
  type MotivoPausa,
  type RegistroLote,
} from '../contracts';
import {
  ATRASO_MAXIMO_S,
  limiteRegistrosDoLote,
  REFERENCIAS_HUB,
  atrasoRetentativaSegundos,
  campoDoHub,
  chaveIdempotencia,
  classificarResposta,
  codigoDoHub,
  decidirEnvioLote,
  dividirAoMeio,
  ehLinhaRetida,
  esperaConsultaSegundos,
  filiaisComCodigoRepetido,
  hashRegistro,
  jsonCanonico,
  montarLotes,
  normalizarPrazo,
  origemDoLote,
  precisaFechamento,
  validarRegistro,
  versaoContratoDoLote,
  type RegistroEspelho,
} from '../domain';
import {
  ESTADOS_EM_VOO,
  LoteAceitoLido,
  LoteResultadoLido,
  RespostaCursorLida,
  UMA_HORA_S,
  abrirOuPausar,
  adiarPresoAPosse,
  defeitoDoCliente,
  marcarUsoDaCredencial,
  mais,
  pausarEntidades,
  prepararCredencial,
  type DepsAgendaConector,
} from './conector-comum';
import { COLUNAS, paraRegistro, type LinhaRegistro } from './espelho';

/** Estado de um lote que ainda não terminou (`ESTADOS_EM_VOO`). */
type EstadoEmVoo = (typeof ESTADOS_EM_VOO)[number];
/** Gerações tentadas para o mesmo conteúdo antes de desistir (cada reenvio de lote final exige uma nova, M6). */
const LIMITE_GERACOES = 100;

/** O mesmo conteúdo já foi enviado em todas as gerações possíveis: defeito do ERP, o laço do worker loga só o nome. */
class GeracoesEsgotadas extends Error {
  override readonly name = 'GeracoesEsgotadas';
}

/** A sessão da entidade mudou entre a leitura e a gravação (carga completa pedida no meio): a transação é desfeita e o envio repete na próxima agenda. */
class CursorMudou extends Error {
  override readonly name = 'CursorMudou';
}

interface LinhaCursor {
  cursor_alterado_em: Date | null;
  cursor_external_id: string | null;
  sessao_aberta_id: string | null;
  pausada_motivo: MotivoPausa | null;
}
export interface LinhaLote {
  id: string;
  estado: EstadoEmVoo;
  modo: ModoLote;
  sessao_id: string | null;
  sessao_parte: number | null;
  sessao_ultimo: boolean | null;
  geracao: number;
  chave_idempotencia: string;
  corpo: CorpoLote;
  hub_lote_id: string | null;
  tentativas: number;
  enviado_em: Date | null;
  contagens: { registros?: number; invalidas?: number; avanco?: CursorHub | null; firmes?: ReadonlyArray<readonly [string, string]>; origem?: OrigemEnvioFdv };
}
const COLUNAS_LOTE = `id, estado, modo, sessao_id, sessao_parte, sessao_ultimo, geracao, chave_idempotencia, corpo, hub_lote_id, tentativas, enviado_em, contagens`;

/** Tudo de uma execução: o item, o contexto da agenda e a credencial já aberta (só em memória). */
export interface Exec {
  tenant: string;
  entidade: Entidade;
  ctx: ContextoAgenda;
  deps: DepsAgendaConector;
  cred: CredencialHub;
  credId: string;
  agora: Date;
  /** `limiteRegistrosDoLote(limite_registros_lote da credencial)` (0015). */
  limiteRegistros: number;
  /** Lote em tratamento nesta execução (para fechar como recusado se o cliente HTTP acusar defeito). */
  loteAtual: LinhaLote | null;
}

/**
 * Atualização do cursor da entidade com a regravação do `proximo_em` travada pela posse (`CASE WHEN proximo_em = posseAte`:
 * a mesma regra de `adiarPresoAPosse`, junto com as outras colunas na mesma instrução).
 */
interface MudancaCursor {
  /**
   * `sessao_aberta_id` que o `montarLoteNoBanco` leu (com a linha travada): a gravação só vale se ainda for esta (`IS NOT DISTINCT
   * FROM`, que também casa `null`). Sem condição = `undefined`. Se a linha mudou, a transação inteira é desfeita e o envio repete.
   */
  sessaoLida?: string | null;
  proximoEm: Date;
  envioEm?: Date;
  sucessoEm?: Date;
  cursor?: CursorHub;
  sessaoAberta?: { id: string | null };
}
async function gravarCursor(tx: Transacao, e: Exec, m: MudancaCursor): Promise<void> {
  const gravadas = await tx.consultar(
    `UPDATE integracao_fdv.cursor_entidade SET
        proximo_em = CASE WHEN proximo_em = $3 THEN $4 ELSE proximo_em END,
        ultimo_envio_em = coalesce($5::timestamptz, ultimo_envio_em),
        ultimo_sucesso_em = coalesce($6::timestamptz, ultimo_sucesso_em),
        cursor_alterado_em = CASE WHEN $7::boolean THEN $8::timestamptz ELSE cursor_alterado_em END,
        cursor_external_id = CASE WHEN $7::boolean THEN $9::text ELSE cursor_external_id END,
        sessao_aberta_id = CASE WHEN $10::boolean THEN $11::uuid ELSE sessao_aberta_id END,
        credencial_id = coalesce(credencial_id, $12::uuid)
      WHERE tenant_id = $1 AND entidade = $2 AND (NOT $13::boolean OR sessao_aberta_id IS NOT DISTINCT FROM $14::uuid)
      RETURNING 1 AS ok`,
    [
      e.tenant, e.entidade, e.ctx.posseAte, m.proximoEm, m.envioEm ?? null, m.sucessoEm ?? null,
      m.cursor !== undefined, m.cursor?.alterado_em ?? null, m.cursor?.external_id ?? null,
      m.sessaoAberta !== undefined, m.sessaoAberta?.id ?? null, e.credId,
      m.sessaoLida !== undefined, m.sessaoLida ?? null,
    ],
  );
  if (m.sessaoLida !== undefined && gravadas.length === 0) throw new CursorMudou();
}

async function publicar(tx: Transacao, e: Exec, nome: typeof EVENTO_LOTE_ENVIADO | typeof EVENTO_LOTE_FALHOU, loteId: string, payload: Record<string, unknown>): Promise<void> {
  const dados = EVENTOS[nome].parse(payload);
  await e.deps.outbox.gravar(tx, criarEvento({ nome, tenant_id: e.tenant, agregado_id: loteId, ator: 'sistema', request_id: `lote-${loteId}`, payload: dados }, e.agora));
}

// ---- ponto de entrada ----

export async function executarEnvio(item: ItemAgenda, ctx: ContextoAgenda, deps: DepsAgendaConector): Promise<void> {
  const entidade = EntidadeHub.safeParse(item.chave);
  if (!entidade.success) return;
  const tenant = item.tenant_id;
  const agora = ctx.agora;
  const antes = await ctx.emTransacao(async (tx) => {
    const [cursor] = await tx.consultar<LinhaCursor>(
      `SELECT cursor_alterado_em, cursor_external_id, sessao_aberta_id, pausada_motivo
         FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2 AND deleted_at IS NULL`,
      [tenant, entidade.data],
    );
    if (!cursor || cursor.pausada_motivo) return null;
    const credencial = await prepararCredencial(tx, tenant, {
      // sem credencial: nada é chamado; volta a olhar em 1 h (o consumidor e a ação do BKO antecipam)
      semCredencial: () => adiarPresoAPosse(tx, tenant, { entidade: entidade.data }, ctx.posseAte, mais(agora, UMA_HORA_S)),
      recusada: (c) => pausarEntidades(tx, tenant, entidade.data, 'credencial', c.id, agora),
    });
    if (!credencial) return null;
    const [lote] = await tx.consultar<LinhaLote>(
      `SELECT ${COLUNAS_LOTE} FROM integracao_fdv.lote_envio
        WHERE tenant_id = $1 AND entidade = $2 AND estado = ANY($3::text[]) AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [tenant, entidade.data, [...ESTADOS_EM_VOO]],
    );
    // entidade desabilitada na credencial (0015): a reserva não filtra (credencial com RLS); aqui não monta lote novo, não pausa
    // e adia 1 h. Lote já em voo termina (consulta e envio), para não deixar o Hub com lote aceito sem resposta.
    if (!lote && !credencial.entidades_habilitadas.includes(entidade.data)) {
      await adiarPresoAPosse(tx, tenant, { entidade: entidade.data }, ctx.posseAte, mais(agora, UMA_HORA_S));
      return null;
    }
    return { cursor, credencial, lote: lote ?? null };
  });
  if (!antes) return;

  const cred = await abrirOuPausar(ctx, tenant, antes.credencial);
  if (!cred) return;
  const e: Exec = { tenant, entidade: entidade.data, ctx, deps, cred, credId: antes.credencial.id, agora, limiteRegistros: limiteRegistrosDoLote(antes.credencial.limite_registros_lote), loteAtual: antes.lote };
  try {
    if (antes.lote) {
      if (antes.lote.estado === 'aceito') await consultarLote(e, antes.lote);
      else await enviarLote(e, antes.lote);
      return;
    }
    await montarEEnviar(e, antes.cursor);
  } catch (erro) {
    const defeito = defeitoDoCliente(erro);
    if (!defeito) throw erro;
    // defeito do ERP (ErroClienteHub): repetir não conserta. Só o nome vai a log (pelo laço do worker), nunca a mensagem.
    await ctx.emTransacao((tx) => fecharPorDefeito(tx, e, e.loteAtual, defeito.codigo, defeito.credencial));
  }
}

/** Defeito do cliente HTTP: o lote em voo fica recusado e a entidade (ou a credencial inteira) pausa. */
async function fecharPorDefeito(tx: Transacao, e: Exec, lote: LinhaLote | null, codigo: string, credencial: boolean): Promise<void> {
  if (lote) await recusarLote(tx, e, lote, codigo);
  await pausarEntidades(tx, e.tenant, credencial ? null : e.entidade, credencial ? 'credencial' : 'envelope', e.credId, e.agora);
}

// ---- montagem ----

const ESPERA_OCIOSA_S = UMA_HORA_S;

async function montarEEnviar(e: Exec, cursor: LinhaCursor): Promise<void> {
  // 1. cursor do Hub, só quando o local é nulo e o BKO não abriu sessão (carga completa pedida)
  let hubCursor: CursorHub | null | undefined;
  if (!cursor.cursor_alterado_em && !cursor.sessao_aberta_id) {
    const r = await e.ctx.hub.chamar(e.cred, { metodo: 'GET', caminho: `/cursores/${e.entidade}` });
    if (r.tipo !== 'ok') {
      await tratarFalhaSemLote(e, r);
      return;
    }
    const lido = RespostaCursorLida.safeParse(r.corpo);
    if (!lido.success) {
      await e.ctx.emTransacao((tx) => adiarPresoAPosse(tx, e.tenant, { entidade: e.entidade }, e.ctx.posseAte, mais(e.agora, atrasoRetentativaSegundos(1))));
      return;
    }
    hubCursor = lido.data.cursor;
  }
  const decisao = await e.ctx.emTransacao((tx) => montarLoteNoBanco(tx, e, hubCursor));
  if (decisao.tipo === 'nada') return;
  await enviarLote(e, decisao.lote);
}

/** Registro do espelho no formato do lote do Hub. */
function paraRegistroLote(r: RegistroEspelho): RegistroLote {
  return { ...r.payload, external_id: r.external_id, alterado_em: r.alterado_em, ativo: r.ativo };
}

type Decisao = { tipo: 'nada' } | { tipo: 'lote'; lote: LinhaLote };

async function montarLoteNoBanco(tx: Transacao, e: Exec, hubCursor: CursorHub | null | undefined): Promise<Decisao> {
  const { tenant, entidade, agora } = e;
  // O cursor foi lido numa transação anterior (e o Hub consultado depois): reler com a linha travada. A carga completa do BKO, que
  // também trava esta linha, ou já valeu (vale a leitura de agora) ou espera esta transação acabar e vê o lote montado (409).
  const [cursor] = await tx.consultar<LinhaCursor>(
    `SELECT cursor_alterado_em, cursor_external_id, sessao_aberta_id, pausada_motivo
       FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2 AND deleted_at IS NULL FOR NO KEY UPDATE`,
    [tenant, entidade],
  );
  if (!cursor || cursor.pausada_motivo) return { tipo: 'nada' };
  // limites próprios do tenant: 15 lotes e 120 chamadas por minuto (domain/limites)
  const recentes = await tx.consultar<{ enviado_em: Date }>(
    `SELECT enviado_em FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND enviado_em > $2 AND deleted_at IS NULL`,
    [tenant, new Date(agora.getTime() - 60_000)],
  );
  const marcas = recentes.map((r) => r.enviado_em.getTime());
  const permissao = decidirEnvioLote({ agora: agora.getTime(), lotesEm: marcas, chamadasEm: marcas, emVooNaEntidade: 0 });
  if (!permissao.permitido) {
    await adiarPresoAPosse(tx, tenant, { entidade }, e.ctx.posseAte, mais(agora, permissao.esperarSegundos));
    return { tipo: 'nada' };
  }

  // 2. modo e ponto de partida
  let localCursor: CursorHub | null = cursor.cursor_alterado_em && cursor.cursor_external_id ? { alterado_em: cursor.cursor_alterado_em.toISOString(), external_id: cursor.cursor_external_id } : null;
  let sessaoId = cursor.sessao_aberta_id;
  if (!localCursor && !sessaoId) {
    if (hubCursor) {
      // o Hub já tem dados deste conector: segue em delta a partir do cursor dele
      localCursor = hubCursor;
      await gravarCursor(tx, e, { proximoEm: e.ctx.posseAte, cursor: hubCursor, sessaoLida: cursor.sessao_aberta_id });
    } else {
      sessaoId = randomUUID();
    }
  }
  const modo: ModoLote = sessaoId ? 'completo' : 'delta';

  // T-0107 (RN-INF-10): só prazo_pagamento tem v2; recoloca quem foi enviado em versão <> vigente (inclui inativos e recusados), sem mexer no hash, depois do lock do cursor.
  if (entidade === 'prazo_pagamento') {
    await tx.consultar(
      `UPDATE integracao_fdv.registro_publicado SET pendente = true
        WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND NOT pendente AND deleted_at IS NULL AND payload IS NOT NULL
          AND contrato_enviado <> $2`,
      [tenant, versaoContratoDoLote('prazo_pagamento', PRAZO_CONTRATO_V2_LIGADO)],
    );
  }

  // 3. candidatos do espelho, na ordem do Hub (alterado_em, registro_external_id COLLATE "C")
  const candidatos =
    modo === 'delta'
      ? await tx.consultar<LinhaRegistro>(
          `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado
            WHERE tenant_id = $1 AND entidade = $2 AND pendente AND NOT aguarda_vinculo AND deleted_at IS NULL AND payload IS NOT NULL
            ORDER BY alterado_em, registro_external_id COLLATE "C" LIMIT $3`,
          [tenant, entidade, e.limiteRegistros],
        )
      : await tx.consultar<LinhaRegistro>(
          `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado
            WHERE tenant_id = $1 AND entidade = $2 AND ativo AND NOT aguarda_vinculo AND deleted_at IS NULL AND payload IS NOT NULL
              AND ($3::timestamptz IS NULL OR (alterado_em, registro_external_id COLLATE "C") > ($3::timestamptz, $4::text COLLATE "C"))
            ORDER BY alterado_em, registro_external_id COLLATE "C" LIMIT $5`,
          [tenant, entidade, localCursor?.alterado_em ?? null, localCursor?.external_id ?? null, e.limiteRegistros + 1],
        );
  const continua = modo === 'completo' && candidatos.length > e.limiteRegistros;
  const chunk = continua ? candidatos.slice(0, e.limiteRegistros) : candidatos;

  // 4. validação local (M5): o que o Hub recusaria vai em linhas_invalidas, sem o valor
  const confirmados = await carregarConfirmados(tx, tenant, entidade, chunk.map((c) => c.payload ?? {}));
  const confirmado = (alvo: Entidade, id: string): boolean => confirmados.has(`${alvo}\u0000${id}`);
  const brutos = chunk.map((c) => paraRegistro(c));
  const espelhos: RegistroEspelho[] = brutos.map((b) => normalizarPrazo(b));
  // T-0107: o espelho com `parcelas_dias` em texto passa a guardar o payload normalizado e o hash dele (mesma transação, depois do lock do
  // cursor), senão o aceite (`pendente = r.hash <> hash enviado`) deixaria a linha pendente para sempre. Só as linhas que mudaram.
  if (entidade === 'prazo_pagamento') {
    const mudou = espelhos.map((n, i) => ({ n, b: brutos[i]! })).filter(({ n, b }) => jsonCanonico(n.payload) !== jsonCanonico(b.payload));
    if (mudou.length > 0) {
      const hashNormalizado = mudou.map(({ n }) => hashRegistro(n.payload));
      // Guarda contra a corrida com o consumidor do espelho: só grava se a linha ainda tem o hash bruto que foi lido. Se um evento novo
      // entrou no meio, a linha fica com o payload novo e pendente (sai normalizada no próximo ciclo) e o hash em memória segue o bruto,
      // para o aceite (`pendente = r.hash <> v.hash`) continuar dando true.
      const gravadas = await tx.consultar<{ registro_external_id: string }>(
        `UPDATE integracao_fdv.registro_publicado r SET payload = v.payload::jsonb, hash = v.hash
           FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS v(chave, payload, hash, hash_lido)
          WHERE r.tenant_id = $1 AND r.entidade = $2 AND r.registro_external_id = v.chave AND r.deleted_at IS NULL AND r.hash = v.hash_lido
          RETURNING r.registro_external_id`,
        [tenant, entidade, mudou.map(({ n }) => n.external_id), mudou.map(({ n }) => JSON.stringify(n.payload)), hashNormalizado, mudou.map(({ b }) => b.hash)],
      );
      const pegas = new Set(gravadas.map((g) => g.registro_external_id));
      mudou.forEach(({ n, b }, i) => {
        n.hash = pegas.has(n.external_id) ? hashNormalizado[i]! : b.hash;
      });
    }
  }
  let repetidas = new Map<string, LinhaInvalida>();
  if (entidade === 'filial') {
    const todas = await tx.consultar<LinhaRegistro>(
      `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'filial' AND ativo AND deleted_at IS NULL AND payload IS NOT NULL`,
      [tenant],
    );
    repetidas = new Map(filiaisComCodigoRepetido(todas.map(paraRegistro)).map((l) => [l.external_id, l]));
  }
  const validos: RegistroLote[] = [];
  const invalidas: LinhaInvalida[] = [];
  // RN-INF-02 (T-0112): referência ainda não confirmada no FDV (ordem de carga, não erro de cadastro) fica retida em silêncio: o lote
  // não a declara ao Hub, o registro segue pendente (o cursor da carga completa passa, o delta e o `acordarDependentes` o reavaliam).
  const retidas: LinhaInvalida[] = [];
  // hash (do momento da montagem) das inválidas FIRMES: erro do próprio registro, que só um evento novo conserta. Fora: o código de
  // filial repetido (depende de outra filial, não do próprio registro).
  const hashDasFirmes = new Map<string, string>();
  for (const r of espelhos) {
    const repetida = repetidas.get(r.external_id);
    const linha = repetida ?? validarRegistro(r, confirmado, { prazoV2: PRAZO_CONTRATO_V2_LIGADO });
    if (!linha) {
      validos.push(paraRegistroLote(r));
    } else if (ehLinhaRetida(linha)) {
      retidas.push(linha);
    } else {
      invalidas.push(linha);
      if (!repetida) hashDasFirmes.set(r.external_id, r.hash);
    }
  }
  const ultimo = chunk[chunk.length - 1];
  const avancoDoChunk: CursorHub | null = ultimo ? { alterado_em: ultimo.alterado_em.toISOString(), external_id: ultimo.registro_external_id } : null;

  // partes recusadas por 413 reaparecem com a mesma numeração: a parte nova é (partes concluídas) + 1
  const parteInicial = sessaoId
    ? Number((await tx.consultar<{ n: string | number }>(`SELECT coalesce(max(sessao_parte), 0) AS n FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND entidade = $2 AND sessao_id = $3 AND estado IN ('concluido', 'concluido_com_erros', 'aceito')`, [tenant, entidade, sessaoId]))[0]?.n ?? 0) + 1
    : 1;

  // T-0061: parte final leva o último aceito (ver registroDeFechamento)
  let registroDeFechamento: RegistroLote | undefined;
  if (localCursor && precisaFechamento({ modo, sessaoParteInicial: parteInicial, sessaoContinua: continua, registrosValidos: validos.length })) {
    const [fecho] = await tx.consultar<LinhaRegistro>(
      `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND entidade = $2 AND ativo AND hash_confirmado = hash AND deleted_at IS NULL AND payload IS NOT NULL
          AND (alterado_em, registro_external_id COLLATE "C") <= ($3::timestamptz, $4::text COLLATE "C")
        ORDER BY alterado_em DESC, registro_external_id COLLATE "C" DESC LIMIT 1`,
      [tenant, entidade, localCursor.alterado_em, localCursor.external_id],
    );
    if (fecho) registroDeFechamento = paraRegistroLote(normalizarPrazo(paraRegistro(fecho)));
  }

  const lotes = montarLotes({
    entidade, modo, registros: validos, linhas_invalidas: invalidas, contratoPrazoV2: PRAZO_CONTRATO_V2_LIGADO, enviadoEm: agora.toISOString(), limiteRegistros: e.limiteRegistros,
    ...(sessaoId ? { sessaoId, sessaoParteInicial: parteInicial, sessaoContinua: continua } : {}),
    ...(registroDeFechamento && localCursor ? { registroDeFechamento, cursorDeFechamento: localCursor } : {}),
  });
  const montado = lotes[0];
  if (!montado) {
    // nada a enviar agora. Carga completa sem registro ativo não abre sessão (o Hub recusaria lote vazio): a sessão já aberta
    // no cursor (pedida pelo BKO) e sem nenhuma parte enviada é fechada, para não pausar o cadastro.
    const fecha = modo === 'completo' && cursor.sessao_aberta_id ? { sessaoAberta: { id: null }, sessaoLida: cursor.sessao_aberta_id } : {};
    await gravarCursor(tx, e, { proximoEm: mais(agora, ESPERA_OCIOSA_S), ...fecha });
    return { tipo: 'nada' };
  }
  // delta só de linhas inválidas: se todas já estão declaradas (erro do ERP ainda não resolvido), não repete
  if (modo === 'delta' && validos.length === 0) {
    const abertas = await tx.consultar<{ registro_external_id: string; codigo: string; campo: string | null }>(
      `SELECT registro_external_id, codigo, campo FROM integracao_fdv.lote_erro
        WHERE tenant_id = $1 AND entidade = $2 AND origem = 'erp' AND resolvido_em IS NULL AND registro_external_id = ANY($3::text[])`,
      [tenant, entidade, invalidas.map((l) => l.external_id)],
    );
    const declaradas = new Set(abertas.map((x) => `${x.registro_external_id}\u0000${x.codigo}\u0000${x.campo ?? ''}`));
    if (invalidas.every((l) => declaradas.has(`${l.external_id}\u0000${l.codigo}\u0000${campoDoHub(l.campo) ?? ''}`))) {
      await gravarCursor(tx, e, { proximoEm: mais(agora, ESPERA_OCIOSA_S) });
      return { tipo: 'nada' };
    }
  }
  // geração: a chave do mesmo conteúdo já gravada (lote final) exige geração nova (M6, geracaoDoReenvio)
  let geracao = 1;
  let chave = chaveIdempotencia(montado.corpo, geracao);
  for (;;) {
    const existe = await tx.consultar(`SELECT 1 FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND chave_idempotencia = $2`, [tenant, chave]);
    if (existe.length === 0) break;
    if (geracao >= LIMITE_GERACOES) throw new GeracoesEsgotadas('gerações do lote esgotadas');
    geracao += 1;
    chave = chaveIdempotencia(montado.corpo, geracao);
  }
  // T-0061: com o fecho, o cursor local fica (o registro é de antes dele)
  const avanco = registroDeFechamento ? localCursor : modo === 'completo' && validos.length === montado.corpo.registros.length ? avancoDoChunk : (montado.corpo.cursor ?? avancoDoChunk);
  // só as detalhadas (as 500 primeiras) foram declaradas ao Hub e gravadas em `lote_erro`: só elas saem da fila no fim
  const detalhadas = invalidas.slice(0, montado.corpo.linhas_invalidas.length);
  const firmes = detalhadas.filter((l) => hashDasFirmes.has(l.external_id)).map((l) => [l.external_id, hashDasFirmes.get(l.external_id)!] as const);
  // T-0086 §4: a origem do envio (ciclo, reprocessar ou zerar) sai das marcas do espelho e vai em `contagens.origem`; carga completa é sempre ciclo
  const origem = modo === 'delta' ? origemDoLote(chunk.map((c) => c.fonte_refs)) : 'ciclo';
  const novo = await inserirLote(tx, e, { modo, geracao, chave, corpo: montado.corpo, cursorDeclarado: montado.cursor_declarado, avanco, firmes, origem });
  for (const [indice, l] of detalhadas.entries()) {
    await gravarErroDeLinha(tx, e, { loteId: novo.id, origem: 'erp', indice, externalId: l.external_id, codigo: l.codigo, campo: l.campo, reprocessavel: false });
  }
  await gravarRetidas(tx, e, novo.id, detalhadas.length, retidas);
  if (sessaoId && !cursor.sessao_aberta_id) await gravarCursor(tx, e, { proximoEm: e.ctx.posseAte, sessaoAberta: { id: sessaoId }, sessaoLida: cursor.sessao_aberta_id });
  return {
    tipo: 'lote',
    lote: { id: novo.id, estado: 'montado', modo, sessao_id: novo.sessao?.id ?? null, sessao_parte: novo.sessao?.parte ?? null, sessao_ultimo: novo.sessao?.ultimo ?? null, geracao, chave_idempotencia: chave, corpo: montado.corpo, hub_lote_id: null, tentativas: 0, enviado_em: null, contagens: novo.contagens },
  };
}

/** Dados de um lote novo (montagem e divisão): o que muda de um para o outro; o resto sai do corpo. */
interface NovoLote {
  modo: ModoLote;
  geracao: number;
  chave: string;
  corpo: CorpoLote;
  cursorDeclarado: CursorHub | null;
  /** Ponto a que o cursor local avança quando o lote concluir (`contagens.avanco`). */
  avanco: CursorHub | null;
  firmes: ReadonlyArray<readonly [string, string]>;
  origem: OrigemEnvioFdv;
}

/** Grava o lote em `montado` com as contagens do corpo (registros e inválidas, as detalhadas e as omitidas). */
async function inserirLote(tx: Transacao, e: Exec, n: NovoLote): Promise<{ id: string; sessao: CorpoLote['sessao']; contagens: LinhaLote['contagens'] }> {
  const sessao = n.corpo.sessao;
  const contagens: LinhaLote['contagens'] = {
    registros: n.corpo.registros.length,
    invalidas: n.corpo.linhas_invalidas.length + n.corpo.linhas_invalidas_omitidas,
    avanco: n.avanco,
    origem: n.origem,
    ...(n.firmes.length > 0 ? { firmes: n.firmes } : {}),
  };
  const [criado] = await tx.consultar<{ id: string }>(
    `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, sessao_id, sessao_parte, sessao_ultimo, geracao, chave_idempotencia, corpo, cursor_declarado, contagens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb) RETURNING id`,
    [e.tenant, e.entidade, e.credId, n.modo, sessao?.id ?? null, sessao?.parte ?? null, sessao?.ultimo ?? null, n.geracao, n.chave, JSON.stringify(n.corpo), n.cursorDeclarado ? JSON.stringify(n.cursorDeclarado) : null, JSON.stringify(contagens)],
  );
  return { id: criado!.id, sessao, contagens };
}

/** Erro de uma linha (`lote_erro`), do ERP (linha inválida que ele mesmo declarou) ou do Hub; sem mensagem nem valor. */
async function gravarErroDeLinha(
  tx: Transacao,
  e: Pick<Exec, 'tenant' | 'entidade'>,
  l: { loteId: string; origem: 'erp' | 'hub'; indice: number; externalId: string; codigo: string; campo: string | null | undefined; reprocessavel: boolean },
): Promise<void> {
  await tx.consultar(
    `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo, reprocessavel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (lote_envio_id, origem, indice) DO NOTHING`,
    [e.tenant, l.loteId, l.indice, l.origem, e.entidade, l.externalId, l.origem === 'hub' ? codigoDoHub(l.codigo) : l.codigo, campoDoHub(l.campo), l.reprocessavel],
  );
}

/**
 * RN-INF-02 (T-0112): as linhas retidas (referência ausente) não vão ao Hub, mas o Log do BKO as mostra (`lote_erro`, origem `erp`,
 * reprocessável) ligadas a este lote. Uma só vez por (registro, código, campo) enquanto estiver aberta; aceite do registro a resolve.
 */
async function gravarRetidas(tx: Transacao, e: Exec, loteId: string, primeiroIndice: number, retidas: readonly LinhaInvalida[]): Promise<void> {
  if (retidas.length === 0) return;
  await tx.consultar(
    `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo, reprocessavel)
     SELECT $1::uuid, $2::uuid, $3::int + v.ordem::int, 'erp', $4::integracao_fdv.entidade_hub, v.chave, 'referencia_ausente', v.campo, true
       FROM unnest($5::text[], $6::text[]) WITH ORDINALITY AS v(chave, campo, ordem)
      WHERE NOT EXISTS (SELECT 1 FROM integracao_fdv.lote_erro a
                         WHERE a.tenant_id = $1 AND a.entidade = $4 AND a.origem = 'erp' AND a.resolvido_em IS NULL AND a.deleted_at IS NULL
                           AND a.registro_external_id = v.chave AND a.codigo = 'referencia_ausente' AND a.campo IS NOT DISTINCT FROM v.campo)
     ON CONFLICT (lote_envio_id, origem, indice) DO NOTHING`,
    [e.tenant, loteId, primeiroIndice - 1, e.entidade, retidas.map((l) => l.external_id), retidas.map((l) => campoDoHub(l.campo))],
  );
}

/** Pares (entidade alvo, chave) das referências dos registros já `confirmados` no Hub. */
async function carregarConfirmados(tx: Transacao, tenant: string, entidade: Entidade, payloads: ReadonlyArray<Record<string, unknown>>): Promise<Set<string>> {
  const refs = REFERENCIAS_HUB[entidade] ?? [];
  const confirmados = new Set<string>();
  for (const [campo, alvo] of refs) {
    const valores = [...new Set(payloads.map((p) => p[campo]).filter((v): v is string => typeof v === 'string'))];
    if (valores.length === 0) continue;
    const linhas = await tx.consultar<{ chave: string; confirmado: boolean }>(
      `SELECT registro_external_id AS chave, hash_confirmado IS NOT NULL AS confirmado
         FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = ANY($3::text[]) AND deleted_at IS NULL`,
      [tenant, alvo, valores],
    );
    for (const l of linhas) {
      if (l.confirmado) confirmados.add(`${alvo}\u0000${l.chave}`);
    }
  }
  return confirmados;
}

// ---- envio ----

export async function enviarLote(e: Exec, lote: LinhaLote): Promise<void> {
  e.loteAtual = lote;
  const tentativas = await e.ctx.emTransacao(async (tx) => {
    const [l] = await tx.consultar<{ tentativas: number }>(
      `UPDATE integracao_fdv.lote_envio SET estado = 'enviando', tentativas = tentativas + 1, enviado_em = coalesce(enviado_em, $3)
        WHERE tenant_id = $1 AND id = $2 AND estado IN ('montado', 'enviando') RETURNING tentativas`,
      [e.tenant, lote.id, e.agora],
    );
    if (!l) return null;
    // ordem dos bloqueios do módulo (e do `portal_credencial_definir`, 0038): sinal -> credencial -> cursor_entidade (evita 40P01)
    await tx.consultar('UPDATE integracao_fdv.sinal SET ultimo_envio_em = $2 WHERE tenant_id = $1', [e.tenant, e.agora]);
    await gravarCursor(tx, e, { proximoEm: e.ctx.posseAte, envioEm: e.agora });
    return l.tentativas;
  });
  if (tentativas === null) return; // outro processo já avançou este lote
  const resp = await e.ctx.hub.chamar(e.cred, { metodo: 'POST', caminho: '/lotes', corpo: lote.corpo, chaveIdempotencia: lote.chave_idempotencia });
  const acao = classificarResposta(resp);
  if (acao.acao === 'ok' || acao.acao === 'replay') {
    const aceito = resp.tipo === 'ok' ? LoteAceitoLido.safeParse(resp.corpo) : null;
    if (!aceito?.success) {
      await e.ctx.emTransacao((tx) => fecharPorDefeito(tx, e, { ...lote, tentativas }, 'resposta_invalida', false));
      return;
    }
    await e.ctx.emTransacao(async (tx) => {
      await tx.consultar(
        `UPDATE integracao_fdv.lote_envio SET estado = 'aceito', hub_lote_id = $3, repetido = $4, ultimo_erro_codigo = NULL
          WHERE tenant_id = $1 AND id = $2 AND estado IN ('montado', 'enviando')`,
        [e.tenant, lote.id, aceito.data.lote_id, acao.acao === 'replay' || aceito.data.repetido === true],
      );
      await marcarUsoDaCredencial(tx, e.tenant, e.credId, e.agora);
      await gravarCursor(tx, e, { proximoEm: mais(e.agora, esperaConsultaSegundos(0)) });
    });
    return;
  }
  if (acao.acao === 'retentar') {
    await e.ctx.emTransacao(async (tx) => {
      await tx.consultar(`UPDATE integracao_fdv.lote_envio SET ultimo_erro_codigo = $3 WHERE tenant_id = $1 AND id = $2 AND estado IN ('montado', 'enviando')`, [e.tenant, lote.id, acao.codigo]);
      await gravarCursor(tx, e, { proximoEm: mais(e.agora, atrasoRetentativaSegundos(tentativas, acao.retryAfterSegundos)) });
    });
    return;
  }
  if (acao.acao === 'dividir') {
    await e.ctx.emTransacao((tx) => dividir(tx, e, { ...lote, tentativas }, resp));
    return;
  }
  await e.ctx.emTransacao((tx) => pausar(tx, e, { ...lote, tentativas }, acao.motivo, acao.codigo, acao.todasEntidades, true));
}

/** Falha de uma chamada sem lote (cursor do Hub): rede e 5xx adiam; o resto pausa (nenhum lote para fechar). */
async function tratarFalhaSemLote(e: Exec, resp: RespostaHub): Promise<void> {
  const acao = classificarResposta(resp);
  await e.ctx.emTransacao(async (tx) => {
    if (acao.acao === 'retentar') await gravarCursor(tx, e, { proximoEm: mais(e.agora, atrasoRetentativaSegundos(1, acao.retryAfterSegundos)) });
    else if (acao.acao === 'pausar') await pausar(tx, e, null, acao.motivo, acao.codigo, acao.todasEntidades, false);
    else await gravarCursor(tx, e, { proximoEm: mais(e.agora, atrasoRetentativaSegundos(1)) });
  });
}

/**
 * Lote recusado (final): fecha como `recusado` com o código e, se `publicarEvento`, publica `lote.falhou@1`. Devolve `false`
 * se o lote já tinha terminado (outro processo chegou antes): nada é feito de novo.
 */
async function recusarLote(tx: Transacao, e: Exec, lote: Pick<LinhaLote, 'id' | 'tentativas' | 'geracao' | 'modo'>, codigo: string, publicarEvento = true): Promise<boolean> {
  const l = await tx.consultar<{ id: string }>(
    `UPDATE integracao_fdv.lote_envio SET estado = 'recusado', ultimo_erro_codigo = $3, concluido_em = $4
      WHERE tenant_id = $1 AND id = $2 AND estado = ANY($5::text[]) RETURNING id`,
    [e.tenant, lote.id, codigo, e.agora, [...ESTADOS_EM_VOO]],
  );
  if (l.length === 0) return false;
  if (publicarEvento) {
    await publicar(tx, e, EVENTO_LOTE_FALHOU, lote.id, { lote_envio_id: lote.id, entidade: e.entidade, modo: lote.modo, geracao: lote.geracao, estado: 'recusado', codigo, tentativas: lote.tentativas, falhou_em: e.agora.toISOString() });
  }
  return true;
}

async function pausar(tx: Transacao, e: Exec, lote: LinhaLote | null, motivo: MotivoPausa, codigo: string, todas: boolean, fecharLote: boolean): Promise<void> {
  if (lote && fecharLote) await recusarLote(tx, e, lote, codigo);
  await pausarEntidades(tx, e.tenant, todas ? null : e.entidade, motivo, e.credId, e.agora);
  await gravarCursor(tx, e, { proximoEm: e.agora });
}

/** 413 (ou 422 acima_do_limite): o lote se divide ao meio com geração nova (M6); a outra metade volta pelo cursor. */
async function dividir(tx: Transacao, e: Exec, lote: LinhaLote, resp: RespostaHub): Promise<void> {
  const codigo = resp.tipo === 'recusa' && resp.status === 413 ? 'corpo_grande' : 'acima_do_limite';
  const partes = dividirAoMeio({ corpo: lote.corpo, geracao: lote.geracao, chave_idempotencia: lote.chave_idempotencia, cursor_declarado: lote.corpo.cursor, bytes: 0 });
  if (!partes) {
    await pausar(tx, e, lote, 'envelope', codigo, false, true);
    return;
  }
  // a divisão não é falha: o lote original fecha como recusado, sem `lote.falhou@1`
  if (!(await recusarLote(tx, e, lote, codigo, false))) return;
  const [primeira] = partes;
  const ult = primeira.corpo.registros[primeira.corpo.registros.length - 1]!;
  const novo = await inserirLote(tx, e, {
    modo: lote.modo, geracao: primeira.geracao, chave: primeira.chave_idempotencia, corpo: primeira.corpo, cursorDeclarado: primeira.cursor_declarado,
    avanco: { alterado_em: ult.alterado_em, external_id: ult.external_id }, firmes: lote.contagens.firmes ?? [], origem: lote.contagens.origem ?? 'ciclo',
  });
  // as linhas inválidas (erro por linha do ERP) seguem com a primeira metade; as do lote original ficam resolvidas pelo novo
  await tx.consultar(
    `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo, reprocessavel)
     SELECT tenant_id, $3, indice, origem, entidade, registro_external_id, codigo, campo, reprocessavel
       FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND lote_envio_id = $2 AND origem = 'erp'`,
    [e.tenant, lote.id, novo.id],
  );
  await tx.consultar(
    `UPDATE integracao_fdv.lote_erro SET resolvido_em = $4, resolvido_no_lote_envio_id = $3
      WHERE tenant_id = $1 AND lote_envio_id = $2 AND origem = 'erp' AND resolvido_em IS NULL`,
    [e.tenant, lote.id, novo.id, e.agora],
  );
  await gravarCursor(tx, e, { proximoEm: e.agora });
}

// ---- consulta ----

async function consultarLote(e: Exec, lote: LinhaLote): Promise<void> {
  const decorrido = lote.enviado_em ? Math.max(0, Math.floor((e.agora.getTime() - lote.enviado_em.getTime()) / 1000)) : 0;
  const resp = await e.ctx.hub.chamar(e.cred, { metodo: 'GET', caminho: `/lotes/${lote.hub_lote_id}` });
  if (resp.tipo === 'ok') {
    const lido = LoteResultadoLido.safeParse(resp.corpo);
    if (!lido.success) {
      await e.ctx.emTransacao((tx) => gravarCursor(tx, e, { proximoEm: mais(e.agora, esperaConsultaSegundos(decorrido)) }));
      return;
    }
    const status = lido.data.status;
    if (status === 'concluido' || status === 'concluido_com_erros' || status === 'falhou') {
      await e.ctx.emTransacao((tx) => finalizar(tx, e, lote, status, lido.data));
      return;
    }
    await e.ctx.emTransacao((tx) => gravarCursor(tx, e, { proximoEm: mais(e.agora, esperaConsultaSegundos(decorrido)) }));
    return;
  }
  const acao = classificarResposta(resp);
  if (acao.acao === 'retentar') {
    await e.ctx.emTransacao((tx) => gravarCursor(tx, e, { proximoEm: mais(e.agora, Math.max(esperaConsultaSegundos(decorrido), acao.retryAfterSegundos ?? 0)) }));
    return;
  }
  if (resp.tipo === 'recusa' && resp.status === 404) {
    // `lote_nao_encontrado`: o Hub perdeu o lote; reenvia o mesmo corpo com a mesma chave (guia do Hub)
    await e.ctx.emTransacao(async (tx) => {
      await tx.consultar(
        `UPDATE integracao_fdv.lote_envio SET estado = 'enviando', hub_lote_id = NULL WHERE tenant_id = $1 AND id = $2 AND estado = 'aceito'`,
        [e.tenant, lote.id],
      );
      await gravarCursor(tx, e, { proximoEm: e.agora });
    });
    return;
  }
  if (acao.acao === 'pausar') {
    // o lote já foi aceito: fica `aceito` e a consulta continua quando a pausa for desfeita
    await e.ctx.emTransacao((tx) => pausar(tx, e, lote, acao.motivo, acao.codigo, acao.todasEntidades, false));
    return;
  }
  await e.ctx.emTransacao((tx) => gravarCursor(tx, e, { proximoEm: mais(e.agora, esperaConsultaSegundos(decorrido)) }));
}

const NUMERICOS = new Set(['recebidas', 'duplicadas_no_lote', 'com_erro', 'novas', 'atualizadas', 'inalteradas', 'obsoletas']);

/** Estado final do lote no Hub: erro por linha, confirmação dos aceitos, cursor e evento. Só uma execução finaliza (guarda `aceito`). */
export async function finalizar(tx: Transacao, e: Exec, lote: LinhaLote, status: 'concluido' | 'concluido_com_erros' | 'falhou', r: LoteResultadoLido): Promise<void> {
  const hub = Object.fromEntries(Object.entries(r.contagens ?? {}).filter(([k, v]) => NUMERICOS.has(k) && typeof v === 'number'));
  const fechado = await tx.consultar<{ id: string }>(
    `UPDATE integracao_fdv.lote_envio
        SET estado = $3, concluido_em = $4, contagens = contagens || $5::jsonb,
            ultimo_erro_codigo = CASE WHEN $3 = 'falhou' THEN 'falha_processamento' ELSE NULL END
      WHERE tenant_id = $1 AND id = $2 AND estado = 'aceito' RETURNING id`,
    [e.tenant, lote.id, status, e.agora, JSON.stringify({ hub })],
  );
  if (fechado.length === 0) return;
  const { tenant, entidade, agora } = e;
  // ordem de bloqueios da 0038: credencial -> cursor_entidade -> registro_publicado (a troca de credencial do portal segue a mesma)
  await marcarUsoDaCredencial(tx, tenant, e.credId, agora);
  await tx.consultar(
    `SELECT 1 FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2 AND deleted_at IS NULL FOR NO KEY UPDATE`,
    [tenant, entidade],
  );

  // erro por linha do Hub (a origem "conector" é a linha inválida que o ERP mesmo mandou: já está gravada como "erp")
  const doHub = (r.erros ?? []).filter((x) => x.origem !== 'conector');
  for (const x of doHub) {
    await gravarErroDeLinha(tx, e, { loteId: lote.id, origem: 'hub', indice: x.indice, externalId: x.external_id, codigo: x.codigo, campo: x.campo, reprocessavel: x.reprocessavel === true });
  }
  const comErro = new Set(doHub.map((x) => x.external_id));
  const reprocessaveis = new Set(doHub.filter((x) => x.reprocessavel === true).map((x) => x.external_id));
  // lista cortada: o Hub contou mais registros com erro do que listou. Quem não está na lista pode ser um deles: nada fora
  // da lista é confirmado (volta pela curva longa); os da lista seguem o caminho normal (o firme sai da fila e a lista encolhe).
  const listados = (r.erros ?? []).length;
  const comErroNoHub = typeof hub.com_erro === 'number' ? hub.com_erro : listados;
  const listaCortada = comErroNoHub > listados;

  let aceitos = 0;
  if (status !== 'falhou') {
    // hash enviado = hash do payload do lote (sem alterado_em): é ele que o Hub confirmou
    const enviados = lote.corpo.registros.map((x) => ({ chave: x.external_id, hash: hashRegistro(x as Record<string, unknown>) }));
    const aceitosOk = listaCortada ? [] : enviados.filter((x) => !comErro.has(x.chave));
    const recusadosFirmes = enviados.filter((x) => comErro.has(x.chave) && !reprocessaveis.has(x.chave));
    aceitos = aceitosOk.length;
    if (aceitosOk.length > 0) {
      await tx.consultar(
        `UPDATE integracao_fdv.registro_publicado r
            SET hash_confirmado = v.hash, confirmado_em = $3, pendente = (r.hash <> v.hash), ultimo_lote_envio_id = $4,
                fonte_refs = r.fonte_refs - 'reenvio', -- a marca do Reprocessar vale até o Hub confirmar
                contrato_enviado = $7 -- T-0107: a versão do envelope em que o Hub confirmou
           FROM unnest($5::text[], $6::text[]) AS v(chave, hash)
          WHERE r.tenant_id = $1 AND r.entidade = $2 AND r.registro_external_id = v.chave`,
        [tenant, entidade, agora, lote.id, aceitosOk.map((x) => x.chave), aceitosOk.map((x) => x.hash), lote.corpo.versao_contrato],
      );
      // troca de chave (ADR 0010, item 3): a linha antiga, inativa e já confirmada no Hub, sai (`deleted_at`) quando há outra
      // linha ativa do mesmo `erp_id`. Inativação comum (sem sucessora) fica no espelho.
      await tx.consultar(
        `UPDATE integracao_fdv.registro_publicado r SET deleted_at = $3
          WHERE r.tenant_id = $1 AND r.entidade = $2 AND r.registro_external_id = ANY($4::text[])
            AND NOT r.ativo AND NOT r.pendente AND r.deleted_at IS NULL AND r.erp_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM integracao_fdv.registro_publicado n
                         WHERE n.tenant_id = r.tenant_id AND n.entidade = r.entidade AND n.erp_id = r.erp_id
                           AND n.fonte_ocorrido_em > r.fonte_ocorrido_em AND n.deleted_at IS NULL AND n.id <> r.id)`,
        [tenant, entidade, agora, aceitosOk.map((x) => x.chave)],
      );
      await tx.consultar(
        `UPDATE integracao_fdv.lote_erro SET resolvido_em = $4, resolvido_no_lote_envio_id = $3
          WHERE tenant_id = $1 AND entidade = $2 AND resolvido_em IS NULL AND lote_envio_id <> $3 AND registro_external_id = ANY($5::text[])`,
        [tenant, entidade, lote.id, agora, aceitosOk.map((x) => x.chave)],
      );
    }
    // recusado pelo Hub (recusadosFirmes) ou declarado inválido pelo ERP (`contagens.firmes`) sem remédio por ora: sai da fila
    // até o cadastro mudar. `pendente = (r.hash <> v.hash)`: se um evento novo mudou o conteúdo no meio do caminho, continua pendente.
    const saemDaFila = [...recusadosFirmes.map((x) => [x.chave, x.hash] as const), ...(lote.contagens.firmes ?? [])];
    if (saemDaFila.length > 0) {
      await tx.consultar(
        `UPDATE integracao_fdv.registro_publicado r SET pendente = (r.hash <> v.hash), ultimo_lote_envio_id = $3,
                contrato_enviado = $6 -- T-0107: o recusado também guarda a versão tentada, senão a virada o recolocaria sem fim
           FROM unnest($4::text[], $5::text[]) AS v(chave, hash)
          WHERE r.tenant_id = $1 AND r.entidade = $2 AND r.registro_external_id = v.chave`,
        [tenant, entidade, lote.id, saemDaFila.map((x) => x[0]), saemDaFila.map((x) => x[1]), lote.corpo.versao_contrato],
      );
    }
  }

  // Cursor local junto com o do Hub; sessão fecha na última parte. O cursor avança no estado final mesmo com erro por linha:
  // ele só marca o ponto da carga completa (o delta escolhe por `pendente`), e o que ficou com erro volta pelo `pendente`.
  const final = status !== 'falhou';
  const avanco = r.cursor ?? lote.contagens.avanco ?? lote.corpo.cursor;
  const proximo =
    status === 'falhou' ? mais(agora, ATRASO_MAXIMO_S)
    : reprocessaveis.size > 0 || listaCortada ? mais(agora, ATRASO_MAXIMO_S)
    : (await haPendentes(tx, tenant, entidade)) || (lote.modo === 'completo' && lote.sessao_ultimo === false) ? agora
    : mais(agora, ESPERA_OCIOSA_S);
  await gravarCursor(tx, e, {
    proximoEm: proximo,
    ...(final ? { sucessoEm: agora } : {}),
    ...(final && avanco ? { cursor: avanco } : {}),
    ...(final && lote.sessao_ultimo === true ? { sessaoAberta: { id: null } } : {}),
  });
  if (final) await acordarDependentes(tx, tenant, entidade, agora);

  if (final) {
    await publicar(tx, e, EVENTO_LOTE_ENVIADO, lote.id, { lote_envio_id: lote.id, entidade, modo: lote.modo, geracao: lote.geracao, registros: lote.corpo.registros.length, aceitos, com_erro: Math.max(comErro.size, comErroNoHub), concluido_em: agora.toISOString() });
  } else {
    await publicar(tx, e, EVENTO_LOTE_FALHOU, lote.id, { lote_envio_id: lote.id, entidade, modo: lote.modo, geracao: lote.geracao, estado: 'falhou', codigo: 'falha_processamento', tentativas: lote.tentativas, falhou_em: agora.toISOString() });
  }
}

async function haPendentes(tx: Transacao, tenant: string, entidade: Entidade): Promise<boolean> {
  const l = await tx.consultar(`SELECT 1 FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = $2 AND pendente AND NOT aguarda_vinculo AND deleted_at IS NULL LIMIT 1`, [tenant, entidade]);
  return l.length > 0;
}

/**
 * Quem depende desta entidade (vem depois na ordem de carga) e tem pendência volta a ser avaliado já. O `least` desfaz de
 * propósito a posse da reserva do dependente: a regravação de quem a tem só vale se o `proximo_em` ainda for o `posseAte`.
 */
async function acordarDependentes(tx: Transacao, tenant: string, entidade: Entidade, agora: Date): Promise<void> {
  const depois = ENTIDADES_HUB_F2.slice(ENTIDADES_HUB_F2.indexOf(entidade) + 1);
  if (depois.length === 0) return;
  await tx.consultar(
    `UPDATE integracao_fdv.cursor_entidade c SET proximo_em = least(c.proximo_em, $3)
      WHERE c.tenant_id = $1 AND c.entidade::text = ANY($2::text[]) AND c.pausada_motivo IS NULL AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM integracao_fdv.registro_publicado r WHERE r.tenant_id = $1 AND r.entidade = c.entidade AND r.pendente AND NOT r.aguarda_vinculo AND r.deleted_at IS NULL)`,
    [tenant, depois, agora],
  );
}
