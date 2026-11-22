/**
 * `Idempotency-Key` das rotas (RN-CORE-05; desenho T-0002 §2; carga de CSV da T-0026 §4). A rota declara
 * `idempotencia` no `definirRota`; a API chama `executarIdempotente` dentro da transação do tenant, depois de sessão,
 * perfil, tenant e licença (RN-CORE-02). A reserva e a resposta ficam em `plataforma.idempotencia` por 24 h, na mesma
 * transação da escrita: se a rota falha, a reserva some junto e o reenvio executa de novo.
 */
import { sha256Hex } from './arquivos';
import type { Transacao } from './banco';
import { erros } from './erros';
import type { ArquivoRecebido, RespostaRota } from './rotas';

export const CABECALHO_IDEMPOTENCIA = 'idempotency-key';
/** Cabeçalho da resposta repetida (devolvida da guarda, sem executar a rota). */
export const CABECALHO_REPETIDA = 'idempotency-replayed';
export const VALIDADE_IDEMPOTENCIA_MS = 24 * 60 * 60 * 1000;
/** 8 a 128 caracteres (CHECK da `plataforma.idempotencia`), sem espaço: UUID, hex de SHA-256 e afins. */
export const PADRAO_CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Registro guardado. `status` nulo = reserva de um pedido ainda em andamento. */
export interface RegistroIdempotencia {
  hash_corpo: string;
  status: number | null;
  resposta: unknown;
}

export interface ChaveIdempotencia {
  tenant_id: string;
  chave: string;
  /** `<MÉTODO> /v1/<modulo><caminho declarado>` (ex.: `POST /v1/cadastros/cargas`). */
  rota: string;
}

/** Pedido de reserva: a chave, o hash do pedido, o instante e o vencimento (24 h). */
export type ReservaIdempotencia = ChaveIdempotencia & { hash_corpo: string; agora: Date; expira_em: Date };
/** Conclusão: status e corpo (JSON) da resposta guardada. */
export type ConclusaoIdempotencia = ChaveIdempotencia & { status: number; resposta: unknown };

/** Porta de `plataforma.idempotencia` (PostgreSQL: `IdempotenciaPg`; testes: `IdempotenciaMemoria`). */
export interface RepositorioIdempotencia {
  /** Reserva a chave; se já existe uma não vencida, devolve o registro dela (e não reserva). Vencida é substituída. */
  reservar(tx: Transacao, p: ReservaIdempotencia): Promise<RegistroIdempotencia | null>;
  concluir(tx: Transacao, p: ConclusaoIdempotencia): Promise<void>;
}

/** A chave do cabeçalho, conferida; `null` se ausente e opcional. */
export function chaveDoPedido(
  cabecalhos: Readonly<Record<string, string>>,
  modo: 'opcional' | 'obrigatoria',
): string | null {
  const v = cabecalhos[CABECALHO_IDEMPOTENCIA]?.trim();
  if (!v) {
    if (modo === 'obrigatoria')
      throw erros.validacao({ [CABECALHO_IDEMPOTENCIA]: 'cabeçalho obrigatório nesta rota' });
    return null;
  }
  if (!PADRAO_CHAVE_IDEMPOTENCIA.test(v))
    throw erros.validacao({ [CABECALHO_IDEMPOTENCIA]: 'de 8 a 128 caracteres: letras, dígitos, _ . : -' });
  return v;
}

/** JSON com chaves em ordem (o mesmo pedido dá o mesmo hash, qualquer que seja a ordem dos campos). */
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/**
 * `hash_corpo`: SHA-256 do corpo e da consulta já validados, dos params e, de cada arquivo, campo, nome e SHA-256 do
 * conteúdo (T-0026 §4: modo + nome e hash de cada arquivo). Os bytes não ficam guardados.
 */
export function hashDoPedido(p: {
  corpo: unknown;
  consulta: unknown;
  params: Readonly<Record<string, string>>;
  todosArquivos: Readonly<Record<string, readonly ArquivoRecebido[]>>;
}): string {
  const arquivos = Object.keys(p.todosArquivos)
    .sort()
    .flatMap((campo) => p.todosArquivos[campo]!.map((a) => [campo, a.nome, sha256Hex(a.conteudo())]));
  return sha256Hex(
    JSON.stringify(
      canonico({ corpo: p.corpo ?? null, consulta: p.consulta ?? null, params: p.params, arquivos }),
    ),
  );
}

/**
 * Executa a rota uma vez por chave: reserva → executa → guarda status e corpo. Repetição com o mesmo hash devolve a
 * resposta guardada (`repetida: true`); com outro hash, ou com o 1º pedido ainda em andamento, é 409 `CONFLITO`.
 */
export async function executarIdempotente(
  repo: RepositorioIdempotencia,
  tx: Transacao,
  p: Omit<ReservaIdempotencia, 'expira_em'>,
  executar: () => Promise<RespostaRota>,
): Promise<{ resposta: RespostaRota; repetida: boolean }> {
  const existente = await repo.reservar(tx, {
    ...p,
    expira_em: new Date(p.agora.getTime() + VALIDADE_IDEMPOTENCIA_MS),
  });
  if (existente) {
    if (existente.hash_corpo !== p.hash_corpo)
      throw erros.conflito('Idempotency-Key já usada com outro pedido');
    if (existente.status === null) throw erros.conflito('Pedido com esta Idempotency-Key ainda em andamento');
    return { resposta: { status: existente.status, corpo: existente.resposta }, repetida: true };
  }
  const resposta = await executar();
  const status = resposta.status ?? 200;
  // Só JSON vai para a guarda (jsonb): a volta é a mesma que o cliente recebeu.
  const corpo = resposta.corpo === undefined ? null : (JSON.parse(JSON.stringify(resposta.corpo)) as unknown);
  await repo.concluir(tx, { tenant_id: p.tenant_id, chave: p.chave, rota: p.rota, status, resposta: corpo });
  return { resposta, repetida: false };
}
