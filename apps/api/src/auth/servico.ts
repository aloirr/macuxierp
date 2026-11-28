/**
 * Login, refresh rotativo e saída (desenho T-0002, seção 2, "Plataforma"):
 * - login por e-mail e senha (ADR 0021: e-mail único no sistema, sem o código da empresa; a conta sai da
 *   `conta_por_email`); argon2id; bloqueio sem prazo após 5 falhas (só a temporária ou o --destravar liberam);
 * - JWT de acesso de 15 min + refresh rotativo (cookie httpOnly, posto pela rota);
 * - refresh reutilizado (já revogado) revoga a família inteira;
 * - troca da própria senha (T-0052, RN-CORE-10): a senha provisória (`deve_trocar_senha`) vai no JWT de acesso e o
 *   `trocarSenha` a zera, revogando as outras sessões do usuário (a família do refresh corrente continua).
 * - senha temporária do "Esqueci a senha" (T-0076) em paralelo à atual: a atual bate = login normal; senão, a temporária
 *   vigente bate = consumo atômico de uso único (zera as duas colunas) e, só se ele devolver true, sessão com a troca
 *   obrigatória de motivo 'temporaria' (o login responde 200 com a sessão; as outras rotas, o 403 `TROCAR_SENHA` do
 *   bloqueio, `SenhaATrocarResposta`); temporária errada ou vencida conta em `falhas_login` como a senha errada; corrida
 *   perdida = a mesma falha neutra. Com a conta travada (hotfix "esqueci a senha desbloqueia"), só a temporária é
 *   conferida: vigente = o mesmo consumo, que também zera `falhas_login` e `bloqueado_ate`, e a mesma sessão; errada,
 *   vencida ou ausente = o 429 da trava de sempre, sem somar falha nem estender a trava; a senha atual segue barrada. O motivo e o fim da temporária vão no JWT (`mtv`, `tex`) e no refresh
 *   (`marcaTemporaria`, coberta pelo hash gravado no banco: adulterar = refresh inexistente) e somem com a troca, que o
 *   dispensa de informar a senha atual. A troca zera as duas colunas da temporária no mesmo UPDATE. Estas regras valem
 *   também para o superadmin (`plataforma/servico.ts`).
 * - pedido (`esqueci`): ordem e regras em `auth/esqueci.ts`.
 * Mensagem de falha única (`MENSAGEM_LOGIN_INVALIDO` do SDK), sem dizer qual campo errou. Empresa suspensa: 403
 * `EMPRESA_SUSPENSA` só depois de a senha conferir, sem sessão (ADR 0021 §3). E-mail só de superadmin: o login devolve
 * `DESVIO_SUPERADMIN` e a rota segue pelo `ServicoPlataforma` (§5 e §7, opção A: o usuário de empresa vem primeiro).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ErroApi,
  erroSenhaForaDaRegra,
  erros,
  MENSAGEM_SENHA_ATUAL_INCORRETA,
  MENSAGEM_SENHA_IGUAL,
  PADRAO_UUID,
  sha256Hex,
  type Banco,
  type Relogio,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { avaliarPedidoSenhaEsquecida, type RepositorioCore } from '@macuxierp/core/api';
import { ConferenciaCustoIgual, travaAposFalha, type Recusa } from './apoio-login';
import { registrarSemEnvio, type LogEsqueci } from './esqueci-log';
import { emitirTokenAcesso, type SessaoAcesso } from './jwt';
import type { RepositorioAuth, SessaoRefresh, UsuarioAuth } from './portas';
import { ARGON2_PADRAO, conferirSenha, gerarHashSenha, type ParametrosArgon2 } from './senha';
import type { MensagemEmail } from '../email/porta';
import { chaveEmail, TravaContaMemoria } from '../plataforma/limite-ip';
import { custoTemporariaDescartada, emitirTemporaria, lerMarcaTemporaria, marcaTemporaria, mensagemSenhaTemporaria } from './senha-temporaria';
import type { TrocaPendente } from './troca-senha';

export interface ConfigAuth {
  jwtSegredo: string;
  acessoSegundos: number;
  refreshDias: number;
  maxFalhas: number;
  argon2: ParametrosArgon2;
}

export const CONFIG_AUTH_PADRAO: Omit<ConfigAuth, 'jwtSegredo'> = {
  acessoSegundos: 15 * 60,
  refreshDias: 30,
  maxFalhas: 5,
  argon2: ARGON2_PADRAO,
};

export interface ResultadoLogin {
  token_acesso: string;
  expira_em: Date;
  refresh: string;
  refresh_expira_em: Date;
  /** Tenant da sessão aberta (só para o log da rota; não vai no corpo). */
  tenant_id: string;
  /** `LoginResposta.desbloqueou` do SDK (RN-CORE-15). */
  desbloqueou?: true;
}

/**
 * O e-mail é só de superadmin (ADR 0021 §5 e §7): o `ServicoAuth` não confere nada e a rota segue pelo
 * `ServicoPlataforma` (cookie do `/config`), que paga o argon2 e a trava dele.
 */
export const DESVIO_SUPERADMIN = 'superadmin' as const;
export type DesvioSuperadmin = typeof DESVIO_SUPERADMIN;

/** Saída de dentro da transação do login, devolvida (não lançada) para a falha gravada não ser desfeita. */
type SaidaLogin = Recusa | ResultadoLogin | { suspensa: true; conferencias: number } | null;

/** 400 `VALIDACAO` da senha atual errada na troca (tenant e superadmin): `campos.senha_atual` com o texto da marca. */
export const erroSenhaAtualIncorreta = (): ErroApi => erros.validacao({ senha_atual: MENSAGEM_SENHA_ATUAL_INCORRETA });

/** 400 `VALIDACAO` da senha nova igual à atual na troca (tenant e superadmin): `campos.senha_nova`. */
export const erroSenhaIgual = (): ErroApi => erros.validacao({ senha_nova: MENSAGEM_SENHA_IGUAL });

/**
 * Senha atual da troca (tenant e superadmin), fora da sessão de motivo 'temporaria': ausente ou errada = 400 em
 * `senha_atual` (não conta como falha de login); igual à nova = 400 em `senha_nova`.
 */
export async function exigirSenhaAtual(senhaAtual: string | undefined, senhaNova: string, hashAtual: string): Promise<void> {
  if (!senhaAtual || !(await conferirSenha(senhaAtual, hashAtual))) throw erroSenhaAtualIncorreta();
  if (senhaNova === senhaAtual) throw erroSenhaIgual();
}

/**
 * 400 `VALIDACAO` da senha nova fora da regra única (`erroSenhaForaDaRegra` do SDK): `campos.senha_nova` com os textos das
 * regras descumpridas e `detalhes.regras` com os ids (`RegraSenhaId[]`). `null` quando a senha cumpre todas.
 */
export function erroSenhaNova(senha: string): ErroApi | null {
  const e = erroSenhaForaDaRegra(senha);
  return e && new ErroApi(400, 'VALIDACAO', e.mensagem, { [e.campo]: e.texto }, { regras: e.detalhes });
}

const hashRefresh = sha256Hex;

/** O refresh carrega o tenant (`<tenant_id>.<aleatório>`) para a busca rodar dentro da RLS dele. */
function tenantDoRefresh(refresh: string): string | null {
  // `<tenant>.<aleatório>` ou `<tenant>.<aleatório>.t<segundos>` (motivo 'temporaria'); o hash cobre o texto todo.
  const [tenant, aleatorio] = refresh.split('.');
  return tenant && aleatorio && PADRAO_UUID.test(tenant) && aleatorio.length >= 40 ? tenant : null;
}

export class ServicoAuth {
  private readonly custoIgual: ConferenciaCustoIgual;
  private readonly travaConta: TravaContaMemoria;

  constructor(
    private readonly banco: Banco,
    private readonly repo: RepositorioAuth,
    private readonly cfg: ConfigAuth,
    private readonly relogio: Relogio,
  ) {
    this.custoIgual = new ConferenciaCustoIgual(cfg.argon2);
    this.travaConta = new TravaContaMemoria(cfg);
  }

  /**
   * Login pela tela única (ADR 0021; RN-CORE-15, T-0111; decisão R-20261126-175321): a conta sai da `conta_por_email`
   * (sem tenant na transação) e a decisão é a `decidirEntrada` (apoio-login.ts), a mesma do superadmin.
   * - sem conta (e-mail inexistente, empresa encerrada, usuário inativo): a trava em memória por e-mail (`chaveEmail`) e o
   *   mesmo custo de argon2 da conta que existe; 401 `MENSAGEM_LOGIN_INVALIDO`;
   * - empresa suspensa: a senha é conferida primeiro; certa = 403 `EMPRESA_SUSPENSA` sem sessão (nem consumo da
   *   temporária, nem `ultimo_acesso_em`); errada = a falha de sempre (401, conta na trava);
   * - só superadmin com o e-mail: `DESVIO_SUPERADMIN`, sem argon2 aqui (a rota chama o `ServicoPlataforma`).
   * O `operador.sh --destravar` (banco) vale na hora.
   */
  async entrar(entrada: { email: string; senha: string }, limite?: () => ErroApi): Promise<ResultadoLogin | DesvioSuperadmin> {
    const agora = this.relogio.agora();
    const email = entrada.email.trim().toLowerCase();
    const falha = () => erros.loginInvalido();
    const semConta = () => this.custoIgual.recusarSemConta(entrada.senha, this.travaConta, chaveEmail(email), falha, limite);
    const conta = await this.banco.semTenant((tx) => this.repo.contaPorEmail(tx, email));
    if (conta?.tipo === 'superadmin') return DESVIO_SUPERADMIN;
    if (!conta) return semConta();
    const { tenant_id: tenantId, suspensa } = conta;
    // A recusa é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.comTenant(tenantId, async (tx): Promise<SaidaLogin> => {
      const usuario = await this.repo.usuarioPorEmail(tx, email);
      if (!usuario || !usuario.ativo) return null;
      const { resultado, fimTemporaria, conferencias } = await this.custoIgual.decidirEntrada(entrada.senha, usuario, agora, limite !== undefined);
      if (resultado === 'bloqueada') return { recusa: 'bloqueada', conferencias };
      if (resultado === 'falha') {
        // IP no limite: só a temporária foi conferida; a recusa é o 429, sem somar falha na conta
        if (limite) return { recusa: 'falha', conferencias };
        await this.registrarFalha(tx, usuario, agora);
        return { recusa: 'falha', conferencias };
      }
      // ADR 0021 §3: a senha (ou a temporária) conferiu; com a empresa suspensa, nada muda na conta e não há sessão.
      if (suspensa) return { suspensa: true, conferencias };
      if (fimTemporaria) {
        // Uso único (zera falhas_login e bloqueado_ate): só abre a sessão se o consumo atômico devolveu true.
        if (!(await this.repo.consumirTemporaria(tx, usuario.id))) return { recusa: 'falha', conferencias };
        await this.repo.registrarAcesso(tx, usuario.id, agora);
        const s = await this.abrirSessao(tx, { ...usuario, deve_trocar_senha: true }, randomUUID(), agora, { motivo_troca: 'temporaria', temporaria_expira_em: fimTemporaria });
        return resultado === 'entra_desbloqueando' ? { ...s, desbloqueou: true } : s;
      }
      await this.repo.registrarAcesso(tx, usuario.id, agora);
      return this.abrirSessao(tx, usuario, randomUUID(), agora);
    });
    if (r === null) return semConta();
    if ('suspensa' in r) return this.custoIgual.recusar(entrada.senha, r.conferencias, erros.empresaSuspensa);
    if ('recusa' in r) return this.custoIgual.recusarConta(entrada.senha, r, falha, limite);
    return r;
  }

  /**
   * Pedido de senha temporária pela tela de login (T-0076; ADR 0021 §4): a conta sai da `conta_por_email`, sem empresa.
   * Só superadmin com o e-mail = `DESVIO_SUPERADMIN` (a rota chama o `ServicoPlataforma.esqueci`, que paga o argon2 dele).
   * Senão o argon2 da temporária roda sempre, exista ou não a conta. Quem decide se grava é o
   * `avaliarPedidoSenhaEsquecida` do core (RN-CORE-13; empresa suspensa não recebe) e quem grava é o
   * `emitirSenhaTemporaria` do `RepositorioCore`, na transação do tenant. Devolve a mensagem de e-mail (só se gravou),
   * sem o código da empresa, para a rota agendar depois da resposta; `aoGravar` roda na mesma transação (a auditoria).
   */
  async esqueci(
    entrada: { email: string },
    repoCore: Pick<RepositorioCore, 'emitirSenhaTemporaria'>,
    aoGravar: (tx: Transacao, conta: { tenant_id: string; usuario_id: string }) => Promise<void>,
    log?: LogEsqueci,
  ): Promise<MensagemEmail | null | DesvioSuperadmin> {
    const email = entrada.email.trim().toLowerCase();
    const conta = await this.banco.semTenant((tx) => this.repo.contaPorEmail(tx, email));
    if (conta?.tipo === 'superadmin') return DESVIO_SUPERADMIN;
    const temporaria = await emitirTemporaria(this.cfg.argon2, this.relogio.agora());
    if (!conta) {
      registrarSemEnvio(log, 'conta_inexistente_ou_inativa');
      return null;
    }
    const tenantId = conta.tenant_id;
    const r = await this.banco.comTenant(tenantId, async (tx) => {
      const usuario = await this.repo.usuarioPorEmail(tx, email);
      // `usuarioPorEmail` já exclui `deleted_at`; a empresa encerrada não tem conta e a suspensa o core recusa.
      const avaliacao = avaliarPedidoSenhaEsquecida(usuario && { ativo: usuario.ativo, excluido: false }, { situacao: conta.suspensa ? 'suspenso' : 'ativo' });
      if (!avaliacao.enviar) return avaliacao.motivo;
      if (!usuario) return 'usuario_inexistente';
      await repoCore.emitirSenhaTemporaria(tx, usuario.id, temporaria.hash, temporaria.expira_em);
      await aoGravar(tx, { tenant_id: tenantId, usuario_id: usuario.id });
      return 'gravou' as const;
    });
    if (r === 'gravou') return mensagemSenhaTemporaria(email, temporaria.senha);
    registrarSemEnvio(log, r === 'empresa_inativa' ? 'empresa_inexistente_ou_suspensa' : 'conta_inexistente_ou_inativa');
    return null;
  }

  /** Pedido com o e-mail desligado (T-0076): o mesmo custo de argon2 do `esqueci`, sem banco, sem temporária e sem envio. */
  esqueciSemEnvio(log?: LogEsqueci): Promise<null> {
    registrarSemEnvio(log, 'email_desligado');
    return custoTemporariaDescartada(this.cfg.argon2);
  }

  async renovar(refresh: string | undefined): Promise<ResultadoLogin> {
    const tenantId = refresh ? tenantDoRefresh(refresh) : null;
    if (!refresh || !tenantId) throw erros.naoAutenticado();
    const agora = this.relogio.agora();
    const resultado = await this.banco.comTenant(tenantId, async (tx) => {
      const atual = await this.repo.sessaoPorHash(tx, hashRefresh(refresh));
      if (!atual) return null;
      if (atual.revogada_em) {
        // Reuso: alguém tem uma cópia do refresh. Derruba a família inteira (o dono legítimo entra de novo).
        await this.repo.revogarFamilia(tx, atual.familia, agora);
        return 'reuso' as const;
      }
      if (atual.expira_em.getTime() <= agora.getTime()) return null;
      const usuario = await this.repo.usuarioPorId(tx, atual.usuario_id);
      if (!usuario || !usuario.ativo) {
        await this.repo.revogarFamilia(tx, atual.familia, agora);
        return null;
      }
      await this.repo.revogarSessao(tx, atual.id, agora);
      // O motivo 'temporaria' segue enquanto a troca obrigatória estiver pendente.
      return this.abrirSessao(tx, usuario, atual.familia, agora, usuario.deve_trocar_senha ? lerMarcaTemporaria(refresh.split('.')[2]) : {});
    });
    if (!resultado || resultado === 'reuso') throw erros.naoAutenticado();
    return resultado;
  }

  /** Revoga a família do refresh (idempotente: sem cookie ou já revogado não é erro). */
  async sair(refresh: string | undefined): Promise<void> {
    const tenantId = refresh ? tenantDoRefresh(refresh) : null;
    if (!refresh || !tenantId) return;
    const agora = this.relogio.agora();
    await this.banco.comTenant(tenantId, async (tx) => {
      const atual = await this.repo.sessaoPorHash(tx, hashRefresh(refresh));
      if (atual) await this.repo.revogarFamilia(tx, atual.familia, agora);
    });
  }

  /**
   * Troca da própria senha (`POST /v1/auth/senha`, T-0052). Ordem: regra da senha nova (400 com `detalhes`, sem tocar
   * o banco) → senha atual (400 em `senha_atual`; NÃO conta como falha de login; dispensada na sessão de motivo
   * 'temporaria' com a troca pendente, T-0076) → nova igual à atual (400 em `senha_nova`) → grava o hash, zera `deve_trocar_senha`, revoga as outras sessões (a família do `refresh` corrente,
   * se for deste usuário, continua) e chama `aoTrocar` na mesma transação (a auditoria). Devolve quantas sessões caíram.
   */
  async trocarSenha(
    sessao: SessaoAcesso,
    refresh: string | undefined,
    entrada: { senha_atual?: string | undefined; senha_nova: string },
    aoTrocar: (tx: Transacao, sessoesRevogadas: number) => Promise<void>,
  ): Promise<number> {
    const foraDaRegra = erroSenhaNova(entrada.senha_nova);
    if (foraDaRegra) throw foraDaRegra;
    const agora = this.relogio.agora();
    return this.banco.comTenant(sessao.tenant_id, async (tx) => {
      const usuario = await this.repo.usuarioPorId(tx, sessao.usuario_id);
      if (!usuario || !usuario.ativo) throw erros.naoAutenticado();
      if (!(sessao.motivo_troca === 'temporaria' && usuario.deve_trocar_senha)) await exigirSenhaAtual(entrada.senha_atual, entrada.senha_nova, usuario.senha_hash);
      await this.repo.trocarSenha(tx, usuario.id, await gerarHashSenha(entrada.senha_nova, this.cfg.argon2));
      const corrente = refresh && tenantDoRefresh(refresh) === sessao.tenant_id ? await this.repo.sessaoPorHash(tx, hashRefresh(refresh)) : null;
      const familia = corrente && corrente.usuario_id === usuario.id && !corrente.revogada_em ? corrente.familia : null;
      const revogadas = await this.repo.revogarOutrasSessoes(tx, usuario.id, familia, agora);
      await aoTrocar(tx, revogadas);
      return revogadas;
    });
  }

  private async abrirSessao(tx: Transacao, u: UsuarioAuth, familia: string, agora: Date, troca: TrocaPendente = {}): Promise<ResultadoLogin> {
    const sessao: SessaoAcesso = {
      usuario_id: u.id,
      tenant_id: u.tenant_id,
      perfil: u.perfil,
      filial_ids: u.filial_ids,
      ...(u.deve_trocar_senha ? { deve_trocar_senha: true as const, ...troca } : {}),
    };
    const marca = marcaTemporaria(sessao);
    const refresh = `${u.tenant_id}.${randomBytes(32).toString('base64url')}${marca ? `.${marca}` : ''}`;
    const linha: SessaoRefresh = {
      id: randomUUID(),
      tenant_id: u.tenant_id,
      usuario_id: u.id,
      familia,
      refresh_hash: hashRefresh(refresh),
      expira_em: new Date(agora.getTime() + this.cfg.refreshDias * 86_400_000),
      revogada_em: null,
    };
    await this.repo.criarSessao(tx, linha);
    const acesso = emitirTokenAcesso(sessao, this.cfg.jwtSegredo, agora, this.cfg.acessoSegundos);
    return { token_acesso: acesso.token, expira_em: acesso.expira_em, refresh, refresh_expira_em: linha.expira_em, tenant_id: u.tenant_id };
  }

  private async registrarFalha(tx: Transacao, u: UsuarioAuth, agora: Date): Promise<void> {
    // bloqueio antigo (de antes do hotfix, com prazo) já vencido: a contagem recomeça
    const travaVencida = u.bloqueado_ate !== null && u.bloqueado_ate.getTime() <= agora.getTime();
    const falhas = (travaVencida ? 0 : u.falhas_login) + 1;
    const trava = travaAposFalha(falhas, this.cfg);
    await this.repo.registrarFalha(tx, u.id, trava ? 0 : falhas, trava);
  }

}
