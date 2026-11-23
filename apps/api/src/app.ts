/**
 * API do Macuxi ERP (Fastify, monólito modular; desenho T-0002, seção 2).
 * - `/v1/saude` (pública), `/v1/auth/*` (login, refresh rotativo em cookie httpOnly, sair, eu);
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
  ArquivoRecebido,
  auditar,
  chaveDoPedido,
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
  trabalhoDoModulo,
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
  type Sessao,
  TAMANHO_MAXIMO_ARQUIVO,
  TAMANHO_MAXIMO_MULTIPART,
  tamanhoMaximoTotal,
  transacaoComPrazo,
  type Transacao,
  type ArquivoEsperado,
  type MultipartRota,
} from '@macuxierp/platform-sdk';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { lerTokenAcesso } from './auth/jwt';
import type { RepositorioAuth } from './auth/portas';
import { ServicoAuth, type ConfigAuth, type ResultadoLogin } from './auth/servico';
import { opcoesCookieSessao } from './auth/apoio-login';
import { entradaDaChamada, responder } from './execucao-rota';
import { montarPlataforma, type DependenciasPlataformaApi } from './plataforma/rotas';

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
  });

  app.setErrorHandler((recebido, req, reply) => {
    const erro = recebido instanceof ZodError ? erros.validacao(camposZod(recebido)) : recebido;
    if (erro instanceof ErroApi) {
      return reply.status(erro.status).send(corpoErroApi(erro));
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
    reply.setCookie(COOKIE_REFRESH, r.refresh, opcoesCookieSessao(CAMINHO_COOKIE, d.cookieSeguro, r.refresh_expira_em));
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
        const filiais = await d.repoAuth.filiaisPorIds(tx, usuario.filial_ids);
        const avisos = await (d.avisosA1 ?? semAvisosA1)(tx, agora);
        // A saída passa pelo contrato: campo a mais (e-mail, tenant_id) não vaza, e dado fora dele é 500 (erro nosso),
        // nunca o 400 VALIDACAO do ZodError, que é do corpo do pedido.
        const eu = EuResposta.safeParse({
          usuario: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil },
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

  // Portal /config (ADR 0012): fora do /v1/<modulo>, sem ContextoRota de tenant e sem licença.
  if (d.plataforma) montarPlataforma(app, d.plataforma, { auth: d.auth, relogio: d.relogio, cookieSeguro: d.cookieSeguro });
  for (const plugin of d.modulos) montarModulo(app, plugin, d);
  return app;
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
        enfileirar: async (pedido) => {
          if (!trabalhoDoModulo(modulo, pedido.tipo)) {
            throw new Error(`${modulo} enfileirando trabalho fora do próprio módulo: ${pedido.tipo}`);
          }
          return d.trabalhos.enfileirar(tx, { ...pedido, tenant_id: sessao.tenant_id });
        },
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

/**
 * Lê o `multipart/form-data` da rota: campos de texto (validados depois pelo `corpo` da rota) e os arquivos declarados,
 * cada um com o próprio limite (413 `ARQUIVO_GRANDE`), a quantidade do campo e o total da rota (413 `ARQUIVO_GRANDE`
 * em `_`). Campo de texto repetido, arquivo não declarado ou acima da quantidade é 400 `VALIDACAO`. Limite da rota igual
 * ao teto global: o `@fastify/multipart` corta antes e o 413 dele vira `ARQUIVO_GRANDE` do campo.
 */
async function lerMultipart(req: FastifyRequest, m: MultipartRota) {
  if (!req.isMultipart()) throw erros.validacao({ _: 'envie multipart/form-data' });
  const porCampo = new Map(m.arquivos.map((a) => [a.campo, a]));
  const corpo: Record<string, unknown> = {};
  const todosArquivos: Record<string, ArquivoRecebido[]> = {};
  let lendo: ArquivoEsperado | undefined;
  try {
    await lerPartes(req, { porCampo, total: tamanhoMaximoTotal(m) }, corpo, todosArquivos, (a) => (lendo = a));
  } catch (e) {
    if (lendo && (e as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') throw erros.arquivoGrande(lendo.campo, lendo.tamanhoMaximo);
    throw e;
  }
  const faltando = m.arquivos.filter((a) => a.obrigatorio !== false && !todosArquivos[a.campo]);
  if (faltando.length) throw erros.validacao(Object.fromEntries(faltando.map((a) => [a.campo, 'arquivo obrigatório'])));
  return { corpo, todosArquivos };
}

async function lerPartes(
  req: FastifyRequest,
  limites: { porCampo: ReadonlyMap<string, ArquivoEsperado>; total: number },
  corpo: Record<string, unknown>,
  arquivos: Record<string, ArquivoRecebido[]>,
  lendo: (a: ArquivoEsperado) => void,
) {
  let totalLote = 0;
  for await (const parte of req.parts()) {
    if (parte.type === 'field') {
      if (parte.fieldname in corpo || limites.porCampo.has(parte.fieldname)) throw erros.validacao({ [parte.fieldname]: 'campo repetido ou no lugar de arquivo' });
      corpo[parte.fieldname] = parte.value;
      continue;
    }
    const esperado = limites.porCampo.get(parte.fieldname);
    const ja = arquivos[parte.fieldname] ?? [];
    if (!esperado || parte.fieldname in corpo) throw erros.validacao({ [parte.fieldname]: 'arquivo não esperado' });
    const maximo = esperado.quantidadeMaxima ?? 1;
    if (ja.length >= maximo) throw erros.validacao({ [parte.fieldname]: maximo === 1 ? 'arquivo repetido' : `no máximo ${maximo} arquivos` });
    lendo(esperado);
    const pedacos: Buffer[] = [];
    let total = 0;
    for await (const p of parte.file as AsyncIterable<Buffer>) {
      total += p.length;
      totalLote += p.length;
      if (total > esperado.tamanhoMaximo) throw erros.arquivoGrande(esperado.campo, esperado.tamanhoMaximo);
      if (totalLote > limites.total) throw erros.arquivoGrande('_', limites.total);
      pedacos.push(p);
    }
    if (total === 0) throw erros.validacao({ [esperado.campo]: 'arquivo vazio' });
    arquivos[esperado.campo] = [...ja, new ArquivoRecebido(esperado.campo, parte.filename, parte.mimetype, Buffer.concat(pedacos))];
  }
}
