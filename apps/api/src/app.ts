/**
 * API do Macuxi ERP (Fastify, monólito modular; desenho T-0002, seção 2).
 * - `/v1/saude` (pública), `/v1/auth/*` (login, refresh rotativo em cookie httpOnly, sair, eu, troca da senha);
 * - tela única de login (T-0076): `POST /v1/auth/login` com o código da empresa; o código reservado MACUXI desvia por
 *   dentro para o login do superadmin (cookie do `/config`, com o `CABECALHO_CSRF_CONFIG`) e a resposta diz o `destino`; o 401 é o mesmo nos dois lados
 *   e o limite por IP também. "Esqueci a senha": `POST /v1/auth/esqueci` (MACUXI = superadmin) e
 *   `GET /v1/auth/esqueci/situacao` (`auth/esqueci.ts`);
 * - senha provisória (T-0052): com `deve_trocar_senha` no JWT, toda rota do tenant é 403 `TROCAR_SENHA`, menos
 *   `GET /v1/auth/eu`, `POST /v1/auth/sair` e `POST /v1/auth/senha` (`auth/troca-senha.ts`);
 * - cada módulo em `/v1/<modulo>`, montado pelas rotas declaradas no plugin (`definirPlugin` do SDK), com a ordem
 *   sessão → perfil → tenant → licença (RN-CORE-02) em toda rota;
 * - rota multipart (upload do A1, carga de CSV) com limite por arquivo, quantidade e total declarados na rota; os bytes
 *   e os nomes dos arquivos nunca vão para log;
 * - `Idempotency-Key` (`idempotencia` da rota, RN-CORE-05) e tempo máximo por rota (`tempoMaximoMs`, T-0026 D7);
 * - logs pino com `request_id`, `tenant_id`, `usuario_id` e `modulo`; sem corpo, cookie, token nem query string;
 * - portal `/config` em `/v1/plataforma/*` (ADR 0012, `plataforma/rotas.ts`): cookie e sessão próprios, fora do tenant.
 */
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import {
  auditar,
  chaveDoPedido,
  CABECALHO_CSRF_CONFIG,
  CAMINHOS_ESQUECI_SENHA,
  destinoDoCodigo,
  LoginEntrada,
  type LoginResposta,
  PedirSenhaTemporariaEntrada,
  SituacaoEsqueciResposta,
  type DestinoLogin,
  corpoErroApi,
  criarEvento,
  ErroApi,
  EuResposta,
  erros,
  eventoDoModulo,
  executarAutorizado,
  executarIdempotente,
  fusoDaRota,
  hashDoPedido,
  modulosLicenciados,
  QUANTIDADE_MAXIMA_ARQUIVOS,
  pode,
  temFuso,
  type Banco,
  type ContextoRota,
  type DestinoAuditoria,
  type FilaDeTrabalhos,
  type FonteLicencas,
  type Outbox,
  type PluginModulo,
  type Relogio,
  type RepositorioIdempotencia,
  type RotaModulo,
  TAMANHO_MAXIMO_ARQUIVO,
  TAMANHO_MAXIMO_MULTIPART,
  transacaoComPrazo,
  type Transacao,
} from '@macuxierp/platform-sdk';
import type { RepositorioCore } from '@macuxierp/core/api';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { lerTokenAcesso, type SessaoAcesso } from './auth/jwt';
import type { RepositorioAuth } from './auth/portas';
import { FALHA_LOGIN, ServicoAuth, type ConfigAuth, type ResultadoLogin } from './auth/servico';
import { opcoesCookieSessao } from './auth/apoio-login';
import { envioAposResposta, erroMuitasTentativas, limitarEsqueciPorIp, type EsqueciMontado } from './auth/esqueci';
import { registrarSemEnvio } from './auth/esqueci-log';
import type { EnvioEmail } from './email/porta';
import { bloqueiaPorTrocaDeSenha, CorpoTrocaSenha, corpoTrocarSenha } from './auth/troca-senha';
import { diagnosticoBanco } from './erro-banco';
import { enfileirarDoModulo, entradaDaChamada, responder } from './execucao-rota';
import { lerMultipart } from './multipart';
import { ipDoCliente } from './plataforma/ip-cliente';
import { montarEntrada, type DependenciasEntrada } from './entrada/montar';
import { LimitePorChave, novosLimitesEsqueci, type LimitesEsqueci } from './plataforma/limite-ip';
import { montarPlataforma, responderLoginPlataforma, traduzido, type DependenciasPlataformaApi } from './plataforma/rotas';
import type { ServicoPlataforma } from './plataforma/servico';

export const COOKIE_REFRESH = 'macuxierp_refresh';
const CAMINHO_COOKIE = '/v1/auth';
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Campos de texto aceitos num multipart (teto global). */
const CAMPOS_MULTIPART = 50;

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
  /** `plataforma.idempotencia`; obrigatório se alguma rota montada declara `idempotencia`. */
  idempotencia?: RepositorioIdempotencia;
  /** Milissegundos monotônicos para o `tempoMaximoMs` das rotas (padrão `performance.now`; os testes trocam). */
  cronometro?: () => number;
  /** Módulos montados (manifesto + rotas). O tenant só acessa os licenciados (MODULO_INATIVO). */
  modulos: readonly PluginModulo[];
  /** Selo do A1 no `/v1/auth/eu`; padrão sem avisos (`async () => []`). O `main.ts` passa o leitor real do core. */
  avisosA1?: LeitorAvisosA1;
  /**
   * Portal `/config` (ADR 0012): `/v1/plataforma/*` com o banco de plataforma e os plugins de plataforma (o do core).
   * Ausente = o prefixo não é montado (404). Produção: `montarDependenciasProducao`.
   */
  plataforma?: DependenciasPlataformaApi;
  /** Limite por IP das falhas do `POST /v1/auth/login` (tenant e MACUXI). Padrão: `LIMITE_LOGIN_IP_PADRAO` (ADR 0012 §6). */
  limiteLogin?: LimitePorChave;
  /**
   * "Esqueci a senha" (T-0076): ausente = sem e-mail (`emailDisponivel(config.email)` falso). Ordem e regras: auth/esqueci.ts.
   * `repoCore` grava a temporária do tenant (`emitirSenhaTemporaria` do core, RN-CORE-13); produção: o `RepositorioCoreSql` dos módulos.
   */
  esqueci?: { envio: EnvioEmail; limites?: LimitesEsqueci; repoCore: Pick<RepositorioCore, 'emitirSenhaTemporaria'> };
  /** `/entrada/v1` (T-0057, ADR 0014 §3): rotas do cadastros e a autenticação de máquina. Ausente = não montada. */
  entrada?: DependenciasEntrada;
  /** Opções do pino; `false` desliga (testes). */
  logger?: boolean | Record<string, unknown>;
}

/**
 * Selo do A1 no `GET /v1/auth/eu` (RF-CORE-04): os avisos vigentes no instante `agora`, no tenant da transação (RLS).
 * Produção: `avisosA1MaisRecentes` do core, sobre a `core.aviso_a1` que a rotina diária do worker grava (o aviso de
 * ontem vale até a nova rodada, com `dias` recalculado em `agora`).
 */
export type LeitorAvisosA1 = (tx: Transacao, agora: Date) => Promise<readonly { filial_id: string; dias: number; valido_ate: Date }[]>;

const semAvisosA1: LeitorAvisosA1 = async () => [];


declare module 'fastify' {
  interface FastifyRequest {
    sessao: SessaoAcesso | null;
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
    bodyLimit: TAMANHO_MAXIMO_ARQUIVO,
  });
  const servico = new ServicoAuth(d.banco, d.repoAuth, d.auth, d.relogio);

  await app.register(cookie);
  // Tetos globais do multipart; o limite de cada arquivo, a quantidade e o total são os da rota (`lerMultipart`).
  // Campo de texto até 64 KB.
  await app.register(multipart, {
    limits: { fileSize: TAMANHO_MAXIMO_MULTIPART, files: QUANTIDADE_MAXIMA_ARQUIVOS, fields: CAMPOS_MULTIPART, fieldSize: 65_536, parts: CAMPOS_MULTIPART + QUANTIDADE_MAXIMA_ARQUIVOS },
  });
  app.decorateRequest('sessao', null);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    const h = req.headers.authorization;
    req.sessao = h?.startsWith('Bearer ') ? lerTokenAcesso(h.slice(7), d.auth.jwtSegredo, d.relogio.agora()) : null;
    // O log de "request completed" sai pelo reply.log: os dois recebem o tenant e o usuário.
    if (req.sessao) req.log = reply.log = req.log.child({ tenant_id: req.sessao.tenant_id, usuario_id: req.sessao.usuario_id });
    // 403 `SenhaATrocarResposta` com o motivo da sessão (e, na temporária, o fim dela), não o corpo genérico do ErroApi.
    if (req.sessao && bloqueiaPorTrocaDeSenha(req.method, req.routeOptions.url, req.sessao.deve_trocar_senha === true)) {
      return reply.status(403).send(corpoTrocarSenha(req.sessao));
    }
  });

  app.setErrorHandler((recebido, req, reply) => {
    const erro = recebido instanceof ZodError ? erros.validacao(camposZod(recebido)) : recebido;
    if (erro instanceof ErroApi) {
      // 429 com prazo (`MuitasTentativasResposta`, T-0076): `detalhes.retry_after_s` no corpo e também no Retry-After.
      const espera = erro.status === 429 ? erro.detalhes?.retry_after_s : undefined;
      if (typeof espera === 'number') reply.header('retry-after', String(espera));
      // 5xx (503 indisponível, tempo esgotado) leva o `request_id`, como o 500: a tela mostra e o suporte acha no log.
      const corpo = corpoErroApi(erro);
      return reply.status(erro.status).send(erro.status >= 500 ? { ...corpo, request_id: req.id } : corpo);
    }
    const status = (erro as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ codigo: status === 413 ? 'CORPO_GRANDE' : 'VALIDACAO', mensagem: 'Requisição inválida' });
    }
    // Sem a message do erro (LGPD); campos do banco: ver erro-banco.ts.
    const pilha = (erro as Error).stack?.split('\n').slice(1, 6).join('\n');
    req.log.error({ tipo: (erro as Error).name, pilha, ...diagnosticoBanco(erro) }, 'erro interno');
    return reply.status(500).send({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno', request_id: req.id });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada' }));

  const porCookie = (reply: FastifyReply, r: ResultadoLogin) =>
    reply.setCookie(COOKIE_REFRESH, r.refresh, opcoesCookieSessao(CAMINHO_COOKIE, d.cookieSeguro, r.refresh_expira_em));
  // 200 `LoginResposta` do destino 'bko' (login e refresh), também com a senha temporária ou a provisória (T-0076): a
  // sessão abre com a troca obrigatória no token, e o 403 `TROCAR_SENHA` sai só nas outras rotas (o bloqueio do
  // onRequest). `expira_em` é o do token de acesso.
  const respostaLogin = (reply: FastifyReply, r: ResultadoLogin) =>
    porCookie(reply, r)
      .header('cache-control', 'no-store')
      .send({ destino: 'bko', token_acesso: r.token_acesso, expira_em: r.expira_em.toISOString(), ...(r.desbloqueou ? { desbloqueou: true as const } : {}) } satisfies LoginResposta);

  app.get('/v1/saude', async (_req, reply) => {
    const banco = await d.banco.ping().catch(() => false);
    return reply.status(banco ? 200 : 503).send({ status: banco ? 'ok' : 'degradado', versao: d.versao, banco: banco ? 'ok' : 'fora' });
  });

  // Portal /config (ADR 0012): fora do /v1/<modulo>, sem ContextoRota de tenant e sem licença. Montado antes do login
  // porque a tela única (MACUXI) usa o mesmo serviço do superadmin.
  const esqueci: EsqueciMontado = { envio: d.esqueci?.envio ?? null, limites: d.esqueci?.limites ?? novosLimitesEsqueci() };
  const plataforma = d.plataforma
    ? montarPlataforma(app, d.plataforma, { auth: d.auth, relogio: d.relogio, cookieSeguro: d.cookieSeguro, ...(d.cronometro ? { cronometro: d.cronometro } : {}), esqueci })
    : undefined;
  const segredoBff = d.plataforma?.segredoBff ?? null;
  const limiteLogin = d.limiteLogin ?? new LimitePorChave();

  // Tela única (T-0076, ADR 0018): limite por IP → corpo → `destinoDoCodigo`: 'config' (MACUXI) = superadmin (cookie do
  // /config) ou 'bko' = tenant pelo código da empresa. O 'config' exige o `CABECALHO_CSRF_CONFIG` como o /config/entrar;
  // sem ele, o mesmo 401 neutro (ADR 0018 §6), com o custo de argon2 de uma conferência e sem tocar o banco. O 401 do
  // superadmin sai com o mesmo corpo do tenant. O limite por IP conta as falhas (401 e 423) dos dois lados juntos;
  // estourado, só a senha temporária válida entra (hotfix v0.3.16.1, RN-CORE-15): o resto é o 429 do limite.
  app.post('/v1/auth/login', async (req, reply) => {
    const ip = ipDoCliente(req, segredoBff);
    const agoraMs = d.relogio.agora().getTime();
    const porIp = limiteLogin.excedido(ip, agoraMs);
    const limite = porIp.permitido ? undefined : () => erroMuitasTentativas(porIp.retry_after_s);
    const entrada = LoginEntrada.parse(req.body);
    try {
      if (destinoDoCodigo(entrada.empresa) === 'bko') return respostaLogin(reply, await servico.entrar(entrada, limite));
      return await entrarComoSuperadmin(reply, plataforma, entrada, { cookieSeguro: d.cookieSeguro, csrf: req.headers[CABECALHO_CSRF_CONFIG] === '1', limite });
    } catch (e) {
      // 401 e 423 (RN-CORE-15) contam no limite por IP; o login certo, inclusive com a temporária, não
      if (e instanceof ErroApi && (e.status === 401 || e.status === 423)) limiteLogin.registrar(ip, agoraMs);
      throw e;
    }
  });

  app.get(CAMINHOS_ESQUECI_SENHA.situacao, async (_req, reply) =>
    reply.header('cache-control', 'no-store').send({ esqueci_disponivel: esqueci.envio !== null } satisfies SituacaoEsqueciResposta),
  );

  // Ordem e regras: auth/esqueci.ts.
  const apos = envioAposResposta(esqueci.envio);
  app.post(CAMINHOS_ESQUECI_SENHA.tenant, apos.opcoes, async (req, reply) => {
    const agoraMs = d.relogio.agora().getTime();
    limitarEsqueciPorIp(esqueci.limites, ipDoCliente(req, segredoBff), agoraMs);
    const { empresa, email } = PedirSenhaTemporariaEntrada.parse(req.body);
    const doSuperadmin = destinoDoCodigo(empresa) === 'config';
    if (!d.esqueci) return apos.responder(req, reply, await servico.esqueciSemEnvio(req.log));
    if (doSuperadmin) {
      if (!plataforma) {
        registrarSemEnvio(req.log, 'plataforma_indisponivel');
        return apos.responder(req, reply, null);
      }
      return apos.responder(req, reply, await traduzido(() => plataforma.esqueci(email, req.log)));
    }
    const mensagem = await servico.esqueci(
      { empresa, email },
      d.esqueci.repoCore,
      async (tx, conta) => {
        const ctx = { ...conta, request_id: req.id };
        await auditar(d.auditoria, tx, ctx, { acao: 'core.usuario.senha_esquecida', entidade: 'usuario', entidade_id: conta.usuario_id }, d.relogio.agora());
      },
      req.log,
    );
    return apos.responder(req, reply, mensagem);
  });

  app.post('/v1/auth/refresh', async (req, reply) => respostaLogin(reply, await servico.renovar(req.cookies[COOKIE_REFRESH])));

  app.post('/v1/auth/sair', async (req, reply) => {
    await servico.sair(req.cookies[COOKIE_REFRESH]);
    return reply.clearCookie(COOKIE_REFRESH, { path: CAMINHO_COOKIE }).status(204).send();
  });

  // Troca da própria senha (T-0052): 204 sem corpo. A sessão corrente (o refresh do cookie) continua; o BKO renova o
  // acesso (`POST /v1/auth/refresh`) para sair do JWT com a senha provisória. Auditoria só com ids e contagem.
  app.post('/v1/auth/senha', async (req, reply) => {
    if (!req.sessao) throw erros.naoAutenticado();
    const sessao = req.sessao;
    const entrada = CorpoTrocaSenha.parse(req.body);
    await servico.trocarSenha(sessao, req.cookies[COOKIE_REFRESH], entrada, async (tx, sessoesRevogadas) => {
      const ctx = { tenant_id: sessao.tenant_id, usuario_id: sessao.usuario_id, request_id: req.id };
      const dados = { acao: 'core.usuario.senha_trocada', entidade: 'usuario', entidade_id: sessao.usuario_id, depois: { sessoes_revogadas: sessoesRevogadas } };
      await auditar(d.auditoria, tx, ctx, dados, d.relogio.agora());
    });
    return reply.header('cache-control', 'no-store').status(204).send();
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
        const filiais = await d.repoAuth.filiaisPorIds(tx, usuario.filial_ids);
        const avisos = await (d.avisosA1 ?? semAvisosA1)(tx, agora);
        // A saída passa pelo contrato: campo a mais (e-mail, tenant_id) não vaza, e dado fora dele é 500 (erro nosso),
        // nunca o 400 VALIDACAO do ZodError, que é do corpo do pedido.
        const eu = EuResposta.safeParse({
          usuario: {
            id: usuario.id,
            nome: usuario.nome,
            perfil: usuario.perfil,
            deve_trocar_senha: usuario.deve_trocar_senha,
            ...(usuario.deve_trocar_senha && req.sessao?.motivo_troca ? { motivo_troca: req.sessao.motivo_troca } : {}),
          },
          empresa: { id: tenant.id, slug: tenant.slug, razao_social: tenant.razao_social, fuso: tenant.fuso },
          filiais,
          modulos: d.modulos.filter((m) => ativos.has(m.manifesto.id)).map((m) => ({ id: m.manifesto.id, menus: [...(m.manifesto.web?.menus ?? [])] })),
          avisos_a1: avisos.map((a) => ({ filial_id: a.filial_id, dias: a.dias, valido_ate: a.valido_ate.toISOString() })),
        } satisfies EuResposta);
        if (!eu.success) throw new Error(`GET /v1/auth/eu fora do contrato EuResposta: ${eu.error.issues.map((i) => i.path.join('.')).join(', ')}`);
        return eu.data;
      },
    });
  });

  for (const plugin of d.modulos) montarModulo(app, plugin, d);
  if (d.entrada) montarEntrada(app, d.entrada, { banco: d.banco, licencas: d.licencas, trabalhos: d.trabalhos, relogio: d.relogio, segredoBff, repoAuth: d.repoAuth });
  return app;
}

/**
 * MACUXI na tela única (T-0076, ADR 0018): o login do superadmin com o cookie do `/config` e 200 `LoginResposta` do
 * destino 'config' (`{ destino, expira_em }`, sem token no corpo), também com a senha temporária. Sem o
 * `CABECALHO_CSRF_CONFIG` (`csrf` falso), o 401 neutro com o custo de uma conferência, antes do banco. O 401 sai com o
 * mesmo corpo do tenant (`FALHA_LOGIN`), para a tela não revelar o lado.
 */
async function entrarComoSuperadmin(
  reply: FastifyReply,
  plataforma: ServicoPlataforma | undefined,
  entrada: { email: string; senha: string },
  o: { cookieSeguro: boolean; csrf: boolean; limite?: (() => ErroApi) | undefined },
) {
  try {
    if (!plataforma) throw o.limite ? o.limite() : erros.naoAutenticado(FALHA_LOGIN);
    if (!o.csrf) return await plataforma.recusarComCustoIgual(entrada.senha);
    const r = await traduzido(() => plataforma.entrar(entrada.email.trim().toLowerCase(), entrada.senha, o.limite));
    reply.log = reply.request.log = reply.request.log.child({ superadmin_id: r.superadmin_id });
    return responderLoginPlataforma(reply, r, o.cookieSeguro, { destino: 'config' satisfies DestinoLogin });
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) throw erros.naoAutenticado(FALHA_LOGIN);
    throw e;
  }
}

function montarModulo(app: FastifyInstance, plugin: PluginModulo, d: DependenciasApp): void {
  const modulo = plugin.manifesto.id;
  for (const rota of plugin.rotas) {
    if (rota.idempotencia && !d.idempotencia) throw new Error(`${modulo}: ${rota.metodo} ${rota.caminho} declara idempotencia sem o repositório na API`);
    app.route({
      method: rota.metodo,
      url: `/v1/${modulo}${rota.caminho}`,
      handler: (req, reply) => executarRota(req, reply, rota, modulo, d),
    });
  }
}

async function executarRota(req: FastifyRequest, reply: FastifyReply, rota: RotaModulo, modulo: string, d: DependenciasApp) {
  req.log = reply.log = req.log.child({ modulo });
  const cronometro = d.cronometro ?? (() => performance.now());
  const inicio = cronometro();
  const estourou = () => rota.tempoMaximoMs !== undefined && cronometro() - inicio > rota.tempoMaximoMs;
  // O multipart é lido antes da transação (não segura conexão enquanto o arquivo sobe), mas só depois da sessão e do
  // perfil, na ordem da RN-CORE-02; tenant e licença seguem no `executarAutorizado`, antes de qualquer uso dos dados.
  if (rota.multipart && !req.sessao) throw erros.naoAutenticado();
  if (rota.multipart && !pode(req.sessao!.perfil, rota.acao)) throw erros.perfilSemPermissao();
  const entrada = rota.multipart ? await lerMultipart(req, rota.multipart) : { corpo: req.body, todosArquivos: {} };
  if (estourou()) throw erros.tempoEsgotado(Math.round(rota.tempoMaximoMs! / 1000));
  const agora = d.relogio.agora();
  const fonte = licencasComFuso(d);
  const resultado = await executarAutorizado({
    sessao: req.sessao,
    acao: rota.acao,
    agora,
    banco: d.banco,
    licencas: fonte,
    executar: async (txTenant, sessao) => {
      const tx = rota.tempoMaximoMs === undefined ? txTenant : transacaoComPrazo(txTenant, { restanteMs: rota.tempoMaximoMs - (cronometro() - inicio), limiteRotaMs: rota.tempoMaximoMs }, cronometro);
      const fuso = fusoDaRota({ fuso: (await fonte.fuso(txTenant, sessao.tenant_id)) ?? undefined });
      const ctx: ContextoRota = {
        sessao,
        tx,
        request_id: req.id,
        agora,
        fuso,
        publicar: async (e) => {
          if (!eventoDoModulo(modulo, e.nome)) throw new Error(`${modulo} publicando evento de outro módulo: ${e.nome}`);
          const { versao: _ignorada, ...dados } = e;
          const evento = criarEvento({ ...dados, tenant_id: sessao.tenant_id, ator: sessao.usuario_id, request_id: req.id }, agora);
          return { ...evento, versao: await d.outbox.gravar(tx, evento) };
        },
        auditar: async (dados) => {
          await auditar(d.auditoria, tx, { tenant_id: sessao.tenant_id, usuario_id: sessao.usuario_id, request_id: req.id }, dados, agora);
        },
        enfileirar: enfileirarDoModulo(modulo, d.trabalhos, tx, sessao.tenant_id),
      };
      const e = entradaDaChamada(req, rota, entrada);
      const chave = rota.idempotencia ? chaveDoPedido(e.cabecalhos, rota.idempotencia) : null;
      if (!chave) return { resposta: await rota.executar(ctx, e), repetida: false };
      const pedido = { tenant_id: sessao.tenant_id, chave, rota: `${rota.metodo} /v1/${modulo}${rota.caminho}`, hash_corpo: hashDoPedido(e), agora };
      return executarIdempotente(d.idempotencia!, tx, pedido, () => rota.executar(ctx, e));
    },
  });
  return responder(reply, resultado.resposta, resultado.repetida);
}

/**
 * Licenças da rota com o fuso do tenant (T-0042, regra 4): com o `LicencasPg` (produção), o fuso vem na mesma consulta
 * das licenças, sem ida extra ao banco. Fonte sem `lerComFuso` (dublê): lê o tenant pelo `repoAuth`, como o `/eu`.
 * Uma por pedido (guarda o fuso lido entre a checagem da licença e o `executar`).
 */
function licencasComFuso(d: DependenciasApp): FonteLicencas & { fuso(tx: Transacao, tenantId: string): Promise<string | null> } {
  const base = d.licencas;
  if (!temFuso(base)) {
    return { ler: (tx, t) => base.ler(tx, t), fuso: async (tx, t) => (await d.repoAuth.tenantPorId(tx, t))?.fuso ?? null };
  }
  let lido: { tenantId: string; fuso: string | null } | null = null;
  return {
    ler: async (tx, t) => {
      const r = await base.lerComFuso(tx, t);
      lido = { tenantId: t, fuso: r.fuso };
      return r.licencas;
    },
    // A rota de módulo sempre checa a licença antes; o fallback só cobre ação sem módulo.
    fuso: async (tx, t) => (lido?.tenantId === t ? lido.fuso : (await base.lerComFuso(tx, t)).fuso),
  };
}

