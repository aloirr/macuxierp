/**
 * Apoio dos testes de rota: roda uma rota do plugin como a API faz (perfil → validação Zod → `executar`), sem Fastify
 * e sem PostgreSQL, com outbox, auditoria e fila em memória. A checagem de licença e a transação do tenant são da API
 * (testadas em apps/api); aqui vale o que é do módulo.
 */
import {
  ArquivoRecebido, ErroApi, chaveDoPedido, erros, executarIdempotente, hashDoPedido, tamanhoMaximoTotal, type EnvelopeEvento, type MetodoHttp, type PluginModulo, type Sessao, type Perfil, pode, type DadosAuditoria, type PedidoTrabalho, type Transacao,
} from '@macuxierp/platform-sdk';
import { IdempotenciaMemoria } from '@macuxierp/platform-sdk/testes';

export const TENANT = '11111111-1111-4111-8111-111111111111';
export const sessaoDe = (perfil: Perfil, usuario_id = '22222222-2222-4222-8222-222222222222'): Sessao => ({ usuario_id, tenant_id: TENANT, perfil, filial_ids: [] });

export interface Resposta {
  status: number;
  corpo: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function criarAmbiente(plugin: PluginModulo, agora = new Date('2026-11-21T15:00:00Z'), tx: Transacao = { consultar: async () => [] }) {
  const eventos: { nome: string; agregado_id: string; versao?: number; payload: Record<string, unknown> }[] = [];
  const auditoria: DadosAuditoria[] = [];
  const trabalhos: (Omit<PedidoTrabalho, 'tenant_id'> & { id: string })[] = [];
  const relogio = { agora };

  const idempotencia = new IdempotenciaMemoria();

  /** `arquivos` = multipart (campo `arquivos`); `semLicenca` = o tenant sem o módulo (a API responde MODULO_INATIVO depois do perfil). */
  async function chamar(
    metodo: MetodoHttp,
    caminho: string,
    o: { sessao?: Sessao; corpo?: unknown; consulta?: Record<string, unknown>; arquivos?: { nome: string; conteudo: string | Buffer }[]; cabecalhos?: Record<string, string>; semLicenca?: boolean } = {},
  ): Promise<Resposta> {
    const partes = caminho.split('/').filter(Boolean);
    for (const rota of plugin.rotas) {
      if (rota.metodo !== metodo) continue;
      const modelo = rota.caminho.split('/').filter(Boolean);
      if (modelo.length !== partes.length) continue;
      const params: Record<string, string> = {};
      if (!modelo.every((m, i) => (m.startsWith(':') ? ((params[m.slice(1)] = partes[i] as string), true) : m === partes[i]))) continue;
      const sessao = o.sessao ?? sessaoDe('administrador');
      if (!pode(sessao.perfil, rota.acao)) return { status: 403, corpo: { codigo: 'PERFIL_SEM_PERMISSAO' } };
      if (o.semLicenca) return { status: 403, corpo: { codigo: 'MODULO_INATIVO' } };
      const corpo = rota.corpo ? rota.corpo.safeParse(o.corpo ?? {}) : null;
      if (corpo && !corpo.success) return { status: 400, corpo: { codigo: 'VALIDACAO', campos: corpo.error.flatten().fieldErrors } };
      const consulta = rota.consulta ? rota.consulta.safeParse(o.consulta ?? {}) : null;
      if (consulta && !consulta.success) return { status: 400, corpo: { codigo: 'VALIDACAO', campos: consulta.error.flatten().fieldErrors } };
      try {
        const bufs = (o.arquivos ?? []).map((x) => new ArquivoRecebido('arquivos', x.nome, 'text/csv', Buffer.from(x.conteudo)));
        if (rota.multipart && bufs.length > 0) {
          const m = rota.multipart.arquivos[0]!;
          if (bufs.length > (m.quantidadeMaxima ?? 1)) throw erros.validacao({ arquivos: 'Arquivos demais' });
          if (bufs.some((b) => b.tamanho > m.tamanhoMaximo) || bufs.reduce((t, b) => t + b.tamanho, 0) > tamanhoMaximoTotal(rota.multipart)) throw erros.arquivoGrande('arquivos', m.tamanhoMaximo);
        }
        const ctx = {
          sessao, tx, request_id: 'req-teste', agora: relogio.agora,
          publicar: async (e: { nome: string; agregado_id: string; versao: number; payload: Record<string, unknown> }) => {
            eventos.push(e);
            return { ...e, id: 'e', tenant_id: TENANT, ocorrido_em: relogio.agora.toISOString(), ator: sessao.usuario_id, request_id: 'req-teste' } as EnvelopeEvento;
          },
          auditar: async (d: DadosAuditoria) => void auditoria.push(d),
          enfileirar: async (p: Omit<PedidoTrabalho, 'tenant_id'>) => {
            const id = `00000000-0000-4000-8000-${String(trabalhos.length + 1).padStart(12, '0')}`;
            trabalhos.push({ ...p, id });
            return { id };
          },
        };
        const entrada = { corpo: corpo?.data, consulta: consulta?.data, params, cabecalhos: o.cabecalhos ?? {}, arquivos: (bufs[0] ? { arquivos: bufs[0] } : {}) as Record<string, ArquivoRecebido>, todosArquivos: (bufs.length ? { arquivos: bufs } : {}) as Record<string, ArquivoRecebido[]> };
        const chave = rota.idempotencia ? chaveDoPedido(entrada.cabecalhos, rota.idempotencia) : null;
        const r = chave
          ? (await executarIdempotente(idempotencia, tx, { tenant_id: TENANT, chave, rota: `${rota.metodo} /v1/${plugin.manifesto.id}${rota.caminho}`, hash_corpo: hashDoPedido(entrada), agora: relogio.agora }, () => rota.executar(ctx, entrada))).resposta
          : await rota.executar(ctx, entrada);
        return { status: r.status ?? 200, corpo: r.corpo };
      } catch (e) {
        if (e instanceof ErroApi) return { status: e.status, corpo: { codigo: e.codigo, mensagem: e.message, campos: e.campos } };
        throw e;
      }
    }
    throw new Error(`sem rota ${metodo} ${caminho}`);
  }
  return { chamar, idempotencia, eventos, auditoria, trabalhos, relogio };
}
