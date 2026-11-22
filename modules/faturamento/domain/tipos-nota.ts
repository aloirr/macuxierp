/** Tipos do retrato da nota (emitente e destinatário), sem dependência de outras peças do domain. */
import type { Crt as CrtFiscal } from '@macuxierp/fiscal/contracts';
import type { NotaItemMontado } from './nota';
import type { CobrancaXml, PagamentoXml } from './pagamento';

/** CRT do emitente, do contrato do fiscal (1, 2, 3 e 4/MEI); indIEDest do destinatário (no retrato vem como texto). */
export type Crt = CrtFiscal;
export type IndIeDest = 1 | 2 | 9;
export interface EnderecoNota {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio_ibge: string;
  /** Nulo = município sem nome no cadastro: violação antes da reserva do número (xMun é obrigatório). */
  municipio_nome: string | null;
  uf: string;
  cep: string;
}
export interface DestinatarioNota {
  documento: string;
  nome: string;
  ind_ie_dest: IndIeDest;
  ie?: string | null;
  endereco: EnderecoNota;
}


/** Conteúdo gravado da nota (retratos, itens com o cálculo fiscal, pagamento e transporte). */
export interface EmitenteNota {
  cnpj: string;
  nome: string;
  fantasia?: string | null;
  ie: string;
  /** 1 Simples, 2 excesso de sublimite, 3 regime normal, 4 MEI (NT 2024.001). */
  crt: Crt;
  endereco: EnderecoNota;
}
export interface ConteudoNota {
  natOp: string;
  emitente: EmitenteNota;
  destinatario: DestinatarioNota;
  /** 0 emitente (CIF), 1 destinatário (FOB), 9 sem frete. */
  modFrete: 0 | 1 | 2 | 3 | 4 | 9;
  /** Informações complementares (infAdic/infCpl): a observação do pedido. */
  infCpl: string | null;
  /** Itens como o pedido os solicitou (nulo = nota total do saldo): o reenvio refaz a nota com os mesmos itens. */
  itensSolicitados: { sequencia: number; quantidade?: number }[] | null;
  pagamentos: PagamentoXml[];
  /** Só no boleto (15): parcelas de `cobr/dup`. */
  cobranca: CobrancaXml | null;
  itens: NotaItemMontado[];
}

