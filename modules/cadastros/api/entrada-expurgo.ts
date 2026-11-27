/**
 * T-0057 (LGPD, ADR 0014 §3): expurgo de 24 h do corpo do lote da `/entrada/v1`. O corpo (dado pessoal dos registros) é zerado no estado
 * final (0071, `entrada_lote_corpo_zerado`); o lote que ficou `recebido` ou `processando` por mais de 24 h (worker parado, fila travada)
 * vai a `falhou` com `erro_codigo` `corpo_expirado` e perde o corpo. O executor roda por tenant, na transação do worker (RLS: só vê o
 * tenant do trabalho; o `macuxierp_worker` tem UPDATE de estado, corpo, erro_codigo e concluido_em, sem filtro por tenant na concessão).
 * Idempotente: o lote já em estado final não entra de novo.
 */
import type { ExecutorTrabalho, Transacao } from '@macuxierp/platform-sdk';
import { CODIGO_ERRO_EXPURGO, corteDoExpurgo } from '../domain';
import type { RepositorioEntrada } from './entrada-sql';

export const TRABALHO_ENTRADA_EXPURGO = 'cadastros.entrada_expurgo';

export function criarExecutorExpurgoEntrada(d: { entrada(tx: Transacao): RepositorioEntrada; agora?: () => Date }): ExecutorTrabalho {
  return {
    tipo: TRABALHO_ENTRADA_EXPURGO,
    async executar(_trabalho, tx) {
      const agora = (d.agora ?? (() => new Date()))();
      return { expurgados: await d.entrada(tx).expurgarCorpos(corteDoExpurgo(agora), CODIGO_ERRO_EXPURGO, agora) };
    },
  };
}
