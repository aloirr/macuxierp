/**
 * Montagem dos eventos da NF-e (cancelamento 110111, CC-e 110110 e EPEC 110140, leiaute 1.00) e da inutilização (leiaute 4.00),
 * sem assinatura e na forma canônica, para o `assinarDocumento` (`infEvento`/`infInut`). Função pura.
 * `Id`, `descEvento` e `xCondUso` vêm do `@macuxierp/nfe-sefaz` (fonte única com o simulador e os testes).
 * A nota autorizada nunca é editada (regra 7): cancelamento e correção são eventos; buraco na numeração só por
 * inutilização. Quem decide quando emitir cada um é o faturamento (T-0021); aqui só se monta o XML.
 *
 * Porte em TypeScript da lógica do sped-nfe (`NFePHP\NFe\Tools::sefazCancela`, `sefazCCe`, `sefazInutiliza`),
 * opção MIT, com atribuição: Copyright (c) NFePHP — https://github.com/nfephp-org/sped-nfe.
 */
import { z } from 'zod';
import {
  C_ORGAO_AN,
  ChaveNFe,
  DESC_EVENTO,
  IdLote,
  NS_NFE,
  TIPO_EVENTO,
  TP_EMIS_EPEC,
  X_COND_USO_CCE,
  XmlTexto,
  chaveNFeComDvValido,
  dadosEpecDaNFe,
  dataHoraSefaz,
  idEvento,
  idInutilizacao,
  lerChaveNFe,
  tpEmisDaNFe,
  type TipoEvento,
} from '@macuxierp/nfe-sefaz';
import { CnpjXml, Texto } from './entrada';
import { ErroMontagemNFe, validarEntrada } from './montar';
import { el, grupo, opt, serializar } from './xml';
import type { Elemento } from './xml';

const BaseEvento = z.object({
  /** Chave de acesso (CNPJ alfanumérico aceito, como no `ChaveNFe` do contrato), com o DV conferido. */
  chNFe: ChaveNFe.refine(chaveNFeComDvValido, 'chave com DV inválido'),
  /** CNPJ do autor (o emitente). */
  cnpj: CnpjXml,
  tpAmb: z.union([z.literal(1), z.literal(2)]),
  /** Instante do evento (UTC); vai no XML com o deslocamento da filial. */
  dhEvento: z.date(),
  /** Deslocamento do fuso da filial em minutos (AM = -240), obrigatório como na `NotaParaEmissao`: sem padrão fixo. */
  fusoMinutos: z.number().int().min(-720).max(840),
  /**
   * `idLote` do `envEvento` (só a porta usa; não vai no `<evento>`). Sem ele, a porta usa `dhEvento` em milissegundos.
   * A retentativa só sai idêntica (mesmo `dhEvento`, mesmo lote, mesmo XML) se o chamador guardar o pedido
   * (`dhEvento` ou `idLote`) antes de transmitir e reenviar o pedido guardado; montar um pedido novo com o relógio
   * gera outro `dhEvento` e outro lote.
   */
  idLote: IdLote.optional(),
});

export const PedidoCancelamento = BaseEvento.extend({
  /** Protocolo de autorização da nota (15 dígitos). */
  nProt: z.string().regex(/^\d{15}$/, '15 dígitos'),
  xJust: Texto(15, 255),
});
export type PedidoCancelamento = z.input<typeof PedidoCancelamento>;

export const PedidoCartaCorrecao = BaseEvento.extend({
  /** Sequência da CC-e na nota (1 a 20): a nova correção substitui a anterior. */
  nSeqEvento: z.number().int().min(1).max(20),
  xCorrecao: Texto(15, 1000),
});
export type PedidoCartaCorrecao = z.input<typeof PedidoCartaCorrecao>;

export const PedidoInutilizacaoEmissor = z
  .object({
    cUF: z.number().int().min(11).max(53),
    tpAmb: z.union([z.literal(1), z.literal(2)]),
    /** Ano da inutilização (2 dígitos). */
    ano: z.string().regex(/^\d{2}$/, '2 dígitos'),
    cnpj: CnpjXml,
    serie: z.number().int().min(0).max(999),
    nNFIni: z.number().int().min(1).max(999_999_999),
    nNFFin: z.number().int().min(1).max(999_999_999),
    xJust: Texto(15, 255),
  })
  .refine((p) => p.nNFIni <= p.nNFFin, { message: 'nNFIni maior que nNFFin', path: ['nNFFin'] });
export type PedidoInutilizacaoEmissor = z.input<typeof PedidoInutilizacaoEmissor>;

/**
 * EPEC (110140, ADR 0011): o evento é montado da PRÓPRIA NF-e já montada com `tpEmis` 4 (`nfe`), para o resumo ser
 * igual ao da nota que vai à SEFAZ normal na volta (a SEFAZ rejeita a divergência com 467). Vai ao Ambiente Nacional
 * (ver `C_ORGAO_AN`). `dhEvento`, `fusoMinutos` e `idLote` seguem as regras dos outros eventos (guarde o pedido antes
 * de transmitir para a retentativa sair idêntica).
 */
export const PedidoEpec = z.object({
  /** `<NFe>` montada (ou assinada) com `tpEmis` 4, como saiu do `montar`. */
  nfe: XmlTexto,
  dhEvento: z.date(),
  fusoMinutos: z.number().int().min(-720).max(840),
  idLote: IdLote.optional(),
});
export type PedidoEpec = z.input<typeof PedidoEpec>;

/** `idLote` do `envEvento` do pedido (o informado ou `dhEvento` em milissegundos). */
export function loteDoEvento(p: { idLote?: string | undefined; dhEvento: Date }): string {
  return p.idLote ?? String(p.dhEvento.getTime());
}

type CabecalhoEvento = Pick<z.output<typeof BaseEvento>, 'chNFe' | 'cnpj' | 'tpAmb' | 'dhEvento' | 'fusoMinutos'>;

function evento(b: CabecalhoEvento, tpEvento: TipoEvento, nSeqEvento: number, detalhe: Elemento[], cOrgao = b.chNFe.slice(0, 2)): string {
  return serializar({
    nome: 'evento',
    xmlns: NS_NFE,
    atributos: { versao: '1.00' },
    filhos: [
      grupo(
        'infEvento',
        [
          el('cOrgao', cOrgao),
          el('tpAmb', String(b.tpAmb)),
          el('CNPJ', b.cnpj),
          el('chNFe', b.chNFe),
          el('dhEvento', dataHoraSefaz(b.dhEvento, b.fusoMinutos)),
          el('tpEvento', tpEvento),
          el('nSeqEvento', String(nSeqEvento)),
          el('verEvento', '1.00'),
          grupo('detEvento', [el('descEvento', DESC_EVENTO[tpEvento]), ...detalhe], { versao: '1.00' }),
        ],
        { Id: idEvento(tpEvento, b.chNFe, nSeqEvento) },
      ),
    ],
  });
}

/** `<evento>` 110111 sem assinatura (assine com `assinarDocumento(xml, a1, 'infEvento')`). */
export function montarCancelamento(entrada: PedidoCancelamento): string {
  const p = validarEntrada(PedidoCancelamento, entrada);
  return evento(p, TIPO_EVENTO.cancelamento, 1, [el('nProt', p.nProt), el('xJust', p.xJust)]);
}

/** `<evento>` 110110 (CC-e) sem assinatura. */
export function montarCartaCorrecao(entrada: PedidoCartaCorrecao): string {
  const p = validarEntrada(PedidoCartaCorrecao, entrada);
  return evento(p, TIPO_EVENTO.cartaCorrecao, p.nSeqEvento, [el('xCorrecao', p.xCorrecao), el('xCondUso', X_COND_USO_CCE)]);
}

/**
 * `<evento>` 110140 (EPEC) sem assinatura (assine com `assinarDocumento(xml, a1, 'infEvento')`), com o `detEvento` do
 * `leiauteEPEC_v1.00`: cOrgaoAutor, tpAutor 1 (emitente), verAplic (o `verProc` da nota), dhEmi, tpNF, IE e o `dest`
 * (UF, documento, IE, vNF, vICMS, vST). Lança `ErroMontagemNFe` se a nota não for EPEC (tpEmis 4 no `ide` e na chave).
 */
export function montarEpec(entrada: PedidoEpec): string {
  const p = validarEntrada(PedidoEpec, entrada);
  const d = dadosEpecDaNFe(p.nfe);
  if (!d) throw new ErroMontagemNFe('NFE_ENTRADA_INVALIDA', ['nfe: NF-e ilegível ou sem dest/total']);
  const chave = lerChaveNFe(d.chNFe);
  const erros: string[] = [];
  if (tpEmisDaNFe(p.nfe) !== TP_EMIS_EPEC) erros.push(`nfe.ide.tpEmis: a EPEC exige tpEmis ${TP_EMIS_EPEC}`);
  if (!chave || !chaveNFeComDvValido(d.chNFe)) erros.push('nfe.infNFe.Id: chave inválida');
  else if (chave.tpEmis !== TP_EMIS_EPEC) erros.push(`nfe.infNFe.Id: a chave não tem o tpEmis ${TP_EMIS_EPEC}`);
  if (d.tpAmb !== '1' && d.tpAmb !== '2') erros.push('nfe.ide.tpAmb: ausente');
  if (erros.length > 0) throw new ErroMontagemNFe('NFE_ENTRADA_INVALIDA', erros);
  const cab: CabecalhoEvento = { chNFe: d.chNFe, cnpj: d.cnpj, tpAmb: Number(d.tpAmb) as 1 | 2, dhEvento: p.dhEvento, fusoMinutos: p.fusoMinutos };
  return evento(
    cab,
    TIPO_EVENTO.epec,
    1,
    [
      el('cOrgaoAutor', d.cOrgaoAutor),
      el('tpAutor', '1'),
      el('verAplic', d.verAplic),
      el('dhEmi', d.dhEmi),
      el('tpNF', d.tpNF),
      el('IE', d.IE),
      grupo('dest', [
        el('UF', d.dest.UF),
        el(d.dest.documento.tag, d.dest.documento.valor),
        opt('IE', d.dest.IE),
        el('vNF', d.vNF),
        el('vICMS', d.vICMS),
        el('vST', d.vST),
      ]),
    ],
    String(C_ORGAO_AN),
  );
}

/** `<inutNFe>` sem assinatura (assine com `assinarDocumento(xml, a1, 'infInut')`). Único jeito de abrir buraco (regra 7). */
export function montarInutilizacao(entrada: PedidoInutilizacaoEmissor): string {
  const p = validarEntrada(PedidoInutilizacaoEmissor, entrada);
  return serializar({
    nome: 'inutNFe',
    xmlns: NS_NFE,
    atributos: { versao: '4.00' },
    filhos: [
      grupo(
        'infInut',
        [
          el('tpAmb', String(p.tpAmb)),
          el('xServ', 'INUTILIZAR'),
          el('cUF', String(p.cUF)),
          el('ano', p.ano),
          el('CNPJ', p.cnpj),
          el('mod', '55'),
          el('serie', String(p.serie)),
          el('nNFIni', String(p.nNFIni)),
          el('nNFFin', String(p.nNFFin)),
          el('xJust', p.xJust),
        ],
        { Id: idInutilizacao({ cUF: p.cUF, ano: p.ano, cnpj: p.cnpj, serie: p.serie, nNFIni: p.nNFIni, nNFFin: p.nNFFin }) },
      ),
    ],
  });
}
