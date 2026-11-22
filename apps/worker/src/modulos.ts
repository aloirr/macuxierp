/**
 * Executores e rotinas montados no worker (T-0029). Desenho, ligações e adaptadores pendentes: `docs/desenho/T-0002.md`
 * (§2, "Integração de plataforma da F1", item "Worker").
 * - Rotina diária do alerta do A1 (RF-CORE-04, T-0035): adaptadores SQL do core.
 * - Exportação LGPD (RF-CORE-06, T-0040): registro SQL do core e um exportador por módulo (core e cadastros, T-0037;
 *   pedido, T-0016).
 *   O armazenamento vem do SDK.
 * - Carga inicial do cadastros (C-4, desenho T-0009 §4; ligada na T-0042): o consumidor de
 *   `integracao-fdv.carga_inicial.solicitada@1` enfileira um trabalho por entidade e o executor republica página a página.
 * - Agendas por tenant (contrato C-9, T-0009 §6.1; T-0016): `montarAgendas`: conector (`MACUXIERP_FDV_ENVIO`) e pedidos
 *   (`MACUXIERP_FDV_RECEBIMENTO`); trava de 22/11/2026, ver envio-fdv.ts.
 * - Consumidores do `integracao-fdv` (T-0016): `integracao-fdv.publicar-cadastros` (espelho do que vai ao Hub, com a
 *   licença PG) e `integracao-fdv.retorno-pedido` (grava o retorno do status do pedido para a agenda de retorno).
 * - Pedidos do FDV (T-0016): as peças (recebedor, resolvedor, alerta) em pedidos-fdv.ts.
 */
import { criarConsumidorCargaInicial, criarExecutorCargaInicial, exportadorCadastros, repositoriosSql } from '@macuxierp/cadastros/api';
import {
  destinoAvisosSql,
  exportadorCore,
  fonteCertificadosSql,
  fonteTenantsSql,
  registroExportacoesSql,
} from '@macuxierp/core/api';
import {
  criarAgendaConector,
  criarAgendasPedidosFdv,
  criarConsumidorPublicarCadastros,
  criarConsumidorRetornoPedido,
} from '@macuxierp/integracao-fdv/api';
import {
  PADRAO_ID_AGENDA,
  PADRAO_TIPO_TRABALHO,
  type AgendaModulo,
  type Armazenamento,
  type Banco,
  type CatalogoArquivos,
  type ConsumidorEvento,
  type ExecutorTrabalho,
  type FilaDeTrabalhos,
  type FonteLicencas,
  type Outbox,
  type Relogio,
} from '@macuxierp/platform-sdk';
import { exportadorPedido } from '@macuxierp/pedido/api';
import { FilaDeTrabalhosPg, LicencasPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
import type { Logger } from 'pino';
import { criarRotinaAlertaA1 } from './alerta-a1';
import type { EstadoEnvioFdv } from './envio-fdv';
import { criarExecutorExportacao, type ExportadorModulo } from './exportacao-lgpd';
import { criarAlertaMonitor, type MontagemPedidosFdv } from './pedidos-fdv';
import type { RotinaDiaria } from './rotinas';

export class RegistroExecutoresInvalido extends Error {
  override readonly name = 'RegistroExecutoresInvalido';
}

export function registrarExecutores(executores: readonly ExecutorTrabalho[]): readonly ExecutorTrabalho[] {
  const tipos = new Set<string>();
  for (const e of executores) {
    if (!PADRAO_TIPO_TRABALHO.test(e.tipo)) throw new RegistroExecutoresInvalido(`tipo de trabalho "${e.tipo}" fora de <modulo>.<tarefa>`);
    if (tipos.has(e.tipo)) throw new RegistroExecutoresInvalido(`dois executores para "${e.tipo}"`);
    tipos.add(e.tipo);
  }
  return Object.freeze([...executores]);
}

/** Id `<modulo>.<agenda>` do próprio módulo (`PADRAO_ID_AGENDA` do C-9) e sem duplicidade. */
export function registrarAgendas(agendas: readonly AgendaModulo[]): readonly AgendaModulo[] {
  const ids = new Set<string>();
  for (const a of agendas) {
    if (!PADRAO_ID_AGENDA.test(a.id) || !a.id.startsWith(`${a.modulo}.`)) {
      throw new RegistroExecutoresInvalido(`agenda "${a.id}" fora de <modulo>.<agenda> do módulo ${a.modulo}`);
    }
    if (ids.has(a.id)) throw new RegistroExecutoresInvalido(`duas agendas "${a.id}"`);
    ids.add(a.id);
  }
  return Object.freeze([...agendas]);
}

/** Um por módulo que guarda dado do tenant; cada módulo acrescenta o seu quando tiver o adaptador. */
export const EXPORTADORES: readonly ExportadorModulo[] = Object.freeze([exportadorCore, exportadorCadastros, exportadorPedido]);

export interface DependenciasModulosWorker {
  banco: Banco;
  log: Logger;
  armazenamento: Armazenamento;
  catalogo: CatalogoArquivos;
  agora: () => Date;
  /** Padrão: `plataforma.trabalho` (PG), na transação do tenant. */
  fila?: FilaDeTrabalhos;
  /** Padrão: `plataforma.evento` (PG), na transação do tenant. */
  outbox?: Outbox;
}

/** Executores da fila de trabalhos, com os adaptadores reais. */
export function montarExecutores(d: DependenciasModulosWorker): readonly ExecutorTrabalho[] {
  return registrarExecutores([
    criarExecutorExportacao({ registro: registroExportacoesSql, exportadores: EXPORTADORES, armazenamento: d.armazenamento, catalogo: d.catalogo, agora: d.agora }),
    criarExecutorCargaInicial({ repositorios: repositoriosSql, fila: d.fila ?? new FilaDeTrabalhosPg(), outbox: d.outbox ?? new OutboxPg(), agora: d.agora }),
  ]);
}

export interface DependenciasConsumidoresWorker {
  log: Logger;
  relogio: Relogio;
  /** Padrão: `plataforma.trabalho` (PG), na transação do tenant. */
  fila?: FilaDeTrabalhos;
  /** Padrão: `plataforma.tenant_modulo` (PG). */
  licencas?: FonteLicencas;
}

/**
 * Consumidores da outbox, com os adaptadores reais (o despachante já roda cada um na transação do tenant do evento):
 * carga inicial do cadastros, espelho do `integracao-fdv` (`publicar-cadastros`) e retorno do pedido. O consumidor do
 * retorno entra mesmo com o recebimento desligado: só grava a fila local (`retorno_enviado`) e nunca chama o Hub; sem
 * `pedido_recebido` do conector, ele só loga e ignora. O alerta do monitor (`criarAlertaMonitor`, T-0011) vai junto: o
 * retorno descartado sem chave do produto aparece no monitor.
 */
export function montarConsumidores(d: DependenciasConsumidoresWorker): readonly ConsumidorEvento[] {
  return Object.freeze([
    criarConsumidorCargaInicial({ fila: d.fila ?? new FilaDeTrabalhosPg() }),
    criarConsumidorPublicarCadastros({ licencas: d.licencas ?? new LicencasPg(), agora: () => d.relogio.agora() }),
    criarConsumidorRetornoPedido({ log: d.log, relogio: d.relogio, alertar: criarAlertaMonitor(d.log) }),
  ]);
}

/** Rotinas diárias, com os adaptadores reais. */
export function montarRotinas(d: Pick<DependenciasModulosWorker, 'banco' | 'log'>): readonly RotinaDiaria[] {
  return Object.freeze([criarRotinaAlertaA1({ banco: d.banco, tenants: fonteTenantsSql, certificados: fonteCertificadosSql, avisos: destinoAvisosSql, log: d.log })]);
}

export interface DependenciasAgendasWorker {
  log: Logger;
  relogio: Relogio;
  /** As peças do `montarPedidosFdv`. */
  pedidosFdv: MontagemPedidosFdv;
  /** `MACUXIERP_FDV_ENVIO`: trava de 22/11/2026, ver envio-fdv.ts. */
  envio: EstadoEnvioFdv;
  /** Padrão: `plataforma.evento` (PG); a agenda do conector grava `lote.enviado@1`/`lote.falhou@1` na transação do lote. */
  outbox?: Outbox;
}

/**
 * Agendas por tenant (T-0009 §6.1), todas do `integracao-fdv`: o conector só com o envio ligado e a busca e o retorno de
 * pedidos só com o recebimento ligado (trava de 22/11/2026, ver envio-fdv.ts). A outbox vai pela fábrica
 * (`criarAgendaConector({ outbox })`).
 */
export function montarAgendas(d: DependenciasAgendasWorker): readonly AgendaModulo[] {
  const { recebedor, resolvedor, alertar, recebimento } = d.pedidosFdv;
  return registrarAgendas([
    ...(d.envio === 'ligado' ? [criarAgendaConector({ outbox: d.outbox ?? new OutboxPg() })] : []),
    ...(recebimento === 'ligado' ? criarAgendasPedidosFdv({ recebedor, resolvedor, alertar, log: d.log, relogio: d.relogio }) : []),
  ]);
}
