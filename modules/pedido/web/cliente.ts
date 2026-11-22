/**
 * Cliente tipado da API `/v1/pedido` para o BKO: a resposta é validada pelo Zod de `contracts`; o token e o `fetch`
 * entram por injeção (mesmo molde do core). O corpo do erro (`codigo`, `mensagem`) nunca leva dado do pedido ao log.
 */
import { paraQuery } from '@macuxierp/platform-sdk/listas';
import { z } from 'zod';
import { CatalogoMotivos, Pedido, type AprovarEntrada, type CancelarEntrada, type PedidoManualEntrada, type RecusarEntrada } from '../contracts';

export class ErroPedido extends Error {
  override readonly name = 'ErroPedido';
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export type FetchPedido = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; headers: { get(nome: string): string | null }; json(): Promise<unknown> }>;

const Erro = z.object({ codigo: z.string(), mensagem: z.string() });

export function criarClientePedido(cfg: { baseUrl: string; token: () => string; fetch: FetchPedido }) {
  async function chamar<T>(metodo: string, caminho: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, corpo?: unknown, cabecalhos: Record<string, string> = {}): Promise<T> {
    const r = await cfg.fetch(`${cfg.baseUrl}/v1/pedido${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token()}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const ehJson = (r.headers.get('content-type') ?? '').includes('json');
    if (!r.ok) {
      // 5xx de proxy ou balanceador costuma vir em HTML: não é JSON, vira ErroPedido sem tentar o parse.
      const e = ehJson ? Erro.safeParse(await r.json().catch(() => null)) : null;
      throw new ErroPedido(r.status, e?.success ? e.data.codigo : 'ERRO', e?.success ? e.data.mensagem : 'Não foi possível concluir. Tente de novo.');
    }
    if (!ehJson) throw new ErroPedido(r.status, 'RESPOSTA_INVALIDA', 'Não foi possível concluir. Tente de novo.');
    return schema.parse(await r.json());
  }

  return {
    pedido: (id: string) => chamar('GET', `/pedidos/${encodeURIComponent(id)}`, Pedido),
    motivos: () => chamar('GET', '/motivos', CatalogoMotivos),
    /** `chave` = `Idempotency-Key` do formulário (obrigatória na criação). */
    lancar: (entrada: PedidoManualEntrada, chave: string) => chamar('POST', '/pedidos', Pedido, entrada, { 'Idempotency-Key': chave }),
    /** `updatedAt` = o `updated_at` que a tela carregou (`If-Match`): outra edição no meio dá conflito. */
    editar: (id: string, entrada: PedidoManualEntrada, updatedAt: string) => chamar('PUT', `/pedidos/${encodeURIComponent(id)}`, Pedido, entrada, { 'If-Match': updatedAt }),
    revalidar: (id: string) => chamar('POST', `/pedidos/${encodeURIComponent(id)}/revalidar`, Pedido, {}),
    aprovar: (id: string, e: AprovarEntrada) => chamar('POST', `/pedidos/${encodeURIComponent(id)}/aprovar`, Pedido, e),
    recusar: (id: string, e: RecusarEntrada) => chamar('POST', `/pedidos/${encodeURIComponent(id)}/recusar`, Pedido, e),
    cancelar: (id: string, e: CancelarEntrada) => chamar('POST', `/pedidos/${encodeURIComponent(id)}/cancelar`, Pedido, e),
    /** Caminho do CSV com os filtros da tela (o navegador baixa direto; a API aplica as colunas do perfil). */
    caminhoDoCsv: (filtros: Record<string, string>) => `/v1/pedido/pedidos/exportar${paraQuery(filtros)}`,
  };
}
