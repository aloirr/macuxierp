/**
 * Apoio dos testes de rota: roda uma rota do plugin como a API faz (perfil → validação Zod → `executar`), sem Fastify
 * e sem PostgreSQL, com outbox, auditoria e fila em memória. A checagem de licença e a transação do tenant são da API
 * (testadas em apps/api); aqui vale o que é do módulo.
 */
import { ErroApi, type EnvelopeEvento, type MetodoHttp, type PluginModulo, type Sessao, type Perfil, pode, type DadosAuditoria, type PedidoTrabalho, type Transacao } from '@macuxierp/platform-sdk';

export const TENANT = '11111111-1111-4111-8111-111111111111';
export const sessaoDe = (perfil: Perfil, usuario_id = '22222222-2222-4222-8222-222222222222'): Sessao => ({ usuario_id, tenant_id: TENANT, perfil, filial_ids: [] });

export interface Resposta {
  status: number;
  corpo: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function criarAmbiente(plugin: PluginModulo, agora = new Date('2026-11-21T15:00:00Z'), tx: Transacao = { consultar: async () => [] }) {
  const eventos: { nome: string; agregado_id: string; versao: number; payload: Record<string, unknown> }[] = [];
  const auditoria: DadosAuditoria[] = [];
  const trabalhos: (Omit<PedidoTrabalho, 'tenant_id'> & { id: string })[] = [];
  const relogio = { agora };

  async function chamar(metodo: MetodoHttp, caminho: string, o: { sessao?: Sessao; corpo?: unknown; consulta?: Record<string, unknown> } = {}): Promise<Resposta> {
    const partes = caminho.split('/').filter(Boolean);
    for (const rota of plugin.rotas) {
      if (rota.metodo !== metodo) continue;
      const modelo = rota.caminho.split('/').filter(Boolean);
      if (modelo.length !== partes.length) continue;
      const params: Record<string, string> = {};
      if (!modelo.every((m, i) => (m.startsWith(':') ? ((params[m.slice(1)] = partes[i] as string), true) : m === partes[i]))) continue;
      const sessao = o.sessao ?? sessaoDe('administrador');
      if (!pode(sessao.perfil, rota.acao)) return { status: 403, corpo: { codigo: 'PERFIL_SEM_PERMISSAO' } };
      const corpo = rota.corpo ? rota.corpo.safeParse(o.corpo ?? {}) : null;
      if (corpo && !corpo.success) return { status: 400, corpo: { codigo: 'VALIDACAO', campos: corpo.error.flatten().fieldErrors } };
      const consulta = rota.consulta ? rota.consulta.safeParse(o.consulta ?? {}) : null;
      if (consulta && !consulta.success) return { status: 400, corpo: { codigo: 'VALIDACAO', campos: consulta.error.flatten().fieldErrors } };
      try {
        const r = await rota.executar(
          {
            sessao, tx, request_id: 'req-teste', agora: relogio.agora,
            publicar: async (e) => {
              eventos.push(e);
              return { ...e, id: 'e', tenant_id: TENANT, ocorrido_em: relogio.agora.toISOString(), ator: sessao.usuario_id, request_id: 'req-teste' } as EnvelopeEvento;
            },
            auditar: async (d) => void auditoria.push(d),
            enfileirar: async (p) => {
              const id = `00000000-0000-4000-8000-${String(trabalhos.length + 1).padStart(12, '0')}`;
              trabalhos.push({ ...p, id });
              return { id };
            },
          },
          { corpo: corpo?.data, consulta: consulta?.data, params },
        );
        return { status: r.status ?? 200, corpo: r.corpo };
      } catch (e) {
        if (e instanceof ErroApi) return { status: e.status, corpo: { codigo: e.codigo, mensagem: e.message, campos: e.campos } };
        throw e;
      }
    }
    throw new Error(`sem rota ${metodo} ${caminho}`);
  }
  return { chamar, eventos, auditoria, trabalhos, relogio };
}
