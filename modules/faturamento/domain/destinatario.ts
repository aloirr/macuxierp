/**
 * Destinatário da NF-e a partir do retrato do cliente gravado no pedido (T-0013 §8.1). O endereço principal do retrato é a
 * reserva do endereço do destinatário quando o cadastro não devolve um (RF-FAT-01). Função pura.
 */
import type { ClienteRetrato } from '@macuxierp/pedido/contracts';
import { violacao, type Violacao } from './violacao';
import type { DadosXml, EnderecoXml, IndIeDest } from './xml';

/** Nome do município (xMun) não vem no retrato (só o código IBGE): quem chama o resolve pelos cadastros. */
function enderecoDoRetrato(retrato: ClienteRetrato, nomeMunicipio: string | null): EnderecoXml | Violacao[] {
  const e = retrato.endereco;
  const v: Violacao[] = [];
  for (const campo of ['logradouro', 'numero', 'bairro', 'municipio_ibge', 'uf', 'cep'] as const) {
    if (!e[campo]) v.push(violacao('RF-FAT-01', `cliente.endereco.${campo}`, `Endereço do destinatário sem ${campo}.`));
  }
  if (!nomeMunicipio) v.push(violacao('RF-FAT-01', 'cliente.endereco.municipio_nome', 'Nome do município do destinatário não encontrado (xMun).'));
  if (v.length > 0) return v;
  return {
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento ?? null,
    bairro: e.bairro,
    municipio_ibge: e.municipio_ibge,
    municipio_nome: nomeMunicipio as string,
    uf: e.uf,
    cep: e.cep,
  };
}

/** `endereco` do cadastro tem preferência; sem ele, o endereço principal do retrato. */
export function destinatarioDoRetrato(
  retrato: ClienteRetrato,
  endereco: EnderecoXml | null,
  nomeMunicipio: string | null,
): { ok: true; destinatario: DadosXml['destinatario'] } | { ok: false; violacoes: Violacao[] } {
  const end = endereco ?? enderecoDoRetrato(retrato, nomeMunicipio);
  if (Array.isArray(end)) return { ok: false, violacoes: end };
  return {
    ok: true,
    destinatario: { documento: retrato.documento, nome: retrato.razao_social, ind_ie_dest: Number(retrato.ind_ie_dest) as IndIeDest, ie: retrato.ie, endereco: end },
  };
}
