/**
 * SQL do espelho `integracao_fdv.registro_publicado` e das referências (M1, M10): gravação com descarte de evento mais velho
 * (M3), dedupe pelo hash (RN-INF-03), recomposição dos dependentes (índice GIN de `fonte_refs`) e leitura das fontes da
 * recomposição. Sem `SELECT *` nem `RETURNING *` (recado R-20261121-221350); toda leitura de `payload` filtra `payload IS NOT NULL`
 * (o payload do inativado e confirmado é anulado pela retenção). `tenant_id` explícito em todo SQL.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { CodigoConflitoChave, EntidadeHub } from '../contracts';
import { ALVO_DA_CHAVE_REFS, inativarRegistro, lerParcelasDias, recomporRegistro, tabelaDaReferencia, type FontesRecomposicao, type RegistroEspelho, type TabelaReferencia } from '../domain';
import { anteciparEntidades, garantirLinhaDoSinal } from './conector-comum';

export interface LinhaRegistro {
  id: string;
  entidade: EntidadeHub;
  registro_external_id: string;
  payload: Record<string, unknown> | null;
  hash: string;
  alterado_em: Date;
  fonte_ocorrido_em: Date;
  erp_id: string | null;
  fonte_refs: Record<string, string>;
  ativo: boolean;
  hash_confirmado: string | null;
  pendente: boolean;
}

/** Colunas do espelho que viram `LinhaRegistro` (e, por `paraRegistro`, `RegistroEspelho`): o envio lê com as mesmas. */
export const COLUNAS = 'id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, erp_id, fonte_refs, ativo, hash_confirmado, pendente';

export function paraRegistro(l: LinhaRegistro): RegistroEspelho {
  return {
    entidade: l.entidade,
    external_id: l.registro_external_id,
    alterado_em: l.alterado_em.toISOString(),
    ativo: l.ativo,
    payload: l.payload ?? {},
    hash: l.hash,
    erp_id: l.erp_id,
    fonte_refs: l.fonte_refs,
  };
}

type ResultadoGravacao = { resultado: 'descartado' | 'conflito' } | { resultado: 'gravado' | 'igual'; pendente: boolean };

/**
 * Grava o registro do espelho. Evento mais velho que o `fonte_ocorrido_em` já aplicado é descartado (M3). Hash igual ao
 * `hash_confirmado` = não fica pendente (RN-INF-03). `alterado_em` só avança e só quando o conteúdo mudou.
 * RN-CORE-05 e ADR 0010 item 3 (nada é sobrescrito): a chave do Hub que já pertence a outro cadastro (`erp_id` diferente)
 * não é gravada; devolve `conflito` (`aplicarRegistros` grava `chave_duplicada` em `conflito_chave`).
 */
export async function gravarRegistro(tx: Transacao, tenantId: string, r: RegistroEspelho, ocorridoEm: Date): Promise<ResultadoGravacao> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const [atual] = await tx.consultar<Pick<LinhaRegistro, 'id' | 'hash' | 'alterado_em' | 'fonte_ocorrido_em' | 'hash_confirmado' | 'pendente' | 'erp_id'>>(
      `SELECT id, hash, alterado_em, fonte_ocorrido_em, hash_confirmado, pendente, erp_id
         FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3 FOR UPDATE`,
      [tenantId, r.entidade, r.external_id],
    );
    if (!atual) {
      const criado = await tx.consultar<{ id: string }>(
        `INSERT INTO integracao_fdv.registro_publicado
           (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente, erp_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6, $7::jsonb, $8, true, $9)
         ON CONFLICT (tenant_id, entidade, registro_external_id) DO NOTHING RETURNING id`,
        [tenantId, r.entidade, r.external_id, JSON.stringify(r.payload), r.hash, ocorridoEm, JSON.stringify(r.fonte_refs), r.ativo, r.erp_id],
      );
      if (criado.length > 0) return { resultado: 'gravado', pendente: true };
      continue; // outro processo criou no meio: relê e segue pelo caminho de atualização
    }
    if (atual.erp_id !== null && atual.erp_id !== r.erp_id) return { resultado: 'conflito' };
    if (atual.fonte_ocorrido_em.getTime() > ocorridoEm.getTime()) return { resultado: 'descartado' };
    if (atual.hash === r.hash) {
      await tx.consultar(
        `UPDATE integracao_fdv.registro_publicado
            SET fonte_ocorrido_em = greatest(fonte_ocorrido_em, $3), fonte_refs = $4::jsonb, erp_id = $5, deleted_at = NULL
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, atual.id, ocorridoEm, JSON.stringify(r.fonte_refs), r.erp_id],
      );
      return { resultado: 'igual', pendente: atual.pendente };
    }
    const pendente = atual.hash_confirmado !== r.hash;
    await tx.consultar(
      `UPDATE integracao_fdv.registro_publicado
          SET payload = $3::jsonb, hash = $4, alterado_em = greatest(alterado_em, $5), fonte_ocorrido_em = $5, fonte_refs = $6::jsonb,
              ativo = $7, pendente = $8, erp_id = $9, deleted_at = NULL
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, atual.id, JSON.stringify(r.payload), r.hash, ocorridoEm, JSON.stringify(r.fonte_refs), r.ativo, pendente, r.erp_id],
    );
    return { resultado: 'gravado', pendente };
  }
  throw new Error('espelho: conflito ao gravar o registro');
}

/** Atualiza o conteúdo de um registro já existente (recomposição e inativação), sem mexer no `fonte_ocorrido_em`. */
async function atualizarConteudo(tx: Transacao, tenantId: string, l: LinhaRegistro, novo: RegistroEspelho, ocorridoEm: Date): Promise<boolean> {
  const pendente = l.hash_confirmado !== novo.hash;
  await tx.consultar(
    `UPDATE integracao_fdv.registro_publicado
        SET payload = $3::jsonb, hash = $4, alterado_em = greatest(alterado_em, $5), ativo = $6, pendente = $7
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, l.id, JSON.stringify(novo.payload), novo.hash, ocorridoEm, novo.ativo, pendente],
  );
  return pendente;
}

// ---- fontes da recomposição ----

/** Carrega, de uma vez, o que `recomporRegistro` precisa para os registros dados (consultas por lote, nunca por registro). */
async function carregarFontes(tx: Transacao, tenantId: string, regs: readonly RegistroEspelho[]): Promise<FontesRecomposicao> {
  const porEntidade = new Map<string, Set<string>>();
  for (const r of regs) {
    for (const [k, v] of Object.entries(r.fonte_refs)) {
      const alvo = ALVO_DA_CHAVE_REFS[k];
      if (alvo) porEntidade.set(alvo, (porEntidade.get(alvo) ?? new Set()).add(v));
    }
  }
  const chaves = new Map<string, string>();
  const nomes = new Map<string, string>();
  const prazos = new Map<string, { forma: string | null; parcelas: unknown }>();
  for (const [alvo, ids] of porEntidade) {
    if (alvo === 'tabela') continue;
    const linhas = await tx.consultar<{ erp_id: string; chave: string; nome: string | null; forma: string | null; parcelas: unknown }>(
      `SELECT b.erp_id, r.registro_external_id AS chave, r.payload ->> 'nome' AS nome,
              r.payload ->> 'forma_external_id' AS forma, r.payload -> 'parcelas_dias' AS parcelas
         FROM unnest($3::uuid[]) AS b(erp_id)
         JOIN integracao_fdv.registro_publicado r
           ON r.tenant_id = $1 AND r.entidade = $2 AND r.erp_id = b.erp_id AND r.deleted_at IS NULL
        ORDER BY r.ativo DESC, r.fonte_ocorrido_em DESC`,
      [tenantId, alvo, [...ids]],
    );
    for (const l of linhas) {
      const k = `${alvo}:${l.erp_id}`;
      if (chaves.has(k)) continue; // a primeira é a ativa mais recente
      chaves.set(k, l.chave);
      if (l.nome) nomes.set(k, l.nome);
      if (alvo === 'prazo_pagamento') prazos.set(l.erp_id, { forma: l.forma, parcelas: l.parcelas });
    }
  }
  const formas = new Map<string, string>();
  const idsForma = [...new Set([...prazos.values()].map((p) => p.forma).filter((f): f is string => f !== null))];
  if (idsForma.length > 0) {
    const linhas = await tx.consultar<{ chave: string; codigo: string | null }>(
      `SELECT registro_external_id AS chave, payload ->> 'codigo' AS codigo
         FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND entidade = 'forma_pagamento' AND registro_external_id = ANY($2::text[]) AND deleted_at IS NULL AND payload IS NOT NULL`,
      [tenantId, idsForma],
    );
    for (const l of linhas) if (l.codigo) formas.set(l.chave, l.codigo);
  }
  const tabelas = new Map<string, TabelaReferencia>();
  const idsTabela = [...(porEntidade.get('tabela') ?? [])];
  if (idsTabela.length > 0) {
    const linhas = await tx.consultar<{ erp_id: string; dados: Record<string, unknown> }>(
      `SELECT erp_id, dados FROM integracao_fdv.referencia
        WHERE tenant_id = $1 AND tipo = 'tabela_preco' AND erp_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [tenantId, idsTabela],
    );
    for (const l of linhas) {
      // RD-0318: a chave do Hub da tabela é `dados.chave`; sem ela a referência não conta (o preço fica referencia_ausente)
      const t = tabelaDaReferencia(l.dados);
      if (t) tabelas.set(l.erp_id, t);
    }
  }
  const padrao = await tx.consultar<{ erp_id: string }>(
    `SELECT erp_id FROM integracao_fdv.referencia
      WHERE tenant_id = $1 AND tipo = 'filial_padrao' AND deleted_at IS NULL ORDER BY fonte_ocorrido_em DESC LIMIT 1`,
    [tenantId],
  );
  return {
    chave: (entidade, erpId) => chaves.get(`${entidade}:${erpId}`) ?? null,
    tabela: (erpId) => tabelas.get(erpId) ?? null,
    filialPadraoId: padrao[0]?.erp_id ?? null,
    nomeFilial: (erpId) => nomes.get(`filial:${erpId}`) ?? null,
    condicao: (erpId) => {
      const p = prazos.get(erpId);
      const codigo = p?.forma ? formas.get(p.forma) : undefined;
      const lista = lerParcelasDias(p?.parcelas);
      if (!lista || !codigo) return null;
      return { forma_codigo: codigo, prazos_dias: lista };
    },
  };
}

/**
 * Recompõe e grava os registros do conjunto (os que já estão compostos com o mesmo hash não são tocados). Chave do Hub que
 * já é de outro `erp_id` não é gravada: vira `chave_duplicada` em `conflito_chave` (ADR 0010, item 3). Gravado ou igual
 * encerra o conflito aberto do registro (o próximo evento coerente).
 */
export async function aplicarRegistros(
  tx: Transacao,
  tenantId: string,
  regs: readonly RegistroEspelho[],
  ocorridoEm: Date,
  /** `falhar`: conflito lança erro (a transação volta e o evento é refeito); usado no principal, depois da troca de chave. */
  aoConflito: 'registrar' | 'falhar' = 'registrar',
): Promise<Set<EntidadeHub>> {
  const pendentes = new Set<EntidadeHub>();
  if (regs.length === 0) return pendentes;
  const fontes = await carregarFontes(tx, tenantId, regs);
  const coerentes: RegistroEspelho[] = [];
  for (const r of regs) {
    const composto = recomporRegistro(r, fontes);
    const g = await gravarRegistro(tx, tenantId, composto, ocorridoEm);
    if (g.resultado === 'conflito') {
      if (aoConflito === 'falhar') throw new Error('espelho: conflito de chave depois da troca; a transação volta e o evento é refeito');
      if (composto.erp_id) await registrarConflito(tx, tenantId, composto.entidade, composto.erp_id, composto.external_id, 'chave_duplicada');
      continue;
    }
    if (g.resultado !== 'descartado') coerentes.push(composto);
    if ('pendente' in g && g.pendente) pendentes.add(r.entidade);
  }
  await encerrarConflitos(tx, tenantId, coerentes);
  return pendentes;
}

// ---- conflito de chave (integracao_fdv.conflito_chave, 0015) ----

/**
 * Grava o conflito aberto do registro (único em aberto por `(tenant, entidade, erp_id)`). Igual ao que já está aberto = nada;
 * diferente (outro código ou outra chave) = encerra o aberto e abre o novo (o worker só tem UPDATE em `resolvido_em` e `deleted_at`).
 */
export async function registrarConflito(tx: Transacao, tenantId: string, entidade: EntidadeHub, erpId: string, chave: string, codigo: CodigoConflitoChave): Promise<void> {
  const [aberto] = await tx.consultar<{ id: string; chave: string; codigo: string }>(
    `SELECT id, chave, codigo FROM integracao_fdv.conflito_chave
      WHERE tenant_id = $1 AND entidade = $2 AND erp_id = $3 AND resolvido_em IS NULL FOR UPDATE`,
    [tenantId, entidade, erpId],
  );
  if (aberto?.chave === chave && aberto.codigo === codigo) return;
  if (aberto) await tx.consultar(`UPDATE integracao_fdv.conflito_chave SET resolvido_em = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, aberto.id]);
  await tx.consultar(
    `INSERT INTO integracao_fdv.conflito_chave (tenant_id, entidade, erp_id, chave, codigo) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, entidade, erpId, chave, codigo],
  );
}

/** Os registros gravados de forma coerente encerram o conflito aberto deles (uma instrução por entidade). */
async function encerrarConflitos(tx: Transacao, tenantId: string, regs: readonly RegistroEspelho[]): Promise<void> {
  const porEntidade = new Map<EntidadeHub, string[]>();
  for (const r of regs) if (r.erp_id) porEntidade.set(r.entidade, [...(porEntidade.get(r.entidade) ?? []), r.erp_id]);
  for (const [entidade, ids] of porEntidade) {
    await tx.consultar(
      `UPDATE integracao_fdv.conflito_chave SET resolvido_em = now()
        WHERE tenant_id = $1 AND entidade = $2 AND erp_id = ANY($3::uuid[]) AND resolvido_em IS NULL`,
      [tenantId, entidade, ids],
    );
  }
}

/**
 * Situação da chave do Hub de um `erp_id` no espelho, para `decidirTrocaDeChave`. Existe antes da gravação porque a troca e o
 * conflito precisam ser decididos antes de gravar; a guarda de `gravarRegistro` cobre só a corrida e os registros sem consulta prévia.
 * A linha do `erp_id` é a ativa, ou a mais recente se todas estão inativas (um cadastro inativo também troca de chave).
 */
export async function situacaoDaChave(
  tx: Transacao,
  tenantId: string,
  entidade: EntidadeHub,
  erpId: string,
  chaveNova: string,
): Promise<{ chaveEspelho: string | null; outroErpId: string | null; fonteOcorridoEm: Date | null }> {
  const [atual] = await tx.consultar<{ chave: string; fonte_ocorrido_em: Date }>(
    `SELECT registro_external_id AS chave, fonte_ocorrido_em FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = $2 AND erp_id = $3 AND deleted_at IS NULL
      ORDER BY ativo DESC, fonte_ocorrido_em DESC LIMIT 1`,
    [tenantId, entidade, erpId],
  );
  // a chave é única no espelho (também a de linha inativa ou já saída): se é de outro erp_id, a nova não pode ser gravada
  const [outro] = await tx.consultar<{ erp_id: string }>(
    `SELECT erp_id FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3 AND erp_id IS NOT NULL AND erp_id <> $4 LIMIT 1`,
    [tenantId, entidade, chaveNova, erpId],
  );
  return { chaveEspelho: atual?.chave ?? null, outroErpId: outro?.erp_id ?? null, fonteOcorridoEm: atual?.fonte_ocorrido_em ?? null };
}

const PAGINA_DEPENDENTES = 500;

/**
 * Recompõe os registros que apontam (`fonte_refs`) para `chaveRef = erpId` (M10): grava só os que mudaram de hash e os
 * marca pendentes. Devolve as entidades que ficaram com pendência.
 */
export async function recomporDependentes(tx: Transacao, tenantId: string, chaveRef: string, erpId: string, ocorridoEm: Date): Promise<Set<EntidadeHub>> {
  const pendentes = new Set<EntidadeHub>();
  let apos = '00000000-0000-0000-0000-000000000000';
  const filtro = JSON.stringify({ [chaveRef]: erpId });
  for (;;) {
    const linhas = await tx.consultar<LinhaRegistro>(
      `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND fonte_refs @> $2::jsonb AND deleted_at IS NULL AND payload IS NOT NULL AND id > $3
        ORDER BY id LIMIT ${PAGINA_DEPENDENTES}`,
      [tenantId, filtro, apos],
    );
    if (linhas.length === 0) break;
    const regs = linhas.map(paraRegistro);
    const fontes = await carregarFontes(tx, tenantId, regs);
    for (const [i, l] of linhas.entries()) {
      const novo = recomporRegistro(regs[i]!, fontes);
      if (novo.hash === l.hash && novo.ativo === l.ativo) continue;
      if (await atualizarConteudo(tx, tenantId, l, novo, ocorridoEm)) pendentes.add(l.entidade);
    }
    apos = linhas[linhas.length - 1]!.id;
    if (linhas.length < PAGINA_DEPENDENTES) break;
  }
  return pendentes;
}

/**
 * Troca controlada (ADR 0010, item 3): a linha antiga do `erp_id` fica viva, com o mesmo `erp_id`, `ativo = false` e
 * pendente até o Hub confirmar a inativação; o `finalizar` do lote a tira (`deleted_at`) só depois (RN-CAD-08). Exceção: a que
 * nunca foi ao Hub e não está em lote aberto recebe `deleted_at` na hora.
 */
export async function aplicarTrocaDeChave(tx: Transacao, tenantId: string, entidade: EntidadeHub, erpId: string, chaveNova: string, ocorridoEm: Date): Promise<Set<EntidadeHub>> {
  const linhas = await tx.consultar<LinhaRegistro>(
    `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = $2 AND erp_id = $3 AND registro_external_id <> $4
        AND ativo AND deleted_at IS NULL AND payload IS NOT NULL`,
    [tenantId, entidade, erpId, chaveNova],
  );
  // a que nunca foi ao Hub e não está em lote aberto não tem o que inativar lá: sai direto
  const nuncaEnviadas = await tx.consultar<{ id: string }>(
    `UPDATE integracao_fdv.registro_publicado r SET deleted_at = now()
      WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[]) AND r.hash_confirmado IS NULL AND r.ultimo_lote_envio_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM integracao_fdv.lote_envio l
                         WHERE l.tenant_id = r.tenant_id AND l.entidade = r.entidade AND l.estado IN ('montado', 'enviando', 'aceito')
                           AND l.corpo @> jsonb_build_object('registros', jsonb_build_array(jsonb_build_object('external_id', r.registro_external_id))))
      RETURNING r.id`,
    [tenantId, linhas.map((l) => l.id)],
  );
  const saidas = new Set(nuncaEnviadas.map((x) => x.id));
  return inativarLinhas(tx, tenantId, linhas.filter((l) => !saidas.has(l.id)), ocorridoEm);
}

/**
 * Filhos retirados da lista do pai (unidade de produto, endereço de cliente): os que têm `fonte_refs[chaveRef] = paiErpId`
 * e `erp_id` fora de `idsAtuais` vão com `ativo = false` (RN-CAD-08).
 */
export async function inativarRetirados(
  tx: Transacao,
  tenantId: string,
  entidade: EntidadeHub,
  chaveRef: string,
  paiErpId: string,
  idsAtuais: readonly string[],
  ocorridoEm: Date,
): Promise<Set<EntidadeHub>> {
  const linhas = await tx.consultar<LinhaRegistro>(
    `SELECT ${COLUNAS} FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = $2 AND fonte_refs @> $3::jsonb AND NOT (erp_id = ANY($4::uuid[]))
        AND ativo AND deleted_at IS NULL AND payload IS NOT NULL`,
    [tenantId, entidade, JSON.stringify({ [chaveRef]: paiErpId }), [...idsAtuais]],
  );
  return inativarLinhas(tx, tenantId, linhas, ocorridoEm);
}

async function inativarLinhas(tx: Transacao, tenantId: string, linhas: readonly LinhaRegistro[], ocorridoEm: Date): Promise<Set<EntidadeHub>> {
  const pendentes = new Set<EntidadeHub>();
  for (const l of linhas) {
    const novo = inativarRegistro(paraRegistro(l), ocorridoEm.toISOString());
    if (await atualizarConteudo(tx, tenantId, l, novo, ocorridoEm)) pendentes.add(l.entidade);
  }
  return pendentes;
}

/** A forma de pagamento fica ativa enquanto houver prazo ativo (de outra condição) com a mesma forma (T-0009 2.3). */
export async function outroPrazoAtivoDaForma(tx: Transacao, tenantId: string, formaChave: string, prazoChave: string): Promise<boolean> {
  const l = await tx.consultar(
    `SELECT 1 FROM integracao_fdv.registro_publicado
      WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND ativo AND deleted_at IS NULL AND payload IS NOT NULL
        AND payload ->> 'forma_external_id' = $2 AND registro_external_id <> $3 LIMIT 1`,
    [tenantId, formaChave, prazoChave],
  );
  return l.length > 0;
}

// ---- referência (tabela de preço, filial padrão) ----

/**
 * `mudou` = a referência mudou ou é nova (`false` se igual ou descartada por ser mais velha, M3); `dadosAntes` = os dados que
 * estavam gravados e ativos (`null` = não havia), lidos na mesma leitura `FOR UPDATE`.
 */
export async function gravarReferencia(
  tx: Transacao,
  tenantId: string,
  r: { tipo: 'tabela_preco' | 'filial_padrao'; erp_id: string; dados: Record<string, unknown> },
  ocorridoEm: Date,
): Promise<{ mudou: boolean; dadosAntes: Record<string, unknown> | null }> {
  const [atual] = await tx.consultar<{ id: string; dados: Record<string, unknown>; fonte_ocorrido_em: Date; deleted_at: Date | null }>(
    `SELECT id, dados, fonte_ocorrido_em, deleted_at FROM integracao_fdv.referencia
      WHERE tenant_id = $1 AND tipo = $2 AND erp_id = $3 FOR UPDATE`,
    [tenantId, r.tipo, r.erp_id],
  );
  const dadosAntes = atual && !atual.deleted_at ? atual.dados : null;
  if (atual && atual.fonte_ocorrido_em.getTime() > ocorridoEm.getTime()) return { mudou: false, dadosAntes };
  if (atual && !atual.deleted_at && JSON.stringify(atual.dados) === JSON.stringify(r.dados)) {
    await tx.consultar(`UPDATE integracao_fdv.referencia SET fonte_ocorrido_em = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, atual.id, ocorridoEm]);
    return { mudou: false, dadosAntes };
  }
  await tx.consultar(
    // RD-0318: a chave da tabela mora em `dados.chave`; `external_id` da referência fica nulo (sem uso)
    `INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, dados, fonte_ocorrido_em)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (tenant_id, tipo, erp_id) DO UPDATE
        SET dados = EXCLUDED.dados, external_id = NULL, fonte_ocorrido_em = EXCLUDED.fonte_ocorrido_em,
            deleted_at = NULL`,
    [tenantId, r.tipo, r.erp_id, JSON.stringify(r.dados), ocorridoEm],
  );
  return { mudou: true, dadosAntes };
}

/** A filial deixou de ser a padrão (ou foi inativada): a referência sai, se o evento não for mais velho que ela. */
export async function removerReferencia(tx: Transacao, tenantId: string, tipo: 'filial_padrao', erpId: string, ocorridoEm: Date): Promise<boolean> {
  const l = await tx.consultar<{ id: string }>(
    `UPDATE integracao_fdv.referencia SET deleted_at = now(), fonte_ocorrido_em = $4
      WHERE tenant_id = $1 AND tipo = $2 AND erp_id = $3 AND deleted_at IS NULL AND fonte_ocorrido_em <= $4 RETURNING id`,
    [tenantId, tipo, erpId, ocorridoEm],
  );
  return l.length > 0;
}

/**
 * O consumidor marcou pendência: o envio da entidade sai em segundos (`proximo_em = least(proximo_em, agora)`). O `least`
 * desfaz de propósito a posse de uma reserva em andamento: quem tem a posse regrava o `proximo_em` só se ele ainda for o
 * `posseAte` (`adiarPresoAPosse`), então a pendência nova vence e a entidade volta a ser avaliada já. Também garante a
 * linha do sinal do tenant.
 */
export async function agendarEnvio(tx: Transacao, tenantId: string, entidades: ReadonlySet<EntidadeHub>, agora: Date): Promise<void> {
  await garantirLinhaDoSinal(tx, tenantId, agora);
  await anteciparEntidades(tx, tenantId, [...entidades], agora);
}
