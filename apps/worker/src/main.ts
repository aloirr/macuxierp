/**
 * Entrada do worker: adaptadores PostgreSQL no papel `macuxierp_worker` (conferido na partida: sem superusuário nem
 * BYPASSRLS), laço da outbox e dos trabalhos e encerramento limpo no SIGTERM do deploy (ADR 0003).
 * Ambiente: conexão pelas variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_worker`, `PGPASSWORD`,
 * `PGDATABASE`); `MACUXIERP_WORKER_INTERVALO_MS` (padrão 1000), `MACUXIERP_PG_POOL` (padrão 5, mínimo 4: `config.ts`) e
 * `MACUXIERP_OUTBOX_MAX_TENTATIVAS` (padrão 10; depois, evento `falhou` com alerta, T-0045). Na partida, a reentrega dos
 * eventos já publicados aos consumidores que ainda não os aplicaram (`reentrega.ts`). Nada de segredo em código.
 * Consumidores, executores e rotinas: `modulos.ts` (carga inicial do cadastros, exportação LGPD de core e cadastros e alerta
 * do A1, com os adaptadores SQL dos módulos). O log leva só
 * contagens, ids e nomes de erro, nunca dado pessoal (regra 8).
 * Agendas por tenant (contrato C-9, T-0009 §6.1; `agenda.ts`, `montarAgendas`) falam com o Hub do FDV (T-0009 §6):
 * `MACUXIERP_HUB_URL_TESTE` e `MACUXIERP_HUB_URL_PRODUCAO` (`hub.ts`) e a chave mestra das credenciais do conector
 * `MACUXIERP_CHAVE_INTEGRACAO` (`credencial.ts`). Sem essa configuração o laço de agenda fica desligado (nada sai para o
 * Hub e as agendas ficam paradas no banco), com um aviso só no log listando as variáveis que faltam. A versão do ERP
 * (User-Agent) vem de `MACUXIERP_VERSAO` (o compose entrega; padrão 'dev').
 * `MACUXIERP_FDV_RECEBIMENTO` (pedidos do FDV, T-0016) e `MACUXIERP_FDV_ENVIO`: interruptor, ver envio-fdv.ts.
 * Faturamento (T-0045 lote A): `MACUXIERP_CHAVE_A1` (a mesma da API, ADR 0005) liga a assinatura e os trabalhos da SEFAZ, que vão SÓ ao
 * simulador (faturamento.ts; nenhuma variável liga a SEFAZ real). Sem ela, os trabalhos do faturamento ficam na fila, com um aviso no log.
 * Purga da memória do simulador: purga-simulador.ts (T-0045 §9).
 */
import { fonteTenantsSql, lerChaveA1 } from '@macuxierp/core/api';
import { aditivosClienteFdvLigados, armazenamentoIndisponivel, relogioDoSistema } from '@macuxierp/platform-sdk';
import { BancoPg, CatalogoArquivosPg, criarPool, LicencasPg } from '@macuxierp/platform-sdk/pg';
import { pino } from 'pino';
import { completarPrazoMedioLigado } from './completar-prazo-medio';
import { inteiroDoAmbiente, poolDoWorker } from './config';
import { configurarCredenciais } from './credencial';
import { configurarEnvioFdv } from './envio-fdv';
import { montarFaturamentoWorker, TRANSPORTE_HOMOLOGACAO_DO_WORKER } from './faturamento';
import { configurarHub, versaoDoErp } from './hub';
import { montarAgendas, montarConsumidores, montarExecutores, montarPeriodicas, montarRotinas } from './modulos';
import { conferirRecebimentoFdv, configurarRecebimentoFdv, criarAlertaMonitor, montarPedidosFdv, resolvedorChaveErpDeProducao } from './pedidos-fdv';
import { FilaOutboxPg, FonteReentregaPg, RegistroConsumoPg, ReservaTrabalhosPg } from './pg';
import { iniciarWorker } from './worker';

const log = pino({ level: 'info', base: { servico: 'macuxierp-worker' } });
const pool = criarPool('macuxierp-worker', poolDoWorker(process.env));
const banco = new BancoPg(pool);
await banco.conferirPapel('macuxierp_worker');

const hub = configurarHub(process.env, versaoDoErp(process.env));
const decifrarCredencial = configurarCredenciais(process.env);
const faltando = [...(hub ? [] : ['MACUXIERP_HUB_URL_TESTE', 'MACUXIERP_HUB_URL_PRODUCAO']), ...(decifrarCredencial ? [] : ['MACUXIERP_CHAVE_INTEGRACAO'])];
const recebimento = configurarRecebimentoFdv(process.env);
const envio = configurarEnvioFdv(process.env);
conferirRecebimentoFdv(recebimento, faltando);
if (faltando.length) log.warn({ faltando }, 'laço de agenda desligado');
const aditivosCliente = aditivosClienteFdvLigados(process.env);
const pedidosFdv = montarPedidosFdv({ log, relogio: relogioDoSistema, recebimento, resolvedor: resolvedorChaveErpDeProducao(), aditivosCliente });
const agendas = hub && decifrarCredencial ? montarAgendas({ log, relogio: relogioDoSistema, pedidosFdv, envio }) : [];
log.info(
  { recebimento_pedidos_fdv: recebimento, envio_fdv: envio, aditivos_cliente_fdv: aditivosCliente, agendas: agendas.map((a) => a.id) },
  'pedidos e clientes do FDV',
);

/** A chave do A1 (ADR 0005): presente e inválida derruba a partida (a mensagem cita só o nome). */
function chaveA1DoAmbiente(): Buffer | null {
  const bruto = process.env.MACUXIERP_CHAVE_A1;
  if (!bruto?.trim()) return null;
  try {
    return lerChaveA1(bruto);
  } catch {
    throw new Error('configuração inválida: MACUXIERP_CHAVE_A1 (precisa de 32 bytes (hex ou base64))');
  }
}
const chaveA1 = chaveA1DoAmbiente();
const faturamento = chaveA1 ? montarFaturamentoWorker({ banco, chaveA1, log, tenants: fonteTenantsSql, licencas: new LicencasPg() }) : undefined;
if (faturamento) log.info({ sefaz_homologacao: TRANSPORTE_HOMOLOGACAO_DO_WORKER }, 'faturamento ligado no worker (NF-e só no simulador)');
else log.warn({ faltando: ['MACUXIERP_CHAVE_A1'] }, 'faturamento desligado no worker: os trabalhos da SEFAZ ficam na fila');

const worker = iniciarWorker({
  banco,
  outbox: new FilaOutboxPg(),
  trabalhos: new ReservaTrabalhosPg(),
  consumo: new RegistroConsumoPg(),
  consumidores: montarConsumidores({ log, relogio: relogioDoSistema }),
  executores: montarExecutores({ banco, log, armazenamento: armazenamentoIndisponivel, catalogo: new CatalogoArquivosPg(), agora: () => relogioDoSistema.agora(), ...(faturamento ? { faturamento } : {}) }),
  rotinas: montarRotinas({ banco, log, ...(faturamento ? { faturamento } : {}), completarPrazoMedio: completarPrazoMedioLigado(process.env) }),
  periodicas: montarPeriodicas({ ...(faturamento ? { faturamento } : {}) }),
  ...(hub && decifrarCredencial ? { agenda: { agendas, licencas: new LicencasPg(), hub, decifrarCredencial } } : {}),
  relogio: relogioDoSistema,
  log,
  intervaloMs: inteiroDoAmbiente(process.env, 'MACUXIERP_WORKER_INTERVALO_MS', 1_000, 100, 60_000),
  maxTentativas: inteiroDoAmbiente(process.env, 'MACUXIERP_OUTBOX_MAX_TENTATIVAS', 10, 1, 100),
  alertar: criarAlertaMonitor(log, 'plataforma'),
  reentrega: { fonte: new FonteReentregaPg() },
});
log.info('worker no ar');

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    log.info({ sinal }, 'encerrando o worker');
    void worker
      .parar()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}
