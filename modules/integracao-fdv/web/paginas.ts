/**
 * Páginas do BKO do módulo Integração FDV (RF-INF-04, RF-INF-05), descritas como dados. A tela principal (monitor,
 * credencial e ações) é desenhada pelo shell a partir de `monitor.ts`; a lista de lotes usa o descritor comum de lista do
 * SDK, o mesmo da rota `GET /v1/integracao-fdv/lotes[/exportar]`. Sem React nem Node. A permissão aqui só esconde botão:
 * a proteção real é a da API (RN-CORE-02).
 */
import { definirPaginaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import type { PaginaBase } from '@macuxierp/platform-sdk/paginas';
import { EntidadeHub, EstadoLote, LoteEnvioResumo } from '../contracts';
import { ROTULO_ENTIDADE, ROTULO_ESTADO_LOTE, ROTULO_MODO_LOTE } from './rotulos';

const colunasLotes: readonly ColunaLista<LoteEnvioResumo>[] = [
  { id: 'entidade', titulo: 'Cadastro', valor: (l) => ROTULO_ENTIDADE[l.entidade] },
  { id: 'estado', titulo: 'Situação', valor: (l) => ROTULO_ESTADO_LOTE[l.estado] },
  { id: 'modo', titulo: 'Tipo', valor: (l) => ROTULO_MODO_LOTE[l.modo] },
  { id: 'registros', titulo: 'Registros', valor: (l) => l.registros },
  { id: 'aceitos', titulo: 'Aceitos', valor: (l) => l.aceitos },
  { id: 'com_erro', titulo: 'Com erro', valor: (l) => l.com_erro },
  { id: 'tentativas', titulo: 'Tentativas', valor: (l) => l.tentativas },
  { id: 'ultimo_erro_mensagem', titulo: 'Motivo da falha', valor: (l) => l.ultimo_erro_mensagem },
  { id: 'enviado_em', titulo: 'Enviado em (UTC)', valor: (l) => l.enviado_em },
  { id: 'concluido_em', titulo: 'Concluído em (UTC)', valor: (l) => l.concluido_em },
];

export const paginaLotes = definirPaginaLista({
  id: 'lotes',
  api: '/v1/integracao-fdv/lotes',
  item: LoteEnvioResumo,
  filtros: { entidade: EntidadeHub.optional(), estado: EstadoLote.optional() },
  colunas: colunasLotes,
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
