/**
 * T-0057: `/entrada/v1` falsa, em memória, só para os testes unitários dos dublês (`conector-simulado`, `lado-cliente`).
 * Não substitui a API real: E2 a E4 rodam contra o plugin do `cadastros` montado por `montarDependenciasProducao`
 * (regra R-20261123-172506: print e prova de pronto só com a API real). Ela implementa só o que o arnês precisa provar
 * de si mesmo: a recusa sem a chave, a `Idempotency-Key` obrigatória (mesma chave e mesmo corpo = mesmo `lote_id`;
 * outro corpo = 409, ADR 0014 §3) e a fila de descida que só esvazia quando o retorno é aceito (§13).
 */
import { createHash, randomUUID } from 'node:crypto';
import { CAMINHOS_ENTRADA_V1 } from './conector-simulado';

export interface RetornoVisto {
  recurso: 'pedidos' | 'notas' | 'clientes';
  id: string;
  corpo: Record<string, unknown>;
}

export interface EntradaFalsa {
  fetch: typeof fetch;
  /** Lotes aceitos por `lote_id` (o corpo fica só aqui, em memória do teste). */
  readonly lotes: ReadonlyMap<string, { chave: string; corpo: unknown }>;
  readonly retornos: readonly RetornoVisto[];
  pendentes: {
    pedidos: Record<string, unknown>[];
    notas: Record<string, unknown>[];
    clientes: Record<string, unknown>[];
  };
  /** As próximas `n` chamadas de retorno respondem 503 (para provar a repetição). */
  falharRetornos(n: number): void;
}

const json = (status: number, corpo: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export function criarEntradaFalsa(o: { chave: string; conectorId: string }): EntradaFalsa {
  const p = CAMINHOS_ENTRADA_V1.prefixo;
  const porChave = new Map<string, { hash: string; lote_id: string }>();
  const lotes = new Map<string, { chave: string; corpo: unknown }>();
  const retornos: RetornoVisto[] = [];
  let falhas = 0;
  const estado: EntradaFalsa = {
    lotes,
    retornos,
    pendentes: { pedidos: [], notas: [], clientes: [] },
    falharRetornos: (n) => void (falhas = n),
    fetch: async (entrada, init) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      const cab = new Headers(init?.headers);
      if (
        cab.get('authorization') !== `Bearer ${o.chave}` ||
        cab.get('x-macuxi-conector-id') !== o.conectorId
      )
        return json(401, { codigo: 'NAO_AUTENTICADO' });
      const metodo = init?.method ?? 'GET';
      const rota = url.pathname.startsWith(p) ? url.pathname.slice(p.length) : null;
      if (rota === null) return json(404, { codigo: 'NAO_ENCONTRADO' });
      const corpo = typeof init?.body === 'string' ? init.body : '';

      if (metodo === 'POST' && rota === CAMINHOS_ENTRADA_V1.lotes) {
        const chave = cab.get('idempotency-key');
        if (!chave) return json(400, { codigo: 'idempotency_key_ausente' });
        const hash = createHash('sha256').update(corpo).digest('hex');
        const ja = porChave.get(chave);
        if (ja && ja.hash !== hash) return json(409, { codigo: 'idempotency_key_reusada' });
        const lote_id = ja?.lote_id ?? randomUUID();
        if (!ja) {
          porChave.set(chave, { hash, lote_id });
          lotes.set(lote_id, { chave, corpo: JSON.parse(corpo) as unknown });
        }
        return json(202, { lote_id, status: 'recebido', repetido: Boolean(ja) });
      }
      const m = /^\/(pedidos|notas|clientes)\/(pendentes|([^/]+)\/retorno)$/.exec(rota);
      if (m) {
        const recurso = m[1] as RetornoVisto['recurso'];
        if (metodo === 'GET' && m[2] === 'pendentes')
          return json(200, { [recurso]: estado.pendentes[recurso] });
        if (metodo === 'POST' && m[3]) {
          if (falhas > 0) {
            falhas--;
            return json(503, { codigo: 'INDISPONIVEL' });
          }
          const id = decodeURIComponent(m[3]);
          retornos.push({ recurso, id, corpo: JSON.parse(corpo) as Record<string, unknown> });
          // o pendente sai da fila só quando o retorno é aceito
          const campo =
            recurso === 'pedidos' ? 'pedido_uuid' : recurso === 'notas' ? 'chave' : 'cliente_uuid';
          if (recurso !== 'clientes' || (JSON.parse(corpo) as { status?: string }).status === 'vinculado')
            estado.pendentes[recurso] = estado.pendentes[recurso].filter((x) => x[campo] !== id);
          return json(200, { aceito: true });
        }
      }
      return json(404, { codigo: 'NAO_ENCONTRADO' });
    },
  };
  return estado;
}
