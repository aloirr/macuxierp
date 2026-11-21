// VIOLA modulo-abre-conexao: módulo abrindo pool em vez de usar a Transacao do ContextoRota
import { criarPool } from '../../../packages/platform-sdk/src/pg';
export const pool = criarPool();
