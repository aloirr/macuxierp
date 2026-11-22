/**
 * T-0017: a porta `ClienteHubPedidos` do `integracao-fdv` (modules/integracao-fdv/api/portas.ts) sobre o cliente HTTP do
 * SDK (`criarClienteHub`, o mesmo do adaptador `conector` da T-0012: cabeçalhos, `User-Agent: macuxierp/<versão>`, sem
 * URL livre, sem corpo nem chave em erro). O `main` ainda não tem esta ligação (pendência na docs/testes/T-0017.md):
 * o arnês a monta aqui, sem regra própria, só a tradução da `RespostaHub` do SDK para a `RespostaPendentes`/`RespostaRetorno`.
 */
import type {
  ClienteHubPedidos,
  RespostaPendentes,
  RespostaRetorno,
} from '../../../modules/integracao-fdv/api/portas';
import type { RetornoErp } from '../../../modules/integracao-fdv/contracts/index';
import { clienteDoSdk } from './adaptador-conector';
import type { CredencialHub } from './config';

export interface ChamadaPedidos {
  metodo: 'GET' | 'POST';
  /** Caminho sem o uuid (`/pedidos/:uuid/retorno`): o log do arnês não guarda identificador de pedido nem corpo. */
  rota: string;
  status: number;
}

export interface ClienteHubPedidosArnes extends ClienteHubPedidos {
  readonly chamadas: readonly ChamadaPedidos[];
}

const segundos = (ms: number | null) => (ms === null ? undefined : Math.ceil(ms / 1000));

export function criarClienteHubPedidos(o: { url: string; credencial: CredencialHub; versaoErp: string }): ClienteHubPedidosArnes {
  const { cliente, cred } = clienteDoSdk(o);
  const chamadas: ChamadaPedidos[] = [];
  return {
    chamadas,
    async pendentes(limite: number): Promise<RespostaPendentes> {
      const r = await cliente.chamar(cred, { metodo: 'GET', caminho: `/pedidos/pendentes?limite=${limite}` });
      const status = r.status ?? 0;
      chamadas.push({ metodo: 'GET', rota: '/pedidos/pendentes', status });
      if (r.tipo === 'ok') {
        const pedidos = (r.corpo as { pedidos?: unknown } | null)?.pedidos;
        return { status, ...(Array.isArray(pedidos) ? { pedidos } : {}) };
      }
      if (r.tipo === 'retentavel') {
        const ra = segundos(r.retryAfterMs);
        return { status, ...(ra !== undefined ? { retryAfterS: ra } : {}) };
      }
      return { status };
    },
    async enviarRetorno(pedidoUuid: string, corpo: RetornoErp): Promise<RespostaRetorno> {
      const r = await cliente.chamar(cred, { metodo: 'POST', caminho: `/pedidos/${pedidoUuid}/retorno`, corpo });
      const status = r.status ?? 0;
      chamadas.push({ metodo: 'POST', rota: '/pedidos/:uuid/retorno', status });
      if (r.tipo === 'ok') {
        const c = (r.corpo ?? {}) as { repetido?: unknown; itens_descartados?: unknown };
        return {
          status,
          ...(typeof c.repetido === 'boolean' ? { repetido: c.repetido } : {}),
          ...(Array.isArray(c.itens_descartados) ? { itens_descartados: c.itens_descartados } : {}),
        };
      }
      if (r.tipo === 'retentavel') {
        const ra = segundos(r.retryAfterMs);
        return { status, ...(r.codigo ? { codigo: r.codigo } : {}), ...(ra !== undefined ? { retryAfterS: ra } : {}) };
      }
      return { status, ...(r.codigo ? { codigo: r.codigo } : {}) };
    },
  };
}
