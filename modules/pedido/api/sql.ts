/**
 * Adaptador PostgreSQL do schema `pedido`. Roda na transação do tenant (`comTenant`: RLS por `app.tenant_id`), por isso
 * nenhum SQL repete `tenant_id` no WHERE e o INSERT usa `plataforma.tenant_atual()`. bigint volta como `float8`
 * (centavos e Qtd4 cabem em 2^53); datas de negócio voltam como texto ISO em UTC com ms.
 * Concorrência (T-0013 §2): `FOR UPDATE` em toda transição e `pg_advisory_xact_lock` por cliente na criação e na aprovação.
 * O gatilho `pedido.validar_status` (0012) é a última barreira: SQLSTATE MXP02 vira 422 `RN-PED-02` com os status possíveis
 * (só nomes de status; o `DETAIL` cru nunca vai a log nem a resposta).
 */
import { erros, paginar, type Pagina, type Transacao } from '@macuxierp/platform-sdk';
import { STATUS_COMPROMETEM } from '../domain';
import { FUSO_TENANT } from './util';
import { StatusPedido, type DecisaoPedido, type HistoricoPedido, type Pendencia } from '../contracts';
import type {
  DadosCabecalho, FiltroPedidos, ItemGravado, LinhaLista, NovaAprovacao, NovoEvento, NovoItem, NovoPedido, PedidoGravado, RepoPedidos,
} from './portas';

type Dict = Record<string, unknown>;

const ISO = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const COMPROMETEM = STATUS_COMPROMETEM.map((s) => `'${s}'`).join(', ');
const N = (c: string) => `${c}::float8`;

const COLUNAS_PEDIDO = [
  'id', `${N('numero')} AS numero`, 'origem', 'status', 'external_id', 'filial_id', 'cliente_id', 'vendedor_id', 'condicao_pagamento_id', 'a_vista',
  'tabela_preco_id', 'cliente_retrato', 'endereco_entrega', 'frete', `${ISO('emitido_em')} AS emitido_em`,
  `${ISO('aprovado_origem_em')} AS aprovado_origem_em`, 'observacao', `${N('total_centavos')} AS total_centavos`,
  `${N('total_informado_centavos')} AS total_informado_centavos`, `${N('valor_faturado_centavos')} AS valor_faturado_centavos`,
  'pendencias', `${ISO('validado_em')} AS validado_em`, 'criado_por', `${ISO('updated_at')} AS updated_at`,
].join(', ');

const COLUNAS_ITEM = [
  'id', 'sequencia', 'produto_id', 'produto_retrato', `${N('quantidade')} AS quantidade`, 'unidade_venda', `${N('fator_venda')} AS fator_venda`,
  `${N('quantidade_venda')} AS quantidade_venda`, `${N('preco_unitario_centavos')} AS preco_unitario_centavos`,
  `${N('preco_tabela_centavos')} AS preco_tabela_centavos`, 'desconto_maximo_bp', `${N('desconto_centavos')} AS desconto_centavos`,
  `${N('total_centavos')} AS total_centavos`, `${N('total_informado_centavos')} AS total_informado_centavos`,
  `${N('quantidade_faturada')} AS quantidade_faturada`, 'aplicacao',
].join(', ');

const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

/** SQLSTATE MXP02 (gatilho de status) → 422 RN-PED-02 com `campos.possiveis`; o resto sobe como está. */
function traduzir(e: unknown): never {
  const err = e as { code?: string; detail?: string };
  if (err.code === 'MXP02') {
    const lista = /^possiveis=(.*)$/.exec(err.detail ?? '')?.[1] ?? '';
    const possiveis = lista.split(',').filter((s) => StatusPedido.safeParse(s).success);
    throw erros.regra('RN-PED-02', 'Transição de status não permitida', { possiveis: possiveis.join(',') });
  }
  throw e;
}

async function executar<L = Dict>(tx: Transacao, sql: string, p: readonly unknown[] = []): Promise<L[]> {
  try {
    return await tx.consultar<L>(sql, p);
  } catch (e) {
    return traduzir(e);
  }
}

const mapItem = (l: Dict): ItemGravado => l as unknown as ItemGravado;

class RepoPedidosSql implements RepoPedidos {
  constructor(private readonly tx: Transacao) {}

  async tenantId(): Promise<string> {
    const [l] = await executar<{ id: string }>(this.tx, 'SELECT plataforma.tenant_atual() AS id');
    return (l as { id: string }).id;
  }

  async travarCliente(chave: bigint): Promise<void> {
    await executar(this.tx, 'SELECT pg_advisory_xact_lock($1::bigint)', [chave.toString()]);
  }

  async proximoNumero(): Promise<number> {
    await executar(this.tx, 'INSERT INTO pedido.numeracao (tenant_id) VALUES (plataforma.tenant_atual()) ON CONFLICT (tenant_id) DO NOTHING');
    const [l] = await executar<{ numero: number }>(this.tx, 'UPDATE pedido.numeracao SET proximo = proximo + 1 RETURNING (proximo - 1)::float8 AS numero');
    return (l as { numero: number }).numero;
  }

  async inserir(id: string, numero: number, p: NovoPedido): Promise<boolean> {
    const r = await executar<{ id: string }>(
      this.tx,
      `INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, vendedor_id, condicao_pagamento_id, tabela_preco_id,
         cliente_retrato, endereco_entrega, frete, emitido_em, aprovado_origem_em, observacao, total_centavos, total_informado_centavos,
         pendencias, validado_em, criado_por, external_id, a_vista)
       VALUES ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21)
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [id, numero, p.origem, p.filial_id, p.cliente_id, p.vendedor_id, p.condicao_pagamento_id, p.tabela_preco_id, json(p.cliente_retrato), json(p.endereco_entrega), json(p.frete),
        p.emitido_em, p.aprovado_origem_em, p.observacao, p.total_centavos, p.total_informado_centavos, json(p.pendencias), p.validado_em, p.criado_por, p.external_id, p.a_vista],
    );
    if (r.length === 0) return false; // external_id repetido (RN-PED-01)
    await this.inserirItens(id, p.itens);
    return true;
  }

  private async inserirItens(pedidoId: string, itens: readonly NovoItem[]): Promise<void> {
    if (itens.length === 0) return;
    const p: unknown[] = [pedidoId];
    const linhas = itens.map((i) => {
      const valores = [i.sequencia, i.produto_id, json(i.produto_retrato), i.quantidade, i.unidade_venda, i.fator_venda, i.quantidade_venda, i.preco_unitario_centavos, i.preco_tabela_centavos,
        i.desconto_maximo_bp, i.desconto_centavos, i.total_centavos, i.total_informado_centavos, i.aplicacao];
      const marcas = valores.map((v, n) => `$${p.push(v)}${n === 2 ? '::jsonb' : ''}`);
      return `(plataforma.tenant_atual(), $1, ${marcas.join(', ')})`;
    });
    await executar(
      this.tx,
      `INSERT INTO pedido.pedido_item (tenant_id, pedido_id, sequencia, produto_id, produto_retrato, quantidade, unidade_venda, fator_venda, quantidade_venda,
         preco_unitario_centavos, preco_tabela_centavos, desconto_maximo_bp, desconto_centavos, total_centavos, total_informado_centavos, aplicacao)
       VALUES ${linhas.join(', ')}`,
      p,
    );
  }

  private async completo(onde: string, valor: string, bloquear: boolean): Promise<PedidoGravado | null> {
    const [l] = await executar(this.tx, `SELECT ${COLUNAS_PEDIDO} FROM pedido.pedido WHERE ${onde} AND deleted_at IS NULL LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`, [valor]);
    if (!l) return null;
    const itens = await executar(this.tx, `SELECT ${COLUNAS_ITEM} FROM pedido.pedido_item WHERE pedido_id = $1 AND deleted_at IS NULL ORDER BY sequencia`, [l.id]);
    return { ...(l as unknown as Omit<PedidoGravado, 'itens'>), itens: itens.map(mapItem) };
  }

  porExternalId(externalId: string) {
    return this.completo('external_id = $1', externalId, false);
  }
  obter(id: string) {
    return this.completo('id = $1', id, false);
  }
  obterParaAtualizar(id: string) {
    return this.completo('id = $1', id, true);
  }

  async atualizarStatus(id: string, status: string, pendencias: readonly Pendencia[], validadoEm: Date | null): Promise<void> {
    await executar(this.tx, 'UPDATE pedido.pedido SET status = $2, pendencias = $3::jsonb, validado_em = coalesce($4, validado_em) WHERE id = $1', [id, status, json(pendencias), validadoEm]);
  }

  async atualizarPendencias(id: string, pendencias: readonly Pendencia[], validadoEm: Date): Promise<void> {
    await executar(this.tx, 'UPDATE pedido.pedido SET pendencias = $2::jsonb, validado_em = $3 WHERE id = $1', [id, json(pendencias), validadoEm]);
  }

  async atualizarAVista(id: string, aVista: boolean): Promise<void> {
    await executar(this.tx, 'UPDATE pedido.pedido SET a_vista = $2 WHERE id = $1', [id, aVista]);
  }

  async atualizarCabecalho(id: string, d: DadosCabecalho): Promise<void> {
    await executar(
      this.tx,
      `UPDATE pedido.pedido SET filial_id = $2, cliente_id = $3, vendedor_id = $4, condicao_pagamento_id = $5, tabela_preco_id = $6,
         cliente_retrato = $7::jsonb, endereco_entrega = $8::jsonb, observacao = $9, total_centavos = $10, a_vista = $11 WHERE id = $1`,
      [id, d.filial_id, d.cliente_id, d.vendedor_id, d.condicao_pagamento_id, d.tabela_preco_id, json(d.cliente_retrato), json(d.endereco_entrega), d.observacao, d.total_centavos, d.a_vista],
    );
  }

  async substituirItens(pedidoId: string, itens: readonly NovoItem[]): Promise<void> {
    const atuais = await executar<{ id: string; produto_id: string }>(this.tx, 'SELECT id, produto_id FROM pedido.pedido_item WHERE pedido_id = $1 AND deleted_at IS NULL ORDER BY sequencia', [pedidoId]);
    const livres = [...atuais];
    const novos: NovoItem[] = [];
    for (const i of itens) {
      const pos = livres.findIndex((a) => a.produto_id === i.produto_id);
      if (pos < 0) {
        novos.push(i);
        continue;
      }
      const [achado] = livres.splice(pos, 1);
      await executar(
        this.tx,
        `UPDATE pedido.pedido_item SET quantidade = $2, preco_unitario_centavos = $3, preco_tabela_centavos = $4, desconto_maximo_bp = $5,
           desconto_centavos = $6, total_centavos = $7 WHERE id = $1`,
        [(achado as { id: string }).id, i.quantidade, i.preco_unitario_centavos, i.preco_tabela_centavos, i.desconto_maximo_bp, i.desconto_centavos, i.total_centavos],
      );
    }
    for (const r of livres) await executar(this.tx, 'UPDATE pedido.pedido_item SET deleted_at = now() WHERE id = $1', [r.id]);
    if (novos.length > 0) {
      // A sequência não se reaproveita, nem a do item retirado (T-0014).
      const [m] = await executar<{ maxima: number }>(this.tx, 'SELECT coalesce(max(sequencia), 0)::int AS maxima FROM pedido.pedido_item WHERE pedido_id = $1', [pedidoId]);
      const base = (m as { maxima: number }).maxima;
      await this.inserirItens(pedidoId, novos.map((i, n) => ({ ...i, sequencia: base + n + 1 })));
    }
  }

  async atualizarPrecosDeTabela(pedidoId: string, linhas: readonly { sequencia: number; preco_tabela_centavos: number | null; desconto_maximo_bp: number | null }[]): Promise<void> {
    for (const l of linhas) {
      await executar(this.tx, 'UPDATE pedido.pedido_item SET preco_tabela_centavos = $3, desconto_maximo_bp = $4 WHERE pedido_id = $1 AND sequencia = $2 AND deleted_at IS NULL', [pedidoId, l.sequencia, l.preco_tabela_centavos, l.desconto_maximo_bp]);
    }
  }

  async registrarEvento(e: NovoEvento): Promise<void> {
    await executar(
      this.tx,
      `INSERT INTO pedido.pedido_evento (tenant_id, pedido_id, de, para, ator_tipo, ator_id, motivo_codigo, motivo_texto, pendencias, evento_id, ocorrido_em)
       VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [e.pedido_id, e.de, e.para, e.ator_tipo, e.ator_id, e.motivo_codigo, e.motivo_texto, json(e.pendencias), e.evento_id, e.ocorrido_em],
    );
  }

  async registrarAprovacao(a: NovaAprovacao): Promise<void> {
    await executar(
      this.tx,
      `INSERT INTO pedido.aprovacao (tenant_id, pedido_id, decisao, automatica, decidido_por, perfil, pendencias_aceitas, justificativa, motivo_codigo, motivo_texto, decidido_em)
       VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [a.pedido_id, a.decisao, a.automatica, a.decidido_por, a.perfil, json(a.pendencias_aceitas), a.justificativa, a.motivo_codigo, a.motivo_texto, a.decidido_em],
    );
  }

  async historico(pedidoId: string): Promise<HistoricoPedido[]> {
    return (await executar(
      this.tx,
      `SELECT de, para, ator_tipo, ator_id, motivo_codigo, motivo_texto, ${ISO('ocorrido_em')} AS ocorrido_em
       FROM pedido.pedido_evento WHERE pedido_id = $1 ORDER BY ocorrido_em, created_at, de NULLS FIRST, id`,
      [pedidoId],
    )) as unknown as HistoricoPedido[];
  }

  async decisao(pedidoId: string): Promise<DecisaoPedido | null> {
    const [l] = await executar(
      this.tx,
      `SELECT decisao, automatica, decidido_por, perfil, pendencias_aceitas, justificativa, motivo_codigo, motivo_texto, ${ISO('decidido_em')} AS decidido_em
       FROM pedido.aprovacao WHERE pedido_id = $1 LIMIT 1`,
      [pedidoId],
    );
    return (l as unknown as DecisaoPedido | undefined) ?? null;
  }

  /** WHERE dos filtros da lista, sem cursor (a página soma o dela). */
  private filtros(f: Omit<FiltroPedidos, 'limite' | 'cursor'>, p: unknown[]): string[] {
    const w = ['p.deleted_at IS NULL'];
    const par = (v: unknown) => `$${p.push(v)}`;
    if (f.status) w.push(`p.status = ${par(f.status)}`);
    if (f.cliente_id) w.push(`p.cliente_id = ${par(f.cliente_id)}`);
    if (f.vendedor_id) w.push(`p.vendedor_id = ${par(f.vendedor_id)}`);
    if (f.filial_id) w.push(`p.filial_id = ${par(f.filial_id)}`);
    if (f.origem) w.push(`p.origem = ${par(f.origem)}`);
    if (f.de) w.push(`p.emitido_em >= (${par(f.de)}::date)::timestamp AT TIME ZONE '${FUSO_TENANT}'`);
    if (f.ate) w.push(`p.emitido_em < ((${par(f.ate)}::date + 1)::timestamp AT TIME ZONE '${FUSO_TENANT}')`);
    if (f.busca) {
      if (/^\d{1,15}$/.test(f.busca)) w.push(`p.numero = ${par(Number(f.busca))}`);
      else w.push(`position(lower(${par(f.busca)}) in lower(p.cliente_retrato->>'razao_social')) > 0`);
    }
    return w;
  }

  private selecaoLista(comDocumento: boolean): string {
    return `p.id, ${N('p.numero')} AS numero, p.origem, p.status, p.filial_id, p.cliente_id, p.cliente_retrato->>'razao_social' AS cliente_razao_social,
      p.vendedor_id, ${ISO('p.emitido_em')} AS emitido_em, ${N('p.total_centavos')} AS total_centavos, jsonb_array_length(p.pendencias) AS pendencias,
      ${comDocumento ? "p.cliente_retrato->>'documento'" : 'NULL::text'} AS cliente_documento`;
  }

  async listar(f: FiltroPedidos): Promise<Pagina<LinhaLista>> {
    const p: unknown[] = [];
    const w = this.filtros(f, p);
    let de = 'pedido.pedido p';
    if (f.cursor) {
      // Ordem da lista: emitido_em DESC, id; o cursor é o id do último item (contrato de listas).
      de += `, (SELECT emitido_em, id FROM pedido.pedido WHERE id = $${p.push(f.cursor)}) c`;
      w.push('(p.emitido_em < c.emitido_em OR (p.emitido_em = c.emitido_em AND p.id > c.id))');
    }
    const linhas = await executar(this.tx, `SELECT ${this.selecaoLista(f.comDocumento === true)} FROM ${de} WHERE ${w.join(' AND ')} ORDER BY p.emitido_em DESC, p.id LIMIT $${p.push(f.limite + 1)}`, p);
    return paginar(linhas as unknown as LinhaLista[], f.limite);
  }

  async listarTodos(f: Omit<FiltroPedidos, 'limite' | 'cursor'>, maximo: number): Promise<LinhaLista[]> {
    const p: unknown[] = [];
    const w = this.filtros(f, p);
    return (await executar(this.tx, `SELECT ${this.selecaoLista(f.comDocumento === true)} FROM pedido.pedido p WHERE ${w.join(' AND ')} ORDER BY p.emitido_em DESC, p.id LIMIT $${p.push(maximo)}`, p)) as unknown as LinhaLista[];
  }

  /** P5: total não faturado dos pedidos aprovados e parcialmente faturados do cliente, só dos pedidos com `NOT a_vista` (valor gravado). */
  async compromissoCredito(clienteId: string, exceto: string | null): Promise<number> {
    const linhas = (await executar(
      this.tx,
      `SELECT coalesce(sum(total_centavos - valor_faturado_centavos), 0)::float8 AS centavos
       FROM pedido.pedido
       WHERE cliente_id = $1 AND NOT a_vista AND status IN (${COMPROMETEM}) AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [clienteId, exceto],
    )) as unknown as { centavos: number }[];
    return Number(linhas[0]?.centavos ?? 0);
  }

  /** P5: saldo ainda não faturado dos itens dos pedidos aprovados da filial, por produto. */
  async compromissoEstoque(filialId: string, produtoIds: readonly string[], exceto: string | null): Promise<{ produto_id: string; quantidade: number }[]> {
    if (produtoIds.length === 0) return [];
    return (await executar(
      this.tx,
      `SELECT i.produto_id, sum(i.quantidade - i.quantidade_faturada)::float8 AS quantidade
       FROM pedido.pedido_item i JOIN pedido.pedido p ON p.tenant_id = i.tenant_id AND p.id = i.pedido_id
       WHERE p.filial_id = $1 AND i.produto_id = ANY($2::uuid[]) AND p.status IN (${COMPROMETEM})
         AND p.deleted_at IS NULL AND i.deleted_at IS NULL AND ($3::uuid IS NULL OR p.id <> $3::uuid)
       GROUP BY i.produto_id`,
      [filialId, [...produtoIds], exceto],
    )) as unknown as { produto_id: string; quantidade: number }[];
  }
}

export const repositorioSql = (tx: Transacao): RepoPedidos => new RepoPedidosSql(tx);
