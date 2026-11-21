/** Worker do Macuxi ERP: despachante da outbox e fila de trabalhos (D10). A entrada é `main.ts` (adaptadores PostgreSQL). */
export { despacharOutbox, type ResumoDespacho } from './despachante';
export { processarTrabalhos, type ResumoTrabalhos } from './trabalhos';
export { ciclo, iniciarWorker, type DependenciasWorker } from './worker';
export type { EventoPendente, FilaOutbox, ReservaTrabalhos, RegistroConsumo } from './portas';
export { criarExecutorExportacao, TRABALHO_EXPORTAR_DADOS, type ExportadorModulo, type RegistroExportacoes } from './exportacao-lgpd';
export { criarRotinaAlertaA1, type DestinoAvisos, type FonteCertificados, type FonteTenants } from './alerta-a1';
export { rodarRotinas, type RotinaDiaria } from './rotinas';
export { registrarExecutores } from './modulos';
