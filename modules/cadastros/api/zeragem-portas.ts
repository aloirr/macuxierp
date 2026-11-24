/**
 * Portas do plugin de plataforma "Zerar dados" (RN-CAD-10, T-0058). O cadastros não importa pedido, faturamento nem
 * integracao-fdv: a apps/api implementa as portas chamando as funções `portal_*` desses módulos, na mesma transação.
 */
import type { CadastroCargaPortal, Transacao } from '@macuxierp/platform-sdk';
import type { MotivoUso, TabelaZeragem } from '../domain';

/** Tabelas que o `p_refs` das funções de uso aceita (0043); as outras (item de preço, saldo etc.) não têm uso próprio. */
export const TABELAS_DE_USO = ['filial', 'vendedor', 'condicao_pagamento', 'tabela_preco', 'produto', 'cliente'] as const;

/** `p_refs` das funções de uso (0043): ids por TABELA (não por cadastro). Chaves fora destas seis não existem. */
export type RefsUso = Partial<Record<(typeof TABELAS_DE_USO)[number], string[]>>;

/** Item de `em_uso` das funções de uso: `motivo` é `pedido` (pedido) ou `nota` | `titulo` (faturamento). */
export interface UsoDaTabela {
  tabela: TabelaZeragem;
  ids: string[];
  motivo: MotivoUso;
}

/**
 * Usos e filiais com nota. A apps/api chama `pedido.portal_usos_cadastros(tenant, refs)` e
 * `faturamento.portal_usos_cadastros(tenant, refs)` com o MESMO `refs` (serializado como jsonb, `p_refs`), na mesma
 * transação, e junta: `emUso` = `em_uso` das duas concatenados (cada função devolve `{em_uso: [{tabela, ids, motivo}]}`);
 * `filiaisComNota` = `filiais_com_nota` do faturamento (o pedido não devolve).
 * RN-CAD-10 (v0.3.6): o motivo 'fiscal' (filial com A1 ou ambiente fiscal, de core.portal_usos_filiais) vem DENTRO de
 * `emUso` como `{ tabela: 'filial', ids, motivo: 'fiscal' }`, preenchido pela apps/api.
 */
export interface UsosCadastroPlataforma {
  usos(tx: Transacao, tenant: string, refs: RefsUso): Promise<{ emUso: UsoDaTabela[]; filiaisComNota: string[] }>;
}

/** Entidades do Hub (`EntidadeEnvioFdv` do SDK) como texto: forma_prazo mapeia para forma_pagamento e prazo_pagamento. */
export interface EstadoEntidadeIntegracao {
  entidade: string;
  ligada: boolean;
  lote_em_voo: boolean;
}

/**
 * Estado e limpeza do espelho do FDV. A apps/api chama `integracao_fdv.portal_estado_entidades` e
 * `integracao_fdv.portal_zerar_espelho(tenant, entidades, request_id)`; o `estado` devolve `entidades` do
 * jsonb `{entidades: [{entidade, ligada, lote_em_voo}]}` e o `zerarEspelho`, o `entidades` de `{entidades: [{entidade, registros}]}`.
 * Ambas só aceitam as 10 entidades da F2 (`check_violation` fora delas), sem repetição; MXI03 se ligada ou lote em voo.
 */
export interface EstadoIntegracaoPlataforma {
  estado(tx: Transacao, tenant: string, entidades: readonly string[]): Promise<EstadoEntidadeIntegracao[]>;
  zerarEspelho(tx: Transacao, tenant: string, entidades: readonly string[], request_id: string): Promise<{ entidade: string; registros: number }[]>;
}

/** Diferente de CadastroZerarPortal: é o conjunto da carga (CadastroCargaPortal), usado pelo carga-portal na substituição. */
export type CadastroZeravel = CadastroCargaPortal;

/** Motivo de uso: vem do domain (`'pedido' | 'titulo' | 'nota' | 'fiscal'`), reexportado aqui para a porta. */
export type { MotivoUso };

/**
 * Consulta de "em uso" por cadastro (usada pelo carga-portal na substituição). No desenho do zerar o "em uso" vem pela
 * `UsosCadastroPlataforma`; esta porta serve a quem consulta ids de um cadastro (id → motivo).
 */
export interface ConsultaUsoCadastros {
  emUso(tx: Transacao, cadastro: CadastroZeravel, ids: readonly string[]): Promise<Map<string, MotivoUso>>;
}

/**
 * Usuários da empresa que guardam filial (`plataforma.usuario.filial_ids`, sem FK). A apps/api implementa com
 * `plataforma.portal_tirar_filiais_dos_usuarios(tenant, ids uuid[])` (0043 v3): devolve quantos usuários mudaram.
 * Só no efeito do zerar, com os ids de filial que o plano apaga (nunca chamada sem ids nem na prévia).
 */
export interface UsuariosFiliaisPlataforma {
  tirarFiliais(tx: Transacao, tenant: string, ids: readonly string[]): Promise<number>;
}

export interface DependenciasZeragemPlataforma {
  usos: UsosCadastroPlataforma;
  integracao: EstadoIntegracaoPlataforma;
  usuarios: UsuariosFiliaisPlataforma;
}
