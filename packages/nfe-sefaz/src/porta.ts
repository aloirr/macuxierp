/**
 * Porta `SefazTransporte`: a conversa com o autorizador da NF-e 4.00 (real ou simulador), já com o XML assinado.
 * Fica ABAIXO da porta `EmissorNFe` da ADR 0002: o emissor monta e assina (T-0018/T-0021) e entrega ao transporte.
 *
 * Contrato (desenho docs/desenho/T-0045.md, seção 3):
 * - Pedido fora do schema: `ErroSefaz('SEFAZ_PEDIDO_INVALIDO')`, nada sai para a SEFAZ.
 * - Rejeição da SEFAZ volta na resposta (`cStat`/`xMotivo`), NUNCA como exceção.
 * - Rede, TLS, tempo esgotado ou SOAP ilegível: `FalhaTransporteSefaz` (com `retentavel`).
 * - Toda resposta traz o XML de retorno (`xml`) e, por protocolo, o XML do protocolo, para a guarda (regra 7: o XML
 *   autorizado é guardado antes de qualquer outra coisa). Os campos seguem os nomes das tags do XML.
 * - Datas (`dhRecbto`, `dhRegEvento`) ficam no texto da SEFAZ (com deslocamento); quem grava converte para UTC.
 */
import { z } from 'zod';
import { TpAmb } from './ambiente';
import { ehDataHoraSefaz } from './datas';
import type { DestinoSefaz } from './destino';
import { ErroSefaz } from './erros';

const digitos = (n: number) => z.string().regex(new RegExp(`^\\d{${n}}$`), `${n} dígitos`);

/** Código de status da SEFAZ (3 dígitos). Ex.: 100 autorizado, 104 lote processado, 107 serviço em operação. */
export const CStat = digitos(3);
/**
 * Chave de acesso (44 posições): o CNPJ do emitente (posições 7 a 20) pode ser alfanumérico desde jul/2026, como no
 * `TChNFe` do PL_010g (`[0-9]{6}[0-9A-Z]{12}[0-9]{26}`). O DV é conferido por `chaveNFeComDvValido`, não aqui.
 */
export const ChaveNFe = z.string().regex(/^\d{6}[0-9A-Z]{12}\d{26}$/, 'chave de 44 posições (CNPJ alfanumérico aceito)');
/** Número do protocolo (15 dígitos). */
export const NProt = digitos(15);
/** Número do recibo do lote assíncrono (15 dígitos). */
export const NRec = digitos(15);
/** Identificador do lote, escolhido pelo emissor (1 a 15 dígitos). Idempotência: um lote por tentativa registrada. */
export const IdLote = z.string().regex(/^\d{1,15}$/, '1 a 15 dígitos');
/** `digVal`: o DigestValue da assinatura da NF-e (base64), devolvido no protocolo. */
export const DigVal = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'base64');
export const DataHoraSefaz = z.string().refine(ehDataHoraSefaz, 'AAAA-MM-DDThh:mm:ssTZD');
/**
 * Teto da mensagem da SEFAZ: 500 KB (Manual de Orientação; acima disso a SEFAZ devolve 214). Vale por documento no
 * contrato (`XmlTexto`) e para o lote inteiro no transporte (o simulador devolve 214).
 */
export const TAMANHO_MAXIMO_XML_SEFAZ = 500_000;
/** XML como texto (UTF-8). No pedido: o documento JÁ ASSINADO; na resposta: o retorno da SEFAZ, sem alteração. */
export const XmlTexto = z.string().min(1).max(TAMANHO_MAXIMO_XML_SEFAZ);

/** Códigos dos eventos da NF-e que a v1 usa. */
export const TIPO_EVENTO = Object.freeze({ cartaCorrecao: '110110', cancelamento: '110111' } as const);
export const TipoEvento = z.enum([TIPO_EVENTO.cartaCorrecao, TIPO_EVENTO.cancelamento]);
export type TipoEvento = z.infer<typeof TipoEvento>;

const RetornoBase = z.object({
  tpAmb: TpAmb,
  verAplic: z.string(),
  cStat: CStat,
  xMotivo: z.string(),
});

/** `protNFe`: o protocolo de uma NF-e (autorizada, denegada ou rejeitada). `nProt`/`digVal` nulos na rejeição. */
export const ProtocoloNFe = RetornoBase.extend({
  chNFe: ChaveNFe,
  dhRecbto: DataHoraSefaz,
  nProt: NProt.nullable(),
  digVal: DigVal.nullable(),
  /** O `<protNFe>` inteiro, como veio: vai junto da NF-e no `nfeProc` guardado. */
  xml: XmlTexto,
});
export type ProtocoloNFe = z.infer<typeof ProtocoloNFe>;

/** `retEvento`: o protocolo de um evento (cancelamento, CC-e). */
export const ProtocoloEvento = RetornoBase.extend({
  chNFe: ChaveNFe,
  tpEvento: TipoEvento,
  nSeqEvento: z.number().int().min(1).max(20),
  dhRegEvento: DataHoraSefaz,
  nProt: NProt.nullable(),
  xml: XmlTexto,
});
export type ProtocoloEvento = z.infer<typeof ProtocoloEvento>;

// ---------- autorizar (NFeAutorizacao4) ----------

/**
 * `enviNFe`: síncrono leva 1 NF-e e já volta com o protocolo; assíncrono leva até 50 e volta com o recibo. Cada NF-e
 * até `TAMANHO_MAXIMO_XML_SEFAZ`; o lote acima do teto é rejeitado pela SEFAZ com 214.
 */
export const PedidoAutorizacao = z
  .object({
    idLote: IdLote,
    sincrono: z.boolean(),
    nfes: z.array(XmlTexto).min(1).max(50),
  })
  .strict()
  .refine((p) => !p.sincrono || p.nfes.length === 1, { message: 'lote síncrono leva uma NF-e só', path: ['nfes'] });
export type PedidoAutorizacao = z.infer<typeof PedidoAutorizacao>;

export const Recibo = z.object({ nRec: NRec, tMed: z.number().int().nonnegative() });
export type Recibo = z.infer<typeof Recibo>;

/** `retEnviNFe`: `recibo` só no assíncrono aceito (103); `protocolos` só no síncrono processado (104). */
export const RespostaAutorizacao = RetornoBase.extend({
  cUF: z.number().int(),
  dhRecbto: DataHoraSefaz,
  recibo: Recibo.nullable(),
  protocolos: z.array(ProtocoloNFe),
  xml: XmlTexto,
});
export type RespostaAutorizacao = z.infer<typeof RespostaAutorizacao>;

// ---------- consultarRecibo (NFeRetAutorizacao4) ----------

export const PedidoConsultaRecibo = z.object({ nRec: NRec }).strict();
export type PedidoConsultaRecibo = z.infer<typeof PedidoConsultaRecibo>;

/** `retConsReciNFe`: 104 com os protocolos; 105 ainda em processamento (consultar de novo depois de `tMed`). */
export const RespostaConsultaRecibo = RetornoBase.extend({
  cUF: z.number().int(),
  nRec: NRec,
  dhRecbto: DataHoraSefaz.nullable(),
  protocolos: z.array(ProtocoloNFe),
  xml: XmlTexto,
});
export type RespostaConsultaRecibo = z.infer<typeof RespostaConsultaRecibo>;

// ---------- consultarProtocolo (NFeConsultaProtocolo4) ----------

export const PedidoConsultaProtocolo = z.object({ chNFe: ChaveNFe }).strict();
export type PedidoConsultaProtocolo = z.infer<typeof PedidoConsultaProtocolo>;

/** `retConsSitNFe`: a situação atual da NF-e, o protocolo de autorização e os eventos registrados. */
export const RespostaConsultaProtocolo = RetornoBase.extend({
  cUF: z.number().int(),
  chNFe: ChaveNFe,
  dhRecbto: DataHoraSefaz,
  protocolo: ProtocoloNFe.nullable(),
  eventos: z.array(ProtocoloEvento),
  xml: XmlTexto,
});
export type RespostaConsultaProtocolo = z.infer<typeof RespostaConsultaProtocolo>;

// ---------- statusServico (NFeStatusServico4) ----------

/** `retConsStatServ`: 107 em operação; 108/109 paralisado (aciona a contingência, desenho §3.5). */
export const RespostaStatusServico = RetornoBase.extend({
  cUF: z.number().int(),
  dhRecbto: DataHoraSefaz,
  tMed: z.number().int().nonnegative().nullable(),
  dhRetorno: DataHoraSefaz.nullable(),
  xObs: z.string().nullable(),
  xml: XmlTexto,
});
export type RespostaStatusServico = z.infer<typeof RespostaStatusServico>;

// ---------- cancelar (110111) e cartaCorrecao (110110) (NFeRecepcaoEvento4) ----------

/** `envEvento` com um `<evento>` JÁ ASSINADO. O transporte confere que o `tpEvento` é o da operação chamada. */
export const PedidoEvento = z.object({ idLote: IdLote, eventoAssinado: XmlTexto }).strict();
export type PedidoEvento = z.infer<typeof PedidoEvento>;

/** `retEnvEvento`: 128 lote processado, com um `ProtocoloEvento` por evento (135/136 registrado). */
export const RespostaEvento = RetornoBase.extend({
  cOrgao: z.number().int(),
  idLote: IdLote,
  eventos: z.array(ProtocoloEvento),
  xml: XmlTexto,
});
export type RespostaEvento = z.infer<typeof RespostaEvento>;

// ---------- inutilizar (NFeInutilizacao4) ----------

/** `<inutNFe>` JÁ ASSINADO. Único jeito de abrir buraco na numeração (regra 7). Não existe em contingência SVC. */
export const PedidoInutilizacao = z.object({ inutilizacaoAssinada: XmlTexto }).strict();
export type PedidoInutilizacao = z.infer<typeof PedidoInutilizacao>;

/** `retInutNFe`: 102 inutilização homologada (com `nProt`); demais códigos, rejeição. */
export const RespostaInutilizacao = RetornoBase.extend({
  cUF: z.number().int(),
  dhRecbto: DataHoraSefaz,
  nProt: NProt.nullable(),
  ano: digitos(2).nullable(),
  CNPJ: digitos(14).nullable(),
  mod: z.literal('55').nullable(),
  serie: z.number().int().min(0).max(999).nullable(),
  nNFIni: z.number().int().positive().nullable(),
  nNFFin: z.number().int().positive().nullable(),
  xml: XmlTexto,
});
export type RespostaInutilizacao = z.infer<typeof RespostaInutilizacao>;

// ---------- a porta ----------

/**
 * Transporte até o autorizador de UM destino (filial emissora + ambiente + modo). Obtido só pelo seletor
 * (`criarSeletorTransporte`) ou, nos testes, por `criarSimuladorSefaz` com um destino de homologação.
 */
export interface SefazTransporte {
  /** Destino congelado escolhido por `escolherDestinoSefaz` (ambiente, tpAmb, UF, modo, endereços ou simulador). */
  readonly destino: DestinoSefaz;
  autorizar(pedido: PedidoAutorizacao): Promise<RespostaAutorizacao>;
  consultarRecibo(pedido: PedidoConsultaRecibo): Promise<RespostaConsultaRecibo>;
  consultarProtocolo(pedido: PedidoConsultaProtocolo): Promise<RespostaConsultaProtocolo>;
  statusServico(): Promise<RespostaStatusServico>;
  /** Evento 110111. */
  cancelar(pedido: PedidoEvento): Promise<RespostaEvento>;
  /** Evento 110110 (CC-e). */
  cartaCorrecao(pedido: PedidoEvento): Promise<RespostaEvento>;
  inutilizar(pedido: PedidoInutilizacao): Promise<RespostaInutilizacao>;
}

/**
 * Valida o pedido contra o schema antes de qualquer envio. Implementações da porta (real e simulador) chamam isto
 * no início de cada operação. A mensagem cita só os caminhos dos campos, nunca o conteúdo (pode haver XML de cliente).
 */
export function validarPedidoSefaz<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, pedido: unknown): T {
  const r = schema.safeParse(pedido);
  if (r.success) return r.data;
  const campos = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(raiz)'))].join(', ');
  throw new ErroSefaz('SEFAZ_PEDIDO_INVALIDO', `Pedido à SEFAZ fora do contrato: ${campos}`);
}
