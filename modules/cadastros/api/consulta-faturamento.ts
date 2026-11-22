/**
 * Consulta de cadastros para o módulo faturamento (T-0021). O faturamento declara a porta `ConsultaCadastrosFaturamento`
 * em `modules/faturamento/api/portas.ts`; os tipos abaixo são estruturalmente compatíveis com ela, sem o cadastros
 * importar o faturamento (sem ciclo). Roda na transação do chamador (RLS do tenant), devolve também o inativo (a decisão
 * é do faturamento) e leva só os campos listados. O CRT e o indIEDest saem como número, como a NF-e os usa.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { classeForma, type ClasseForma, type CondicaoPagamento, type EnderecoClienteItem } from '../contracts';
import { comNomeMunicipio } from './enderecos';
import type { Repositorios } from './portas';
import { escolher } from './util';

const CAMPOS_ENDERECO = ['logradouro', 'numero', 'complemento', 'bairro', 'municipio_ibge', 'uf', 'cep'] as const;

/** Endereço da nota: sem o `pais_bacen`; `municipio_nome` é `null` quando o código não está na tabela do IBGE (xMun é obrigatório). */
export type EnderecoNotaCadastros = Pick<EnderecoClienteItem, (typeof CAMPOS_ENDERECO)[number]> & { municipio_nome: string | null };
export type CrtCadastros = 1 | 2 | 3 | 4;
export type IndIeDestCadastros = 1 | 2 | 9;

const CRT: Record<'1' | '2' | '3' | '4', CrtCadastros> = { '1': 1, '2': 2, '3': 3, '4': 4 };
const IND_IE_DEST: Record<'1' | '2' | '9', IndIeDestCadastros> = { '1': 1, '2': 2, '9': 9 };

export interface FilialParaFaturamento {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  /** Filial sem IE no cadastro sai como texto vazio (a porta exige texto): o faturamento recusa a emissão. */
  ie: string;
  crt: CrtCadastros;
  endereco: EnderecoNotaCadastros;
  emissora: boolean;
  nfe_serie: number | null;
}
export interface ClienteParaFaturamento {
  id: string;
  documento: string;
  nome: string;
  ind_ie_dest: IndIeDestCadastros;
  ie: string | null;
  endereco: EnderecoNotaCadastros;
  /** `email_nfe` do cliente (os contatos não entram). */
  email: string | null;
}
export type CondicaoParaFaturamento = Pick<CondicaoPagamento, 'forma_tpag' | 'prazos_dias'> & { parcelas_cartao: number | null; classe: ClasseForma | null };

export interface ConsultaCadastrosParaFaturamento {
  filial(tx: Transacao, id: string): Promise<FilialParaFaturamento | null>;
  cliente(tx: Transacao, id: string): Promise<ClienteParaFaturamento | null>;
  condicao(tx: Transacao, id: string): Promise<CondicaoParaFaturamento | null>;
  numeroInicial(tx: Transacao, filial_id: string, serie: number): Promise<number | null>;
}

async function enderecoDaNota(r: Repositorios, e: Pick<EnderecoClienteItem, (typeof CAMPOS_ENDERECO)[number]>): Promise<EnderecoNotaCadastros> {
  return (await comNomeMunicipio(r, [escolher(e, CAMPOS_ENDERECO)]))[0] as EnderecoNotaCadastros;
}

export function criarConsultaParaFaturamento(repositorios: (tx: Transacao) => Repositorios): ConsultaCadastrosParaFaturamento {
  return {
    async filial(tx, id) {
      const r = repositorios(tx);
      const f = await r.filiais.obter(id);
      if (!f) return null;
      return {
        id: f.id, cnpj: f.cnpj, razao_social: f.razao_social, nome_fantasia: f.nome_fantasia, ie: f.ie ?? '',
        crt: CRT[f.crt], endereco: await enderecoDaNota(r, f.endereco), emissora: f.emissora, nfe_serie: f.nfe_serie,
      };
    },
    async cliente(tx, id) {
      const r = repositorios(tx);
      const c = await r.clientes.obter(id);
      if (!c) return null;
      const enderecos = (c.enderecos ?? []) as EnderecoClienteItem[];
      const principal = enderecos.find((e) => e.tipo === 'principal') ?? enderecos[0];
      if (!principal) return null;
      return {
        id: c.id, documento: c.documento, nome: c.razao_social, ind_ie_dest: IND_IE_DEST[c.ind_ie_dest], ie: c.ie,
        endereco: await enderecoDaNota(r, principal), email: c.email_nfe ?? null,
      };
    },
    async condicao(tx, id) {
      const c = await repositorios(tx).condicoesPagamento.obter(id);
      return c ? { forma_tpag: c.forma_tpag, prazos_dias: c.prazos_dias, parcelas_cartao: c.parcelas_cartao ?? null, classe: classeForma(c.forma_tpag) } : null;
    },
    async numeroInicial(tx, filial_id, serie) {
      const f = await repositorios(tx).filiais.obter(filial_id);
      return f && f.nfe_serie === serie ? f.nfe_numero_inicial : null;
    },
  };
}
