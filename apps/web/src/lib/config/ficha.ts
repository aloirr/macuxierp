import type { FichaReceitaPlanaMascarada, RegimeFicha } from '@macuxierp/core/contracts';
import { formatarDataHora } from '@macuxierp/platform-sdk';
import { AUSENTE, ou, type LinhaDado } from './empresa';

/** Ficha da empresa pela Receita (T-0101): linhas da aba Empresa. Só dado da ficha MASCARADA; nada vai a log. */

const REGIMES: Record<RegimeFicha, string> = { mei: 'MEI', simples: 'Simples Nacional', normal: 'Regime normal' };

// RD-2034: ir para platform-sdk/formatar
/** AAAA-MM-DD → DD/MM/AAAA (data civil, sem fuso). */
export const dataCivil = (d: string | null): string => (d ? d.split('-').reverse().join('/') : AUSENTE);

// RD-2034: ir para platform-sdk/formatar
const cep = (c: string | null) => (c ? `${c.slice(0, 5)}-${c.slice(5)}` : null);

/**
 * Endereço em uma linha: "Rua X, 10, Sala 2, Centro, CEP 69000-000". A cidade/UF fica só no bloco Dados (RD-2033), sem repetir aqui.
 * Partes ausentes saem; tudo ausente vira "—".
 */
export function enderecoEmLinha(f: Pick<FichaReceitaPlanaMascarada, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cep'>): string {
  const partes = [f.logradouro, f.numero, f.complemento, f.bairro, cep(f.cep) ? `CEP ${cep(f.cep)}` : null].filter((p): p is string => !!p && p.trim() !== '');
  return partes.length > 0 ? partes.join(', ') : AUSENTE;
}

/** Linhas da ficha, na ordem da tela. Razão social, CNPJ e cidade/UF ficam no bloco Dados; CNAE secundários, e-mail e telefone têm lugar próprio. */
export function linhasDaFicha(f: FichaReceitaPlanaMascarada): LinhaDado[] {
  return [
    { rotulo: 'Nome fantasia', valor: ou(f.nome_fantasia) },
    { rotulo: 'Inscrição estadual', valor: ou(f.ie) },
    { rotulo: 'Situação cadastral', valor: ou(f.situacao_cadastral) },
    { rotulo: 'Abertura', valor: dataCivil(f.data_abertura) },
    { rotulo: 'Natureza jurídica', valor: ou(f.natureza_juridica) },
    { rotulo: 'Porte', valor: ou(f.porte) },
    { rotulo: 'Regime', valor: f.regime_receita ? REGIMES[f.regime_receita] : AUSENTE },
    { rotulo: 'CNAE principal', valor: f.cnae_principal ? textoCnae(f.cnae_principal, f.cnae_principal_descricao) : AUSENTE },
    { rotulo: 'Endereço', valor: enderecoEmLinha(f) },
  ];
}

/** "4781400" → "4781-4/00"; fora de 7 dígitos, como veio. */
export const formatarCnae = (c: string): string => (/^\d{7}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4, 5)}/${c.slice(5)}` : c);

/** Texto de um CNAE: "4781-4/00 · Descrição" (a descrição como a tabela oficial traz); sem descrição, só o código formatado. */
export function textoCnae(codigo: string, descricao?: string | null): string {
  const d = descricao?.trim();
  return d ? `${formatarCnae(codigo)} · ${d}` : formatarCnae(codigo);
}

/** Os CNAE secundários em texto: com descrição quando o contrato a trouxer; senão, os códigos antigos sem descrição. */
export function textosCnaeSecundarios(f: Pick<FichaReceitaPlanaMascarada, 'cnae_secundarios' | 'cnae_secundarios_descritos'>): string[] {
  if (f.cnae_secundarios_descritos && f.cnae_secundarios_descritos.length > 0) return f.cnae_secundarios_descritos.map((c) => textoCnae(c.codigo, c.descricao));
  return (f.cnae_secundarios ?? []).map((c) => textoCnae(c));
}

export type EstadoFicha = 'nunca' | 'sem_dados' | 'com_dados';

/**
 * Três estados (RD-2201): nunca consultada (sem ficha ou sem data da consulta); consultada sem dados (data preenchida e todo
 * campo de dado vazio; `receita_fonte` e `receita_consultada_em` são metadado); com dados.
 */
export function estadoDaFicha(f: FichaReceitaPlanaMascarada | null): EstadoFicha {
  if (!f || !f.receita_consultada_em) return 'nunca';
  const { receita_fonte: fonte, receita_consultada_em: consultadaEm, ...dados } = f;
  void fonte;
  void consultadaEm;
  const vazio = Object.values(dados).every((v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0));
  return vazio ? 'sem_dados' : 'com_dados';
}

/** Sem dado para mostrar (nunca consultada ou consultada sem dados): a tela mostra só o estado vazio. */
export const fichaVazia = (f: FichaReceitaPlanaMascarada | null): f is null => estadoDaFicha(f) !== 'com_dados';

/** Texto do estado vazio da ficha, por estado. */
export const TEXTO_FICHA_VAZIA: Record<'nunca' | 'sem_dados', string> = {
  nunca: 'Ainda não consultada. Use Atualizar pela Receita.',
  sem_dados: 'Consultada, sem dados na Receita.',
};

/** "Consultada em 24/11/2026 12:00", no fuso da empresa; sem a data, nada. */
export const origemDaConsulta = (f: FichaReceitaPlanaMascarada, fuso: string): string | null => (f.receita_consultada_em ? `Consultada em ${formatarDataHora(f.receita_consultada_em, fuso)}` : null);
