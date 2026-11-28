/** Portas do cadastro de regras (T-0127): o SQL é o padrão; os testes trocam por memória. Sem `tenant_id`: a transação do tenant (RLS) isola. */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { CatalogoRegra, RegraDetalhe, RegraEntrada, RegraLinha, SituacaoRegra, TributoRegra } from '../contracts';

export interface FiltroListaRegras {
  busca?: string | undefined;
  tributo?: TributoRegra | undefined;
  uf_origem?: string | undefined;
  uf_destino?: string | undefined;
  crt?: string | undefined;
  situacao?: SituacaoRegra | undefined;
  cursor?: string | undefined;
  limite: number;
  /** Data civil de hoje no fuso do tenant (AAAA-MM-DD): a situação (vigente, futura, encerrada) é calculada contra ela. */
  hoje: string;
}

export interface RepositorioRegras {
  /** Até `limite + 1` linhas, ordem por `id` (o `paginar` do SDK corta). */
  listar(f: FiltroListaRegras): Promise<RegraLinha[]>;
  listarTodos(f: Omit<FiltroListaRegras, 'cursor' | 'limite'>, maximo: number): Promise<RegraLinha[]>;
  obter(id: string, hoje: string): Promise<RegraDetalhe | null>;
  inserir(r: RegraEntrada, hoje: string, regraBaseId?: string): Promise<RegraDetalhe>;
  /** `ifMatch` = o `updated_at` lido. `'conflito'` = a regra mudou depois; `null` = não existe. */
  atualizar(id: string, r: RegraEntrada, ifMatch: string, hoje: string): Promise<RegraDetalhe | 'conflito' | null>;
  /** Exclusão lógica (`deleted_at`); devolve a regra como estava, para o evento e a auditoria. */
  excluir(id: string, hoje: string): Promise<RegraDetalhe | null>;
}

export interface RepositorioCatalogo {
  listar(f: { busca?: string | undefined; tributo?: TributoRegra | undefined; cursor?: string | undefined; limite: number }): Promise<CatalogoRegra[]>;
  obter(id: string): Promise<CatalogoRegra | null>;
}

export interface DependenciasRegras {
  regras(tx: Transacao): RepositorioRegras;
  catalogo(tx: Transacao): RepositorioCatalogo;
  /** Regras vigentes que podem valer para o alvo (a consulta "qual regra vale"); o padrão é `repositorioFiscalSql.regras`. */
  candidatas?: import('./portas').RepositorioFiscal['regras'];
}
