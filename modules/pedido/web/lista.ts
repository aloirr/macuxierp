/**
 * Tela da lista de pedidos (RF-PED-05): colunas por perfil, linha formatada e filtros, sempre a partir do descritor
 * `paginaPedidos` (nada de tabela à mão). O documento do cliente nunca vem na lista JSON (só no CSV, e nunca para o
 * vendedor): a tela mostra o nome. A permissão aqui só esconde; a proteção real é a da API (RN-CORE-02).
 */
import { colunasDoPerfil, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import type { Perfil } from '@macuxierp/platform-sdk';
import { FONTE_CLIENTE, FONTE_FILIAL, FONTE_VENDEDOR } from './fontes';
import { podeVerDocumentoCliente } from '../domain/privacidade';
import { OrigemPedido, StatusPedido } from '../contracts';
import { formatarCentavos, formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { COLUNA_DOCUMENTO, ROTULO_STATUS, paginaPedidos, type ItemListaPedido } from './paginas';

export const ROTULO_ORIGEM: Readonly<Record<OrigemPedido, string>> = { fdv: 'Macuxi FDV', bko: 'Manual' };

/** Colunas do CSV do perfil: as do descritor, sem o documento do cliente para quem não pode vê-lo (mesma regra da API). */
export function colunasDoCsv(perfil: Perfil): ColunaLista<ItemListaPedido>[] {
  return colunasDoPerfil(paginaPedidos, perfil).filter((c) => c.id !== COLUNA_DOCUMENTO || podeVerDocumentoCliente(perfil));
}

/** Colunas da tabela do perfil: as do CSV, menos o documento (a lista JSON nunca o leva). */
export function colunasDaTela(perfil: Perfil): ColunaLista<ItemListaPedido>[] {
  return colunasDoCsv(perfil).filter((c) => c.id !== COLUNA_DOCUMENTO);
}

/** Linha para exibir: dinheiro em R$, data no fuso do tenant e rótulos em português. A chave é o `id` da coluna. */
export function linhaDaTela(p: ItemListaPedido, fuso: string): Record<string, string> {
  return {
    numero: String(p.numero),
    origem: ROTULO_ORIGEM[p.origem],
    status: ROTULO_STATUS[p.status],
    emitido_em: formatarDataHora(p.emitido_em, fuso),
    cliente_razao_social: p.cliente_razao_social,
    filial_id: p.filial_id,
    vendedor_id: p.vendedor_id ?? '',
    total_centavos: formatarCentavos(p.total_centavos),
    pendencias: p.pendencias > 0 ? String(p.pendencias) : '',
  };
}

/** Título da coluna na tabela: o total sai sem o "(R$)" do CSV (a célula já traz o símbolo). */
export function tituloDaColuna(c: ColunaLista<ItemListaPedido>): string {
  if (c.id === 'total_centavos') return 'Total';
  return c.titulo;
}

export type FiltroTela =
  | { chave: string; rotulo: string; tipo: 'selecao'; opcoes: readonly { valor: string; rotulo: string }[] }
  /** Escolha num cadastro (a API do cadastros alimenta o seletor; na URL vai só o UUID). */
  | { chave: string; rotulo: string; tipo: 'cadastro'; fonte: string }
  | { chave: string; rotulo: string; tipo: 'data' };

/** Filtros da barra, na ordem da tela; as chaves são as do descritor (a URL é a fonte da verdade). `busca` é o campo de número. */
export const FILTROS_TELA: readonly FiltroTela[] = [
  { chave: 'status', rotulo: 'Status', tipo: 'selecao', opcoes: StatusPedido.options.map((valor) => ({ valor, rotulo: ROTULO_STATUS[valor] })) },
  { chave: 'cliente_id', rotulo: 'Cliente', tipo: 'cadastro', fonte: FONTE_CLIENTE.caminho },
  { chave: 'vendedor_id', rotulo: 'Vendedor', tipo: 'cadastro', fonte: FONTE_VENDEDOR },
  { chave: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: FONTE_FILIAL },
  { chave: 'origem', rotulo: 'Origem', tipo: 'selecao', opcoes: OrigemPedido.options.map((valor) => ({ valor, rotulo: ROTULO_ORIGEM[valor] })) },
  { chave: 'de', rotulo: 'De', tipo: 'data' },
  { chave: 'ate', rotulo: 'Até', tipo: 'data' },
];

export const ROTULO_BUSCA = 'Número do pedido';
