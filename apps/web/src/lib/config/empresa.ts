import { CODIGO_TROCAR_SENHA, formatarDataHora, type EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { ConfigIndisponivel, ConfigNaoAutenticado, ConfigSemPermissao, EMPRESA_NAO_ENCONTRADA, ErroPlataforma, SEM_PERMISSAO } from './erros';

export const AUSENTE = '—';

/** Código da empresa em maiúsculas; slug antigo aparece em maiúsculas. */
export const codigoExibido = (e: Pick<EmpresaPlataforma, 'slug' | 'codigo'>): string => (e.codigo ?? e.slug).toUpperCase() || AUSENTE;

/** "Manaus/AM"; só uma das partes sai sem a barra; nenhuma, null. */
const lugar = (cidade: string | null | undefined, uf: string | null | undefined): string | null => (cidade && uf ? `${cidade}/${uf}` : cidade || uf || null);

type FichaLugar = { uf: string | null; municipio_nome?: string | null };

/**
 * Cidade/UF da empresa: o cadastro (filial padrão) manda; sem a cidade, vale o nome do município da ficha da Receita
 * ("Manaus/AM"); sem o nome, só a UF ("AM"), nunca o código IBGE. Nada disso, null. Na Ficha, sob o código IBGE (RD-2033, RD-2200).
 */
export function lugarDaEmpresa(e: Pick<EmpresaPlataforma, 'cidade' | 'uf'>, ficha?: FichaLugar | null): string | null {
  return lugar(e.cidade?.trim() || ficha?.municipio_nome?.trim() || null, e.uf || ficha?.uf);
}

/** "Criada em 23/11/2026 08:00", no fuso da empresa, no cabeçalho da tela da empresa (docs/design/telas-horizontais §3). */
export const textoCriadaEm = (e: Pick<EmpresaPlataforma, 'created_at' | 'fuso'>): string => `Criada em ${formatarDataHora(e.created_at, e.fuso)}`;

/** "22/11/2026": só a data de criação, no fuso da empresa (coluna "Criada em" da lista, simulação 124 A). */
export const dataCriacao = (e: Pick<EmpresaPlataforma, 'created_at' | 'fuso'>): string => formatarDataHora(e.created_at, e.fuso).slice(0, 10);

/** Busca única da lista (RD-2362, 124 A): filtra ao digitar pelo código ou pelo nome, sem caixa e sem acento. */
const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function filtrarEmpresas<E extends Pick<EmpresaPlataforma, 'slug' | 'codigo' | 'nome'>>(lista: readonly E[], termo: string): E[] {
  const q = normalizar(termo);
  if (!q) return [...lista];
  return lista.filter((e) => normalizar(`${codigoExibido(e)} ${e.slug} ${e.nome}`).includes(q));
}

export type DestinoErroEmpresa = { tipo: 'senha' } | { tipo: 'tela'; texto: string; naoAchou: boolean; requestId?: string };

/** O que a ficha da empresa faz com o erro da leitura (fora o 401, que encerra a sessão): 403 TROCAR_SENHA vai à troca; sem permissão e 404 têm texto próprio. */
export function destinoErroEmpresa(e: unknown): DestinoErroEmpresa {
  if (e instanceof ErroPlataforma && e.codigo === CODIGO_TROCAR_SENHA) return { tipo: 'senha' };
  if (e instanceof ConfigSemPermissao) return { tipo: 'tela', texto: SEM_PERMISSAO, naoAchou: false };
  if (e instanceof ErroPlataforma && e.status === 404) return { tipo: 'tela', texto: EMPRESA_NAO_ENCONTRADA, naoAchou: true };
  const requestId = e instanceof ConfigIndisponivel ? e.requestId : undefined;
  return { tipo: 'tela', texto: 'Não foi possível carregar a empresa.', naoAchou: false, ...(requestId ? { requestId } : {}) };
}

/** Leitura de apoio da aba: sessão vencida é sinalizada; qualquer outra falha vira `valor: null` com o `requestId` da PRÓPRIA leitura. */
export async function lerApoio<T>(ler: () => Promise<T>): Promise<{ valor: T | null; requestId?: string; naoAutenticado?: boolean }> {
  try {
    return { valor: await ler() };
  } catch (e) {
    if (e instanceof ConfigNaoAutenticado) return { valor: null, naoAutenticado: true };
    return { valor: null, ...(e instanceof ConfigIndisponivel && e.requestId ? { requestId: e.requestId } : {}) };
  }
}
