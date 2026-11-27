/**
 * Páginas do BKO do módulo Integração FDV (RF-INF-04, RF-INF-05), descritas como dados. A tela principal (monitor,
 * credencial e ações) é desenhada pelo shell a partir de `monitor.ts`; a lista de lotes usa o descritor comum de lista do
 * SDK, o mesmo da rota `GET /v1/integracao-fdv/lotes[/exportar]`. Sem React nem Node. A permissão aqui só esconde botão:
 * a proteção real é a da API (RN-CORE-02).
 */
import { FUSO_PADRAO } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import type { PaginaBase } from '@macuxierp/platform-sdk/paginas';
import { EntidadeHub, EstadoLote, LoteEnvioResumo } from '../contracts';
import { ROTULO_ENTIDADE, ROTULO_ESTADO_LOTE, ROTULO_MODO_LOTE } from './rotulos';

/** Tipos de coluna do `TabelaDensa` do packages/ui (mesmo formato do faturamento): `numero` alinha à direita; `data` e `status` têm desenho próprio. */
export type TipoColunaLista = 'texto' | 'numero' | 'dinheiro' | 'data' | 'status';
export type TomSelo = 'ok' | 'alerta' | 'erro' | 'neutro';
export interface SeloLote {
  texto: string;
  tom: TomSelo;
}
/** `selos`: o que a tela desenha como selo na célula (o CSV usa só o `valor`, em texto). */
export type ColunaLote = ColunaLista<LoteEnvioResumo> & { tipo?: TipoColunaLista; selos?: (linha: LoteEnvioResumo) => readonly SeloLote[] };

/** Formata um instante ISO no fuso do tenant (`DD/MM/AAAA HH:mm`); vazio para nulo ou ausente. */
const hora = (fuso: string) => (iso: string | null | undefined): string => (iso ? formatarDataHora(iso, fuso) : '');

const TOM_ESTADO_LOTE: Readonly<Record<EstadoLote, TomSelo>> = {
  montado: 'neutro',
  enviando: 'neutro',
  aceito: 'neutro',
  concluido: 'ok',
  concluido_com_erros: 'alerta',
  falhou: 'erro',
  recusado: 'erro',
};

/** Colunas da lista de lotes; as de data saem no fuso do tenant (o shell chama com `eu.empresa.fuso`). */
export const colunasDeLotes = (fuso: string): readonly ColunaLote[] => [
  { id: 'entidade', titulo: 'Cadastro', valor: (l) => ROTULO_ENTIDADE[l.entidade] },
  { id: 'estado', titulo: 'Situação', tipo: 'status', valor: (l) => ROTULO_ESTADO_LOTE[l.estado], selos: (l) => [{ texto: ROTULO_ESTADO_LOTE[l.estado], tom: TOM_ESTADO_LOTE[l.estado] }] },
  { id: 'modo', titulo: 'Tipo', valor: (l) => ROTULO_MODO_LOTE[l.modo] },
  { id: 'registros', titulo: 'Registros', tipo: 'numero', valor: (l) => l.registros },
  { id: 'aceitos', titulo: 'Aceitos', tipo: 'numero', valor: (l) => l.aceitos },
  { id: 'com_erro', titulo: 'Com erro', tipo: 'numero', valor: (l) => l.com_erro },
  { id: 'tentativas', titulo: 'Tentativas', tipo: 'numero', valor: (l) => l.tentativas },
  { id: 'ultimo_erro_mensagem', titulo: 'Motivo da falha', valor: (l) => l.ultimo_erro_mensagem },
  { id: 'enviado_em', titulo: 'Enviado em', tipo: 'data', valor: (l) => hora(fuso)(l.enviado_em) },
  { id: 'concluido_em', titulo: 'Concluído em', tipo: 'data', valor: (l) => hora(fuso)(l.concluido_em) },
];

export const paginaLotes = definirPaginaLista({
  id: 'lotes',
  api: '/v1/integracao-fdv/lotes',
  item: LoteEnvioResumo,
  filtros: { entidade: EntidadeHub.optional(), estado: EstadoLote.optional() },
  colunas: colunasDeLotes(FUSO_PADRAO),
  csv: { arquivo: 'lotes-integracao-fdv.csv' },
});

export interface PaginaIntegracaoFdv extends PaginaBase {
  readonly id: string;
  /** `monitor`: tela principal; `lotes`: histórico de lotes (lista do SDK). */
  readonly tipo: 'monitor' | 'lotes';
}

/**
 * A rota segue a convenção do shell: `/<módulo>/<slug do rótulo do menu>` (`apps/web/src/lib/menu.ts`). O histórico de lotes
 * é uma segunda página do mesmo item de menu (`ocultaNoMenu`), aberta a partir do monitor.
 */
export const PAGINAS_INTEGRACAO_FDV: readonly PaginaIntegracaoFdv[] = [
  { id: 'monitor', tipo: 'monitor', menu: 'Integração FDV', titulo: 'Integração FDV', rota: '/integracao-fdv/integracao-fdv', ver: 'integracao-fdv.ver' },
  { id: 'lotes', tipo: 'lotes', menu: 'Integração FDV', titulo: 'Envios ao FDV', rota: '/integracao-fdv/integracao-fdv/lotes', ver: 'integracao-fdv.ver', ocultaNoMenu: true },
];

/** A página com as datas no fuso do tenant: a rota `/lotes/exportar` usa no CSV; o descritor fica no `FUSO_PADRAO`. */
export const paginaLotesNoFuso = (fuso: string): typeof paginaLotes => ({ ...paginaLotes, colunas: colunasDeLotes(fuso) });
