/**
 * Entrada do worker: adaptadores PostgreSQL no papel `macuxierp_worker` (conferido na partida: sem superusuário nem
 * BYPASSRLS), laço da outbox e dos trabalhos e encerramento limpo no SIGTERM do deploy (ADR 0003).
 * Ambiente: conexão pelas variáveis do libpq (`PGHOST`, `PGPORT`, `PGUSER=macuxierp_worker`, `PGPASSWORD`,
 * `PGDATABASE`); `MACUXIERP_WORKER_INTERVALO_MS` (padrão 1000), `MACUXIERP_PG_POOL` (padrão 5) e
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
 * `MACUXIERP_FDV_RECEBIMENTO` (pedidos do FDV, T-0016) e `MACUXIERP_FDV_ENVIO`: trava de 22/11/2026, ver envio-fdv.ts.
 */
import { armazenamentoIndisponivel, relogioDoSistema } from '@macuxierp/platform-sdk';
import { BancoPg, CatalogoArquivosPg, criarPool, LicencasPg } from '@macuxierp/platform-sdk/pg';
import { pino } from 'pino';
import { configurarCredenciais } from './credencial';
import { configurarEnvioFdv } from './envio-fdv';
import { configurarHub, versaoDoErp } from './hub';
import { montarAgendas, montarConsumidores, montarExecutores, montarRotinas } from './modulos';
import { conferirRecebimentoFdv, configurarRecebimentoFdv, criarAlertaMonitor, montarPedidosFdv, resolvedorChaveErpDeProducao } from './pedidos-fdv';
import { FilaOutboxPg, FonteReentregaPg, RegistroConsumoPg, ReservaTrabalhosPg } from './pg';
import { iniciarWorker } from './worker';

function inteiro(nome: string, padrao: number, min: number, max: number): number {
  const bruto = process.env[nome];
  const n = bruto === undefined || bruto === '' ? padrao : Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`configuração inválida: ${nome} (inteiro de ${min} a ${max})`);
  return n;
}

const log = pino({ level: 'info', base: { servico: 'macuxierp-worker' } });
const pool = criarPool('macuxierp-worker', inteiro('MACUXIERP_PG_POOL', 5, 2, 50));
const banco = new BancoPg(pool);
await banco.conferirPapel('macuxierp_worker');

const hub = configurarHub(process.env, versaoDoErp(process.env));
const decifrarCredencial = configurarCredenciais(process.env);
const faltando = [...(hub ? [] : ['MACUXIERP_HUB_URL_TESTE', 'MACUXIERP_HUB_URL_PRODUCAO']), ...(decifrarCredencial ? [] : ['MACUXIERP_CHAVE_INTEGRACAO'])];
const recebimento = configurarRecebimentoFdv(process.env);
const envio = configurarEnvioFdv(process.env);
conferirRecebimentoFdv(recebimento, faltando);
if (faltando.length) log.warn({ faltando }, 'laço de agenda desligado');
const pedidosFdv = montarPedidosFdv({ log, relogio: relogioDoSistema, recebimento, resolvedor: resolvedorChaveErpDeProducao() });
const agendas = hub && decifrarCredencial ? montarAgendas({ log, relogio: relogioDoSistema, pedidosFdv, envio }) : [];
log.info({ recebimento_pedidos_fdv: recebimento, envio_fdv: envio, agendas: agendas.map((a) => a.id) }, 'pedidos do FDV');

const worker = iniciarWorker({
  banco,
  outbox: new FilaOutboxPg(),
  trabalhos: new ReservaTrabalhosPg(),
  consumo: new RegistroConsumoPg(),
  consumidores: montarConsumidores({ log, relogio: relogioDoSistema }),
  executores: montarExecutores({ banco, log, armazenamento: armazenamentoIndisponivel, catalogo: new CatalogoArquivosPg(), agora: () => relogioDoSistema.agora() }),
  rotinas: montarRotinas({ banco, log }),
  ...(hub && decifrarCredencial ? { agenda: { agendas, licencas: new LicencasPg(), hub, decifrarCredencial } } : {}),
  relogio: relogioDoSistema,
  log,
  intervaloMs: inteiro('MACUXIERP_WORKER_INTERVALO_MS', 1_000, 100, 60_000),
  maxTentativas: inteiro('MACUXIERP_OUTBOX_MAX_TENTATIVAS', 10, 1, 100),
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
