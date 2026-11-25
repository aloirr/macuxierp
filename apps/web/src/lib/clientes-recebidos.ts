/**
 * "Clientes recebidos do FDV" no BKO (T-0059, desenho §6), parte pura: da página da API às linhas da tela e à URL.
 * O documento só aparece mascarado (a API já o manda assim); nada aqui lê ou monta o documento inteiro (LGPD).
 */
import { CAMINHOS_INTEGRACAO_FDV_TENANT, LIMITE_PADRAO, PADRAO_UUID, SITUACOES_CLIENTE_RECEBIDO_FDV, type ClienteRecebidoFdv, type PaginaClientesRecebidosFdv, type SituacaoClienteRecebidoFdv } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { urlDaLista } from '@/lib/listas-url';

export const ROTULO_SITUACAO_RECEBIDO: Readonly<Record<SituacaoClienteRecebidoFdv, string>> = Object.freeze({
  recebido: 'Recebido',
  aceito: 'Aceito',
  recusado: 'Recusado',
  reenviado: 'Reenviado',
});

export const CLASSE_SELO_RECEBIDO: Readonly<Record<SituacaoClienteRecebidoFdv, string>> = Object.freeze({
  recebido: 'selo selo-inativo',
  aceito: 'selo selo-ativo',
  recusado: 'selo selo-erro',
  reenviado: 'selo selo-inativo',
});

export const TEXTO_CORRIGIR_NO_FDV = 'Corrija no Macuxi FDV e reenvie.';
export const TEXTO_RETORNO_FALHOU = 'Não voltou ao FDV';

/** Rota da API (`/v1` + caminho do SDK) com a situação e o cursor, só do que veio válido na URL. */
export function caminhoApiClientesRecebidos(consulta: ConsultaUrl): string {
  return urlDaLista(`/v1${CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidos}`, { limite: String(LIMITE_PADRAO), ...filtrosDaTela(consulta) });
}

/** Filtros da tela (situação e cursor) para `urlDaLista`, `urlInicio` e `urlProxima`. */
export function filtrosDaTela(consulta: ConsultaUrl): Record<string, string> {
  return { ...(consulta.situacao ? { situacao: consulta.situacao } : {}), ...(consulta.cursor ? { cursor: consulta.cursor } : {}) };
}

export interface ConsultaUrl {
  situacao?: SituacaoClienteRecebidoFdv;
  cursor?: string;
}

/** Lê `?situacao=` e `?cursor=`; valor fora do conjunto é ignorado (nunca vai à API). */
export function lerConsultaUrl(busca: Readonly<Record<string, string | string[] | undefined>>): ConsultaUrl {
  const s = busca.situacao;
  const c = busca.cursor;
  const situacao = typeof s === 'string' && (SITUACOES_CLIENTE_RECEBIDO_FDV as readonly string[]).includes(s) ? (s as SituacaoClienteRecebidoFdv) : undefined;
  const cursor = typeof c === 'string' && PADRAO_UUID.test(c) ? c : undefined;
  return { ...(situacao ? { situacao } : {}), ...(cursor ? { cursor } : {}) };
}

export interface LinhaClienteRecebido {
  id: string;
  situacao: SituacaoClienteRecebidoFdv;
  rotuloSituacao: string;
  classeSelo: string;
  cliente: string;
  documento: string;
  vendedor: string;
  recebidoEm: string;
  /** Só quando a revisão passa de 1. */
  revisao: number | null;
  /** Só quando o retorno ao FDV falhou. */
  retorno: string | null;
  motivo: string | null;
  erros: { campo: string; mensagem: string }[];
  /** Só no aceito. */
  hrefCliente: string | null;
}

export function linhaClienteRecebido(c: ClienteRecebidoFdv, fuso: string): LinhaClienteRecebido {
  return {
    id: c.id,
    situacao: c.situacao,
    rotuloSituacao: ROTULO_SITUACAO_RECEBIDO[c.situacao],
    classeSelo: CLASSE_SELO_RECEBIDO[c.situacao],
    cliente: c.razao_social,
    documento: c.documento_mascarado ?? '—',
    vendedor: c.vendedor_external_id ?? '—',
    recebidoEm: formatarDataHora(c.recebido_em, fuso),
    revisao: c.revisao > 1 ? c.revisao : null,
    retorno: c.retorno === 'falhou' ? TEXTO_RETORNO_FALHOU : null,
    erros: c.situacao === 'recusado' ? c.erros.map((e) => ({ campo: e.campo, mensagem: e.mensagem })) : [],
    motivo: c.situacao === 'recusado' && c.erros.length === 0 ? c.motivo : null,
    hrefCliente: c.situacao === 'aceito' && c.cliente_id ? `/cadastros/clientes/${c.cliente_id}` : null,
  };
}

export interface VistaClientesRecebidos {
  linhas: LinhaClienteRecebido[];
  proximoCursor: string | null;
}

export function montarVistaClientesRecebidos(p: PaginaClientesRecebidosFdv, fuso: string): VistaClientesRecebidos {
  return { linhas: p.itens.map((c) => linhaClienteRecebido(c, fuso)), proximoCursor: p.proximo_cursor };
}
