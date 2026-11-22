/**
 * Portas do faturamento (só interfaces; rotas e repositório SQL entram com a migração 0013 do banco-dados, T-0019, e o @macuxierp/nfe-sefaz, T-0045).
 * Nada daqui importa a api nem o domain de outro módulo: as implementações vêm de fora (pedido, cadastros,
 * fiscal, core e o simulador da SEFAZ) e os tipos "DUBLÊ" saem quando os contratos chegarem.
 */
import type { CalculoSaida, ErroFiscal } from '@macuxierp/fiscal/contracts';
import type { Transacao } from '@macuxierp/platform-sdk';
import type { Ambiente, StatusNota, TipoEmissao } from '../contracts';
import type { Crt, EnderecoXml, IndIeDest, PedidoFaturavel, SituacaoPedido } from '../domain';

/** Implementação no `pedido/api` (`criarConsultaParaFaturar`, T-0015). Lê com `FOR SHARE` (T-0013 §8.1). */
export interface SituacaoPedidoParaFaturar {
  situacao(tx: Transacao, pedido_id: string): Promise<SituacaoPedido | null>;
}

/** Porta inversa, implementada AQUI e consumida pelo cancelamento do pedido (P-2): nota `em_autorizacao` bloqueia o cancelamento. */
export interface NotaEmAberto {
  temNotaEmAutorizacao(tx: Transacao, pedido_id: string): Promise<boolean>;
}

/** Pedido aprovado como a fila "a faturar" o guarda (payload de `pedido.pedido.aprovado@1`, sem ler o schema `pedido`). */
export interface PedidosAprovados {
  obter(tx: Transacao, pedido_id: string): Promise<PedidoFaturavel | null>;
}

/** Entrada do adaptador do cálculo fiscal (o fiscal.calculo@1 exige mais: regras, origem, CFOP; quem implementa a porta os busca). */
export interface EntradaCalculoFiscal {
  ambiente: Ambiente;
  filial_id: string;
  pedido: PedidoFaturavel;
  /** Data civil de emissão (AAAA-MM-DD, fuso do tenant): decide a vigência das regras (RN-FIS-04). */
  data_emissao: string;
  itens: { sequencia: number; produto_id: string; ncm: string; quantidade: number; preco_unitario_centavos: number; valor_centavos: number; desconto_centavos: number; frete_centavos: number; outras_centavos: number }[];
}
export type ResultadoCalculoFiscal =
  | { ok: true; saida: CalculoSaida; /** CFOP por sequência: o contrato do cálculo o recebe e não o devolve. */ cfops: Record<number, string> }
  | { ok: false; erros: ErroFiscal[] };
/** Implementada sobre `fiscal.calculo@1` (motor puro do fiscal + regras buscadas pela API). Os `item_id` do cálculo são `String(sequencia)`. */
export interface CalculoFiscal {
  calcular(tx: Transacao, entrada: EntradaCalculoFiscal): Promise<ResultadoCalculoFiscal>;
}

// DUBLÊ até T-0045 (@macuxierp/nfe-sefaz): nomes e operações alinhados ao contrato da T-0045. O faturamento recebe a
// porta pronta do worker (já ligada a tenant, filial e ambiente; em teste e homologação o destino é sempre o simulador).
export interface ContextoSefaz {
  tenant_id: string;
  filial_id: string;
  ambiente: Ambiente;
}
/** DUBLÊ até T-0045 (@macuxierp/nfe-sefaz). `xml` traz o `nfeProc`/retorno bruto quando há; o `nfeProc` autorizado é o que se guarda em `nota_xml` (RN-FAT-03). */
export interface RespostaSefaz {
  cStat: string;
  xMotivo: string;
  nProt?: string;
  digVal?: string;
  dhRecbto?: string;
  xml?: string;
}
/** DUBLÊ até T-0045 (@macuxierp/nfe-sefaz). */
export interface PedidoAutorizacao {
  xmlAssinado: string;
  tpEmis: TipoEmissao;
}
/** DUBLÊ até T-0045 (@macuxierp/nfe-sefaz). Evento já assinado (cancelamento ou CC-e). */
export interface PedidoEvento {
  chNFe: string;
  eventoAssinado: string;
}
/** DUBLÊ até T-0045 (@macuxierp/nfe-sefaz). `autorizar` devolve o recibo; o resultado vem de `consultarRecibo` (cStat 104 → protNFe). */
export interface SefazTransporte {
  autorizar(pedido: PedidoAutorizacao): Promise<RespostaSefaz & { nRec: string }>;
  consultarRecibo(p: { nRec: string }): Promise<RespostaSefaz>;
  consultarProtocolo(p: { chNFe: string }): Promise<RespostaSefaz>;
  statusServico(): Promise<RespostaSefaz>;
  cancelar(pedido: PedidoEvento): Promise<RespostaSefaz>;
  cartaCorrecao(pedido: PedidoEvento): Promise<RespostaSefaz>;
  inutilizar(p: { inutilizacaoAssinada: string }): Promise<RespostaSefaz>;
}

export interface FilialEmissora {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  ie: string;
  crt: Crt;
  endereco: EnderecoXml;
  emissora: boolean;
  nfe_serie: number | null;
}
export interface ClienteDestinatario {
  id: string;
  documento: string;
  nome: string;
  ind_ie_dest: IndIeDest;
  ie: string | null;
  endereco: EnderecoXml;
  email: string | null;
}
/** Implementada sobre os contratos de `cadastros` (sem ler tabela de outro schema). */
export interface ConsultaCadastrosFaturamento {
  filial(tx: Transacao, filial_id: string): Promise<FilialEmissora | null>;
  cliente(tx: Transacao, cliente_id: string): Promise<ClienteDestinatario | null>;
  /** Nome do município pelo código IBGE (xMun do destinatário; o retrato do pedido só traz o código). */
  municipioNome(tx: Transacao, ibge: string): Promise<string | null>;
  /** Número inicial da série da filial (RF-CAD-08); o `faturamento.reservar_numero` o recebe do app. */
  numeroInicial(tx: Transacao, filial_id: string, serie: number): Promise<number | null>;
}

/** Ambiente fiscal da filial (`core.ambiente_fiscal`; sem linha = homologação, ADR 0006). Só leitura. */
export interface AmbienteFiscalDaFilial {
  ambiente(tx: Transacao, filial_id: string): Promise<Ambiente>;
}

/** Assina o XML com o A1 da filial. O certificado e a senha são decifrados só dentro da implementação, na memória. */
export interface AssinadorA1 {
  assinar(ctx: ContextoSefaz, xml: string, idInfNFe: string): Promise<string>;
}

/** Nota gravada (o que o repositório devolve). Sem XML: o XML vive em `nota_xml`. */
export interface NotaRegistro {
  id: string;
  tenant_id: string;
  pedido_id: string;
  pedido_uuid: string | null;
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
  ambiente: Ambiente;
  /** RN-FAT-04: só produção vira faturamento no FDV. */
  vai_ao_fdv: boolean;
  serie: number;
  numero: number;
  cnf: string;
  chave_acesso: string;
  tp_emis: TipoEmissao;
  status: StatusNota;
  emitida_em: string;
  total_centavos: number;
  protocolo: string | null;
  idempotencia: string;
  /** Itens como o pedido os solicitou (nulo = nota total do saldo): o reenvio da rejeitada refaz a nota com os mesmos itens. */
  itens_solicitados: { sequencia: number; quantidade?: number }[] | null;
  itens: { sequencia: number; quantidade: number; valor_centavos: number }[];
}
export type NovaNota = Omit<NotaRegistro, 'id' | 'status' | 'protocolo'>;

export interface DadosMudancaStatus {
  protocolo?: string;
  cStat?: string;
  xMotivo?: string;
}

/**
 * Repositório SQL das notas (implementação com a migração 0013 do banco-dados, T-0019). TODAS as operações rodam na MESMA
 * transação `tx` recebida: número, nota, XML, mudança de status e evento confirmam ou desfazem juntos.
 */
export interface RepositorioNotas {
  /**
   * Para a 0013: `UNIQUE (tenant_id, idempotencia_chave)` em `nota` (RN-CORE-05). O `pedido_id` NÃO é único por nota: o faturamento
   * parcial gera várias notas do mesmo pedido.
   */
  buscarPorIdempotencia(tx: Transacao, tenant_id: string, idempotencia: string): Promise<NotaRegistro | null>;
  /** XML assinado da nota (o mais recente), para a repetição idempotente devolver o mesmo XML; nulo se não houver. */
  lerXml(tx: Transacao, nota_id: string): Promise<string | null>;
  /** Próximo número da série da filial, sem buraco (RN-FAT-01): `numeroInicial` só vale na 1ª reserva da série. */
  reservarNumero(tx: Transacao, tenant_id: string, filial_id: string, serie: number, numeroInicial: number): Promise<number>;
  /** Grava a nota em `rascunho`. */
  gravarNota(tx: Transacao, nota: NovaNota): Promise<NotaRegistro>;
  /**
   * Reenvio (RN-FAT-07): regrava total, itens e o XML assinado da nota `rejeitada` (ou `rascunho`) na mesma tx. Número, série, cNF e
   * chave NUNCA mudam; em outro status lança. O banco recusa também (trigger).
   */
  atualizarConteudo(tx: Transacao, nota_id: string, dados: { total_centavos: number; itens: NotaRegistro['itens']; xml: string }): Promise<void>;
  /** Valida a transição no banco também (CHECK/trigger); lança se `de` não for o status atual. */
  mudarStatus(tx: Transacao, nota_id: string, de: StatusNota, para: StatusNota, dados?: DadosMudancaStatus): Promise<void>;
  /** `assinado` pode ser reescrito no reenvio; `autorizado` (nfeProc) é imutável e só entra uma vez (RN-FAT-03). Falha = lança, e a tx continua usável (savepoint). */
  guardarXml(tx: Transacao, nota_id: string, xml: { tipo: 'assinado' | 'autorizado'; conteudo: string; protocolo?: string }): Promise<void>;
  /** Outbox: grava `nome` (ex.: `faturamento.nota.autorizada@1`) com o `payload` já validado pelo contrato. */
  publicarEvento(tx: Transacao, evento: { nome: string; agregado_id: string; payload: Record<string, unknown> }): Promise<void>;
}
