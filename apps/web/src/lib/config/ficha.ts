import type { EnderecoFicha, FichaReceitaMascarada, RegimeFicha } from '@macuxierp/core/contracts';
import { formatarDataHora, formatarDocumento } from '@macuxierp/platform-sdk';
import { AUSENTE, ou, type LinhaDado } from './empresa';

/** Ficha da empresa pela Receita (T-0101): textos e linhas da aba Empresa. Só dado da ficha MASCARADA; nada vai a log. */

const REGIMES: Record<RegimeFicha, string> = { mei: 'MEI', simples: 'Simples Nacional', normal: 'Regime normal' };
const FONTES: Record<FichaReceitaMascarada['fonte'], string> = { brasilapi: 'BrasilAPI', 'receita-aberta': 'Base aberta da Receita' };

/** AAAA-MM-DD → DD/MM/AAAA (data civil, sem fuso). */
export const dataCivil = (d: string | null): string => (d ? d.split('-').reverse().join('/') : AUSENTE);

const cep = (c: string | null) => (c ? `${c.slice(0, 5)}-${c.slice(5)}` : null);

/** Endereço em uma linha: "Rua X, 10, Sala 2, Centro, Manaus/AM, CEP 69000-000". Partes ausentes saem; tudo ausente vira "—". */
export function enderecoEmLinha(e: EnderecoFicha): string {
  const lugar = e.municipio && e.uf ? `${e.municipio}/${e.uf}` : e.municipio || e.uf;
  const partes = [e.logradouro, e.numero, e.complemento, e.bairro, lugar, cep(e.cep) ? `CEP ${cep(e.cep)}` : null].filter((p): p is string => !!p && p.trim() !== '');
  return partes.length > 0 ? partes.join(', ') : AUSENTE;
}

/** Linhas da ficha, na ordem da tela. CNAE secundários ficam fora (lista própria); e-mail e telefone também (têm o Revelar). */
export function linhasDaFicha(f: FichaReceitaMascarada): LinhaDado[] {
  return [
    { rotulo: 'Razão social', valor: f.razao_social },
    { rotulo: 'Nome fantasia', valor: ou(f.nome_fantasia) },
    { rotulo: 'CNPJ', valor: formatarDocumento(f.cnpj) },
    { rotulo: 'Situação cadastral', valor: ou(f.situacao_cadastral) },
    { rotulo: 'Abertura', valor: dataCivil(f.data_abertura) },
    { rotulo: 'Natureza jurídica', valor: ou(f.natureza_juridica) },
    { rotulo: 'Porte', valor: ou(f.porte) },
    { rotulo: 'Regime', valor: f.regime ? REGIMES[f.regime] : AUSENTE },
    { rotulo: 'CNAE principal', valor: f.cnae_principal ? [f.cnae_principal.codigo, f.cnae_principal.descricao].filter(Boolean).join(' · ') : AUSENTE },
    { rotulo: 'Endereço', valor: enderecoEmLinha(f.endereco) },
  ];
}

export const cnaeEmTexto = (c: { codigo: string; descricao: string | null }): string => [c.codigo, c.descricao].filter(Boolean).join(' · ');

/** "Consultada em 24/11/2026 12:00 · BrasilAPI", no fuso da empresa. */
export const origemDaConsulta = (f: FichaReceitaMascarada, fuso: string): string => `Consultada em ${formatarDataHora(f.consultado_em, fuso)} · ${FONTES[f.fonte]}`;

export const CAMPOS_CONTATO = [
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'telefone', rotulo: 'Telefone' },
] as const;
