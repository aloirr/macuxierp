/**
 * API do Macuxi ERP (Fastify, monólito modular; desenho T-0002, seção 2).
 * - `/v1/saude` (pública), `/v1/auth/*` (login, refresh rotativo em cookie httpOnly, sair, eu);
 * - cada módulo em `/v1/<modulo>`, montado pelas rotas declaradas no plugin (`definirPlugin` do SDK), com a ordem
 *   sessão → perfil → tenant → licença (RN-CORE-02) em toda rota;
 * - logs pino com `request_id`, `tenant_id`, `usuario_id` e `modulo`; sem corpo, cookie, token nem query string.
 */
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import {
  auditar,
  criarEvento,
  ErroApi,
  erros,
  eventoDoModulo,
  executarAutorizado,
  moduloDaAcao,
  modulosLicenciados,
  PERMISSOES,
  pode,
  trabalhoDoModulo,
  type Acao,
  type Banco,
  type ContextoRota,
  type DestinoAuditoria,
  type FilaDeTrabalhos,
  type FonteLicencas,
  type Outbox,
  type PluginModulo,
  type Relogio,
  type RotaModulo,
  type Sessao,
} from '@macuxierp/platform-sdk';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { lerTokenAcesso } from './auth/jwt';
import type { RepositorioAuth } from './auth/portas';
import { ServicoAuth, type ConfigAuth, type ResultadoLogin } from './auth/servico';

export const COOKIE_REFRESH = 'macuxierp_refresh';
const CAMINHO_COOKIE = '/v1/auth';
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export interface DependenciasApp {
  versao: string;
  auth: ConfigAuth;
  /** `false` só em teste local sem HTTPS; em produção o cookie é sempre `Secure`. */
  cookieSeguro: boolean;
  banco: Banco;
  repoAuth: RepositorioAuth;
  licencas: FonteLicencas;
  outbox: Outbox;
  auditoria: DestinoAuditoria;
  trabalhos: FilaDeTrabalhos;
  relogio: Relogio;
  /** Módulos montados (manifesto + rotas). O tenant só acessa os licenciados (MODULO_INATIVO). */
  modulos: readonly PluginModulo[];
  /** Opções do pino; `false` desliga (testes). */
  logger?: boolean | Record<string, unknown>;
}

const Login = z.object({ empresa: z.string().min(1).max(60), email: z.string().email().max(254), senha: z.string().min(1).max(256) });

declare module 'fastify' {
  interface FastifyRequest {
    sessao: Sessao | null;
  }
}

function camposZod(e: ZodError): Record<string, string> {
  return Object.fromEntries(e.issues.map((i) => [i.path.join('.') || '_', i.message]));
}

export async function criarApp(d: DependenciasApp): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      d.logger === false
        ? false
        : {
            level: 'info',
            redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], remove: true },
            serializers: {
              // Só método e caminho: a query string pode ter CPF ou nome (?busca=), e o corpo nunca vai ao log.
              req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
            },
            ...(typeof d.logger === 'object' ? d.logger : {}),
          },
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && REQUEST_ID.test(h) ? h : randomUUID();
    },
    requestIdLogLabel: 'request_id',
    bodyLimit: 1_048_576,
  });
  const servico = new ServicoAuth(d.banco, d.repoAuth, d.auth, d.relogio);

  await app.register(cookie);
  app.decorateRequest('sessao', null);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    const h = req.headers.authorization;
    req.sessao = h?.startsWith('Bearer ') ? lerTokenAcesso(h.slice(7), d.auth.jwtSegredo, d.relogio.agora()) : null;
    // O log de "request completed" sai pelo reply.log: os dois recebem o tenant e o usuário.
    if (req.sessao) req.log = reply.log = req.log.child({ tenant_id: req.sessao.tenant_id, usuario_id: req.sessao.usuario_id });
  });

  app.setErrorHandler((recebido, req, reply) => {
    const erro = recebido instanceof ZodError ? erros.validacao(camposZod(recebido)) : recebido;
    if (erro instanceof ErroApi) {
      return reply.status(erro.status).send({ codigo: erro.codigo, mensagem: erro.message, ...(erro.campos ? { campos: erro.campos } : {}) });
    }
        const status = (erro as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ codigo: status === 413 ? 'CORPO_GRANDE' : 'VALIDACAO', mensagem: 'Requisição inválida' });
    }
    // Só o tipo e a pilha: a mensagem de erro de banco pode trazer valor de coluna (dado pessoal).
    req.log.error({ tipo: (erro as Error).name, pilha: (erro as Error).stack?.split('\n').slice(1, 6).join('\n') }, 'erro interno');
    return reply.status(500).send({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno', request_id: req.id });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada' }));

  const porCookie = (reply: FastifyReply, r: ResultadoLogin) =>
    reply.setCookie(COOKIE_REFRESH, r.refresh, { httpOnly: true, secure: d.cookieSeguro, sameSite: 'strict', path: CAMINHO_COOKIE, expires: r.refresh_expira_em });
  const respostaLogin = (reply: FastifyReply, r: ResultadoLogin) =>
    porCookie(reply, r).header('cache-control', 'no-store').send({ token_acesso: r.token_acesso, expira_em: r.expira_em.toISOString() });

  app.get('/v1/saude', async (_req, reply) => {
    const banco = await d.banco.ping().catch(() => false);
    return reply.status(banco ? 200 : 503).send({ status: banco ? 'ok' : 'degradado', versao: d.versao, banco: banco ? 'ok' : 'fora' });
  });

  app.post('/v1/auth/login', async (req, reply) => respostaLogin(reply, await servico.entrar(Login.parse(req.body))));

  app.post('/v1/auth/refresh', async (req, reply) => respostaLogin(reply, await servico.renovar(req.cookies[COOKIE_REFRESH])));

  app.post('/v1/auth/sair', async (req, reply) => {
    await servico.sair(req.cookies[COOKIE_REFRESH]);
    return reply.clearCookie(COOKIE_REFRESH, { path: CAMINHO_COOKIE }).status(204).send();
  });

  app.get('/v1/auth/eu', async (req) => {
    const agora = d.relogio.agora();
    return executarAutorizado({
      sessao: req.sessao,
      acao: 'sessao',
      agora,
      banco: d.banco,
      licencas: d.licencas,
      executar: async (tx, s) => {
        const [usuario, tenant, licencas] = await Promise.all([d.repoAuth.usuarioPorId(tx, s.usuario_id), d.repoAuth.tenantPorId(tx, s.tenant_id), d.licencas.ler(tx, s.tenant_id)]);
        if (!usuario || !usuario.ativo || !tenant) throw erros.naoAutenticado();
        const ativos = new Set(modulosLicenciados(licencas, agora));
        return {
          usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
          empresa: { id: tenant.id, slug: tenant.slug, nome: tenant.nome, fuso: tenant.fuso },
          filial_ids: usuario.filial_ids,
          modulos: d.modulos.filter((m) => ativos.has(m.manifesto.id)).map((m) => ({ id: m.manifesto.id, menus: m.manifesto.web?.menus ?? [] })),
          acoes: (Object.keys(PERMISSOES) as Acao[]).filter((a) => ativos.has(moduloDaAcao(a)) && pode(usuario.perfil, a)),
        };
      },
    });
  });

  for (const plugin of d.modulos) montarModulo(app, plugin, d);
  return app;
}

function montarModulo(app: FastifyInstance, plugin: PluginModulo, d: DependenciasApp): void {
  const modulo = plugin.manifesto.id;
  for (const rota of plugin.rotas) {
    app.route({
      method: rota.metodo,
      url: `/v1/${modulo}${rota.caminho}`,
      handler: (req, reply) => executarRota(req, reply, rota, modulo, d),
    });
  }
}

async function executarRota(req: FastifyRequest, reply: FastifyReply, rota: RotaModulo, modulo: string, d: DependenciasApp) {
  req.log = reply.log = req.log.child({ modulo });
  const agora = d.relogio.agora();
  const resposta = await executarAutorizado({
    sessao: req.sessao,
    acao: rota.acao,
    agora,
    banco: d.banco,
    licencas: d.licencas,
    executar: async (tx, sessao) => {
      const ctx: ContextoRota = {
        sessao,
        tx,
        request_id: req.id,
        agora,
        publicar: async (e) => {
          if (!eventoDoModulo(modulo, e.nome)) throw new Error(`${modulo} publicando evento de outro módulo: ${e.nome}`);
          const evento = criarEvento({ ...e, tenant_id: sessao.tenant_id, ator: sessao.usuario_id, request_id: req.id }, agora);
          await d.outbox.gravar(tx, evento);
          return evento;
        },
        auditar: async (dados) => {
          await auditar(d.auditoria, tx, { tenant_id: sessao.tenant_id, usuario_id: sessao.usuario_id, request_id: req.id }, dados, agora);
        },
        enfileirar: async (pedido) => {
          if (!trabalhoDoModulo(modulo, pedido.tipo)) {
            throw new Error(`${modulo} enfileirando trabalho fora do próprio módulo: ${pedido.tipo}`);
          }
          return d.trabalhos.enfileirar(tx, { ...pedido, tenant_id: sessao.tenant_id });
        },
      };
      return rota.executar(ctx, {
        corpo: rota.corpo ? rota.corpo.parse(req.body) : undefined,
        consulta: rota.consulta ? rota.consulta.parse(req.query) : undefined,
        params: req.params as Record<string, string>,
      });
    },
  });
  if (resposta.cabecalhos) reply.headers(resposta.cabecalhos);
  return reply.status(resposta.status ?? 200).send(resposta.corpo ?? null);
}
