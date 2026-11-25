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
    { rotulo: 'CNAE principal', valor: ou(f.cnae_principal) },
    { rotulo: 'Endereço', valor: enderecoEmLinha(f) },
  ];
}

/** Ficha sem nenhum dado (a data da consulta não conta): vale como sem ficha, com um só estado vazio na tela (RD-2201). */
export function fichaVazia(f: FichaReceitaPlanaMascarada | null): f is null {
  if (!f) return true;
  const { cnae_secundarios: sec, receita_consultada_em: consultadaEm, ...resto } = f;
  void consultadaEm;
  return Object.values(resto).every((v) => v === null || v === '') && (!sec || sec.length === 0);
}

/** "Consultada em 24/11/2026 12:00", no fuso da empresa; sem a data, nada. */
export const origemDaConsulta = (f: FichaReceitaPlanaMascarada, fuso: string): string | null => (f.receita_consultada_em ? `Consultada em ${formatarDataHora(f.receita_consultada_em, fuso)}` : null);
