/**
 * Portas do faturamento (só interfaces; rotas e repositório entram com a migração 0013 do banco-dados, T-0019).
 * Nada daqui importa a api nem o domain de outro módulo: as implementações vêm de fora (pedido, cadastros,
 * fiscal, core e o simulador da SEFAZ) e os tipos "DUBLÊ" saem quando os contratos chegarem.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { Ambiente, TipoEmissao } from '../contracts';
import type { CalculoFiscalItem, Crt, EnderecoXml, IndIeDest, SituacaoPedido } from '../domain';

/** Implementação no `pedido/api` (`criarConsultaParaFaturar`, T-0015). Lê com `FOR SHARE` (T-0013 §8.1). */
export interface SituacaoPedidoParaFaturar {
  situacao(tx: Transacao, pedido_id: string): Promise<SituacaoPedido | null>;
}

/** Porta inversa, implementada AQUI e consumida pelo cancelamento do pedido (P-2): nota `em_autorizacao` bloqueia o cancelamento. */
export interface NotaEmAberto {
  temNotaEmAutorizacao(tx: Transacao, pedido_id: string): Promise<boolean>;
}

// DUBLÊ até T-0020 (`fiscal.calculo@1`).
export interface EntradaCalculoFiscal {
  ambiente: Ambiente;
  filial_id: string;
  cliente_id: string;
  itens: { sequencia: number; produto_id: string; quantidade: number; valor_centavos: number; desconto_centavos: number; frete_centavos: number }[];
}
export interface CalculoFiscal {
  calcular(tx: Transacao, entrada: EntradaCalculoFiscal): Promise<CalculoFiscalItem[]>;
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
