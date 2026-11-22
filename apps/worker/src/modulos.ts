/**
 * Executores e rotinas montados no worker (T-0029). Desenho, ligações e adaptadores pendentes: `docs/desenho/T-0002.md`
 * (§2, "Integração de plataforma da F1", item "Worker").
 * - Rotina diária do alerta do A1 (RF-CORE-04, T-0035): adaptadores SQL do core.
 * - Exportação LGPD (RF-CORE-06, T-0040): registro SQL do core e um exportador por módulo (core e cadastros, T-0037;
 *   pedido, T-0016).
 *   O armazenamento vem do SDK.
 * - Carga inicial do cadastros (C-4, desenho T-0009 §4; ligada na T-0042): o consumidor de
 *   `integracao-fdv.carga_inicial.solicitada@1` enfileira um trabalho por entidade e o executor republica página a página.
 * - Agendas por tenant (contrato C-9, T-0009 §6.1): `montarAgendas`, vazia até o `integracao-fdv` ligar a dele.
 * - Pedidos do FDV (T-0016): em pedidos-fdv.ts (pendências no desenho T-0002 §2).
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
  PADRAO_TIPO_TRABALHO,
  type AgendaModulo,
  type Armazenamento,
  type Banco,
  type CatalogoArquivos,
  type ConsumidorEvento,
  type ExecutorTrabalho,
  type FilaDeTrabalhos,
  type Outbox,
} from '@macuxierp/platform-sdk';
import { exportadorPedido } from '@macuxierp/pedido/api';
import { FilaDeTrabalhosPg, OutboxPg } from '@macuxierp/platform-sdk/pg';
import type { Logger } from 'pino';
import { criarRotinaAlertaA1 } from './alerta-a1';
import { criarExecutorExportacao, type ExportadorModulo } from './exportacao-lgpd';
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

/** Id `<modulo>.<agenda>` do próprio módulo (padrão do tipo de trabalho) e sem duplicidade. */
export function registrarAgendas(agendas: readonly AgendaModulo[]): readonly AgendaModulo[] {
  const ids = new Set<string>();
  for (const a of agendas) {
    if (!PADRAO_TIPO_TRABALHO.test(a.id) || !a.id.startsWith(`${a.modulo}.`)) {
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

/** Consumidores da outbox, com os adaptadores reais (o despachante já roda cada um na transação do tenant do evento). */
export function montarConsumidores(d: { fila?: FilaDeTrabalhos } = {}): readonly ConsumidorEvento[] {
  return Object.freeze([criarConsumidorCargaInicial({ fila: d.fila ?? new FilaDeTrabalhosPg() })]);
}

/** Rotinas diárias, com os adaptadores reais. */
export function montarRotinas(d: Pick<DependenciasModulosWorker, 'banco' | 'log'>): readonly RotinaDiaria[] {
  return Object.freeze([criarRotinaAlertaA1({ banco: d.banco, tenants: fonteTenantsSql, certificados: fonteCertificadosSql, avisos: destinoAvisosSql, log: d.log })]);
}

/**
 * Agendas por tenant (T-0009 §6.1). Vazia por ora: o `integracao-fdv` acrescenta a dele (envio, lote, sinal,
 * reconciliação) na T-0011 L2, com os adaptadores SQL do módulo. Só roda com o cliente do Hub configurado (`main.ts`).
 */
export function montarAgendas(_d: Pick<DependenciasModulosWorker, 'banco' | 'log'>): readonly AgendaModulo[] {
  return registrarAgendas([]);
}
