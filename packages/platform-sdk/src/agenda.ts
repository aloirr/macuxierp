/**
 * Porta de agenda do worker (contrato C-9; desenho T-0009 §6.1 e §8). Tarefas **recorrentes por tenant** (envio ao
 * Hub, consulta de lote, sinal, reconciliação e, na F3, busca de pedidos e retorno) não cabem no `plataforma.trabalho`,
 * cujo `external_id` deduplica para sempre. O módulo fornece a agenda; o laço é do `apps/worker` (`agenda.ts`).
 *
 * Garantias do laço (o módulo pode contar com elas):
 * 1. `reservar` roda em `banco.semTenant`, no papel `macuxierp_worker` (política `worker_global` das tabelas da agenda,
 *    sem dado pessoal), numa transação curta que termina antes de qualquer `executar`.
 * 2. `semLicenca` e o conferir da licença (`moduloLicenciado`) rodam em `banco.comTenant(item.tenant_id)`.
 * 3. `executar` roda **fora de transação**: a chamada HTTP ao Hub nunca segura transação nem trava linha. O que for
 *    banco vai por `ctx.emTransacao`, sempre em `comTenant(item.tenant_id)` (RLS do tenant do item).
 *    Atenção: nas tabelas da agenda (`worker_global`) o papel `macuxierp_worker` enxerga todos os tenants mesmo em
 *    `comTenant`; ali o SQL do módulo filtra sempre por `tenant_id = item.tenant_id`.
 * 4. Erro no `executar` não derruba o laço nem as outras agendas: o worker loga só o nome do erro e segue. A posse
 *    (`POSSE_AGENDA_MS`) vence sozinha e o item volta na próxima reserva.
 * 5. O laço para de executar os itens restantes do lote quando falta menos de `MARGEM_POSSE_AGENDA_MS` para o
 *    `posseAte` da reserva: eles voltam sozinhos quando a posse vence (outro worker já pode pegá-los).
 */
import { MODULOS, type ModuloId } from './modulo';
import type { Transacao } from './banco';
import type { ClienteHub } from './hub';

/** Uma tarefa vencida de um tenant (ex.: `tarefa` 'envio', `chave` a entidade; `chave` nula = tarefa do tenant). */
export interface ItemAgenda {
  tenant_id: string;
  tarefa: string;
  chave: string | null;
}

export interface ContextoAgenda {
  agora: Date;
  /**
   * Fim da posse da reserva deste item (o `proximo*_em` que o `reservar` gravou). Depois dele outro worker pode pegar o
   * item; o módulo pode travar a regravação final com `WHERE proximo_em = posseAte` (0 linhas = a posse já se perdeu).
   */
  posseAte: Date;
  /** Porta HTTP do Hub, injetada pelo worker (o módulo não abre conexão). */
  hub: ClienteHub;
  /**
   * Abre a chave do conector guardada pelo módulo (`cifrarCampo`, AAD = `tenantId`) com a chave mestra da versão
   * `versao` (o worker conhece as versões; hoje só a 1, `MACUXIERP_CHAVE_INTEGRACAO`). Versão desconhecida, outro tenant
   * ou cifrado adulterado: erro de mensagem fixa. O resultado fica só em memória, na hora da chamada: nunca vai a log,
   * erro, banco nem resposta.
   */
  decifrarCredencial(cifrada: Uint8Array, tenantId: string, versao: number): string;
  /** Transação em `comTenant(item.tenant_id)`. Não chame o Hub aqui dentro (segura a transação durante o HTTP). */
  emTransacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
}

/**
 * Id da agenda: `<modulo>.<agenda>`, com `<agenda>` em minúsculas, dígitos, `_` ou `-`, começando por letra ou `_` (como os ids de consumidor:
 * `integracao-fdv.busca-pedidos`). Mais largo que o `PADRAO_TIPO_TRABALHO` (só `[a-z_]`), que valia na primeira versão do
 * C-9: alargar é compatível (todo id antigo continua válido). O id só vai a log; não é gravado no banco.
 */
export const PADRAO_ID_AGENDA = new RegExp(`^(${MODULOS.join('|')})\\.[a-z_][a-z0-9_-]*$`);

export interface AgendaModulo {
  /** `<modulo>.<agenda>` (`PADRAO_ID_AGENDA`), com o prefixo do próprio módulo. */
  id: string;
  modulo: ModuloId;
  /**
   * Até `limite` itens vencidos (`proximo*_em <= agora`, não pausados), de todos os tenants. Roda em `semTenant`
   * (papel `macuxierp_worker`), trava com `FOR NO KEY UPDATE SKIP LOCKED` (dois workers não pegam o mesmo item) e
   * **adia o `proximo*_em` para `posseAte` na mesma transação**: se o worker cair, o item volta sozinho depois da posse.
   */
  reservar(tx: Transacao, limite: number, agora: Date, posseAte: Date): Promise<ItemAgenda[]>;
  /** Fora de transação (ver `ContextoAgenda`). O módulo regrava o `proximo*_em` final (sucesso, curva do Hub ou pausa). */
  executar(item: ItemAgenda, ctx: ContextoAgenda): Promise<void>;
  /** Módulo sem licença no tenant: pausa o item (`pausada_motivo = 'licenca_erp'`), na transação do tenant. Idempotente. */
  semLicenca(item: ItemAgenda, tx: Transacao, agora: Date): Promise<void>;
}

/** Prazo de posse de um item reservado (T-0009 §6.1): 2 min. */
export const POSSE_AGENDA_MS = 120_000;

/** Folga antes do fim da posse: com menos que isso, o laço não começa outro item do lote (garantia 5). */
export const MARGEM_POSSE_AGENDA_MS = 30_000;
