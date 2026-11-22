/** Worker do Macuxi ERP: despachante da outbox, fila de trabalhos (D10) e agendas por tenant (T-0009 §6.1). A entrada é `main.ts` (adaptadores PostgreSQL). */
export { despacharOutbox, type ResumoDespacho } from './despachante';
export { processarTrabalhos, type ResumoTrabalhos } from './trabalhos';
export { ciclo, iniciarWorker, type DependenciasWorker } from './worker';
export type { EventoPendente, FilaOutbox, ReservaTrabalhos, RegistroConsumo } from './portas';
export { criarExecutorExportacao, type ExportadorModulo, type RegistroExportacoes } from './exportacao-lgpd';
export { criarRotinaAlertaA1, type DestinoAvisos, type FonteCertificados, type FonteTenants } from './alerta-a1';
export { rodarRotinas, type RotinaDiaria } from './rotinas';
export { registrarAgendas, registrarExecutores } from './modulos';
export { resumoAgendasVazio, rodarAgendas, type DependenciasAgendas, type ResumoAgendas } from './agenda';
export { configurarHub } from './hub';
export { configurarCredenciais, criarDecifradorCredencial, type DecifrarCredencial } from './credencial';
