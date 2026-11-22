/**
 * Faturamento no worker (T-0045 lote A; T-0021; README do faturamento, "O que o apps/api e o apps/worker ligam").
 * - A1 só aqui (ADR 0005 item 4): `lerA1DecifradoDaFilial` (core, papel `macuxierp_worker`, RLS) + `abrirA1` (nfe-emissor). O `pfx` é zerado
 *   também quando o `abrirA1` lança; a credencial do mTLS é o próprio objeto do core, com `pfx` e `senha` ocultos (regras 8 e 9).
 * - SEFAZ: SÓ o simulador (decisão do Alexandre, R-20261122-022626; ADR 0008, emenda de 22/11/2026). O seletor recebe só a fábrica do
 *   simulador, com o transporte fixo em `simulador`: nenhuma variável de ambiente liga a SEFAZ real (isso é a T-0046, por PR). Filial em
 *   produção fiscal recebe `SimuladorEmProducaoErro` do seletor, sem o simulador ser chamado (regra 7).
 * - Trabalhos e rotinas: README do faturamento e ADR 0008, emenda de 22/11. Cada trabalho abre as próprias transações (a SEFAZ vai fora
 *   delas); a `tx` do executor não é usada. Erro de configuração da SEFAZ desiste na hora (422, sem retentativa): repetir não muda nada.
 * - Lote 5 (#205): `titulos` e `log` no transmissor e no processador; varredura dos títulos de boleto (`criarVarreduraTitulos`) na mesma rotina de 60 s,
 *   só em tenant licenciado; consumidor do pedido aprovado com a situação ATUAL do pedido (`criarConsultaParaFaturar`, a mesma porta da API).
 * - #222: o transmissor recebe a situação do pedido (`criarConsultaParaFaturar`, RN-PED-02): pedido cancelado não lê o A1 nem assina.
 * Logs: só ids, contagens, códigos e nomes de erro; nunca XML, CNPJ/CPF, certificado ou senha.
 */
import { criarConsultaParaFaturamento, repositoriosSql as repositoriosCadastros } from '@macuxierp/cadastros/api';
import { lerA1DecifradoDaFilial } from '@macuxierp/core/api';
import {
  criarConsumidorPedidoAprovado,
  criarProcessadorEventos,
  criarTransmissor,
  criarVarreduraTitulos,
  repositoriosSql as repositoriosFaturamento,
  type A1DaFilial,
  type LogFaturamento,
  type PedidosAprovados,
  type RepositorioNotas,
  type SituacaoPedidoDoPedido,
} from '@macuxierp/faturamento/api';
import {
  ConsultarNotaPayload,
  ProcessarEventoPayload,
  ProcessarInutilizacaoPayload,
  TRABALHO_CONSULTAR_NOTA,
  TRABALHO_PROCESSAR_EVENTO,
  TRABALHO_PROCESSAR_INUTILIZACAO,
  TRABALHO_TRANSMITIR_NOTA,
  TransmitirNotaPayload,
} from '@macuxierp/faturamento/contracts';
import { criarConsultaParaFaturar } from '@macuxierp/pedido/api';
import { abrirA1, criarEmissorNFe, type EmissorNFe } from '@macuxierp/nfe-emissor';
import { criarSeletorTransporte, DESLOCAMENTO_MANAUS_MIN, ErroSefaz, type FabricaTransporteSimulador, type SeletorTransporte } from '@macuxierp/nfe-sefaz';
import { criarFabricaSimulador } from '@macuxierp/sefaz-simulador';
import { ErroApi, moduloLicenciado, type Banco, type ConsumidorEvento, type ExecutorTrabalho, type FonteLicencas, type Transacao } from '@macuxierp/platform-sdk';
import { OutboxPg } from '@macuxierp/platform-sdk/pg';
import type { Logger } from 'pino';
import type { z } from 'zod';
import type { FonteTenants } from './alerta-a1';
import { nomeDoErro } from './backoff';
import type { RotinaDiaria, RotinaPeriodica } from './rotinas';

/**
 * Para onde vai a filial em HOMOLOGAÇÃO neste worker: sempre o simulador (R-20261122-022626). Constante, sem leitura de ambiente: trocar para
 * a SEFAZ real exige a fábrica SOAP (`criarFabricaTransporteSoap`) ligada aqui, por PR, na T-0046.
 */
export const TRANSPORTE_HOMOLOGACAO_DO_WORKER = 'simulador' as const;

/**
 * Seletor de transporte do worker. Só a fábrica do simulador: `transporte: 'sefaz'` (que este módulo nunca passa) daria
 * `SEFAZ_TRANSPORTE_NAO_CONFIGURADO`, e a filial em produção dá `SimuladorEmProducaoErro` antes de qualquer fábrica ser chamada.
 * `simulador` existe para os testes (espião ou registro próprio); o padrão é um registro único para o processo.
 */
export function criarSefazDoWorker(o: { simulador?: FabricaTransporteSimulador } = {}): SeletorTransporte {
  return criarSeletorTransporte({ transporte: TRANSPORTE_HOMOLOGACAO_DO_WORKER, simulador: o.simulador ?? criarFabricaSimulador() });
}

/**
 * `lerA1` do transmissor e do processador: o A1 decifrado da filial (core) aberto pelo emissor. `null` = filial sem A1 ativo. O
 * `ErroCertificadoA1` do `abrirA1` (vencido, senha, sem chave) sobe para o faturamento decidir, mas o `pfx` decifrado é zerado antes.
 */
export function criarLerA1DoWorker(chaveA1: Buffer, agora: () => Date = () => new Date()): (tx: Transacao, filial_id: string) => Promise<A1DaFilial | null> {
  return async (tx, filial_id) => {
    const decifrado = await lerA1DecifradoDaFilial(tx, chaveA1, filial_id);
    if (!decifrado) return null;
    try {
      const certificado = abrirA1(decifrado.pfx, decifrado.senha, agora());
      return { certificado, credencial: decifrado };
    } catch (e) {
      decifrado.pfx.fill(0);
      throw e;
    }
  };
}

/** Códigos da SEFAZ que são configuração do worker, não falha passageira: o trabalho desiste na hora. */
const ERRO_DE_CONFIGURACAO: ReadonlySet<string> = new Set([
  'SEFAZ_SIMULADOR_EM_PRODUCAO',
  'SEFAZ_TRANSPORTE_NAO_CONFIGURADO',
  'SEFAZ_ENDERECO_NAO_CONFERIDO',
  'SEFAZ_FILIAL_INVALIDA',
  'SEFAZ_UF_SEM_AUTORIZADOR',
  'SEFAZ_CONTINGENCIA_INVALIDA',
]);

async function semRetentarConfiguracao<T>(fazer: () => Promise<T>): Promise<T> {
  try {
    return await fazer();
  } catch (e) {
    if (e instanceof ErroSefaz && ERRO_DE_CONFIGURACAO.has(e.codigo)) throw new ErroApi(422, e.codigo, e.message);
    throw e;
  }
}

/** Resumo gravado no `plataforma.trabalho`: só o resultado e os códigos (nada de nota, XML ou mensagem da SEFAZ). */
function resumo(r: { resultado: string; motivo?: string; codigo?: string; status?: string }): Record<string, unknown> {
  return { resultado: r.resultado, ...(r.motivo ? { motivo: r.motivo } : {}), ...(r.codigo ? { codigo: r.codigo } : {}), ...(r.status ? { status: r.status } : {}) };
}

function executor<S extends z.ZodTypeAny>(tipo: string, payload: S, fazer: (tenant_id: string, p: z.infer<S>) => Promise<{ resultado: string }>): ExecutorTrabalho {
  return {
    tipo,
    async executar(t) {
      const p = payload.parse(t.payload) as z.infer<S>;
      return resumo(await semRetentarConfiguracao(() => fazer(t.tenant_id, p)));
    },
  };
}

export interface DependenciasFaturamentoWorker {
  /** Banco no papel `macuxierp_worker` (o único que lê as colunas cifradas do A1). */
  banco: Banco;
  /** `MACUXIERP_CHAVE_A1` lida com `lerChaveA1` (core); nunca vai a log. */
  chaveA1: Buffer;
  log: Logger;
  tenants: FonteTenants;
  licencas: FonteLicencas;
  agora?: () => Date;
  /** Padrão: `criarSefazDoWorker()` (só o simulador). */
  sefaz?: SeletorTransporte;
  /** Padrão: `criarEmissorNFe()` completo (montar, assinar, transmitir). */
  emissor?: EmissorNFe;
  /**
   * RN-PED-02: situação do pedido antes de assinar (#222). Padrão: `criarConsultaParaFaturar().situacao` do pedido, a MESMA porta da emissão
   * na API e do consumidor do pedido aprovado (pedido cancelado não vira nota assinada).
   */
  situacao?: SituacaoPedidoDoPedido;
  /** Intervalo da varredura (padrão 60 s). */
  intervaloVarreduraMs?: number;
  /** Hora UTC do alerta das numeradas não enviadas (padrão 11 h UTC = 7 h em Manaus). */
  horaUtcAlerta?: number;
}

export interface MontagemFaturamentoWorker {
  executores: readonly ExecutorTrabalho[];
  periodicas: readonly RotinaPeriodica[];
  rotinas: readonly RotinaDiaria[];
}

/**
 * `LogFaturamento` sobre o pino do worker: uma linha `warn` por ocorrência (título pendente ou desistido, divergência de título no cancelamento),
 * com `modulo` e só o que o faturamento manda (ids, contagens e motivo de regra; nunca dado pessoal, regra 8).
 */
export function logFaturamentoDoWorker(log: Pick<Logger, 'warn'>): LogFaturamento {
  return (e) => log.warn({ modulo: 'faturamento', ...e }, e.evento);
}

/**
 * Consumidor de `pedido.pedido.aprovado@1` (fila `pedido_a_faturar`): não depende do A1 e entra sempre. A situação é a MESMA porta da
 * emissão na API (`criarConsultaParaFaturar` do pedido): a reentrega de um aprovado antigo não ressuscita pedido cancelado (README do faturamento).
 */
export function consumidoresFaturamento(o: { pedidos?: PedidosAprovados; situacao?: SituacaoPedidoDoPedido } = {}): readonly ConsumidorEvento[] {
  return [criarConsumidorPedidoAprovado({ pedidos: o.pedidos ?? repositoriosFaturamento({ outbox: new OutboxPg() }).pedidos, situacao: o.situacao ?? criarConsultaParaFaturar() })];
}

/** Varredura dos títulos (RN-FAT-03): nota autorizada de boleto sem título há este tempo gera de novo (a geração normal é na mesma tx da autorização). */
export const TITULOS_PARADOS_HA_MINUTOS = 5;
/** Notas por tenant em cada varredura de títulos. */
export const LIMITE_VARREDURA_TITULOS = 50;

/** Resultados conhecidos do `processarPendentes` (evento e inutilização); o resto é o nome do erro que o processador capturou. */
const RESULTADOS_DE_EVENTO: ReadonlySet<string> = new Set(['registrado', 'rejeitado', 'registrada', 'rejeitada', 'divergente', 'ignorada', 'sem_certificado', 'ambiente_mudou', 'filial_invalida']);

export function montarFaturamentoWorker(d: DependenciasFaturamentoWorker): MontagemFaturamentoWorker {
  const agora = d.agora ?? (() => new Date());
  const repos = repositoriosFaturamento({ outbox: new OutboxPg(), agora });
  const lerA1 = criarLerA1DoWorker(d.chaveA1, agora);
  const emissor = d.emissor ?? criarEmissorNFe();
  const sefaz = d.sefaz ?? criarSefazDoWorker();
  const log = logFaturamentoDoWorker(d.log);
  const comuns = { banco: d.banco, notas: repos.notas, titulos: repos.titulos, log, ambiente: repos.ambiente, lerA1, emissor, sefaz, agora };
  const situacao = d.situacao ?? criarConsultaParaFaturar();
  const transmissor = criarTransmissor({ ...comuns, situacao });
  const processador = criarProcessadorEventos({ ...comuns, eventos: repos.eventos, cadastros: criarConsultaParaFaturamento(repositoriosCadastros) });
  // Uma por processo: o teto de tentativas por nota fica na memória da instância (titulos.md).
  const varrerTitulos = criarVarreduraTitulos({ titulos: repos.titulos, notas: repos.notas, log });

  const executores = [
    executor(TRABALHO_TRANSMITIR_NOTA, TransmitirNotaPayload, (t, p) => transmissor.transmitirNota(t, p.nota_id)),
    executor(TRABALHO_PROCESSAR_EVENTO, ProcessarEventoPayload, (t, p) => processador.processarEvento(t, p.evento_id)),
    executor(TRABALHO_PROCESSAR_INUTILIZACAO, ProcessarInutilizacaoPayload, (t, p) => processador.processarInutilizacao(t, p.inutilizacao_id)),
    executor(TRABALHO_CONSULTAR_NOTA, ConsultarNotaPayload, (t, p) => processador.consultarNota(t, p.nota_id)),
  ];

  const tenantsLicenciados = async (quando: Date): Promise<string[]> => {
    const ativos = await d.banco.semTenant((tx) => d.tenants.ativos(tx));
    const saida: string[] = [];
    for (const t of ativos) {
      if (await d.banco.comTenant(t, async (tx) => moduloLicenciado(await d.licencas.ler(tx, t), 'faturamento', quando))) saida.push(t);
    }
    return saida;
  };

  const varredura: RotinaPeriodica = {
    id: 'faturamento.varredura',
    intervaloMs: d.intervaloVarreduraMs ?? 60_000,
    async executar(quando) {
      const r = { tenants: 0, notas: 0, eventos: 0, titulos: 0, titulos_pendentes: 0, falhas: 0 };
      for (const tenant_id of await tenantsLicenciados(quando)) {
        r.tenants++;
        // Títulos à parte (savepoint por nota, na tx do tenant): uma falha na SEFAZ ou nos eventos não segura a geração, e vice-versa.
        try {
          const t = await d.banco.comTenant(tenant_id, (tx) => varrerTitulos(tx, { ha_minutos: TITULOS_PARADOS_HA_MINUTOS, limite: LIMITE_VARREDURA_TITULOS }));
          r.titulos += t.geradas;
          r.titulos_pendentes += t.pendentes;
        } catch (e) {
          r.falhas++;
          d.log.warn({ rotina: 'faturamento.varredura', modulo: 'faturamento', tenant_id, erro: nomeDoErro(e) }, 'varredura de títulos falhou no tenant');
        }
        try {
          const notas = await transmissor.transmitirPendentes(tenant_id);
          const eventos = await processador.processarPendentes(tenant_id);
          r.notas += notas.length;
          r.eventos += eventos.length;
          const falhas = [
            ...notas.filter((n) => n.resultado.resultado === 'falha').map((n) => ({ nota_id: n.nota_id, erro: 'codigo' in n.resultado ? n.resultado.codigo : 'ERRO' })),
            ...eventos.filter((e) => !RESULTADOS_DE_EVENTO.has(e.resultado)).map((e) => ({ [`${e.tipo}_id`]: e.id, erro: e.resultado })),
          ];
          r.falhas += falhas.length;
          for (const f of falhas) d.log.warn({ rotina: 'faturamento.varredura', modulo: 'faturamento', tenant_id, ...f }, 'varredura do faturamento: item falhou');
        } catch (e) {
          r.falhas++;
          d.log.warn({ rotina: 'faturamento.varredura', modulo: 'faturamento', tenant_id, erro: nomeDoErro(e) }, 'varredura do faturamento falhou no tenant');
        }
      }
      return r;
    },
  };

  return { executores, periodicas: [varredura], rotinas: [criarAlertaNumeradasNaoEnviadas({ ...d, notas: repos.notas, tenantsLicenciados })] };
}

/** Fuso do tenant: fixo em Manaus na v1 (pendência: o fuso vem do tenant, RN-CORE; o prazo da RN-FAT-01 vai ao domain do faturamento). */
const DESLOCAMENTO_MANAUS_MS = DESLOCAMENTO_MANAUS_MIN * 60_000;

/** Data civil `AAAA-MM-DD` em Manaus. */
const diaEmManaus = (t: Date): string => new Date(t.getTime() + DESLOCAMENTO_MANAUS_MS).toISOString().slice(0, 10);

/** Instante UTC da 0 h do dia 1 do mês corrente em Manaus. */
export function inicioDoMesEmManaus(agora: Date): Date {
  const local = new Date(agora.getTime() + DESLOCAMENTO_MANAUS_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DESLOCAMENTO_MANAUS_MS);
}

/** RN-FAT-01: prazo da inutilização = dia 10 do mês seguinte ao da emissão (data civil em Manaus). */
export function prazoInutilizacao(emitidaEm: Date): string {
  const local = new Date(emitidaEm.getTime() + DESLOCAMENTO_MANAUS_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 10)).toISOString().slice(0, 10);
}

/**
 * Alerta diário (RN-FAT-01, alerta antes do dia 10): notas numeradas e não enviadas (`rascunho`/`rejeitada`) emitidas antes do mês
 * corrente em Manaus. O prazo delas para a inutilização é o dia 10 deste mês (ou já passou). Uma linha de aviso por nota, só com ids,
 * série, número e prazo. PENDÊNCIA: o aviso no BKO precisa de destino próprio (hoje só o log do worker).
 */
export function criarAlertaNumeradasNaoEnviadas(d: {
  banco: Banco;
  log: Logger;
  notas: Pick<RepositorioNotas, 'numeradasNaoEnviadas'>;
  tenantsLicenciados: (agora: Date) => Promise<string[]>;
  horaUtcAlerta?: number;
}): RotinaDiaria {
  return {
    id: 'faturamento.alerta_inutilizacao',
    horaUtc: d.horaUtcAlerta ?? 11,
    async executar(agora) {
      const r = { tenants: 0, notas: 0, atrasadas: 0, falhas: 0 };
      const hoje = diaEmManaus(agora);
      for (const tenant_id of await d.tenantsLicenciados(agora)) {
        r.tenants++;
        try {
          const notas = await d.banco.comTenant(tenant_id, (tx) => d.notas.numeradasNaoEnviadas(tx, inicioDoMesEmManaus(agora)));
          for (const n of notas) {
            const prazo = prazoInutilizacao(new Date(n.emitida_em));
            const atrasada = hoje > prazo;
            r.notas++;
            if (atrasada) r.atrasadas++;
            d.log.warn(
              { rotina: 'faturamento.alerta_inutilizacao', modulo: 'faturamento', tenant_id, nota_id: n.id, filial_id: n.filial_id, ambiente: n.ambiente, serie: n.serie, numero: n.numero, status: n.status, prazo, atrasada },
              'RN-FAT-01: número emitido e não enviado; inutilize até o prazo',
            );
          }
        } catch (e) {
          r.falhas++;
          d.log.warn({ rotina: 'faturamento.alerta_inutilizacao', modulo: 'faturamento', tenant_id, erro: nomeDoErro(e) }, 'alerta das numeradas não enviadas falhou no tenant');
        }
      }
      return r;
    },
  };
}
