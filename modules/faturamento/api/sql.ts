/**
 * Adaptador PostgreSQL do schema `faturamento` (migração 0013): `RepositorioNotas`, `PedidosAprovados`, `AmbienteFiscalDaFilial` e
 * `NotaEmAberto`. Roda na transação do tenant (`comTenant`: RLS por `app.tenant_id`); o INSERT usa `plataforma.tenant_atual()`.
 * bigint volta como `float8` (centavos e escala 4 cabem em 2^53). Escrita idempotente: pedido a faturar por `ON CONFLICT`, nota por
 * `(tenant_id, idempotencia_chave)` com trava de advisory lock, itens por upsert em `(nota_id, n_item)`.
 *
 * Onde a 0013 não tem coluna, o conteúdo vai em jsonb: `transporte` = `{ mod_frete, inf_cpl, itens_solicitados }` e `pagamento` =
 * `{ pagamentos, cobranca }` (ver "Pendências" do README); `transporte.revisao` conta as gravações do conteúdo (1 na emissão, +1 no reenvio)
 * e é a `versao` do XML assinado que o cobre. O XML assinado vai em `nota_xml` (tipo `nfe_assinada`, só INSERT, `UNIQUE (nota_id, versao)`).
 */
import { criarEvento, erros, paginar, type Outbox, type Pagina, type Transacao } from '@macuxierp/platform-sdk';
import { PedidoAprovadoV1 } from '@macuxierp/pedido/contracts';
import type { FiltroNotas, FiltroRejeicoes, NotaDetalhe, NotaResumo, RejeicaoNota, StatusNota } from '../contracts';
import { calcularTotais, interpretarRetorno, nfeVaiAoFdv, type ConteudoNota, type NotaItemMontado, type NotaNaFaixa } from '../domain';
import type {
  AmbienteFiscalDaFilial, EventoRegistro, InutilizacaoRegistro, NotaEmAberto, NotaNumeradaNaoEnviada, NotaRegistro, PedidosAprovados, RepositorioEventos, RepositorioNotas, RepositorioTitulos, ConfiguracaoFaturamento,
} from './portas';
import { configuracaoFaturamentoSql } from './sql-configuracao';
import { repositorioTitulosSql } from './sql-titulos';

type Dict = Record<string, unknown>;

/** PENDÊNCIA (README): fuso fixo porque a v1 só tem tenant no AM; passa a vir do tenant (RN-CORE). */
const FUSO_TENANT = 'America/Manaus';
const ISO = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const json = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

/**
 * Erro do banco com código de regra (`RN-FAT-04: ...`) vira 422 com a mesma RN; o resto sobe como está. As mensagens dos
 * gatilhos da 0013 só trazem números de série e de nota e nomes de status, nunca dado pessoal.
 */
export function traduzirErroBanco(e: unknown): never {
  const m = e instanceof Error ? /^(RN-[A-Z]+-\d{2})[^:]*: (.*)$/s.exec(e.message) : null;
  if (m?.[1] && m[2]) throw erros.regra(m[1], m[2].split('\n')[0] ?? m[2]);
  throw e;
}

const COLUNAS_NOTA = `n.id, n.tenant_id, n.pedido_id, p.payload->>'pedido_uuid' AS pedido_uuid, n.filial_id, n.cliente_id,
  p.payload->>'vendedor_id' AS vendedor_id, n.ambiente, n.serie::int AS serie, n.numero, n.c_nf AS cnf, n.chave_acesso,
  n.tipo_emissao::int AS tp_emis, n.status, ${ISO('n.emitida_em')} AS emitida_em, n.total_nota_centavos::float8 AS total_centavos,
  n.protocolo, ${ISO('n.autorizada_em')} AS autorizada_em, n.recibo, n.idempotencia_chave AS idempotencia, n.transporte->'itens_solicitados' AS itens_solicitados,
  COALESCE((n.transporte->>'revisao')::int, 1) AS revisao`;
const DE_NOTA = `faturamento.nota n LEFT JOIN faturamento.pedido_a_faturar p ON p.tenant_id = n.tenant_id AND p.pedido_id = n.pedido_id AND p.deleted_at IS NULL`;

const COLUNAS_RESUMO = `n.id, n.filial_id, n.cliente_id, n.pedido_id, n.ambiente, n.serie::int AS serie, n.numero, n.chave_acesso, n.status,
  ${ISO('n.emitida_em')} AS emitida_em, n.total_nota_centavos::float8 AS total_centavos, n.protocolo, n.c_stat::int AS c_stat, n.x_motivo`;

async function itensDaNota(tx: Transacao, notaId: string): Promise<NotaRegistro['itens']> {
  return tx.consultar<NotaRegistro['itens'][number]>(
    `SELECT n_item::int AS sequencia, produto_id, quantidade::float8 AS quantidade, (valor_produto_centavos - desconto_centavos)::float8 AS valor_centavos
       FROM faturamento.nota_item WHERE nota_id = $1 AND deleted_at IS NULL ORDER BY n_item`,
    [notaId],
  );
}

async function montarRegistro(tx: Transacao, l: Dict): Promise<NotaRegistro> {
  const r = l as unknown as Omit<NotaRegistro, 'vai_ao_fdv' | 'itens'>;
  return { ...r, vai_ao_fdv: nfeVaiAoFdv(r.ambiente), itens: await itensDaNota(tx, r.id) };
}

/** Linhas de `nota_item` a partir do conteúdo (a mesma carga serve ao INSERT e ao reenvio, por `ON CONFLICT`). */
const itensJson = (itens: readonly NotaItemMontado[]): string =>
  JSON.stringify(
    itens.map((i) => ({
      n_item: i.sequencia,
      produto_id: i.produto_id,
      produto_retrato: { codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, unidade: i.unidade, gtin: i.gtin, origem: i.origem },
      cfop: i.calculo.cfop,
      quantidade: i.quantidade,
      valor_unitario_centavos: i.preco_unitario_centavos,
      valor_produto_centavos: i.valor_produto_centavos,
      desconto_centavos: i.desconto_centavos,
      frete_centavos: i.frete_centavos,
      outras_centavos: i.outras_centavos,
      valor_total_centavos: i.valor_produto_centavos - i.desconto_centavos + i.frete_centavos + i.outras_centavos,
      tributos: i.calculo.resultado,
    })),
  );

const COLUNAS_TOTAIS = `produtos_centavos = $2, desconto_centavos = $3, frete_centavos = $4, outras_centavos = $5, bc_icms_centavos = $6,
  icms_centavos = $7, bc_icms_st_centavos = $8, icms_st_centavos = $9, ipi_centavos = $10, pis_centavos = $11, cofins_centavos = $12,
  ibs_centavos = $13, cbs_centavos = $14, is_imposto_centavos = $15, total_nota_centavos = $16`;

function paramsTotais(itens: readonly NotaItemMontado[]): number[] {
  const t = calcularTotais(itens);
  return [t.vProd, t.vDesc, t.vFrete, t.vOutro, t.vBC, t.vICMS, t.vBCST, t.vST, t.vIPI, t.vPIS, t.vCOFINS, t.vIBS, t.vCBS, t.vIS, t.vNF];
}

const transporteDe = (c: ConteudoNota, revisao = 1): Dict => ({ mod_frete: c.modFrete, inf_cpl: c.infCpl, itens_solicitados: c.itensSolicitados, revisao });
const pagamentoDe = (c: ConteudoNota): Dict => ({ pagamentos: c.pagamentos, cobranca: c.cobranca, prazos_dias: c.prazos_dias ?? null, conta_como_real: c.conta_como_real === true });

async function gravarItens(tx: Transacao, notaId: string, itens: readonly NotaItemMontado[]): Promise<void> {
  await tx.consultar(
    `INSERT INTO faturamento.nota_item (tenant_id, nota_id, n_item, pedido_item_sequencia, produto_id, produto_retrato, cfop, quantidade,
        valor_unitario_centavos, valor_produto_centavos, desconto_centavos, frete_centavos, outras_centavos, valor_total_centavos, tributos)
     SELECT plataforma.tenant_atual(), $1, x.n_item, x.n_item, x.produto_id, x.produto_retrato, x.cfop, x.quantidade, x.valor_unitario_centavos,
        x.valor_produto_centavos, x.desconto_centavos, x.frete_centavos, x.outras_centavos, x.valor_total_centavos, x.tributos
       FROM jsonb_to_recordset($2::jsonb) AS x(n_item int, produto_id uuid, produto_retrato jsonb, cfop text, quantidade bigint,
        valor_unitario_centavos bigint, valor_produto_centavos bigint, desconto_centavos bigint, frete_centavos bigint, outras_centavos bigint,
        valor_total_centavos bigint, tributos jsonb)
     ON CONFLICT (nota_id, n_item) DO UPDATE SET produto_id = EXCLUDED.produto_id, produto_retrato = EXCLUDED.produto_retrato,
        cfop = EXCLUDED.cfop, quantidade = EXCLUDED.quantidade, valor_unitario_centavos = EXCLUDED.valor_unitario_centavos,
        valor_produto_centavos = EXCLUDED.valor_produto_centavos, desconto_centavos = EXCLUDED.desconto_centavos,
        frete_centavos = EXCLUDED.frete_centavos, outras_centavos = EXCLUDED.outras_centavos,
        valor_total_centavos = EXCLUDED.valor_total_centavos, tributos = EXCLUDED.tributos`,
    [notaId, itensJson(itens)],
  );
}

export interface DependenciasSql {
  outbox: Outbox;
  agora?: () => Date;
}

export function repositorioNotasSql(deps: DependenciasSql): RepositorioNotas {
  const agora = deps.agora ?? ((): Date => new Date());
  return {
    async travarIdempotencia(tx, tenant_id, idempotencia) {
      await tx.consultar('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`faturamento.nota:${tenant_id}:${idempotencia}`]);
    },

    async buscarPorIdempotencia(tx, _tenant_id, idempotencia) {
      const [l] = await tx.consultar(`SELECT ${COLUNAS_NOTA} FROM ${DE_NOTA} WHERE n.idempotencia_chave = $1 AND n.deleted_at IS NULL`, [idempotencia]);
      return l ? montarRegistro(tx, l) : null;
    },

    async obter(tx, nota_id, opcoes) {
      const [l] = await tx.consultar(`SELECT ${COLUNAS_NOTA} FROM ${DE_NOTA} WHERE n.id = $1 AND n.deleted_at IS NULL ${opcoes?.travar ? 'FOR UPDATE OF n' : ''}`, [nota_id]);
      return l ? montarRegistro(tx, l) : null;
    },

    async lerConteudo(tx, nota_id) {
      const [n] = await tx.consultar<{ natureza_operacao: string; emitente_retrato: ConteudoNota['emitente']; destinatario_retrato: ConteudoNota['destinatario']; transporte: Dict; pagamento: Dict }>(
        'SELECT natureza_operacao, emitente_retrato, destinatario_retrato, transporte, pagamento FROM faturamento.nota WHERE id = $1 AND deleted_at IS NULL',
        [nota_id],
      );
      if (!n?.emitente_retrato || !n.destinatario_retrato) return null;
      const linhas = await tx.consultar<{
        n_item: number; produto_id: string; produto_retrato: Dict; cfop: string; quantidade: number; valor_unitario_centavos: number;
        valor_produto_centavos: number; desconto_centavos: number; frete_centavos: number; outras_centavos: number; tributos: NotaItemMontado['calculo']['resultado'];
      }>(
        `SELECT n_item::int AS n_item, produto_id, produto_retrato, cfop, quantidade::float8 AS quantidade, valor_unitario_centavos::float8 AS valor_unitario_centavos,
                valor_produto_centavos::float8 AS valor_produto_centavos, desconto_centavos::float8 AS desconto_centavos, frete_centavos::float8 AS frete_centavos,
                outras_centavos::float8 AS outras_centavos, tributos
           FROM faturamento.nota_item WHERE nota_id = $1 AND deleted_at IS NULL ORDER BY n_item`,
        [nota_id],
      );
      const itens: NotaItemMontado[] = linhas.map((i) => ({
        sequencia: i.n_item,
        produto_id: i.produto_id,
        codigo: String(i.produto_retrato.codigo),
        descricao: String(i.produto_retrato.descricao),
        ncm: String(i.produto_retrato.ncm),
        unidade: String(i.produto_retrato.unidade),
        gtin: (i.produto_retrato.gtin as string | null) ?? null,
        origem: String(i.produto_retrato.origem),
        quantidade: i.quantidade,
        preco_unitario_centavos: i.valor_unitario_centavos,
        valor_produto_centavos: i.valor_produto_centavos,
        desconto_centavos: i.desconto_centavos,
        frete_centavos: i.frete_centavos,
        outras_centavos: i.outras_centavos,
        calculo: { sequencia: i.n_item, cfop: i.cfop, resultado: i.tributos },
      }));
      return {
        natOp: n.natureza_operacao,
        emitente: n.emitente_retrato,
        destinatario: n.destinatario_retrato,
        modFrete: (n.transporte.mod_frete as ConteudoNota['modFrete']) ?? 9,
        infCpl: (n.transporte.inf_cpl as string | null) ?? null,
        itensSolicitados: (n.transporte.itens_solicitados as ConteudoNota['itensSolicitados']) ?? null,
        pagamentos: (n.pagamento.pagamentos as ConteudoNota['pagamentos']) ?? [],
        cobranca: (n.pagamento.cobranca as ConteudoNota['cobranca']) ?? null,
        prazos_dias: (n.pagamento.prazos_dias as number[] | null | undefined) ?? null,
        conta_como_real: n.pagamento.conta_como_real === true,
        itens,
      };
    },

    async reservarNumero(tx, _tenant_id, filial_id, ambiente, serie, numeroInicial) {
      const [l] = await tx.consultar<{ numero: number }>('SELECT faturamento.reservar_numero($1::uuid, $2::text, $3::smallint, $4::integer) AS numero', [filial_id, ambiente, serie, numeroInicial]);
      if (!l) throw new Error('RN-FAT-01: a reserva do número não devolveu linha');
      return l.numero;
    },

    async gravarNota(tx, nota, conteudo) {
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO faturamento.nota (tenant_id, filial_id, pedido_id, cliente_id, ambiente, serie, numero, chave_acesso, c_nf, tipo_emissao, emitida_em,
            natureza_operacao, emitente_retrato, destinatario_retrato, transporte, pagamento, idempotencia_chave)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16)
         RETURNING id`,
        [nota.filial_id, nota.pedido_id, nota.cliente_id, nota.ambiente, nota.serie, nota.numero, nota.chave_acesso, nota.cnf, nota.tp_emis, nota.emitida_em,
          conteudo.natOp, json(conteudo.emitente), json(conteudo.destinatario), json(transporteDe(conteudo)), json(pagamentoDe(conteudo)), nota.idempotencia],
      );
      if (!criada) throw new Error('RN-FAT-01: a nota não foi gravada');
      await tx.consultar(`UPDATE faturamento.nota SET ${COLUNAS_TOTAIS} WHERE id = $1`, [criada.id, ...paramsTotais(conteudo.itens)]);
      await gravarItens(tx, criada.id, conteudo.itens);
      const [l] = await tx.consultar(`SELECT ${COLUNAS_NOTA} FROM ${DE_NOTA} WHERE n.id = $1`, [criada.id]);
      return montarRegistro(tx, l as Dict);
    },

    async atualizarConteudo(tx, nota_id, conteudo) {
      const r = await tx.consultar(
        `UPDATE faturamento.nota SET ${COLUNAS_TOTAIS}, natureza_operacao = $17, emitente_retrato = $18::jsonb, destinatario_retrato = $19::jsonb,
                transporte = $20::jsonb || jsonb_build_object('revisao', COALESCE((transporte->>'revisao')::int, 1) + 1), pagamento = $21::jsonb, recibo = NULL
          WHERE id = $1 AND status IN ('rejeitada', 'rascunho') AND deleted_at IS NULL RETURNING id`,
        [nota_id, ...paramsTotais(conteudo.itens), conteudo.natOp, json(conteudo.emitente), json(conteudo.destinatario), json(transporteDe(conteudo)), json(pagamentoDe(conteudo))],
      );
      if (r.length === 0) throw new Error('RN-FAT-07: só a nota rejeitada ou em rascunho aceita novo conteúdo');
      await gravarItens(tx, nota_id, conteudo.itens);
    },

    async registrarMotivoEnvio(tx, nota_id, motivo) {
      await tx.consultar(
        `UPDATE faturamento.nota
            SET transporte = COALESCE(transporte, '{}'::jsonb) || jsonb_build_object('envio_pendente', jsonb_build_object('motivo', left($2::text, 255), 'registrado_em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
          WHERE id = $1 AND status IN ('rascunho', 'rejeitada') AND deleted_at IS NULL`,
        [nota_id, motivo],
      );
    },

    async mudarStatus(tx, nota_id, de, para, dados) {
      const r = await tx.consultar(
        `UPDATE faturamento.nota SET status = $3, c_stat = COALESCE($4::smallint, c_stat), x_motivo = COALESCE(left($5::text, 255), x_motivo),
                recibo = COALESCE($6::text, recibo), protocolo = COALESCE($7::text, protocolo), autorizada_em = COALESCE($8::timestamptz, autorizada_em)
          WHERE id = $1 AND status = $2 AND deleted_at IS NULL AND ($9::int IS NULL OR COALESCE((transporte->>'revisao')::int, 1) = $9::int) RETURNING id`,
        [nota_id, de, para, dados?.cStat ?? null, dados?.xMotivo ?? null, dados?.recibo ?? null, dados?.protocolo ?? null, dados?.autorizadaEm ?? null, dados?.revisao ?? null],
      );
      if (r.length === 0) throw new Error(`RN-FAT-02: a nota não está em ${de}${dados?.revisao === undefined ? '' : ` na revisão ${dados.revisao}`}`);
    },

    async registrarRecibo(tx, nota_id, recibo) {
      await tx.consultar(`UPDATE faturamento.nota SET recibo = $2 WHERE id = $1 AND status = 'em_autorizacao'`, [nota_id, recibo]);
    },

    async guardarXmlAutorizado(tx, nota_id, xml) {
      // Savepoint: a falha da guarda não aborta a transação, e a nota fica em `autorizada_guarda_pendente` já gravada (RN-FAT-03).
      await tx.consultar('SAVEPOINT guarda_xml_autorizado');
      try {
        await tx.consultar(
          `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, protocolo, xml, sha256)
           SELECT plataforma.tenant_atual(), 'nfe_autorizada', n.id, n.chave_acesso, $2::text, $3::text, encode(sha256(convert_to($3::text, 'UTF8')), 'hex')
             FROM faturamento.nota n WHERE n.id = $1`,
          [nota_id, xml.protocolo, xml.conteudo],
        );
        await tx.consultar('RELEASE SAVEPOINT guarda_xml_autorizado');
      } catch (e) {
        await tx.consultar('ROLLBACK TO SAVEPOINT guarda_xml_autorizado');
        await tx.consultar('RELEASE SAVEPOINT guarda_xml_autorizado');
        throw e;
      }
    },

    async travarTransmissao(tx, nota_id) {
      const [l] = await tx.consultar<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok', [`faturamento.transmissao:${nota_id}`]);
      return l?.ok === true;
    },

    async gravarXmlAssinado(tx, nota_id, xml, sha256) {
      const [l] = await tx.consultar<{ versao: number }>(
        `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, chave_acesso, versao, protocolo, xml, sha256)
         SELECT plataforma.tenant_atual(), 'nfe_assinada', n.id, n.chave_acesso,
                (SELECT COALESCE(MAX(x.versao), 0) + 1 FROM faturamento.nota_xml x WHERE x.nota_id = n.id AND x.tipo = 'nfe_assinada'),
                NULL, $2::text, $3::text
           FROM faturamento.nota n WHERE n.id = $1
         RETURNING versao::int AS versao`,
        [nota_id, xml, sha256],
      );
      return l?.versao ?? 1;
    },

    async ultimoXmlAssinado(tx, nota_id) {
      const [l] = await tx.consultar<{ versao: number; xml: string }>(
        `SELECT versao::int AS versao, xml FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_assinada' AND deleted_at IS NULL ORDER BY versao DESC LIMIT 1`,
        [nota_id],
      );
      return l ?? null;
    },

    async registrarTransmissao(tx, t) {
      await tx.consultar(
        `INSERT INTO faturamento.transmissao (tenant_id, nota_id, servico, destino, tentativa, c_stat, x_motivo, enviada_em, respondida_em, duracao_ms)
         VALUES (plataforma.tenant_atual(), $1, $2, $3,
                 LEAST(COALESCE((SELECT max(tentativa) FROM faturamento.transmissao WHERE nota_id = $1 AND servico = $2), 0) + 1, 999),
                 $4::smallint, $5, $6::timestamptz, $7::timestamptz, $8)`,
        [t.nota_id, t.servico, t.destino, t.cStat, t.xMotivo, t.enviada_em, t.respondida_em, t.duracao_ms],
      );
    },

    async publicarEvento(tx, evento) {
      const [t] = await tx.consultar<{ tenant_id: string }>('SELECT plataforma.tenant_atual() AS tenant_id');
      if (!t) throw new Error('sem tenant na sessão');
      const envelope = criarEvento(
        { nome: evento.nome, tenant_id: t.tenant_id, agregado_id: evento.agregado_id, ator: 'sistema', request_id: `faturamento-${evento.agregado_id}`, payload: evento.payload },
        agora(),
      );
      await deps.outbox.gravar(tx, envelope);
    },

    async listar(tx, f: FiltroNotas): Promise<Pagina<NotaResumo>> {
      const linhas = await tx.consultar<NotaResumo>(
        `SELECT ${COLUNAS_RESUMO} FROM faturamento.nota n
          WHERE n.deleted_at IS NULL
            AND ($1::uuid IS NULL OR n.filial_id = $1) AND ($2::uuid IS NULL OR n.cliente_id = $2) AND ($3::uuid IS NULL OR n.pedido_id = $3)
            AND ($4::text IS NULL OR n.status = $4) AND ($5::text IS NULL OR n.ambiente = $5) AND ($6::int IS NULL OR n.serie = $6)
            AND ($7::int IS NULL OR n.numero = $7)
            AND ($8::date IS NULL OR n.emitida_em >= ($8::date)::timestamp AT TIME ZONE '${FUSO_TENANT}')
            AND ($9::date IS NULL OR n.emitida_em < (($9::date + 1))::timestamp AT TIME ZONE '${FUSO_TENANT}')
            AND ($10::uuid IS NULL OR n.id > $10)
          ORDER BY n.id LIMIT $11`,
        [f.filial_id ?? null, f.cliente_id ?? null, f.pedido_id ?? null, f.status ?? null, f.ambiente ?? null, f.serie ?? null, f.numero ?? null, f.de ?? null, f.ate ?? null, f.cursor ?? null, f.limite + 1],
      );
      return paginar(linhas, f.limite);
    },

    async detalhar(tx, nota_id): Promise<NotaDetalhe | null> {
      const [l] = await tx.consultar<Omit<NotaDetalhe, 'itens'>>(
        `SELECT ${COLUNAS_RESUMO}, n.natureza_operacao, n.tipo_emissao::int AS tipo_emissao, n.recibo FROM faturamento.nota n WHERE n.id = $1 AND n.deleted_at IS NULL`,
        [nota_id],
      );
      return l ? { ...l, itens: await itensDaNota(tx, nota_id) } : null;
    },

    async lerXmlAutorizado(tx, nota_id) {
      const [l] = await tx.consultar<{ xml: string; protocolo: string; chave_acesso: string }>(
        `SELECT xml, protocolo, chave_acesso FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'nfe_autorizada' AND deleted_at IS NULL`,
        [nota_id],
      );
      return l ?? null;
    },

    async listarRejeicoes(tx, f: FiltroRejeicoes): Promise<Pagina<RejeicaoNota>> {
      const linhas = await tx.consultar<Omit<RejeicaoNota, 'acao_sugerida'>>(
        `SELECT n.id, n.filial_id, n.pedido_id, n.serie::int AS serie, n.numero, n.c_stat::text AS codigo, n.x_motivo AS mensagem, ${ISO('n.updated_at')} AS rejeitada_em
           FROM faturamento.nota n
          WHERE n.deleted_at IS NULL AND n.status = 'rejeitada' AND ($1::uuid IS NULL OR n.filial_id = $1) AND ($2::uuid IS NULL OR n.id > $2)
          ORDER BY n.id LIMIT $3`,
        [f.filial_id ?? null, f.cursor ?? null, f.limite + 1],
      );
      const pagina = paginar(linhas, f.limite);
      return { ...pagina, itens: pagina.itens.map((l) => ({ ...l, acao_sugerida: interpretarRetorno(l.codigo ?? '', l.mensagem ?? '').acao })) };
    },

    async pendentesDeTransmissao(tx, limite, paradasHaMinutos, esperaEnvioPendenteMin) {
      return tx.consultar<{ id: string; status: StatusNota }>(
        `SELECT n.id, n.status FROM faturamento.nota n
          WHERE n.deleted_at IS NULL
            AND ((n.status IN ('em_autorizacao', 'autorizada_guarda_pendente') AND n.updated_at < now() - make_interval(mins => $2::int))
              OR (n.status = 'rascunho'
                  AND NOT EXISTS (SELECT 1 FROM faturamento.nota_xml x WHERE x.nota_id = n.id AND x.tipo = 'nfe_assinada' AND x.deleted_at IS NULL)
                  AND n.updated_at < now() - make_interval(mins => CASE WHEN n.transporte->'envio_pendente' IS NOT NULL THEN $3::int ELSE $2::int END)))
          ORDER BY n.updated_at, n.id LIMIT $1`,
        [limite, paradasHaMinutos, esperaEnvioPendenteMin],
      );
    },

    async numeradasNaoEnviadas(tx, antesDe) {
      return tx.consultar<NotaNumeradaNaoEnviada>(
        `SELECT n.id, n.filial_id, n.ambiente, n.serie::int AS serie, n.numero, n.status, ${ISO('n.emitida_em')} AS emitida_em
           FROM faturamento.nota n
          WHERE n.deleted_at IS NULL AND n.status IN ('rascunho', 'rejeitada') AND n.emitida_em < $1::timestamptz
          ORDER BY n.emitida_em, n.id`,
        [antesDe.toISOString()],
      );
    },
  };
}

const COLUNAS_EVENTO = `e.id, e.nota_id, e.tipo, e.n_seq_evento::int AS n_seq_evento, e.texto, e.status, e.protocolo, e.c_stat::int AS c_stat, e.x_motivo,
  ${ISO('e.registrado_em')} AS registrado_em, ${ISO('e.created_at')} AS criado_em, ${ISO('e.updated_at')} AS dh_evento`;
const COLUNAS_INUT = `i.id, i.filial_id, i.ambiente, i.serie::int AS serie, i.ano::int AS ano, i.numero_inicial, i.numero_final, i.justificativa, i.status,
  i.protocolo, i.c_stat::int AS c_stat, i.x_motivo, ${ISO('i.registrado_em')} AS registrado_em, ${ISO('i.created_at')} AS criado_em`;

/**
 * Repositório dos eventos e da inutilização (0013 e 0020). O `dh_evento` do pedido é o `updated_at` da linha `pendente` (o gatilho `tocar_updated_at` o
 * renova em cada UPDATE, inclusive no `rejeitado → pendente`): a retentativa do mesmo pedido o encontra IGUAL, e a 0013 não tem coluna própria
 * (PENDÊNCIA: `dh_evento`, `id_lote` e `fuso_minutos` em `nota_evento`, por recado ao banco-dados). O `idLote` sai do `dh_evento`; o fuso é o do tenant (Manaus).
 * Antes do INSERT em `nota_xml`, o `registrado_em` recebe a data do `dhRegEvento` da SEFAZ (o gatilho só preenche com a da guarda se estiver vazio).
 */
export function repositorioEventosSql(): RepositorioEventos {
  return {
    async listarEventos(tx, nota_id) {
      return tx.consultar<EventoRegistro>(`SELECT ${COLUNAS_EVENTO} FROM faturamento.nota_evento e WHERE e.nota_id = $1 ORDER BY e.tipo, e.n_seq_evento`, [nota_id]);
    },
    async obterEvento(tx, evento_id, opcoes) {
      const [l] = await tx.consultar<EventoRegistro>(`SELECT ${COLUNAS_EVENTO} FROM faturamento.nota_evento e WHERE e.id = $1 ${opcoes?.travar ? 'FOR UPDATE' : ''}`, [evento_id]);
      return l ?? null;
    },
    async criarEvento(tx, e) {
      const [c] = await tx.consultar<{ id: string }>(
        `INSERT INTO faturamento.nota_evento (tenant_id, nota_id, tipo, n_seq_evento, texto) VALUES (plataforma.tenant_atual(), $1, $2, $3, $4) RETURNING id`,
        [e.nota_id, e.tipo, e.n_seq_evento, e.texto],
      );
      const [l] = await tx.consultar<EventoRegistro>(`SELECT ${COLUNAS_EVENTO} FROM faturamento.nota_evento e WHERE e.id = $1`, [c?.id]);
      if (!l) throw new Error('RN-FAT-02: o evento não foi gravado');
      return l;
    },
    async reabrirEvento(tx, evento_id, texto) {
      const r = await tx.consultar(
        `UPDATE faturamento.nota_evento SET status = 'pendente', texto = $2, c_stat = NULL, x_motivo = NULL WHERE id = $1 AND status = 'rejeitado' RETURNING id`,
        [evento_id, texto],
      );
      if (r.length === 0) throw new Error('RN-FAT-02: só o evento rejeitado volta a pendente');
      const [l] = await tx.consultar<EventoRegistro>(`SELECT ${COLUNAS_EVENTO} FROM faturamento.nota_evento e WHERE e.id = $1`, [evento_id]);
      return l as EventoRegistro;
    },
    async rejeitarEvento(tx, evento_id, r) {
      const u = await tx.consultar(
        `UPDATE faturamento.nota_evento SET status = 'rejeitado', c_stat = $2::smallint, x_motivo = left($3::text, 255) WHERE id = $1 AND status = 'pendente' RETURNING id`,
        [evento_id, r.cStat, r.xMotivo],
      );
      if (u.length === 0) throw new Error('RN-FAT-02: o evento não está pendente');
    },
    async guardarXmlEvento(tx, evento, xml) {
      await tx.consultar(`UPDATE faturamento.nota_evento SET registrado_em = $2::timestamptz WHERE id = $1 AND status = 'pendente'`, [evento.id, xml.dhRegistro]);
      await tx.consultar(
        `INSERT INTO faturamento.nota_xml (tenant_id, tipo, nota_id, evento_id, chave_acesso, protocolo, xml, sha256)
         SELECT plataforma.tenant_atual(), 'evento_' || e.tipo, e.nota_id, e.id, n.chave_acesso, $2::text, $3::text, encode(sha256(convert_to($3::text, 'UTF8')), 'hex')
           FROM faturamento.nota_evento e JOIN faturamento.nota n ON n.tenant_id = e.tenant_id AND n.id = e.nota_id WHERE e.id = $1`,
        [evento.id, xml.protocolo, xml.conteudo],
      );
    },

    async listarInutilizacoes(tx, filtro) {
      return tx.consultar<InutilizacaoRegistro>(
        `SELECT ${COLUNAS_INUT} FROM faturamento.inutilizacao i WHERE ($1::uuid IS NULL OR i.filial_id = $1) ORDER BY i.created_at DESC, i.id LIMIT 200`,
        [filtro.filial_id ?? null],
      );
    },
    async obterInutilizacao(tx, id, opcoes) {
      const [l] = await tx.consultar<InutilizacaoRegistro>(`SELECT ${COLUNAS_INUT} FROM faturamento.inutilizacao i WHERE i.id = $1 ${opcoes?.travar ? 'FOR UPDATE' : ''}`, [id]);
      return l ?? null;
    },
    async criarInutilizacao(tx, i) {
      const [c] = await tx.consultar<{ id: string }>(
        `INSERT INTO faturamento.inutilizacao (tenant_id, filial_id, ambiente, serie, ano, numero_inicial, numero_final, justificativa)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [i.filial_id, i.ambiente, i.serie, i.ano, i.numero_inicial, i.numero_final, i.justificativa],
      );
      const [l] = await tx.consultar<InutilizacaoRegistro>(`SELECT ${COLUNAS_INUT} FROM faturamento.inutilizacao i WHERE i.id = $1`, [c?.id]);
      if (!l) throw new Error('RN-FAT-01: a inutilização não foi gravada');
      return l;
    },
    async rejeitarInutilizacao(tx, id, r) {
      const u = await tx.consultar(
        `UPDATE faturamento.inutilizacao SET status = 'rejeitado', c_stat = $2::smallint, x_motivo = left($3::text, 255) WHERE id = $1 AND status = 'pendente' RETURNING id`,
        [id, r.cStat, r.xMotivo],
      );
      if (u.length === 0) throw new Error('RN-FAT-01: a inutilização não está pendente');
    },
    async guardarXmlInutilizacao(tx, i, xml) {
      await tx.consultar(`UPDATE faturamento.inutilizacao SET registrado_em = $2::timestamptz WHERE id = $1 AND status = 'pendente'`, [i.id, xml.dhRegistro]);
      await tx.consultar(
        `INSERT INTO faturamento.nota_xml (tenant_id, tipo, inutilizacao_id, protocolo, xml, sha256)
         VALUES (plataforma.tenant_atual(), 'inutilizacao', $1, $2::text, $3::text, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'))`,
        [i.id, xml.protocolo, xml.conteudo],
      );
    },
    async proximoNumero(tx, filial_id, ambiente, serie) {
      const [l] = await tx.consultar<{ proximo: number }>(
        `SELECT proximo FROM faturamento.serie_numeracao WHERE filial_id = $1 AND ambiente = $2 AND modelo = 55 AND serie = $3 AND deleted_at IS NULL`,
        [filial_id, ambiente, serie],
      );
      return l?.proximo ?? null;
    },
    async notasNaFaixa(tx, filial_id, ambiente, serie, inicial, final, opcoes) {
      return tx.consultar<NotaNaFaixa>(
        `SELECT numero, status FROM faturamento.nota WHERE filial_id = $1 AND ambiente = $2 AND modelo = 55 AND serie = $3 AND numero BETWEEN $4 AND $5 AND deleted_at IS NULL ORDER BY numero ${opcoes?.travar ? 'FOR UPDATE' : ''}`,
        [filial_id, ambiente, serie, inicial, final],
      );
    },
    async registrarTransmissao(tx, t) {
      const ref = t.servico === 'evento' ? 'evento_id' : 'inutilizacao_id';
      await tx.consultar(
        `INSERT INTO faturamento.transmissao (tenant_id, nota_id, ${ref}, servico, destino, tentativa, c_stat, x_motivo, enviada_em, respondida_em, duracao_ms)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4,
                 LEAST(COALESCE((SELECT max(tentativa) FROM faturamento.transmissao WHERE ${ref} = $2 AND servico = $3), 0) + 1, 999),
                 $5::smallint, $6, $7::timestamptz, $8::timestamptz, $9)`,
        [t.nota_id ?? null, t.evento_id ?? t.inutilizacao_id, t.servico, t.destino, t.cStat, t.xMotivo, t.enviada_em, t.respondida_em, t.duracao_ms],
      );
    },
    async situacaoTransmissaoEvento(tx, evento_id, leaseMin) {
      const [r] = await tx.consultar<{ tentativas: string; lease: boolean }>(
        `SELECT count(*) AS tentativas, bool_or(respondida_em IS NULL AND enviada_em > now() - make_interval(mins => $2::int)) AS lease FROM faturamento.transmissao WHERE evento_id = $1 AND servico = 'evento'`,
        [evento_id, leaseMin],
      );
      return { tentativas: Number(r?.tentativas ?? 0), leaseAtivo: r?.lease === true };
    },
    async iniciarTransmissao(tx, l) {
      const tabela = l.servico === 'evento' ? 'faturamento.nota_evento' : 'faturamento.inutilizacao';
      const ref = l.servico === 'evento' ? 'evento_id' : 'inutilizacao_id';
      const id = (l.servico === 'evento' ? l.evento_id : l.inutilizacao_id) as string;
      const [p] = await tx.consultar<{ status: string }>(`SELECT status FROM ${tabela} WHERE id = $1 FOR UPDATE`, [id]);
      if (p?.status !== 'pendente') return null;
      const ativo = await tx.consultar(
        `SELECT 1 FROM faturamento.transmissao WHERE ${ref} = $1 AND servico = $2 AND respondida_em IS NULL AND enviada_em > now() - make_interval(mins => $3::int) LIMIT 1`,
        [id, l.servico, l.leaseMin],
      );
      if (ativo.length > 0) return null;
      const [c] = await tx.consultar<{ id: string }>(
        `INSERT INTO faturamento.transmissao (tenant_id, nota_id, ${ref}, servico, destino, tentativa)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, LEAST(COALESCE((SELECT max(tentativa) FROM faturamento.transmissao WHERE ${ref} = $2 AND servico = $3), 0) + 1, 999)) RETURNING id`,
        [l.nota_id ?? null, id, l.servico, l.destino],
      );
      return c ? { id: c.id } : null;
    },
    async concluirTransmissao(tx, lease_id, r) {
      await tx.consultar(
        `UPDATE faturamento.transmissao SET c_stat = $2::smallint, x_motivo = left($3::text, 255), respondida_em = $4::timestamptz, duracao_ms = $5 WHERE id = $1 AND respondida_em IS NULL`,
        [lease_id, r.cStat, r.xMotivo, r.respondida_em, r.duracao_ms],
      );
    },
    async registrarDivergenciaInutilizacao(tx, id, r) {
      const u = await tx.consultar(
        `UPDATE faturamento.inutilizacao SET c_stat = $2::smallint, x_motivo = left($3::text, 255) WHERE id = $1 AND status = 'pendente' RETURNING id`,
        [id, r.cStat, r.xMotivo],
      );
      if (u.length === 0) throw new Error('RN-FAT-01: a inutilização não está pendente');
    },
    async pendentes(tx, limite, paradasHaMinutos, leaseMin) {
      return tx.consultar<{ tipo: 'evento' | 'inutilizacao'; id: string }>(
        `SELECT tipo, id FROM (
           SELECT 'evento'::text AS tipo, id, updated_at FROM faturamento.nota_evento WHERE status = 'pendente'
           UNION ALL SELECT 'inutilizacao'::text, id, updated_at FROM faturamento.inutilizacao WHERE status = 'pendente' AND c_stat IS DISTINCT FROM 563) p
          WHERE updated_at < now() - make_interval(mins => $2::int)
            AND NOT EXISTS (SELECT 1 FROM faturamento.transmissao t WHERE t.servico = p.tipo AND t.respondida_em IS NULL
                              AND t.enviada_em > now() - make_interval(mins => $3::int) AND p.id = CASE p.tipo WHEN 'evento' THEN t.evento_id ELSE t.inutilizacao_id END)
          ORDER BY updated_at, id LIMIT $1`,
        [limite, paradasHaMinutos, leaseMin],
      );
    },
  };
}

export const pedidosAprovadosSql: PedidosAprovados = {
  async obter(tx, pedido_id) {
    const [l] = await tx.consultar<{ payload: unknown }>('SELECT payload FROM faturamento.pedido_a_faturar WHERE pedido_id = $1 AND deleted_at IS NULL', [pedido_id]);
    return l ? PedidoAprovadoV1.parse(l.payload) : null;
  },
  async gravar(tx, pedido) {
    const r = await tx.consultar(
      `INSERT INTO faturamento.pedido_a_faturar (tenant_id, pedido_id, filial_id, cliente_id, payload)
       VALUES (plataforma.tenant_atual(), $1, $2, $3, $4::jsonb) ON CONFLICT (tenant_id, pedido_id) DO NOTHING RETURNING id`,
      [pedido.pedido_id, pedido.filial_id, pedido.cliente_id, JSON.stringify(pedido)],
    );
    return r.length > 0 ? 'novo' : 'repetido';
  },
};

export const ambienteFiscalSql: AmbienteFiscalDaFilial = {
  async ambiente(tx, filial_id) {
    const [l] = await tx.consultar<{ ambiente: 'homologacao' | 'producao' }>('SELECT faturamento.ambiente_da_filial(plataforma.tenant_atual(), $1::uuid) AS ambiente', [filial_id]);
    return l?.ambiente ?? 'homologacao';
  },
};

/** Porta inversa do pedido (P-2): nota em autorização ou em contingência bloqueia o cancelamento; `FOR SHARE` na linha da nota. */
export const notaEmAbertoSql: NotaEmAberto = {
  async temNotaEmAutorizacao(tx, pedido_id) {
    const r = await tx.consultar(`SELECT id FROM faturamento.nota WHERE pedido_id = $1 AND status IN ('em_autorizacao', 'emitida_contingencia') AND deleted_at IS NULL LIMIT 1 FOR SHARE`, [pedido_id]);
    return r.length > 0;
  },
};

/** Repositórios de produção, ligados pelo apps/api e pelo apps/worker (a `Outbox` vem do SDK: `new OutboxPg()`). */
export function repositoriosSql(deps: DependenciasSql): { titulos: RepositorioTitulos; configuracao: ConfiguracaoFaturamento; notas: RepositorioNotas; eventos: RepositorioEventos; pedidos: PedidosAprovados; ambiente: AmbienteFiscalDaFilial; notaEmAberto: NotaEmAberto } {
  return { titulos: repositorioTitulosSql, configuracao: configuracaoFaturamentoSql, notas: repositorioNotasSql(deps), eventos: repositorioEventosSql(), pedidos: pedidosAprovadosSql, ambiente: ambienteFiscalSql, notaEmAberto: notaEmAbertoSql };
}
