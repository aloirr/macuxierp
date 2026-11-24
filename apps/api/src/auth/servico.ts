/**
 * Login, refresh rotativo e saída (desenho T-0002, seção 2, "Plataforma"):
 * - login por empresa (slug), e-mail e senha (D2); argon2id; trava após 5 falhas por 15 min;
 * - JWT de acesso de 15 min + refresh rotativo (cookie httpOnly, posto pela rota);
 * - refresh reutilizado (já revogado) revoga a família inteira;
 * - troca da própria senha (T-0052, RN-CORE-10): a senha provisória (`deve_trocar_senha`) vai no JWT de acesso e o
 *   `trocarSenha` a zera, revogando as outras sessões do usuário (a família do refresh corrente continua).
 * - senha temporária do "Esqueci a senha" (T-0076) em paralelo à atual: a atual bate = login normal; senão, a temporária
 *   vigente bate = consumo atômico de uso único (zera as duas colunas) e, só se ele devolver true, sessão com a troca
 *   obrigatória de motivo 'temporaria' (o login responde 200 com a sessão; as outras rotas, o 403 `TROCAR_SENHA` do
 *   bloqueio, `SenhaATrocarResposta`); temporária errada ou vencida conta em `falhas_login` como a senha errada; corrida
 *   perdida = a mesma falha neutra. O motivo e o fim da temporária vão no JWT (`mtv`, `tex`) e no refresh
 *   (`marcaTemporaria`, coberta pelo hash gravado no banco: adulterar = refresh inexistente) e somem com a troca, que o
 *   dispensa de informar a senha atual. A troca zera as duas colunas da temporária no mesmo UPDATE. Estas regras valem
 *   também para o superadmin (`plataforma/servico.ts`).
 * - login certo com a senha atual e temporária pendente (T-0083, RN-CORE-13): cancela a temporária na mesma transação
 *   (`cancelarSenhaTemporaria` do core) e audita `core.usuario.senha_temporaria_cancelada` (`aoCancelar`), sem senha nem e-mail.
 * - pedido (`esqueci`): ordem e regras em `auth/esqueci.ts`; o e-mail vai para o endereço da conta lido do banco.
 * Mensagem de falha única (`MENSAGEM_FALHA_LOGIN` do SDK), sem dizer qual campo errou.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ErroApi,
  erroSenhaForaDaRegra,
  erros,
  MENSAGEM_FALHA_LOGIN,
  MENSAGEM_SENHA_ATUAL_INCORRETA,
  MENSAGEM_SENHA_IGUAL,
  PADRAO_UUID,
  sha256Hex,
  type Banco,
  type Relogio,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { avaliarPedidoSenhaEsquecida, type RepositorioCore } from '@macuxierp/core/api';
import { ConferenciaCustoIgual, travaAposFalha } from './apoio-login';
import { emitirTokenAcesso, type SessaoAcesso } from './jwt';
import type { RepositorioAuth, SessaoRefresh, UsuarioAuth } from './portas';
import { ARGON2_PADRAO, conferirSenha, gerarHashSenha, type ParametrosArgon2 } from './senha';
import type { MensagemEmail } from '../email/porta';
import { conferirTemporaria, custoTemporariaDescartada, emitirTemporaria, lerMarcaTemporaria, marcaTemporaria, mensagemSenhaTemporaria } from './senha-temporaria';
import type { TrocaPendente } from './troca-senha';

export interface ConfigAuth {
  jwtSegredo: string;
  acessoSegundos: number;
  refreshDias: number;
  maxFalhas: number;
  travaMinutos: number;
  argon2: ParametrosArgon2;
}

export const CONFIG_AUTH_PADRAO: Omit<ConfigAuth, 'jwtSegredo'> = {
  acessoSegundos: 15 * 60,
  refreshDias: 30,
  maxFalhas: 5,
  travaMinutos: 15,
  argon2: ARGON2_PADRAO,
};

export interface ResultadoLogin {
  token_acesso: string;
  expira_em: Date;
  refresh: string;
  refresh_expira_em: Date;
}

/**
 * O que a API usa do `RepositorioCore` no "esqueci" (`emitirSenhaTemporaria`) e no login certo com a temporária pendente
 * (`cancelarSenhaTemporaria`: UPDATE ... WHERE id AND senha_temporaria_hash IS NOT NULL RETURNING id; true = cancelou).
 */
export type RepoCoreAuth = Pick<RepositorioCore, 'emitirSenhaTemporaria' | 'cancelarSenhaTemporaria'>;

/** O cancelamento da temporária no login certo (T-0083): o repositório e a auditoria, na transação do login. */
export interface CancelamentoTemporaria {
  repoCore: Pick<RepoCoreAuth, 'cancelarSenhaTemporaria'>;
  aoCancelar: (tx: Transacao, conta: { tenant_id: string; usuario_id: string }) => Promise<void>;
}

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

  constructor(
    private readonly banco: Banco,
    private readonly repo: RepositorioAuth,
    private readonly cfg: ConfigAuth,
    private readonly relogio: Relogio,
  ) {
    this.custoIgual = new ConferenciaCustoIgual(cfg.argon2);
  }

  async entrar(entrada: { empresa: string; email: string; senha: string }, cancelamento?: CancelamentoTemporaria): Promise<ResultadoLogin> {
    const agora = this.relogio.agora();
    const tenantId = await this.banco.semTenant((tx) => this.repo.tenantIdPorSlug(tx, entrada.empresa.trim().toLowerCase()));
    if (!tenantId) return this.falharSemUsuario(entrada.senha);
    // A falha é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.comTenant(tenantId, async (tx) => {
      const usuario = await this.repo.usuarioPorEmail(tx, entrada.email.trim().toLowerCase());
      if (!usuario || !usuario.ativo) return 'sem_usuario' as const;
      if (usuario.bloqueado_ate && usuario.bloqueado_ate.getTime() > agora.getTime()) return 'travado' as const;
      if (await conferirSenha(entrada.senha, usuario.senha_hash)) {
        if (usuario.senha_temporaria_hash && cancelamento && (await cancelamento.repoCore.cancelarSenhaTemporaria(tx, usuario.id))) {
          await cancelamento.aoCancelar(tx, { tenant_id: tenantId, usuario_id: usuario.id });
        }
        await this.repo.registrarAcesso(tx, usuario.id, agora);
        return this.abrirSessao(tx, usuario, randomUUID(), agora);
      }
      const fimTemporaria = await conferirTemporaria(entrada.senha, usuario.senha_temporaria_hash, usuario.senha_temporaria_expira_em, agora);
      if (fimTemporaria) {
        // Uso único: só abre a sessão se o consumo atômico devolveu true; quem perde a corrida recebe a falha neutra.
        if (!(await this.repo.consumirTemporaria(tx, usuario.id))) return 'corrida' as const;
        await this.repo.registrarAcesso(tx, usuario.id, agora);
        return this.abrirSessao(tx, { ...usuario, deve_trocar_senha: true }, randomUUID(), agora, { motivo_troca: 'temporaria', temporaria_expira_em: fimTemporaria });
      }
      // Senha errada, temporária errada ou vencida: a mesma falha, na mesma trava.
      await this.registrarFalha(tx, usuario, agora);
      return 'senha' as const;
    });
    if (r === 'sem_usuario') return this.falharSemUsuario(entrada.senha);
    if (r === 'travado') {
      throw erros.muitasTentativas(`Acesso travado por ${this.cfg.travaMinutos} minutos após ${this.cfg.maxFalhas} tentativas`);
    }
    if (r === 'senha' || r === 'corrida') throw erros.naoAutenticado(MENSAGEM_FALHA_LOGIN);
    return r;
  }

  /**
   * Pedido de senha temporária (T-0076). O argon2 roda antes de saber se a conta existe. Quem decide se grava é o
   * `avaliarPedidoSenhaEsquecida` do core (RN-CORE-13) e quem grava é o `emitirSenhaTemporaria` do `RepositorioCore`, na
   * transação do tenant. Devolve a mensagem de e-mail (só se gravou), para o endereço da conta lido do banco (T-0083: o
   * `usuario.email`, não o digitado); `aoGravar` roda na mesma transação (a auditoria). Roda em segundo plano, depois do
   * 202 (`auth/esqueci.ts`).
   */
  async esqueci(
    entrada: { empresa: string; email: string },
    repoCore: Pick<RepoCoreAuth, 'emitirSenhaTemporaria'>,
    aoGravar: (tx: Transacao, conta: { tenant_id: string; usuario_id: string }) => Promise<void>,
  ): Promise<MensagemEmail | null> {
    const temporaria = await emitirTemporaria(this.cfg.argon2, this.relogio.agora());
    const email = entrada.email.trim().toLowerCase();
    // `tenant_por_slug` só devolve o tenant ativo: empresa suspensa, encerrada ou inexistente = nada a avaliar nem gravar.
    const tenantId = await this.banco.semTenant((tx) => this.repo.tenantIdPorSlug(tx, entrada.empresa.trim().toLowerCase()));
    if (!tenantId) return null;
    const para = await this.banco.comTenant(tenantId, async (tx) => {
      const usuario = await this.repo.usuarioPorEmail(tx, email);
      // `usuarioPorEmail` já exclui `deleted_at`; o tenant achado pelo slug está ativo.
      const avaliacao = avaliarPedidoSenhaEsquecida(usuario && { ativo: usuario.ativo, excluido: false }, { situacao: 'ativo' });
      if (!usuario || !avaliacao.enviar) return null;
      await repoCore.emitirSenhaTemporaria(tx, usuario.id, temporaria.hash, temporaria.expira_em);
      await aoGravar(tx, { tenant_id: tenantId, usuario_id: usuario.id });
      return usuario.email;
    });
    return para ? mensagemSenhaTemporaria(para, temporaria.senha) : null;
  }

  /** Pedido com o e-mail desligado (T-0076): o mesmo custo de argon2 do `esqueci`, sem banco, sem temporária e sem envio. */
  esqueciSemEnvio(): Promise<null> {
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
    return { token_acesso: acesso.token, expira_em: acesso.expira_em, refresh, refresh_expira_em: linha.expira_em };
  }

  private async registrarFalha(tx: Transacao, u: UsuarioAuth, agora: Date): Promise<void> {
    const travaVencida = u.bloqueado_ate !== null && u.bloqueado_ate.getTime() <= agora.getTime();
    const falhas = (travaVencida ? 0 : u.falhas_login) + 1;
    const trava = travaAposFalha(falhas, agora, this.cfg);
    await this.repo.registrarFalha(tx, u.id, trava ? 0 : falhas, trava);
  }

  /** Confere contra um hash falso para o tempo de resposta não revelar se a empresa ou o e-mail existem. */
  private falharSemUsuario(senha: string): Promise<never> {
    return this.custoIgual.falhar(senha, () => erros.naoAutenticado(MENSAGEM_FALHA_LOGIN));
  }
}
