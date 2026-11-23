/**
 * Conteúdo gravado da nota (retratos, itens com o cálculo fiscal, pagamento e transporte) e a `NotaParaEmissao`, a entrada da porta
 * `EmissorNFe` (T-0018, packages/nfe-emissor: o ÚNICO montador do XML). A API grava o conteúdo ao reservar o número, monta a
 * `NotaParaEmissao` dele, pede o XML ao emissor e assina com o A1 (porta `lerA1`); o worker só transmite o assinado. O XML é determinístico.
 * Regras de forma de pagamento, frete, origem e município são CAMPOS daqui e validações em `validacao-emissao.ts`, não código de XML.
 */
import type { NotaParaEmissaoEntrada } from '@macuxierp/nfe-emissor';
import { normalizarDocumento } from '@macuxierp/platform-sdk';
import type { Ambiente, TipoEmissao } from '../contracts';
import { destParaEmissao, enderecoParaEmissao } from './destinatario';
import { itemParaEmissao, textoNfe } from './itens-emissao';
import { FUSO_MANAUS_MINUTOS } from './fuso';
import type { ConteudoNota } from './tipos-nota';
import { validarNotaParaEmissao } from './validacao-emissao';
import { violacao, type Violacao } from './violacao';

/** Código da UF da filial emissora (AM). */
const CUF_AM = '13';

export type { ConteudoNota, DestinatarioNota, EmitenteNota, EnderecoNota, Crt, IndIeDest } from './tipos-nota';

/** O que a nota fixa na reserva do número e nunca muda (RN-FAT-07). */
export interface IdentidadeNota {
  /** Nulo na primeira montagem (o emissor sorteia); a nota grava o sorteado e o reenvia igual. */
  cnf: string | null;
  tpEmis: TipoEmissao;
  serie: number;
  numero: number;
  emitida_em: Date;
  ambiente: Ambiente;
  pedido_id: string;
  filial_id: string;
  cliente_id: string;
  vendedor_id: string | null;
}

/** Versão do processo emissor (`verProc` do `ide`): constante única; entra na nota pelo `notaParaEmissaoDe` e o emissor a leva ao XML. */
export const VER_PROC = 'macuxierp-fat-0.1';

export type ResultadoNotaParaEmissao = { ok: true; nota: NotaParaEmissaoEntrada } | { ok: false; violacoes: Violacao[] };

/**
 * Entrada da porta `EmissorNFe` (`NotaParaEmissao` do `@macuxierp/nfe-emissor`, em centavos) a partir do conteúdo gravado e da identidade
 * fixa da nota. Função pura e determinística: o mesmo conteúdo gera os mesmos bytes (RN-FAT-02). `cNF` nulo = o emissor sorteia (primeira
 * montagem); depois o sorteado é gravado na nota e reenviado igual. As violações vêm do domain (`validarNotaParaEmissao`, itens): nada
 * é montado com elas e nenhum número é queimado. Os totais NÃO entram: o emissor os calcula e confere.
 */
export function notaParaEmissaoDe(id: IdentidadeNota, c: ConteudoNota): ResultadoNotaParaEmissao {
  const v = validarNotaParaEmissao(c);
  // RN-FAT-08: o tpEmis da identidade (que está na chave) e o da contingência do conteúdo andam juntos; com 1 não há dhCont nem xJust.
  const k = c.contingencia ?? null;
  if (id.tpEmis === 1 ? k !== null : k === null || k.tpEmis !== id.tpEmis) {
    v.push(violacao('RN-FAT-08', 'contingencia', `A contingência do conteúdo não confere com o tpEmis ${id.tpEmis} da nota.`));
  }
  const itens: NotaParaEmissaoEntrada['itens'] = [];
  for (const i of c.itens) {
    const r = itemParaEmissao(i);
    if (r.ok) itens.push(r.item);
    else v.push(...r.violacoes);
  }
  if (v.length > 0) return { ok: false, violacoes: v };
  const e = c.emitente;
  const infCpl = c.infCpl ? textoNfe(c.infCpl) : '';
  return {
    ok: true,
    nota: {
      ide: {
        cUF: CUF_AM,
        natOp: textoNfe(c.natOp),
        serie: id.serie,
        nNF: id.numero,
        dhEmi: id.emitida_em.toISOString(),
        fusoMinutos: FUSO_MANAUS_MINUTOS,
        tpNF: 1,
        idDest: e.endereco.uf === c.destinatario.endereco.uf ? 1 : 2,
        cMunFG: e.endereco.municipio_ibge,
        tpAmb: id.ambiente === 'producao' ? 1 : 2,
        indFinal: c.destinatario.ind_ie_dest === 1 ? 0 : 1,
        indPres: 9,
        verProc: VER_PROC,
        ...(id.tpEmis !== 1 ? { tpEmis: id.tpEmis } : {}),
        ...(k ? { dhCont: k.dhCont, xJust: k.xJust } : {}),
        ...(id.cnf ? { cNF: id.cnf } : {}),
      },
      emit: {
        CNPJ: normalizarDocumento(e.cnpj),
        xNome: textoNfe(e.nome),
        ...(e.fantasia?.trim() ? { xFant: textoNfe(e.fantasia) } : {}),
        enderEmit: enderecoParaEmissao(e.endereco),
        IE: e.ie.replace(/\D/g, ''),
        CRT: e.crt,
      },
      dest: destParaEmissao(c.destinatario),
      itens,
      transp: { modFrete: c.modFrete },
      pag: {
        detPag: c.pagamentos.map((p) => ({ indPag: p.indPag, tPag: p.tPag, ...(p.xPag ? { xPag: p.xPag } : {}), vPag: p.valor_centavos })),
      },
      ...(infCpl ? { infAdic: { infCpl } } : {}),
    },
  };
}
