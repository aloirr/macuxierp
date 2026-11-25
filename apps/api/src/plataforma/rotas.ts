/**
 * Rotas do portal `/config` na API (ADR 0012 §2): `/v1/plataforma/auth/*` (da apps/api) e as rotas dos plugins de
 * plataforma (`definirPluginPlataforma`, hoje só o do core), FORA do `/v1/<modulo>` e do `ContextoRota` do tenant.
 * - Sessão só pelo cookie `COOKIE_CONFIG` (Path=/v1/plataforma); o JWT do tenant nunca vale em `/v1/plataforma`, e o
 *   cookie de plataforma nunca vale em `/v1/<modulo>` nem em `/v1/auth/*` (cada prefixo lê só a própria credencial).
 * - Anti-CSRF: toda escrita (inclusive o login) exige `CABECALHO_CSRF_CONFIG: 1`, além do SameSite=Strict.
 * - Ordem: anti-CSRF (403) → sessão (401) → troca de senha pendente (403 `TROCAR_SENHA`) → `executarPlataforma` (papel
 *   de plataforma só na transação) → função SECURITY DEFINER da 0033, que revalida a sessão. Sem perfil e sem licença.
 * - Idempotency-Key pelas funções `idem_plataforma_reservar`/`concluir` (tenant de referência). Resposta `no-store`
 *   (senha provisória) conclui a chave sem corpo (SQL NULL) e o reenvio é 409: a senha nunca sai duas vezes.
 * - SQLSTATE → HTTP com mensagem fixa (`erroDaPlataforma`). Log com `superadmin_id`, nunca e-mail, senha, token ou nome.
 * - Deadlock (`40P01`) no `comPlataforma`: a transação é refeita uma vez (`comRetentativaEmDeadlock`, T-0056).
 * - Multipart (T-0058): lido depois da sessão e antes de qualquer transação, com os limites da rota (`lerMultipart`).
 * - Rota `por_etapa` (só a carga do portal; ADR 0013, adendo A1): sem transação em volta; o `executar` abre as próprias.
 * - "Esqueci a senha" (T-0076): `POST /v1/plataforma/auth/esqueci`, pública (com o anti-CSRF), com os limites por IP e
 *   por conta (empresa = `EMPRESA_PLATAFORMA`) antes do banco e SEMPRE o mesmo 202 neutro; o e-mail sai só depois da
 *   resposta (`auth/esqueci.ts`). Sem a porta de e-mail, o mesmo 202 (sem banco e sem envio). Login com a temporária = 200 com a
 *   sessão e o cookie (`responderLoginPlataforma`, o mesmo da tela única com o código MACUXI); as outras rotas dão o 403
 *   `TROCAR_SENHA` do bloqueio (`SenhaATrocarResposta`, motivo 'temporaria', `expira_em` = o fim da temporária).
 */
import {
  CABECALHO_CSRF_CONFIG,
  chaveDoPedido,
  COOKIE_CONFIG,
  EntrarPlataformaEntrada,
  ErroApi,
  erros,
  EuPlataforma,
  executarPlataforma,
  executarPlataformaPorEtapa,
  CAMINHOS_ESQUECI_SENHA,
  PedirSenhaTemporariaPlataformaEntrada,
  hashDoPedido,
  MENSAGENS_IDEMPOTENCIA,
  PREFIXO_PLATAFORMA,
  type ArquivoRecebido,
  type BancoPlataformaComLogin,
  type BancoTenantPlataforma,
  type ContextoPlataforma,
  type PluginPlataforma,
  type Relogio,
  type RespostaRota,
  type RotaPlataforma,
  type Transacao,
  transacaoComPrazo,
} from '@macuxierp/platform-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigAuth } from '../auth/servico';
import { opcoesCookieSessao } from '../auth/apoio-login';
import { envioAposResposta, erroMuitasTentativas, limitarEsqueciPorConta, limitarEsqueciPorIp, type EsqueciMontado } from '../auth/esqueci';
import { CorpoTrocaSenha, corpoTrocarSenha } from '../auth/troca-senha';
import { entradaDaChamada, responder } from '../execucao-rota';
import { lerMultipart } from '../multipart';
import { erroDaPlataforma } from './erros';
import { ipDoCliente } from './ip-cliente';
import { EMPRESA_PLATAFORMA, LimitePorChave } from './limite-ip';
import { comRetentativaEmDeadlock } from './retentativa';
import { ServicoPlataforma, type LoginPlataforma, type SessaoPlataformaLida } from './servico';

const ESCRITAS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface DependenciasPlataformaApi {
  banco: BancoPlataformaComLogin;
  /**
   * Transação de tenant das rotas `por_etapa` (T-0058): o `Banco` da API (`BancoPg` no papel `macuxierp_app`). Só a
   * apps/api injeta, e só aqui. Obrigatório se algum plugin declara rota por etapa.
   */
  bancoTenant?: BancoTenantPlataforma;
  plugins: readonly PluginPlataforma[];
  /** Padrão: `LIMITE_LOGIN_IP_PADRAO` (ADR 0012 §6). */
  limiteLogin?: LimitePorChave;
  /** `MACUXIERP_SEGREDO_BFF` (T-0050); ausente = a prova do BFF nunca vale (`ipDoCliente`). */
  segredoBff: string | null;
}

interface Contexto {
  servico: ServicoPlataforma;
  banco: BancoPlataformaComLogin;
  bancoTenant: BancoTenantPlataforma | undefined;
  relogio: Relogio;
  cronometro: () => number;
  cookieSeguro: boolean;
}

type Lido = { corpo: unknown; todosArquivos: Record<string, ArquivoRecebido[]> };

/** Sem dado do banco no erro: a tradução vale para todas as rotas do prefixo. */
export async function traduzido<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    throw erroDaPlataforma(e);
  }
}

function exigirCsrf(req: FastifyRequest): void {
  if (ESCRITAS.has(req.method) && req.headers[CABECALHO_CSRF_CONFIG] !== '1') {
    throw new ErroApi(403, 'ORIGEM_RECUSADA', `Escrita do portal sem o cabeçalho ${CABECALHO_CSRF_CONFIG}`);
  }
}

async function sessaoDoPedido(req: FastifyRequest, reply: FastifyReply, c: Contexto): Promise<SessaoPlataformaLida | null> {
  const s = await c.servico.sessaoDoToken(req.cookies[COOKIE_CONFIG]);
  if (s) req.log = reply.log = req.log.child({ superadmin_id: s.superadmin_id });
  return s;
}

/**
 * Resposta do login do superadmin (`/v1/plataforma/auth/entrar` e, pela tela única, `/v1/auth/login` com MACUXI): o
 * cookie `COOKIE_CONFIG` (Path=/v1/plataforma) e 200 `{ expira_em }` (a sessão), também com a senha temporária ou a
 * provisória (a troca pendente sai no `GET /v1/plataforma/auth/eu` e no 403 das outras rotas). `extra` entra no corpo
 * (o `destino` da tela única, `LoginResposta`).
 */
export function responderLoginPlataforma(reply: FastifyReply, r: LoginPlataforma, cookieSeguro: boolean, extra: Record<string, string> = {}) {
  return reply
    .setCookie(COOKIE_CONFIG, r.token, opcoesCookieSessao(PREFIXO_PLATAFORMA, cookieSeguro, r.expira_em))
    .header('cache-control', 'no-store')
    .send({ expira_em: r.expira_em.toISOString(), ...extra });
}

/** Monta `/v1/plataforma/*` e devolve o serviço do superadmin (a tela única do `/v1/auth/login` e do esqueci usa o mesmo). */
export function montarPlataforma(
  app: FastifyInstance,
  d: DependenciasPlataformaApi,
  o: { auth: ConfigAuth; relogio: Relogio; cookieSeguro: boolean; cronometro?: () => number; esqueci: EsqueciMontado },
): ServicoPlataforma {
  // O serviço (sair, troca de senha) loga pelo log da app; as rotas dos plugins, pelo do pedido (request_id, superadmin_id).
  const servico = new ServicoPlataforma(comRetentativaEmDeadlock(d.banco, app.log), o.auth, o.relogio);
  const c: Contexto = { servico, banco: d.banco, bancoTenant: d.bancoTenant, relogio: o.relogio, cronometro: o.cronometro ?? (() => performance.now()), cookieSeguro: o.cookieSeguro };
  const limite = d.limiteLogin ?? new LimitePorChave();
  const caminhoCookie = PREFIXO_PLATAFORMA;

  app.post(`${PREFIXO_PLATAFORMA}/auth/entrar`, async (req, reply) =>
    traduzido(async () => {
      exigirCsrf(req);
      const porIp = limite.registrar(ipDoCliente(req, d.segredoBff), o.relogio.agora().getTime());
      if (!porIp.permitido) throw erroMuitasTentativas(porIp.retry_after_s);
      const { email, senha } = EntrarPlataformaEntrada.parse(req.body);
      const r = await c.servico.entrar(email, senha);
      req.log = reply.log = req.log.child({ superadmin_id: r.superadmin_id });
      return responderLoginPlataforma(reply, r, c.cookieSeguro);
    }),
  );

  montarEsqueciPlataforma(app, d, o.esqueci, servico, o.relogio);

  app.post(`${PREFIXO_PLATAFORMA}/auth/sair`, async (req, reply) =>
    traduzido(async () => {
      exigirCsrf(req);
      const s = await sessaoDoPedido(req, reply, c);
      if (s) await c.servico.sair(s);
      return reply.clearCookie(COOKIE_CONFIG, { path: caminhoCookie }).status(204).send();
    }),
  );

  app.get(`${PREFIXO_PLATAFORMA}/auth/eu`, async (req, reply) =>
    traduzido(async () => {
      const s = await sessaoDoPedido(req, reply, c);
      if (!s) throw erros.naoAutenticado();
      const eu: EuPlataforma = {
        superadmin: { id: s.superadmin_id, nome: s.nome },
        deve_trocar_senha: s.deve_trocar_senha,
        ...(s.motivo_troca ? { motivo_troca: s.motivo_troca } : {}),
        sessao_expira_em: s.expira_em.toISOString(),
      };
      return reply.header('cache-control', 'no-store').send(EuPlataforma.parse(eu));
    }),
  );

  app.post(`${PREFIXO_PLATAFORMA}/auth/senha`, async (req, reply) =>
    traduzido(async () => {
      exigirCsrf(req);
      const s = await sessaoDoPedido(req, reply, c);
      if (!s) throw erros.naoAutenticado();
      // Mesmo corpo e mesmos 400 da troca do tenant (erroSenhaNova); senha atual dispensada no motivo 'temporaria'.
      const { senha_atual, senha_nova } = CorpoTrocaSenha.parse(req.body);
      await c.servico.trocarSenha(s, senha_atual, senha_nova);
      return reply.status(204).send();
    }),
  );

  const vistas = new Set<string>();
  for (const plugin of d.plugins) {
    for (const rota of plugin.rotas) {
      const id = `${rota.metodo} ${rota.caminho}`;
      if (vistas.has(id)) throw new Error(`plataforma: rota ${id} montada por dois plugins`);
      if (rota.transacoes === 'por_etapa' && !d.bancoTenant) throw new Error(`plataforma: rota por etapa ${id} sem o bancoTenant na API`);
      vistas.add(id);
      app.route({ method: rota.metodo, url: `${PREFIXO_PLATAFORMA}${rota.caminho}`, handler: (req, reply) => traduzido(() => executarRotaPlataforma(req, reply, rota, c)) });
    }
  }
  return servico;
}

// `POST /v1/plataforma/auth/esqueci` (T-0076), com o anti-CSRF antes de tudo. Ordem e regras: auth/esqueci.ts.
function montarEsqueciPlataforma(app: FastifyInstance, d: DependenciasPlataformaApi, e: EsqueciMontado, servico: ServicoPlataforma, relogio: Relogio): void {
  const apos = envioAposResposta(e.envio);
  app.post(CAMINHOS_ESQUECI_SENHA.plataforma, apos.opcoes, async (req, reply) =>
    traduzido(async () => {
      exigirCsrf(req);
      const agoraMs = relogio.agora().getTime();
      limitarEsqueciPorIp(e.limites, ipDoCliente(req, d.segredoBff), agoraMs);
      const { email } = PedirSenhaTemporariaPlataformaEntrada.parse(req.body);
      limitarEsqueciPorConta(e.limites, EMPRESA_PLATAFORMA, email, agoraMs);
      return apos.responder(req, reply, e.envio ? await servico.esqueci(email, req.log) : await servico.esqueciSemEnvio(req.log));
    }),
  );
}

async function executarRotaPlataforma(req: FastifyRequest, reply: FastifyReply, rota: RotaPlataforma, c: Contexto) {
  req.log = reply.log = req.log.child({ modulo: 'plataforma' });
  const inicio = c.cronometro();
  exigirCsrf(req);
  const lida = await sessaoDoPedido(req, reply, c);
  if (lida?.deve_trocar_senha) return reply.status(403).send(corpoTrocarSenha(lida));
  const sessao = lida && { superadmin_id: lida.superadmin_id, sessao_id: lida.sessao_id };
  // O multipart só é lido com sessão (não aceita bytes de quem não entrou) e antes de qualquer transação (não segura
  // conexão enquanto o arquivo sobe), como no BKO.
  if (rota.multipart && !sessao) throw erros.naoAutenticado();
  const lido: Lido = rota.multipart ? await lerMultipart(req, rota.multipart) : { corpo: req.body, todosArquivos: {} };
  const agora = c.relogio.agora();
  if (rota.transacoes === 'por_etapa') return executarPorEtapa(req, reply, rota, c, { sessao, lido, agora, inicio });
  const resultado = await executarPlataforma({
    sessao,
    banco: comRetentativaEmDeadlock(c.banco, req.log),
    executar: async (tx, sessao) => {
      const ctx: ContextoPlataforma = {
        sessao,
        tx,
        request_id: req.id,
        agora,
        // A 0033 grava a auditoria do portal dentro de cada função (autor = superadmin_id); o papel de plataforma não
        // tem INSERT em plataforma.auditoria. Rota que precisar auditar à parte pede função nova na lista fechada (ADR).
        auditar: () => Promise.reject(new Error('plataforma: a auditoria do portal é gravada pelas funções da 0033')),
      };
      const e = entradaDaChamada(req, rota, lido);
      const chave = rota.idempotencia ? chaveDoPedido(e.cabecalhos, rota.idempotencia) : null;
      if (!chave) return { resposta: await rota.executar(ctx, e), repetida: false };
      return executarIdempotentePlataforma(tx, { chave, rota: `${rota.metodo} ${PREFIXO_PLATAFORMA}${rota.caminho}`, hash_corpo: hashDoPedido(e) }, () => rota.executar(ctx, e));
    },
  });
  return responder(reply, resultado.resposta, resultado.repetida);
}

/**
 * Rota por etapa (carga do portal, T-0058): sem transação em volta e sem Idempotency-Key. O prazo (`tempoMaximoMs`)
 * conta desde o pedido, como no BKO: estourado na leitura do arquivo é 503 antes de qualquer transação; depois, vale
 * para a transação de tenant.
 */
async function executarPorEtapa(
  req: FastifyRequest,
  reply: FastifyReply,
  rota: RotaPlataforma,
  c: Contexto,
  p: { sessao: { superadmin_id: string; sessao_id: string } | null; lido: Lido; agora: Date; inicio: number },
) {
  const limite = rota.tempoMaximoMs;
  if (p.sessao && limite !== undefined && c.cronometro() - p.inicio > limite) throw erros.tempoEsgotado(Math.round(limite / 1000));
  const e = entradaDaChamada(req, rota, p.lido);
  const resposta = await executarPlataformaPorEtapa({
    sessao: p.sessao,
    banco: comRetentativaEmDeadlock(c.banco, req.log),
    // Montagem garante o bancoTenant quando há rota por etapa.
    bancoTenant: c.bancoTenant!,
    tenantDaRota: e.params.id ?? '',
    request_id: req.id,
    agora: p.agora,
    ...(limite === undefined
      ? {}
      : { prazoTenant: (tx: Transacao) => transacaoComPrazo(tx, { restanteMs: limite - (c.cronometro() - p.inicio), limiteRotaMs: limite }, c.cronometro) }),
    executar: (ctx) => rota.executar(ctx, e),
  });
  return responder(reply, resposta, false);
}

const semGuarda = (r: RespostaRota) => /no-store/i.test(r.cabecalhos?.['cache-control'] ?? '');

/**
 * Idempotency-Key do portal pelas funções da 0033 (na mesma transação da rota: se a rota falha, a reserva some junto).
 * Concluída com corpo = repete; concluída sem corpo (SQL NULL, resposta `no-store`) = 409; outro corpo ou em andamento = 409.
 */
async function executarIdempotentePlataforma(
  tx: Transacao,
  p: { chave: string; rota: string; hash_corpo: string },
  executar: () => Promise<RespostaRota>,
): Promise<{ resposta: RespostaRota; repetida: boolean }> {
  const [r] = await tx.consultar<{ situacao: string; status: number | null; resposta: unknown; sem_corpo: boolean }>(
    'SELECT situacao, status, resposta, resposta IS NULL AS sem_corpo FROM plataforma.idem_plataforma_reservar($1, $2, $3)',
    [p.chave, p.rota, p.hash_corpo],
  );
  switch (r?.situacao) {
    case 'nova':
      break;
    case 'concluida':
      if (r.sem_corpo || r.status === null) throw erros.conflito('Pedido já atendido com esta Idempotency-Key: a resposta não se repete');
      return { resposta: { status: r.status, corpo: r.resposta }, repetida: true };
    case 'conflito':
      throw erros.conflito(MENSAGENS_IDEMPOTENCIA.outroPedido);
    default:
      throw erros.conflito(MENSAGENS_IDEMPOTENCIA.emAndamento);
  }
  const resposta = await executar();
  // Corpo JSON (jsonb; `undefined` vira o JSON null, que repete); resposta no-store fica SQL NULL (nunca guarda senha).
  const corpo = semGuarda(resposta) ? null : JSON.stringify(resposta.corpo ?? null);
  await tx.consultar('SELECT plataforma.idem_plataforma_concluir($1, $2, $3, $4::jsonb)', [p.chave, p.rota, resposta.status ?? 200, corpo]);
  return { resposta, repetida: false };
}
