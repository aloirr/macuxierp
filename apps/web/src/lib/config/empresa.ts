import { CODIGO_TROCAR_SENHA, formatarDataHora, formatarDocumento, type EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { ConfigSemPermissao, EMPRESA_NAO_ENCONTRADA, ErroPlataforma, SEM_PERMISSAO } from './erros';

export const AUSENTE = '—';
export const ou = (v: string | null | undefined) => (v && v.trim() ? v : AUSENTE);

/** Código da empresa em maiúsculas; slug antigo aparece em maiúsculas. */
export const codigoExibido = (e: Pick<EmpresaPlataforma, 'slug' | 'codigo'>): string => (e.codigo ?? e.slug).toUpperCase() || AUSENTE;

export interface LinhaDado {
  rotulo: string;
  valor: string;
}

/** "Manaus/AM"; só uma das partes sai sem a barra; nenhuma, null. */
export const lugar = (cidade: string | null | undefined, uf: string | null | undefined): string | null => (cidade && uf ? `${cidade}/${uf}` : cidade || uf || null);

/**
 * Cidade/UF da empresa: o cadastro (filial padrão) manda; sem a cidade, a ficha da Receita só traz o código do município
 * e a UF, e a tela mostra só a UF ("AM"), sem código IBGE. Nada disso, null. Serve ao cartão Dados e ao endereço da ficha.
 */
export function lugarDaEmpresa(e: Pick<EmpresaPlataforma, 'cidade' | 'uf'>, ficha?: { municipio_ibge: string | null; uf: string | null } | null): string | null {
  // T-0106: trocar pela cidade quando a API devolver o nome do município
  return lugar(e.cidade?.trim() || null, e.uf || ficha?.uf);
}

/** As linhas do bloco "Dados da empresa" (só leitura). Campo ausente ou null vira "—". CNPJ com máscara (numérico ou alfanumérico). */
export function dadosDaEmpresa(e: EmpresaPlataforma, ficha?: { municipio_ibge: string | null; uf: string | null } | null): LinhaDado[] {
  return [
    { rotulo: 'Razão social', valor: ou(e.razao_social) },
    { rotulo: 'CNPJ', valor: e.cnpj ? formatarDocumento(e.cnpj) : AUSENTE },
    { rotulo: 'Cidade/UF', valor: ou(lugarDaEmpresa(e, ficha)) },
    { rotulo: 'Criada em', valor: formatarDataHora(e.created_at, e.fuso) },
  ];
}

export type DestinoErroEmpresa = { tipo: 'senha' } | { tipo: 'tela'; texto: string; naoAchou: boolean };

/** O que a ficha da empresa faz com o erro da leitura (fora o 401, que encerra a sessão): 403 TROCAR_SENHA vai à troca; sem permissão e 404 têm texto próprio. */
export function destinoErroEmpresa(e: unknown): DestinoErroEmpresa {
  if (e instanceof ErroPlataforma && e.codigo === CODIGO_TROCAR_SENHA) return { tipo: 'senha' };
  if (e instanceof ConfigSemPermissao) return { tipo: 'tela', texto: SEM_PERMISSAO, naoAchou: false };
  if (e instanceof ErroPlataforma && e.status === 404) return { tipo: 'tela', texto: EMPRESA_NAO_ENCONTRADA, naoAchou: true };
  return { tipo: 'tela', texto: 'Não foi possível carregar. Tente de novo.', naoAchou: false };
}
