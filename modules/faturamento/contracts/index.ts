/**
 * Contratos públicos do módulo faturamento (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 */
import { ConsultaPaginada } from '@macuxierp/platform-sdk';
import { z } from 'zod';

export const MODULO = 'faturamento' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

/** Tipos de campo vindos de cadastros (o faturamento já depende dele). */
export { Centavos, Qtd4, Uuid } from '@macuxierp/cadastros/contracts';
import { Centavos, Qtd4, Uuid } from '@macuxierp/cadastros/contracts';

export const Ambiente = z.enum(['homologacao', 'producao']);
export type Ambiente = z.infer<typeof Ambiente>;

/** Máquina de estados da nota (RN-FAT-02, RN-FAT-03, RN-FAT-07). Espelha o CHECK de `faturamento.nota.status`. */
export const StatusNota = z.enum([
  'rascunho',
  'em_autorizacao',
  'autorizada_guarda_pendente',
  'autorizada',
  'rejeitada',
  'denegada',
  'cancelada',
  'emitida_contingencia',
  'inutilizada',
]);
export type StatusNota = z.infer<typeof StatusNota>;

/** tpEmis: 1 normal, 6 SVC-AN, 7 SVC-RS (RN-FAT-05; a modalidade fica em ADR). */
export const TipoEmissao = z.union([z.literal(1), z.literal(6), z.literal(7)]);
export type TipoEmissao = z.infer<typeof TipoEmissao>;

/**
 * Chave de acesso de 44 posições. CNPJ alfanumérico (NT 2025.001, válido desde jul/2026): as 12 primeiras posições do CNPJ
 * aceitam A-Z e 0-9; os 2 DV do CNPJ e todo o resto seguem numéricos. Única fonte do regex (domain e api importam daqui).
 */
export const CHAVE_ACESSO_REGEX = /^\d{6}[A-Z0-9]{12}\d{26}$/;
export const ChaveAcesso = z.string().regex(CHAVE_ACESSO_REGEX);
export type ChaveAcesso = z.infer<typeof ChaveAcesso>;

/** Número de protocolo de autorização (nProt). */
export const Protocolo = z.string().min(1).max(20);

/** Identificação da nota nos eventos. `chave_acesso` e `protocolo` são nulos na rejeição antes da autorização. */
export const NotaEvento = z.object({
  id: Uuid,
  filial_id: Uuid,
  cliente_id: Uuid,
  serie: z.number().int().min(0).max(999),
  numero: z.number().int().min(1).max(999_999_999),
  chave_acesso: ChaveAcesso.nullable(),
  emitida_em: z.string().datetime(),
  total_centavos: Centavos,
  protocolo: Protocolo.nullable(),
});
export type NotaEvento = z.infer<typeof NotaEvento>;

/** `produto_id` e `filial_id` (opcionais, aditivos no @1) servem ao consumidor de estoque; `quantidade` é Qtd4 (inteiro, escala 4). */
export const ItemNotaEvento = z.object({
  sequencia: z.number().int().min(1),
  quantidade: Qtd4,
  valor_centavos: Centavos,
  produto_id: Uuid.optional(),
  filial_id: Uuid.optional(),
});
export type ItemNotaEvento = z.infer<typeof ItemNotaEvento>;

/**
 * Base dos eventos de nota (agregado = `nota.id`). Campos que o pedido (T-0013 §8.1) e a integração-fdv (T-0009 C-5)
 * leem com leitor tolerante. Só `ambiente = producao` vira faturamento real no FDV (RN-FAT-04, M7).
 */
const BaseEventoNota = z.object({
  pedido_id: Uuid,
  ambiente: Ambiente,
  nota: NotaEvento,
  itens: z.array(ItemNotaEvento).min(1),
  vendedor_id: Uuid.nullable(),
  quantidade_itens: z.number().int().min(1),
  /** Acréscimo opcional: `true` só quando a filial liga "faturamento real com NF-e simulada" e a nota é de homologação (o FDV a conta como faturamento real). Ausente = como sempre. */
  conta_como_real: z.boolean().optional(),
});

/** Identificação da nota já autorizada: chave e protocolo sempre presentes. */
export const NotaEventoAutorizada = NotaEvento.extend({ chave_acesso: ChaveAcesso, protocolo: Protocolo });
export type NotaEventoAutorizada = z.infer<typeof NotaEventoAutorizada>;

/** `faturamento.nota.autorizada@1`: publicado só depois do XML autorizado guardado (RN-FAT-03). */
export const NotaAutorizadaPayload = BaseEventoNota.extend({
  nota: NotaEventoAutorizada,
  /** UUID do pedido no FDV (T-0009 2.10); nulo para pedido nascido no ERP. */
  pedido_uuid: Uuid.nullable(),
  /**
   * true quando a filial tem a bandeira 'faturamento real com NF-e simulada' e a nota é de homologação;
   * consumidores (FDV, estoque) tratam como produção. Ausente = false (decisão do Alexandre, 22/11, 02h31).
   */
  conta_como_real: z.boolean().optional(),
});
export type NotaAutorizadaPayload = z.infer<typeof NotaAutorizadaPayload>;

/** `faturamento.nota.cancelada@1`: o pedido devolve as quantidades (T-0013 §2, P-2). */
export const NotaCanceladaPayload = BaseEventoNota.extend({
  nota: NotaEventoAutorizada,
  pedido_uuid: Uuid.nullable(),
  protocolo_cancelamento: Protocolo,
  motivo: z.string().min(15).max(255),
  /**
   * true quando a filial tem a bandeira 'faturamento real com NF-e simulada' e a nota é de homologação;
   * consumidores (FDV, estoque) tratam como produção. Ausente = false (decisão do Alexandre, 22/11, 02h31).
   */
  conta_como_real: z.boolean().optional(),
});
export type NotaCanceladaPayload = z.infer<typeof NotaCanceladaPayload>;

/** `faturamento.nota.rejeitada@1` (RF-FAT-08): código, mensagem e ação sugerida da SEFAZ. */
export const NotaRejeitadaPayload = BaseEventoNota.extend({
  codigo: z.string().regex(/^\d{3}$/),
  mensagem: z.string().max(1000),
  acao_sugerida: z.string().max(500),
});
export type NotaRejeitadaPayload = z.infer<typeof NotaRejeitadaPayload>;

/** `faturamento.titulo.gerado@1` (T-0009 §2.9): um evento por parcela. Datas civis (AAAA-MM-DD). */
export const TituloGeradoPayload = z.object({
  titulo_id: Uuid,
  nota_id: Uuid,
  pedido_id: Uuid,
  cliente_id: Uuid,
  ambiente: Ambiente,
  numero: z.number().int().min(1),
  serie: z.number().int().min(0).max(999),
  parcela: z.number().int().min(1),
  total_parcelas: z.number().int().min(1),
  emissao: z.string().date(),
  vencimento: z.string().date(),
  valor_centavos: Centavos,
  saldo_centavos: Centavos,
  /**
   * true quando a filial tem a bandeira 'faturamento real com NF-e simulada' e a nota é de homologação;
   * consumidores (FDV, estoque) tratam como produção. Ausente = false (decisão do Alexandre, 22/11, 02h31).
   */
  conta_como_real: z.boolean().optional(),
});
export type TituloGeradoPayload = z.infer<typeof TituloGeradoPayload>;

/** `faturamento.titulo.baixado@1` (C-5 da T-0009). */
export const TituloBaixadoPayload = TituloGeradoPayload.extend({ baixado_em: z.string().date(), valor_baixado_centavos: Centavos });
export type TituloBaixadoPayload = z.infer<typeof TituloBaixadoPayload>;

/** Entrada de `POST /v1/faturamento/notas` (RF-FAT-01). Sem `itens` = nota total do saldo do pedido. */
export const ItemEmissao = z.object({ sequencia: z.number().int().min(1), quantidade: Qtd4.positive().optional() });
export type ItemEmissao = z.infer<typeof ItemEmissao>;

export const EmitirNotaEntrada = z.object({
  pedido_id: Uuid,
  /** Parcial: só as sequências listadas, com `quantidade` (escala 4) opcional (omitida = todo o saldo do item). */
  itens: z
    .array(ItemEmissao)
    .min(1)
    .max(500)
    .optional(),
  /** Mesma `Idempotency-Key` da rota (RN-CORE-05): repetir não gera segunda nota nem queima número. */
  idempotencia: z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/),
});
export type EmitirNotaEntrada = z.infer<typeof EmitirNotaEntrada>;

// ---- Consulta (rotas GET) ----

/** Linha da lista de notas e do painel de rejeições (sem dado pessoal: nada do destinatário). */
export const NotaResumo = z.object({
  id: Uuid,
  filial_id: Uuid,
  cliente_id: Uuid,
  pedido_id: Uuid.nullable(),
  ambiente: Ambiente,
  serie: z.number().int(),
  numero: z.number().int().nullable(),
  chave_acesso: z.string().nullable(),
  status: StatusNota,
  emitida_em: z.string().datetime(),
  total_centavos: Centavos,
  protocolo: z.string().nullable(),
  c_stat: z.number().int().nullable(),
  x_motivo: z.string().nullable(),
  /** Só na lista do BKO (RF-FAT-08 / T-0021 item C): nome do destinatário no retrato da nota; ausente nos eventos e no painel de rejeições. */
  cliente_razao_social: z.string().nullable().optional(),
  /** Para as colunas "Filial" e "Pedido" do BKO. PENDENTE na API (hoje ausentes): nome da filial vem do cadastros e o número do pedido do retrato em `pedido_a_faturar`. */
  filial_nome: z.string().nullable().optional(),
  pedido_numero: z.number().int().nullable().optional(),
});
export type NotaResumo = z.infer<typeof NotaResumo>;

export const NotaDetalhe = NotaResumo.extend({
  natureza_operacao: z.string(),
  tipo_emissao: TipoEmissao,
  recibo: z.string().nullable(),
  itens: z.array(ItemNotaEvento),
  /** RF-FAT-08: só na nota `rejeitada`, a ação sugerida para o cStat/xMotivo (mesma do painel `GET /rejeicoes`). */
  acao_sugerida: z.string().nullable().optional(),
  /** Base do prazo de cancelamento (RN-FAT-02): a tela só oferece o botão dentro de 24 h; a API revalida. */
  autorizada_em: z.string().datetime().nullable().optional(),
});
export type NotaDetalhe = z.infer<typeof NotaDetalhe>;

/** Local até o sdk exportar a data civil (RD-0369). */
export const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `GET /v1/faturamento/notas`: filtros na URL (o BKO mantém o link). `de` e `ate` são datas civis do fuso do tenant. */
export const FiltroNotas = ConsultaPaginada.extend({
  filial_id: Uuid.optional(),
  cliente_id: Uuid.optional(),
  pedido_id: Uuid.optional(),
  status: StatusNota.optional(),
  ambiente: Ambiente.optional(),
  serie: z.coerce.number().int().min(0).max(999).optional(),
  numero: z.coerce.number().int().min(1).max(999_999_999).optional(),
  de: DataCivil.optional(),
  ate: DataCivil.optional(),
});
export type FiltroNotas = z.infer<typeof FiltroNotas>;

/** Status do pedido na fila de faturamento (`faturamento.pedido_a_faturar.status`). */
export const StatusPedidoAFaturar = z.enum(['a_faturar', 'faturado_parcial', 'faturado', 'cancelado']);
export type StatusPedidoAFaturar = z.infer<typeof StatusPedidoAFaturar>;

/** `GET /v1/faturamento/pedidos-a-faturar` (RF-FAT-01): por padrão só `a_faturar` e `faturado_parcial`. `de`/`ate` = data do recebimento (fuso do tenant). */
export const FiltroPedidosAFaturar = ConsultaPaginada.extend({
  filial_id: Uuid.optional(),
  cliente_id: Uuid.optional(),
  status: StatusPedidoAFaturar.optional(),
  de: DataCivil.optional(),
  ate: DataCivil.optional(),
});
export type FiltroPedidosAFaturar = z.infer<typeof FiltroPedidosAFaturar>;

export const PedidoAFaturarResumo = z.object({
  id: Uuid,
  pedido_id: Uuid,
  numero: z.number().int().nullable(),
  filial_id: Uuid,
  cliente_id: Uuid,
  cliente_razao_social: z.string().nullable(),
  status: StatusPedidoAFaturar,
  total_centavos: Centavos,
  recebido_em: z.string().datetime(),
});
export type PedidoAFaturarResumo = z.infer<typeof PedidoAFaturarResumo>;

/** `PUT /v1/faturamento/filiais/:id/configuracao` (só administrador; `Idempotency-Key` obrigatória). Desligada por padrão. A nota segue de homologação no XML (tpAmb 2, "SEM VALOR FISCAL"). */
export const ConfigurarFilialEntrada = z.object({ faturamento_real_nfe_simulada: z.boolean() });
export type ConfigurarFilialEntrada = z.infer<typeof ConfigurarFilialEntrada>;

// ---- Títulos a receber (RF-FAT-07, RN-FAT-06) ----
export const StatusTitulo = z.enum(['aberto', 'baixado', 'cancelado']);
export type StatusTitulo = z.infer<typeof StatusTitulo>;

/** `GET /v1/faturamento/titulos`: filtros na URL. `vencimento_de` e `vencimento_ate` são datas civis (inclusivas). */
export const FiltroTitulos = ConsultaPaginada.extend({
  cliente_id: Uuid.optional(),
  nota_id: Uuid.optional(),
  status: StatusTitulo.optional(),
  ambiente: Ambiente.optional(),
  vencimento_de: DataCivil.optional(),
  vencimento_ate: DataCivil.optional(),
});
export type FiltroTitulos = z.infer<typeof FiltroTitulos>;

export const TituloResumo = z.object({
  id: Uuid,
  nota_id: Uuid,
  filial_id: Uuid,
  /** Número da nota (série na `nota`); razão social do retrato do destinatário gravado na nota. */
  numero: z.number().int().min(1),
  cliente_id: Uuid,
  cliente_razao_social: z.string().nullable(),
  ambiente: Ambiente,
  parcela: z.number().int().min(1),
  total_parcelas: z.number().int().min(1),
  vencimento: DataCivil,
  valor_centavos: Centavos,
  saldo_centavos: Centavos,
  status: StatusTitulo,
});
export type TituloResumo = z.infer<typeof TituloResumo>;

export const BaixaTituloResumo = z.object({
  id: Uuid,
  titulo_id: Uuid,
  valor_centavos: Centavos,
  forma: z.string(),
  baixado_em: z.string().datetime(),
  estornada_em: z.string().datetime().nullable(),
});
export type BaixaTituloResumo = z.infer<typeof BaixaTituloResumo>;

export const TituloDetalhe = TituloResumo.extend({ baixas: z.array(BaixaTituloResumo) });
export type TituloDetalhe = z.infer<typeof TituloDetalhe>;

/** `POST /v1/faturamento/titulos/:id/baixas` (`data_baixa` opcional: sem ela, hoje no fuso do tenant; `Idempotency-Key` obrigatória). */
export const BaixarTituloEntrada = z.object({
  valor_centavos: z.number().int().min(1),
  /** Data civil da baixa (fuso do tenant), não futura; sem ela, hoje. */
  data_baixa: DataCivil.optional(),
  /** Forma do recebimento (até 30 caracteres); sem ela, `manual`. */
  forma: z.string().trim().min(1).max(30).default('manual'),
});
export type BaixarTituloEntrada = z.infer<typeof BaixarTituloEntrada>;

/** `GET /v1/faturamento/rejeicoes` (RF-FAT-08): notas rejeitadas com o código, a mensagem e a ação sugerida da SEFAZ. */
export const FiltroRejeicoes = ConsultaPaginada.extend({ filial_id: Uuid.optional() });
export type FiltroRejeicoes = z.infer<typeof FiltroRejeicoes>;

export const RejeicaoNota = z.object({
  id: Uuid,
  filial_id: Uuid,
  pedido_id: Uuid.nullable(),
  /** A lista de rejeições mostra o selo de homologação (RN-FAT-04). */
  ambiente: Ambiente,
  serie: z.number().int(),
  numero: z.number().int().nullable(),
  codigo: z.string().nullable(),
  mensagem: z.string().nullable(),
  acao_sugerida: z.string(),
  rejeitada_em: z.string().datetime(),
  /** Mesmos campos opcionais da `NotaResumo` (pendentes na API). */
  filial_nome: z.string().nullable().optional(),
  pedido_numero: z.number().int().nullable().optional(),
});
export type RejeicaoNota = z.infer<typeof RejeicaoNota>;

/** Trabalho do worker (`plataforma.trabalho`): transmitir a nota `em_autorizacao` (ou reconciliar a guarda pendente). */
export const TRABALHO_TRANSMITIR_NOTA = 'faturamento.transmitir_nota' as const;
export const TransmitirNotaPayload = z.object({ nota_id: Uuid });
export type TransmitirNotaPayload = z.infer<typeof TransmitirNotaPayload>;

// ---- Eventos fiscais (T-0021, lote 2): cancelamento, CC-e, inutilização e consulta (RN-FAT-01, RN-FAT-02, RN-FAT-03) ----

/** Limites de caracteres (após o trim) dos textos dos eventos fiscais: a tela e a API leem daqui (RN-FAT-02, RN-FAT-01). */
export const LIMITES_TEXTO = { justificativa: { min: 15, max: 255 }, cartaCorrecao: { min: 15, max: 1000 } } as const;

/** `POST /v1/faturamento/notas/:id/cancelar`: só nota autorizada, até 24 h da autorização (RN-FAT-02). */
export const CancelarNotaEntrada = z.object({ justificativa: z.string().trim().min(LIMITES_TEXTO.justificativa.min).max(LIMITES_TEXTO.justificativa.max) });
export type CancelarNotaEntrada = z.infer<typeof CancelarNotaEntrada>;

/** `POST /v1/faturamento/notas/:id/carta-correcao`: só nota autorizada, até 20 por nota (RN-FAT-02). */
export const CartaCorrecaoEntrada = z.object({ texto: z.string().trim().min(LIMITES_TEXTO.cartaCorrecao.min).max(LIMITES_TEXTO.cartaCorrecao.max) });
export type CartaCorrecaoEntrada = z.infer<typeof CartaCorrecaoEntrada>;

/** `POST /v1/faturamento/inutilizacoes`: faixa da série da filial emissora (RN-FAT-01). Sem `serie` = a da filial; sem `ano` = o do ano corrente (Manaus). */
export const InutilizarEntrada = z
  .object({
    filial_id: Uuid,
    serie: z.number().int().min(0).max(999).optional(),
    numero_inicial: z.number().int().min(1).max(999_999_999),
    numero_final: z.number().int().min(1).max(999_999_999),
    ano: z.number().int().min(2000).max(2099).optional(),
    justificativa: z.string().trim().min(LIMITES_TEXTO.justificativa.min).max(LIMITES_TEXTO.justificativa.max),
  })
  .refine((e) => e.numero_inicial <= e.numero_final, { message: 'o número inicial não pode ser maior que o final', path: ['numero_final'] });
export type InutilizarEntrada = z.infer<typeof InutilizarEntrada>;

export const StatusEvento = z.enum(['pendente', 'registrado', 'rejeitado']);
export type StatusEvento = z.infer<typeof StatusEvento>;

/** Evento da nota (`GET /notas/:id/eventos`). */
export const EventoNotaResumo = z.object({
  id: Uuid,
  nota_id: Uuid,
  tipo: z.enum(['cancelamento', 'cce']),
  n_seq_evento: z.number().int().min(1).max(20),
  texto: z.string(),
  status: StatusEvento,
  protocolo: z.string().nullable(),
  c_stat: z.number().int().nullable(),
  x_motivo: z.string().nullable(),
  registrado_em: z.string().datetime().nullable(),
  criado_em: z.string().datetime(),
});
export type EventoNotaResumo = z.infer<typeof EventoNotaResumo>;

export const InutilizacaoResumo = z.object({
  id: Uuid,
  filial_id: Uuid,
  ambiente: Ambiente,
  serie: z.number().int(),
  ano: z.number().int(),
  numero_inicial: z.number().int(),
  numero_final: z.number().int(),
  justificativa: z.string(),
  status: StatusEvento,
  protocolo: z.string().nullable(),
  c_stat: z.number().int().nullable(),
  x_motivo: z.string().nullable(),
  registrado_em: z.string().datetime().nullable(),
});
export type InutilizacaoResumo = z.infer<typeof InutilizacaoResumo>;

/** Trabalhos do worker (`plataforma.trabalho`): a API só grava o pedido `pendente` e enfileira; a SEFAZ é chamada pelo worker. */
export const TRABALHO_PROCESSAR_EVENTO = 'faturamento.processar_evento' as const;
export const ProcessarEventoPayload = z.object({ evento_id: Uuid });
export type ProcessarEventoPayload = z.infer<typeof ProcessarEventoPayload>;
export const TRABALHO_PROCESSAR_INUTILIZACAO = 'faturamento.processar_inutilizacao' as const;
export const ProcessarInutilizacaoPayload = z.object({ inutilizacao_id: Uuid });
export type ProcessarInutilizacaoPayload = z.infer<typeof ProcessarInutilizacaoPayload>;
export const TRABALHO_CONSULTAR_NOTA = 'faturamento.consultar_nota' as const;
export const ConsultarNotaPayload = z.object({ nota_id: Uuid });
export type ConsultarNotaPayload = z.infer<typeof ConsultarNotaPayload>;
