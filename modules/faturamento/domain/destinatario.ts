/**
 * Destinatário da NF-e a partir do retrato do cliente gravado no pedido (T-0013 §8.1). O endereço principal do retrato é a
 * reserva do endereço do destinatário quando o cadastro não devolve um (RF-FAT-01). Função pura.
 */
import type { ClienteRetrato } from '@macuxierp/pedido/contracts';
import { violacao, type Violacao } from './violacao';
import type { NotaParaEmissaoEntrada } from '@macuxierp/nfe-emissor';
import { normalizarDocumento } from '@macuxierp/platform-sdk';
import type { DestinatarioNota, EnderecoNota, IndIeDest } from './tipos-nota';
import { textoNfe } from './itens-emissao';

/** O retrato traz `municipio_nome` (aditivo no @1, T-0021); nulo segue como nulo: quem recusa é `validarNotaParaEmissao` (único lugar do xMun). */
function enderecoDoRetrato(retrato: ClienteRetrato): EnderecoNota | Violacao[] {
  const e = retrato.endereco;
  const v: Violacao[] = [];
  for (const campo of ['logradouro', 'numero', 'bairro', 'municipio_ibge', 'uf', 'cep'] as const) {
    if (!e[campo]) v.push(violacao('RF-FAT-01', `cliente.endereco.${campo}`, `Endereço do destinatário sem ${campo}.`));
  }
  if (v.length > 0) return v;
  return {
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento ?? null,
    bairro: e.bairro,
    municipio_ibge: e.municipio_ibge,
    municipio_nome: e.municipio_nome?.trim() || null,
    uf: e.uf,
    cep: e.cep,
  };
}

/** `endereco` do cadastro tem preferência; sem ele, o endereço principal do retrato. */
export function destinatarioDoRetrato(
  retrato: ClienteRetrato,
  endereco: EnderecoNota | null,
): { ok: true; destinatario: DestinatarioNota } | { ok: false; violacoes: Violacao[] } {
  const end = endereco ?? enderecoDoRetrato(retrato);
  if (Array.isArray(end)) return { ok: false, violacoes: end };
  return {
    ok: true,
    destinatario: { documento: retrato.documento, nome: retrato.razao_social, ind_ie_dest: Number(retrato.ind_ie_dest) as IndIeDest, ie: retrato.ie, endereco: end },
  };
}

type Dest = NonNullable<NotaParaEmissaoEntrada['dest']>;
type EnderEmissao = Dest['enderDest'];

/** Endereço do retrato no formato do emissor (`enderEmit`/`enderDest`). O xMun nulo já foi recusado por `validarNotaParaEmissao`. */
export function enderecoParaEmissao(e: EnderecoNota): EnderEmissao {
  return {
    xLgr: textoNfe(e.logradouro),
    nro: textoNfe(e.numero),
    ...(e.complemento?.trim() ? { xCpl: textoNfe(e.complemento) } : {}),
    xBairro: textoNfe(e.bairro),
    cMun: e.municipio_ibge,
    xMun: textoNfe(e.municipio_nome ?? ''),
    UF: e.uf,
    CEP: e.cep.replace(/\D/g, ''),
  };
}

/**
 * `dest` da `NotaParaEmissao` (CNPJ ou CPF, `enderDest`, `indIEDest`; IE só do contribuinte). Em homologação o emissor troca o xNome pelo
 * texto do Manual (RN-FAT-04): aqui vai o nome real.
 */
export function destParaEmissao(d: DestinatarioNota): Dest {
  const doc = normalizarDocumento(d.documento);
  return {
    ...(doc.length === 14 ? { CNPJ: doc } : { CPF: doc }),
    xNome: textoNfe(d.nome),
    enderDest: enderecoParaEmissao(d.endereco),
    indIEDest: d.ind_ie_dest,
    ...(d.ind_ie_dest === 1 && d.ie ? { IE: d.ie.replace(/\D/g, '') } : {}),
  };
}
