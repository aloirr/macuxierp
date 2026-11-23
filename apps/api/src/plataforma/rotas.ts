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
  hashDoPedido,
  MENSAGENS_IDEMPOTENCIA,
  PREFIXO_PLATAFORMA,
  TrocarSenhaPlataformaEntrada,
  type BancoPlataformaComLogin,
  type ContextoPlataforma,
  type PluginPlataforma,
  type Relogio,
  type RespostaRota,
  type RotaPlataforma,
  type Transacao,
} from '@macuxierp/platform-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConfigAuth } from '../auth/servico';
import { opcoesCookieSessao } from '../auth/apoio-login';
import { entradaDaChamada, responder } from '../execucao-rota';
import { erroDaPlataforma } from './erros';
import { ipDoCliente } from './ip-cliente';
import { LimitePorIp } from './limite-ip';
import { ServicoPlataforma, type SessaoPlataformaLida } from './servico';

const ESCRITAS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface DependenciasPlataformaApi {
  banco: BancoPlataformaComLogin;
  plugins: readonly PluginPlataforma[];
  /** Padrão: `LIMITE_LOGIN_IP_PADRAO` (ADR 0012 §6). */
  limiteLogin?: LimitePorIp;
  /** `MACUXIERP_SEGREDO_BFF` (T-0050); ausente = a prova do BFF nunca vale (`ipDoCliente`). */
  segredoBff: string | null;
}

interface Contexto {
  servico: ServicoPlataforma;
  banco: BancoPlataformaComLogin;
  relogio: Relogio;
  cookieSeguro: boolean;
}

/** Sem dado do banco no erro: a tradução vale para todas as rotas do prefixo. */
async function traduzido<R>(fn: () => Promise<R>): Promise<R> {
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

export function montarPlataforma(app: FastifyInstance, d: DependenciasPlataformaApi, o: { auth: ConfigAuth; relogio: Relogio; cookieSeguro: boolean }): void {
  const c: Contexto = { servico: new ServicoPlataforma(d.banco, o.auth, o.relogio), banco: d.banco, relogio: o.relogio, cookieSeguro: o.cookieSeguro };
  const limite = d.limiteLogin ?? new LimitePorIp();
  const caminhoCookie = PREFIXO_PLATAFORMA;

  app.post(`${PREFIXO_PLATAFORMA}/auth/entrar`, async (req, reply) =>
    traduzido(async () => {
      exigirCsrf(req);
      if (!limite.contar(ipDoCliente(req, d.segredoBff), o.relogio.agora().getTime())) throw erros.muitasTentativas('Muitas tentativas de acesso: tente de novo em alguns minutos');
      const { email, senha } = EntrarPlataformaEntrada.parse(req.body);
      const r = await c.servico.entrar(email, senha);
      req.log = reply.log = req.log.child({ superadmin_id: r.superadmin_id });
      return reply
        .setCookie(COOKIE_CONFIG, r.token, opcoesCookieSessao(caminhoCookie, c.cookieSeguro, r.expira_em))
        .header('cache-control', 'no-store')
        .send({ expira_em: r.expira_em.toISOString() });
    }),
  );

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
      const eu: EuPlataforma = { superadmin: { id: s.superadmin_id, nome: s.nome }, deve_trocar_senha: s.deve_trocar_senha, sessao_expira_em: s.expira_em.toISOString() };
      return reply.header('cache-control', 'no-store').send(EuPlataforma.parse(eu));
    }),
  );

  app.post(`${PREFIXO_PLATAFORMA}/auth/senha`, async (req, reply) =>
    traduzido(async () => {
      exigirCsrf(req);
      const s = await sessaoDoPedido(req, reply, c);
      if (!s) throw erros.naoAutenticado();
      const { senha_atual, senha_nova } = TrocarSenhaPlataformaEntrada.parse(req.body);
      await c.servico.trocarSenha(s, senha_atual, senha_nova);
      return reply.status(204).send();
    }),
  );

  const vistas = new Set<string>();
  for (const plugin of d.plugins) {
    for (const rota of plugin.rotas) {
      const id = `${rota.metodo} ${rota.caminho}`;
      if (vistas.has(id)) throw new Error(`plataforma: rota ${id} montada por dois plugins`);
      vistas.add(id);
      app.route({ method: rota.metodo, url: `${PREFIXO_PLATAFORMA}${rota.caminho}`, handler: (req, reply) => traduzido(() => executarRotaPlataforma(req, reply, rota, c)) });
    }
  }
}

async function executarRotaPlataforma(req: FastifyRequest, reply: FastifyReply, rota: RotaPlataforma, c: Contexto) {
  req.log = reply.log = req.log.child({ modulo: 'plataforma' });
  exigirCsrf(req);
  const lida = await sessaoDoPedido(req, reply, c);
  if (lida?.deve_trocar_senha) throw new ErroApi(403, 'TROCAR_SENHA', 'Troque a senha provisória antes de continuar');
  const agora = c.relogio.agora();
  const resultado = await executarPlataforma({
    sessao: lida && { superadmin_id: lida.superadmin_id, sessao_id: lida.sessao_id },
    banco: c.banco,
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
      const e = entradaDaChamada(req, rota);
      const chave = rota.idempotencia ? chaveDoPedido(e.cabecalhos, rota.idempotencia) : null;
      if (!chave) return { resposta: await rota.executar(ctx, e), repetida: false };
      return executarIdempotentePlataforma(tx, { chave, rota: `${rota.metodo} ${PREFIXO_PLATAFORMA}${rota.caminho}`, hash_corpo: hashDoPedido(e) }, () => rota.executar(ctx, e));
    },
  });
  return responder(reply, resultado.resposta, resultado.repetida);
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
