/**
 * Apoio dos testes de rota: roda uma rota do plugin como a API faz (perfil → licença → validação Zod → idempotência →
 * `executar`), sem Fastify e sem PostgreSQL, com outbox e auditoria em memória. A transação do tenant e a checagem real
 * da licença são da API (testadas em apps/api); aqui vale o que é do módulo.
 */
import {
  ErroApi, corpoErroApi, chaveDoPedido, executarIdempotente, hashDoPedido, pode, type DadosAuditoria, type EnvelopeEvento, type MetodoHttp, type Perfil, type PluginModulo, type Sessao,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { IdempotenciaMemoria } from '@macuxierp/platform-sdk/testes';
import { TENANT_MEMORIA } from './memoria';

const TENANT = TENANT_MEMORIA;
const USUARIO = '22222222-2222-4222-8222-222222222222';
export const sessaoDe = (perfil: Perfil, usuario_id = USUARIO): Sessao => ({ usuario_id, tenant_id: TENANT, perfil, filial_ids: [] });

export interface Resposta {
  status: number;
  corpo: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  cabecalhos?: Record<string, string>;
  repetida?: boolean;
}

export function criarAmbiente(plugin: PluginModulo, agora = new Date('2026-11-21T15:00:00Z'), tx: Transacao = { consultar: async () => [] }) {
  const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
  const auditoria: DadosAuditoria[] = [];
  const relogio = { agora };
  const idempotencia = new IdempotenciaMemoria();

  async function chamar(
    metodo: MetodoHttp,
    caminho: string,
    o: { sessao?: Sessao; corpo?: unknown; consulta?: Record<string, unknown>; cabecalhos?: Record<string, string>; semLicenca?: boolean; fuso?: string } = {},
  ): Promise<Resposta> {
    const partes = caminho.split('/').filter(Boolean);
    for (const rota of plugin.rotas) {
      if (rota.metodo !== metodo) continue;
      const modelo = rota.caminho.split('/').filter(Boolean);
      if (modelo.length !== partes.length) continue;
      const params: Record<string, string> = {};
      // Caminho fixo vence parâmetro (`/pedidos/exportar` × `/pedidos/:id`), como no roteador da API.
      if (!modelo.every((m, i) => (m.startsWith(':') ? ((params[m.slice(1)] = partes[i] as string), true) : m === partes[i]))) continue;
      if (Object.keys(params).length > 0 && plugin.rotas.some((r) => r.metodo === metodo && r.caminho === caminho)) continue;
      const sessao = o.sessao ?? sessaoDe('administrador');
      if (!pode(sessao.perfil, rota.acao)) return { status: 403, corpo: { codigo: 'PERFIL_SEM_PERMISSAO' } };
      if (o.semLicenca) return { status: 403, corpo: { codigo: 'MODULO_INATIVO' } };
      const corpo = rota.corpo ? rota.corpo.safeParse(o.corpo) : null;
      if (corpo && !corpo.success) return { status: 400, corpo: { codigo: 'VALIDACAO', campos: corpo.error.flatten().fieldErrors } };
      const consulta = rota.consulta ? rota.consulta.safeParse(o.consulta ?? {}) : null;
      if (consulta && !consulta.success) return { status: 400, corpo: { codigo: 'VALIDACAO', campos: consulta.error.flatten().fieldErrors } };
      try {
        const ctx = {
          sessao, tx, request_id: 'req-teste', agora: relogio.agora, ...(o.fuso ? { fuso: o.fuso } : {}),
          publicar: async (e: { nome: string; agregado_id: string; payload: Record<string, unknown> }) => {
            eventos.push(e);
            return { ...e, id: crypto.randomUUID(), tenant_id: TENANT, versao: 1, ocorrido_em: relogio.agora.toISOString(), ator: sessao.usuario_id, request_id: 'req-teste' } as EnvelopeEvento;
          },
          auditar: async (d: DadosAuditoria) => void auditoria.push(d),
          enfileirar: async () => ({ id: crypto.randomUUID() }),
        };
        const entrada = { corpo: corpo?.data, consulta: consulta?.data, params, cabecalhos: o.cabecalhos ?? {}, arquivos: {}, todosArquivos: {} };
        const chave = rota.idempotencia ? chaveDoPedido(entrada.cabecalhos, rota.idempotencia) : null;
        if (!chave) {
          const r = await rota.executar(ctx, entrada);
          return { status: r.status ?? 200, corpo: r.corpo, cabecalhos: r.cabecalhos };
        }
        const r = await executarIdempotente(idempotencia, tx, { tenant_id: TENANT, chave, rota: `${rota.metodo} /v1/pedido${rota.caminho}`, hash_corpo: hashDoPedido(entrada), agora: relogio.agora }, () => rota.executar(ctx, entrada));
        return { status: r.resposta.status ?? 200, corpo: r.resposta.corpo, repetida: r.repetida };
      } catch (e) {
        if (e instanceof ErroApi) return { status: e.status, corpo: corpoErroApi(e) };
        throw e;
      }
    }
    throw new Error(`sem rota ${metodo} ${caminho}`);
  }
  return { chamar, idempotencia, eventos, auditoria, relogio };
}
