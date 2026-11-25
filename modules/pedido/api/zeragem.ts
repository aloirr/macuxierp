/**
 * Plugin de plataforma "Zerar pedidos não faturados" do portal `/config` (RN-CAD-10, T-0093, ADR 0012 §4 e 0013). Só superadmin.
 * Molde do `cadastros/api/zeragem.ts`: fatos (`pedido.portal_zeragem_fatos`) + nota e título (porta do faturamento) → plano
 * (`planoZeragemPedidos`, no domain) → `pedido.portal_zerar`, tudo na mesma transação do `comPlataforma`. A auditoria (só
 * contagens e superadmin_id) é gravada pela função do banco, então a rota não chama `c.auditar`. O erro `MXC03` (o estado
 * mudou entre o plano e o efeito) sobe cru para o mapa de erros da apps/api.
 */
import { definirPluginPlataforma, definirRotaPlataforma, erros, type ContextoPlataforma, type PluginPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { ApagadoZerarPedidos, CAMINHOS_ZERAR_PEDIDOS, OrigemPedido, StatusPedido, ZerarPedidosEntrada, ZeragemPedidosResposta } from '../contracts';
import type { AposZerarPedidos } from './apos-zerar';
import { planoZeragemPedidos, type PedidoParaZerar, type PlanoZeragemPedidos } from '../domain';

/** Ids com nota ou com título, vistos pelo faturamento (a apps/api implementa chamando a função `portal_*` dele; fronteira). */
export interface UsosFaturamentoPedidos {
  pedidosComNotaOuTitulo(tx: Transacao, tenant: string, pedidoIds: readonly string[]): Promise<{ comNota: string[]; comTitulo: string[] }>;
}

export interface DependenciasZerarPedidos {
  faturamento: UsosFaturamentoPedidos;
  /** Libera o reenvio do FDV e descarta o a_faturar, na mesma tx do zerar (T-0093, critério 3; docs/desenho/T-0093.md). */
  aposZerar: AposZerarPedidos;
}

/** `pedido.portal_zeragem_fatos(p_tenant)`: `{pedidos: [{id, status, origem}]}`, sem dado pessoal. */
const FatosBanco = z.object({
  pedidos: z.array(z.object({ id: z.string().min(1), status: StatusPedido, origem: OrigemPedido })),
});

/** Retorno de `pedido.portal_zerar(p_tenant, p_plano, p_request_id)`: contagens por tabela. */
const ResultadoZerar = z.object({ apagados: z.array(ApagadoZerarPedidos) });

const Uuid = z.string().uuid();
const idDaRota = (params: Record<string, string>): string => {
  const r = Uuid.safeParse(params.id);
  if (!r.success) throw erros.validacao({ id: 'UUID inválido' });
  return r.data;
};

async function montarPlano(c: ContextoPlataforma, tenant: string, deps: DependenciasZerarPedidos): Promise<PlanoZeragemPedidos> {
  const [l] = await c.tx.consultar<{ r: unknown }>('SELECT pedido.portal_zeragem_fatos($1::uuid) AS r', [tenant]);
  if (!l) throw new Error('portal_zeragem_fatos sem retorno');
  const { pedidos } = FatosBanco.parse(l.r);
  const usos = pedidos.length > 0 ? await deps.faturamento.pedidosComNotaOuTitulo(c.tx, tenant, pedidos.map((p) => p.id)) : { comNota: [], comTitulo: [] };
  const comNota = new Set(usos.comNota);
  const comTitulo = new Set(usos.comTitulo);
  const fatos: PedidoParaZerar[] = pedidos.map((p) => ({ ...p, com_nota: comNota.has(p.id), com_titulo: comTitulo.has(p.id) }));
  return planoZeragemPedidos(fatos);
}

function resposta(tenant: string, plano: PlanoZeragemPedidos, simulado: boolean, efeito?: z.infer<typeof ResultadoZerar>) {
  return ZeragemPedidosResposta.parse({
    empresa_id: tenant,
    simulado,
    apagados: efeito?.apagados ?? [{ tabela: 'pedido', quantidade: plano.apagar.length }],
    apagados_fdv: plano.apagarFdv,
    mantidos: plano.mantidos,
  });
}

export function criarPluginPlataformaPedidoZerar(deps: DependenciasZerarPedidos): PluginPlataforma {
  const C = CAMINHOS_ZERAR_PEDIDOS;
  return definirPluginPlataforma([
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.previa,
      acao: 'plataforma.cadastros.zerar',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        return { corpo: resposta(tenant, await montarPlano(c, tenant, deps), true) };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.zerar,
      acao: 'plataforma.cadastros.zerar',
      corpo: ZerarPedidosEntrada,
      idempotencia: 'obrigatoria',
      async executar(c, { params }) {
        const tenant = idDaRota(params);
        const plano = await montarPlano(c, tenant, deps);
        if (plano.apagar.length === 0) return { corpo: resposta(tenant, plano, false, { apagados: [] }) };
        // A função do banco revalida cada id com FOR UPDATE (MXC03 se ganhou nota ou título) e audita só contagens.
        const [l] = await c.tx.consultar<{ r: unknown }>('SELECT pedido.portal_zerar($1::uuid, $2::jsonb, $3) AS r', [
          tenant,
          JSON.stringify({ apagar: plano.apagar }),
          c.request_id,
        ]);
        if (!l) throw new Error('portal_zerar sem retorno');
        const efeito = ResultadoZerar.parse(l.r);
        // Depois do portal_zerar e na MESMA tx: se a porta falhar, o zerar inteiro é desfeito (T-0093, critério 3).
        const extras = await deps.aposZerar.aposZerarPedidos(c.tx, tenant, plano.apagar);
        return { corpo: resposta(tenant, plano, false, { apagados: [...efeito.apagados, ...extras] }) };
      },
    }),
  ]);
}
