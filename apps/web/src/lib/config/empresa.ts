import { CODIGO_TROCAR_SENHA, formatarDataHora, formatarDocumento, type EmpresaPlataforma } from '@macuxierp/platform-sdk';
import { ConfigSemPermissao, ErroPlataforma, SEM_PERMISSAO } from './erros';

const AUSENTE = '—';
const ou = (v: string | null | undefined) => (v && v.trim() ? v : AUSENTE);

/** Código da empresa em maiúsculas; slug antigo aparece em maiúsculas. */
export const codigoExibido = (e: Pick<EmpresaPlataforma, 'slug' | 'codigo'>): string => (e.codigo ?? e.slug).toUpperCase() || AUSENTE;

export interface LinhaDado {
  rotulo: string;
  valor: string;
}

/** As linhas do bloco "Dados da empresa" (só leitura). Campo ausente ou null vira "—". CNPJ com máscara (numérico ou alfanumérico). */
export function dadosDaEmpresa(e: EmpresaPlataforma): LinhaDado[] {
  const lugar = e.cidade && e.uf ? `${e.cidade}/${e.uf}` : e.cidade || e.uf || null;
  return [
    { rotulo: 'Razão social', valor: ou(e.razao_social) },
    { rotulo: 'CNPJ', valor: e.cnpj ? formatarDocumento(e.cnpj) : AUSENTE },
    { rotulo: 'Cidade/UF', valor: ou(lugar) },
    { rotulo: 'Criada em', valor: formatarDataHora(e.created_at, e.fuso) },
  ];
}

export type DestinoErroEmpresa = { tipo: 'senha' } | { tipo: 'tela'; texto: string; naoAchou: boolean };

/** O que a ficha da empresa faz com o erro da leitura (fora o 401, que encerra a sessão): 403 TROCAR_SENHA vai à troca; sem permissão e 404 têm texto próprio. */
export function destinoErroEmpresa(e: unknown): DestinoErroEmpresa {
  if (e instanceof ErroPlataforma && e.codigo === CODIGO_TROCAR_SENHA) return { tipo: 'senha' };
  if (e instanceof ConfigSemPermissao) return { tipo: 'tela', texto: SEM_PERMISSAO, naoAchou: false };
  if (e instanceof ErroPlataforma && e.status === 404) return { tipo: 'tela', texto: 'Empresa não encontrada. Volte à lista.', naoAchou: true };
  return { tipo: 'tela', texto: 'Não foi possível carregar. Tente de novo.', naoAchou: false };
}
