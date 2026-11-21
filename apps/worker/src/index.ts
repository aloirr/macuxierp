/** Worker do Macuxi ERP: despachante da outbox e fila de trabalhos (D10). A entrada (main) vem com os adaptadores PostgreSQL. */
export { despacharOutbox, type ResumoDespacho } from './despachante';
export { processarTrabalhos, type ResumoTrabalhos } from './trabalhos';
export { ciclo, iniciarWorker, type DependenciasWorker } from './worker';
export type { EventoPendente, FilaOutbox, ReservaTrabalhos, RegistroConsumo } from './portas';
