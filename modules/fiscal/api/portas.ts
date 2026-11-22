/**
 * Portas pequenas do adaptador de cálculo (o fiscal não importa api nem domain de outro módulo): o que falta à porta `CalculoFiscal`
 * do faturamento para montar o emitente vem de quem conhece a filial (cadastros), injetado pelo apps/api.
 */
import type { CargaAproximada, Crt, RegraTributaria } from '../contracts';
import type { Transacao } from '@macuxierp/platform-sdk';

/** Dados fiscais da filial emissora. `regime_pis_cofins` é exigido no CRT 3; `industrial_ipi` padrão false. */
export interface EmitenteFiscal {
  uf: string;
  crt: Crt;
  regime_pis_cofins?: 'cumulativo' | 'nao_cumulativo';
  /** Só para o IPI; o CFOP vem da produção própria do item (`producaoPropria`). */
  industrial_ipi?: boolean;
}
/** Implementada no `cadastros/api` (ou no apps/api sobre os contratos de cadastros). `null` = filial inexistente no tenant. */
export interface ConsultaEmitenteFiscal {
  emitente(tx: Transacao, filial_id: string): Promise<EmitenteFiscal | null>;
  /** Ids (entre os informados) dos produtos fabricados pelo estabelecimento (CFOP 5101/6101/6107/5401/6401); fora do conjunto = revenda. Mesma assinatura de `criarConsultaParaFiscal` (cadastros). */
  producaoPropria(tx: Transacao, produto_ids: string[]): Promise<Set<string>>;
}

/** Leitura das tabelas do próprio fiscal, na `tx` do tenant (RLS). */
export interface RepositorioFiscal {
  /** Regras vigentes em `data_emissao` (RN-FIS-04) que podem valer para a UF, o CRT e os NCMs; o motor aplica a especificidade (RN-FIS-01). */
  regras(tx: Transacao, f: { data_emissao: string; uf_origem: string; uf_destino: string; crt: Crt; ncms: string[] }): Promise<RegraTributaria[]>;
  /** IBPT vigente por NCM (8 dígitos) e UF; o ajuste do próprio tenant vence a tabela geral. */
  cargas(tx: Transacao, f: { data_emissao: string; uf: string; ncms: string[] }): Promise<Map<string, CargaAproximada>>;
}
