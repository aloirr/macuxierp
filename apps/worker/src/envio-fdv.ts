/**
 * Interruptor do envio ao Hub; o compose.yml o liga desde a virada. Fonte: desenho T-0002 §2, "Virada".
 *
 * `MACUXIERP_FDV_ENVIO` = `ligado` | `desligado` (ausente ou vazio = `desligado`; outro valor derruba a partida, citando só o
 * nome). Desligado, o `montarAgendas` não registra a agenda `integracao-fdv.conector` inteira: nenhum `POST /lotes`,
 * `POST /sinal` nem `POST /reconciliacoes`. A leitura de cursor (`GET /cursores/{entidade}`) e a consulta do lote
 * (`GET /lotes/{id}`) correm dentro da tarefa `envio` da mesma agenda e caem juntas até o módulo separá-las. As colunas
 * (`cursor_entidade.proximo_em`, `sinal.proximo_sinal_em`, `sinal.proxima_reconciliacao_em`) ficam paradas no banco; o
 * consumidor `integracao-fdv.publicar-cadastros` segue gravando só o espelho local (não chama o Hub).
 */
import { chaveLigadoDesligado, type EstadoChaveFdv } from './chaves-fdv';

export type EstadoEnvioFdv = EstadoChaveFdv;

/** `MACUXIERP_FDV_ENVIO` (chaves-fdv.ts). */
export function configurarEnvioFdv(env: Readonly<Record<string, string | undefined>>): EstadoEnvioFdv {
  return chaveLigadoDesligado(env, 'MACUXIERP_FDV_ENVIO');
}
