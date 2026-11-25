import { ZeragemPedidosResposta, ZerarPedidosEntrada } from '@macuxierp/pedido/contracts';
import { PADRAO_UUID } from '@macuxierp/platform-sdk';
import { chamar, idEmpresa, validado } from './api';
import { SEM_CACHE, comSessao, falha, falhaDadosMudaram, guardaPost } from './cargas-rotas';
import { ErroPlataforma } from './erros';

/** Route handlers do Zerar pedidos não faturados (T-0093): o portal chama `POST /v1/plataforma/empresas/:id/pedidos/zerar[/previa]`. */
/** Caminhos do plugin do pedido (iguais aos do contrato `zeragem.ts` do pedido, conferido em teste); o teste de rotas de tela só enxerga as constantes do SDK. */
export const CAMINHOS = { previa: '/empresas/:id/pedidos/zerar/previa', zerar: '/empresas/:id/pedidos/zerar' } as const;
const caminho = (chave: keyof typeof CAMINHOS, id: string) => CAMINHOS[chave].replace(':id', idEmpresa(id));

/** `POST /config/empresas/:id/pedidos/zerar/previa`: sem corpo, só leitura; devolve a `ZeragemPedidosResposta` simulada. */
export async function tratarPreviaZerarPedidos(req: Request, id: string): Promise<Response> {
  const barrada = guardaPost(req, id);
  if (barrada) return barrada;
  return comSessao(req, async (token) => {
    const previa = await validado(await chamar('POST', caminho('previa', id), { token }), ZeragemPedidosResposta);
    return Response.json({ ok: true, previa }, { headers: SEM_CACHE });
  });
}

/** `POST /config/empresas/:id/pedidos/zerar`: corpo `{ frase }` e `Idempotency-Key`; a frase é conferida pelo contrato (a API revalida). */
export async function tratarZerarPedidos(req: Request, id: string): Promise<Response> {
  const barrada = guardaPost(req, id);
  if (barrada) return barrada;
  return comSessao(req, async (token) => {
    const bruto = (await req.json().catch(() => null)) as { frase?: unknown } | null;
    const chave = req.headers.get('idempotency-key') ?? '';
    const entrada = ZerarPedidosEntrada.safeParse({ frase: typeof bruto?.frase === 'string' ? bruto.frase : '' });
    if (!entrada.success || !PADRAO_UUID.test(chave)) return falha('Digite a frase para confirmar.', 400);
    try {
      const zeragem = await validado(await chamar('POST', caminho('zerar', id), { token, corpo: entrada.data, chave }), ZeragemPedidosResposta);
      return Response.json({ ok: true, zeragem }, { headers: SEM_CACHE });
    } catch (e) {
      // Único 409 da rota: o pedido ganhou nota ou título entre a prévia e o zerar (MXC03); o código do DETAIL ainda não está no SDK.
      if (e instanceof ErroPlataforma && e.status === 409) return falhaDadosMudaram();
      throw e;
    }
  });
}
