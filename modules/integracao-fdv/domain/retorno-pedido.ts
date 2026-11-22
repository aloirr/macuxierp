/**
 * Status do ERP -> Hub (RN-PED-05; T-0013 §6.2, ADR 0007). Função pura: recebe o evento `pedido.pedido.*@1` e o último
 * status já gravado para o pedido, e diz o que enviar. O recusado vai como `cancelado` com motivo (o Hub não aceita
 * `integrado -> rejeitado_erp`); `rejeitado_erp` é só do recebimento recusado (`retornoRejeitadoErp`).
 */
import { z } from 'zod';
import { jsonCanonico } from './canonico';
import type { CodigoRejeicao } from './pedido-fdv';
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
// condicao_ausente vem no lote 1c da T-0015; tirar o `| 'condicao_ausente'` depois que ele entrar.
const TEXTO_DA_REJEICAO: Readonly<Record<CodigoRejeicao | 'condicao_ausente', string>> = {
  cliente_desconhecido: 'Cliente não cadastrado no ERP',
  vendedor_desconhecido: 'Vendedor não cadastrado no ERP',
  produto_desconhecido: 'Produto não cadastrado no ERP',
  filial_desconhecida: 'Filial não cadastrada no ERP',
  sequencia_repetida: 'Itens com sequência repetida',
  quantidade_invalida: 'Quantidade inválida',
  pedido_fora_do_contrato: 'Pedido fora do contrato',
  modulo_pedido_inativo: 'Módulo de pedidos inativo no ERP',
  cliente_inexistente: 'Cliente não cadastrado no ERP',
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
/** Leitor tolerante do payload do evento (`Base` + campos do fato; T-0013 §8). Campo novo opcional não derruba. */
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
  'pedido.pedido.recusado@1',
  'pedido.pedido.cancelado@1',
  'pedido.pedido.faturado@1',
] as const;

export interface EventoPedido {
  nome: string;
  /** ISO UTC do envelope. */
  ocorrido_em: string;
  payload: PayloadPedidoLido;
}

type DecisaoRetorno =
  | { acao: 'enviar'; corpo: RetornoErp }
  | { acao: 'ignorar'; motivo: 'origem_nao_fdv' | 'homologacao' | 'status_sem_retorno' | 'evento_sem_retorno' | 'hub_ja_terminal' | 'hub_ja_adiante' };

const TERMINAIS: ReadonlySet<StatusRetornoHub> = new Set(['rejeitado_erp', 'cancelado', 'faturado_total']);

function motivoDe(p: PayloadPedidoLido): string | undefined {
  const codigo = p.motivo_codigo ?? undefined;
  if (codigo === 'outro') return (p.motivo_texto ?? TEXTO_DO_MOTIVO.outro)?.slice(0, 300) || undefined;
  return codigo ? (TEXTO_DO_MOTIVO[codigo] ?? undefined) : undefined;
}

export function retornoDoPedido(evento: EventoPedido, ultimoStatusHub: StatusRetornoHub | null): DecisaoRetorno {
  const p = evento.payload;
  if (p.origem !== 'fdv' || !p.pedido_uuid) return { acao: 'ignorar', motivo: 'origem_nao_fdv' };
  if (ultimoStatusHub && TERMINAIS.has(ultimoStatusHub)) return { acao: 'ignorar', motivo: 'hub_ja_terminal' };
  const comum = { versao_contrato: 'v1' as const, pedido_uuid: p.pedido_uuid, numero_erp: String(p.numero), ocorrido_em: evento.ocorrido_em };

  switch (evento.nome) {
    case 'pedido.pedido.recebido@1':
      if (p.status !== 'aprovado' && p.status !== 'em_analise') return { acao: 'ignorar', motivo: 'status_sem_retorno' };
      if (ultimoStatusHub) return { acao: 'ignorar', motivo: 'hub_ja_adiante' };
      return { acao: 'enviar', corpo: { ...comum, status: 'integrado' } };
    case 'pedido.pedido.recusado@1':
    case 'pedido.pedido.cancelado@1': {
      const motivo = motivoDe(p);
      return { acao: 'enviar', corpo: { ...comum, status: 'cancelado', ...(motivo ? { motivo } : {}) } };
    }
    case 'pedido.pedido.faturado@1': {
      if (p.ambiente !== 'producao') return { acao: 'ignorar', motivo: 'homologacao' };
      if (!p.nota || !p.itens_faturados) return { acao: 'ignorar', motivo: 'status_sem_retorno' };
      const status: StatusRetornoHub = p.status === 'faturado' ? 'faturado_total' : 'faturado_parcial';
      return {
        acao: 'enviar',
        corpo: {
          ...comum,
          status,
          nota: { numero: p.nota.numero, serie: p.nota.serie, chave: p.nota.chave, emitida_em: p.nota.emitida_em, total_cents: p.nota.total_centavos },
          itens_faturados: p.itens_faturados.map((i) => ({
            sequencia: i.sequencia,
            produto_external_id: i.produto_id,
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
