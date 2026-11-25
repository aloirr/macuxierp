/**
 * Status do ERP -> Hub (RN-PED-05; T-0013 §6.2, ADR 0007). Função pura: recebe o evento `pedido.pedido.*@1` e o último
 * status já gravado para o pedido, e diz o que enviar. O cancelamento vai como `cancelado` com motivo (o Hub não aceita
 * `integrado -> rejeitado_erp`); o `recusado@1` não é consumido (RN-PED-01, T-0013 §6.1); `rejeitado_erp` é só do recebimento recusado (`retornoRejeitadoErp`).
 */
import { z } from 'zod';
import { jsonCanonico } from './canonico';
import { qtd4InteiraParaHub } from './quantidade-hub';
import type { CodigoRejeicao } from './pedido-fdv';
import { PedidoFaturadoV1 } from '@macuxierp/pedido/contracts';
import type { RetornoErp, StatusRetornoHub } from '../contracts';

/** Catálogo de motivos do pedido (T-0013 §4.3): ao FDV vai o texto do catálogo; em `outro`, o texto livre. */
const TEXTO_DO_MOTIVO: Readonly<Record<string, string>> = {
  preco_divergente: 'Preço divergente',
  credito_insuficiente: 'Crédito insuficiente',
  estoque_insuficiente: 'Estoque insuficiente',
  cliente_bloqueado: 'Cliente bloqueado',
  pedido_duplicado: 'Pedido duplicado',
  condicao_nao_aceita: 'Condição de pagamento não aceita',
  solicitacao_cliente: 'Solicitação do cliente',
  sem_estoque: 'Sem estoque',
  erro_lancamento: 'Erro de lançamento',
  outro: 'Outro motivo',
};

/**
 * Motivos do recebimento recusado: um texto por código da porta (`CodigoRecusaRecebimento`, vindo do contrato do pedido)
 * e por código da tradução local. `Record` exaustivo: código novo no contrato quebra o typecheck aqui.
 */
const TEXTO_DA_REJEICAO: Readonly<Record<CodigoRejeicao, string>> = {
  sequencia_repetida: 'Itens com sequência repetida',
  quantidade_invalida: 'Quantidade inválida',
  pedido_fora_do_contrato: 'Pedido fora do contrato',
  modulo_pedido_inativo: 'Módulo de pedidos inativo no ERP',
  cliente_inexistente: 'Cliente não cadastrado no ERP',
  vendedor_inexistente: 'Vendedor não cadastrado no ERP',
  produto_inexistente: 'Produto não cadastrado no ERP',
  filial_inexistente: 'Filial não cadastrada no ERP',
  cliente_inativo: 'Cliente inativo no ERP',
  produto_inativo: 'Produto inativo no ERP',
  filial_nao_emissora: 'Filial inativa ou não emissora no ERP',
  condicao_ausente: 'Pedido sem condição de pagamento',
  condicao_inexistente: 'Condição de pagamento não cadastrada no ERP',
  condicao_inativa: 'Condição de pagamento inativa no ERP',
  item_incoerente: 'Item com desconto maior que o valor do item',
  falha_interna: 'Falha interna do ERP ao receber o pedido',
};

const Uuid = z.string().uuid();
/** Leitor tolerante do payload do evento (`Base` + campos do fato). Leitor tolerante e não o schema do publicador: campo novo opcional não derruba o consumidor (.coord/contratos/eventos.md, seção Dependências). */
export const PayloadPedidoLido = z
  .object({
    pedido_id: Uuid,
    numero: z.number().int(),
    origem: z.enum(['fdv', 'bko']),
    pedido_uuid: Uuid.nullable().optional(),
    status: z.string(),
    motivo_codigo: z.string().nullable().optional(),
    motivo_texto: z.string().nullable().optional(),
    ambiente: z.enum(['producao', 'homologacao']).optional(),
    /** RN-FAT-04/M7: ver PedidoFaturadoV1.conta_como_real (pedido/contracts). Ausente = false. */
    conta_como_real: PedidoFaturadoV1.shape.conta_como_real,
    nota: z
      .object({ id: Uuid.optional(), numero: z.number().int(), serie: z.number().int(), chave: z.string(), emitida_em: z.string(), total_centavos: z.number().int() })
      .optional(),
    itens_faturados: z
      .array(z.object({ sequencia: z.number().int().min(1), produto_id: Uuid, quantidade: z.number().int(), valor_centavos: z.number().int() }))
      .optional(),
  })
  .passthrough();
export type PayloadPedidoLido = z.infer<typeof PayloadPedidoLido>;

export const EVENTOS_DE_RETORNO = [
  'pedido.pedido.recebido@1',
  'pedido.pedido.cancelado@1',
  'pedido.pedido.faturado@1',
] as const;

export interface EventoPedido {
  nome: string;
  /** ISO UTC do envelope. */
  ocorrido_em: string;
  payload: PayloadPedidoLido;
}

/**
 * RN-PED-05 / A-02: quanto o retorno faturado espera a chave do Hub de um produto chegar ao espelho. PREMISSA (a confirmar pelo
 * gerente): 24 h, contadas do `ocorrido_em` do evento; é o prazo em que a carga de produtos do conector (modo completo ou delta)
 * já deveria ter publicado o produto. Passado o prazo o consumidor desiste do retorno (monitor + alerta) em vez de repetir sem fim.
 */
export const PRAZO_AGUARDAR_CHAVE_MS = 24 * 60 * 60 * 1000;

type DecisaoRetorno =
  | { acao: 'enviar'; corpo: RetornoErp; /** T-0085: sequências dos itens faturados fracionários, fora do corpo (o Log registra). */ itens_fracionarios?: number[] }
  /** Faturado com produto sem chave do Hub no espelho, dentro do prazo: o consumidor falha (retentativa) até a chave existir; nunca vai o UUID cru. */
  | { acao: 'aguardar_chave'; produtos: string[] }
  /** Prazo vencido sem a chave: o retorno não vai ao Hub. `corpo` é o que seria enviado, sem itens (só para o registro `falhou`); `produtos` são UUIDs do ERP. */
  | { acao: 'descartar_sem_chave'; produtos: string[]; corpo: RetornoErp }
  | { acao: 'ignorar'; motivo: 'origem_nao_fdv' | 'homologacao' | 'status_sem_retorno' | 'evento_sem_retorno' | 'hub_ja_terminal' | 'hub_ja_adiante' };

/**
 * Ordem do avanço no Hub (RN-PED-05): integrado < faturado_parcial < faturado_total; os terminais ficam no degrau do total.
 * Única fonte: o SQL do "último status aceito" (api/retorno-pedidos.ts) é montado a partir dela.
 */
export const ORDEM_HUB = { integrado: 1, faturado_parcial: 2, faturado_total: 3, rejeitado_erp: 3, cancelado: 3 } as const satisfies Readonly<Record<StatusRetornoHub, number>>;

/** Terminais no Hub (degrau 3 de `ORDEM_HUB`): nada mais é enviado depois deles, salvo `cancelado@1` depois de `faturado_total` (o Hub aceita). */
const TERMINAIS: ReadonlySet<StatusRetornoHub> = new Set(['rejeitado_erp', 'cancelado', 'faturado_total']);

function motivoDe(p: PayloadPedidoLido): string | undefined {
  const codigo = p.motivo_codigo ?? undefined;
  if (codigo === 'outro') return (p.motivo_texto ?? TEXTO_DO_MOTIVO.outro)?.slice(0, 300) || undefined;
  return codigo ? (TEXTO_DO_MOTIVO[codigo] ?? undefined) : undefined;
}

/**
 * `chavesProduto`: UUID do produto no ERP -> chave do Hub (`registro_external_id` do espelho, achada pelo `erp_id`; ADR 0010,
 * item 1). Só o faturado usa. `ultimoStatusHub` é o maior status ACEITO pelo Hub (estado `enviado`), não o último tentado; `chaveNotaUltimoAceito` é a chave da nota desse retorno
 * (parcial depois de parcial vai se a nota for diferente ou desconhecida; com a mesma nota é ignorado). `agora` (relógio do consumidor) decide o prazo `PRAZO_AGUARDAR_CHAVE_MS`; sem ele o retorno sempre aguarda.
 */
export function retornoDoPedido(evento: EventoPedido, ultimoStatusHub: StatusRetornoHub | null, chavesProduto: ReadonlyMap<string, string> = new Map(), agora?: Date, chaveNotaUltimoAceito?: string | null): DecisaoRetorno {
  const p = evento.payload;
  if (p.origem !== 'fdv' || !p.pedido_uuid) return { acao: 'ignorar', motivo: 'origem_nao_fdv' };
  const cancelaFaturado = evento.nome === 'pedido.pedido.cancelado@1' && ultimoStatusHub === 'faturado_total';
  if (ultimoStatusHub && TERMINAIS.has(ultimoStatusHub) && !cancelaFaturado) return { acao: 'ignorar', motivo: 'hub_ja_terminal' };
  const comum = { versao_contrato: 'v1' as const, pedido_uuid: p.pedido_uuid, numero_erp: String(p.numero), ocorrido_em: evento.ocorrido_em };

  switch (evento.nome) {
    case 'pedido.pedido.recebido@1':
      if (p.status !== 'aprovado' && p.status !== 'em_analise') return { acao: 'ignorar', motivo: 'status_sem_retorno' };
      if (ultimoStatusHub) return { acao: 'ignorar', motivo: 'hub_ja_adiante' };
      return { acao: 'enviar', corpo: { ...comum, status: 'integrado' } };
    case 'pedido.pedido.cancelado@1': {
      const motivo = motivoDe(p);
      return { acao: 'enviar', corpo: { ...comum, status: 'cancelado', ...(motivo ? { motivo } : {}) } };
    }
    case 'pedido.pedido.faturado@1': {
      if (p.ambiente !== 'producao' && !p.conta_como_real) return { acao: 'ignorar', motivo: 'homologacao' };
      if (!p.nota || !p.itens_faturados) return { acao: 'ignorar', motivo: 'status_sem_retorno' };
      const novo: StatusRetornoHub = p.status === 'faturado' ? 'faturado_total' : 'faturado_parcial';
      if (ultimoStatusHub && ORDEM_HUB[novo] <= ORDEM_HUB[ultimoStatusHub]) {
        const novoParcial = novo === 'faturado_parcial' && ultimoStatusHub === 'faturado_parcial' && chaveNotaUltimoAceito !== p.nota.chave;
        if (!novoParcial) return { acao: 'ignorar', motivo: 'hub_ja_adiante' };
      }
      const faltam = [...new Set(p.itens_faturados.filter((i) => !chavesProduto.has(i.produto_id)).map((i) => i.produto_id))];
      const notaHub = { numero: String(p.nota.numero), serie: String(p.nota.serie), chave: p.nota.chave, emitida_em: p.nota.emitida_em, total_cents: p.nota.total_centavos };
      if (faltam.length > 0) {
        const vencido = agora !== undefined && agora.getTime() - Date.parse(evento.ocorrido_em) >= PRAZO_AGUARDAR_CHAVE_MS;
        return vencido ? { acao: 'descartar_sem_chave', produtos: faltam, corpo: { ...comum, status: novo, nota: notaHub, itens_faturados: [] } } : { acao: 'aguardar_chave', produtos: faltam };
      }
      // T-0085: o Hub só aceita quantidade inteira. Premissa: `itens_faturados` é opcional e sem mínimo no contrato, então o retorno
      // sai sem o item fracionário (o status e a nota seguem) e a decisão devolve as sequências recusadas para o Log.
      const fracionarios = p.itens_faturados.filter((i) => !qtd4InteiraParaHub(i.quantidade)).map((i) => i.sequencia);
      return {
        acao: 'enviar',
        ...(fracionarios.length > 0 ? { itens_fracionarios: fracionarios } : {}),
        corpo: {
          ...comum,
          status: novo,
          nota: notaHub,
          itens_faturados: p.itens_faturados.filter((i) => qtd4InteiraParaHub(i.quantidade)).map((i) => ({
            sequencia: i.sequencia,
            produto_external_id: chavesProduto.get(i.produto_id)!, // chave do Hub, nunca o UUID (ADR 0010, item 1)
            quantidade: i.quantidade / 10_000,
            valor_cents: i.valor_centavos,
          })),
        },
      };
    }
    default:
      return { acao: 'ignorar', motivo: 'evento_sem_retorno' };
  }
}

/** `rejeitado_erp` do recebimento recusado (sem pedido criado, logo sem `numero_erp`). */
export function retornoRejeitadoErp(pedidoUuid: string, codigo: string, agora: Date): RetornoErp {
  return { versao_contrato: 'v1', pedido_uuid: pedidoUuid, status: 'rejeitado_erp', motivo: (TEXTO_DA_REJEICAO as Readonly<Record<string, string>>)[codigo] ?? 'Pedido não recebido pelo ERP', ocorrido_em: agora.toISOString() };
}

/** Corpo sem `ocorrido_em`, no JSON canônico: a base do hash de idempotência (o SHA-256 é calculado em `api/`, T-0013 §6.3). */
export function corpoCanonicoDoRetorno(corpo: RetornoErp): string {
  const { ocorrido_em: _ignorado, ...resto } = corpo;
  void _ignorado;
  return jsonCanonico(resto);
}
