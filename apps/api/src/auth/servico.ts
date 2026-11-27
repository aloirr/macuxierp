/**
 * Login, refresh rotativo e saída (desenho T-0002, seção 2, "Plataforma"):
 * - login por empresa (slug), e-mail e senha (D2); argon2id; bloqueio sem prazo após 5 falhas (só a temporária ou o --destravar liberam);
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
 * Mensagem de falha única ("empresa, e-mail ou senha inválidos"), sem dizer qual campo errou.
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
import { chaveEmpresaEmail, TravaContaMemoria } from '../plataforma/limite-ip';
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
  /** `LoginResposta.desbloqueou` do SDK (RN-CORE-15). */
  desbloqueou?: true;
}

/** Mensagem única do 401 do login (tenant e, pela tela única, o superadmin): não diz qual campo errou. */
export const FALHA_LOGIN = 'Empresa, e-mail ou senha inválidos';

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
   * Login do tenant (RN-CORE-15, T-0111; decisão R-20261126-175321): a decisão é a `decidirEntrada` (apoio-login.ts), a
   * mesma do superadmin. A conta que não existe trava pela memória (empresa + e-mail); o 423 e o custo saem iguais. O
   * `operador.sh --destravar` (banco) vale na hora.
   */
  async entrar(entrada: { empresa: string; email: string; senha: string }, limite?: () => ErroApi): Promise<ResultadoLogin> {
    const agora = this.relogio.agora();
    const chave = chaveEmpresaEmail(entrada.empresa, entrada.email);
    const semConta = () => this.custoIgual.recusarSemConta(entrada.senha, this.travaConta, chave, () => erros.naoAutenticado(FALHA_LOGIN), limite);
    const tenantId = await this.banco.semTenant((tx) => this.repo.tenantIdPorSlug(tx, entrada.empresa.trim().toLowerCase()));
    if (!tenantId) return semConta();
    // A recusa é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.comTenant(tenantId, async (tx): Promise<Recusa | ResultadoLogin | null> => {
      const usuario = await this.repo.usuarioPorEmail(tx, entrada.email.trim().toLowerCase());
      if (!usuario || !usuario.ativo) return null;
      const { resultado, fimTemporaria, conferencias } = await this.custoIgual.decidirEntrada(entrada.senha, usuario, agora, limite !== undefined);
      if (resultado === 'bloqueada') return { recusa: 'bloqueada', conferencias };
      if (resultado === 'falha') {
        // IP no limite: só a temporária foi conferida; a recusa é o 429, sem somar falha na conta
        if (limite) return { recusa: 'falha', conferencias };
        await this.registrarFalha(tx, usuario, agora);
        return { recusa: 'falha', conferencias };
      }
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
    if ('recusa' in r) return this.custoIgual.recusarConta(entrada.senha, r, () => erros.naoAutenticado(FALHA_LOGIN), limite);
    return r;
  }

  /**
   * Pedido de senha temporária (T-0076). O argon2 roda antes de saber se a conta existe. Quem decide se grava é o
   * `avaliarPedidoSenhaEsquecida` do core (RN-CORE-13) e quem grava é o `emitirSenhaTemporaria` do `RepositorioCore`, na
   * transação do tenant. Devolve a mensagem de e-mail (só se gravou) para a rota agendar depois da resposta; `aoGravar`
   * roda na mesma transação (a auditoria).
   */
  async esqueci(
    entrada: { empresa: string; email: string },
    repoCore: Pick<RepositorioCore, 'emitirSenhaTemporaria'>,
    aoGravar: (tx: Transacao, conta: { tenant_id: string; usuario_id: string }) => Promise<void>,
    log?: LogEsqueci,
  ): Promise<MensagemEmail | null> {
    const temporaria = await emitirTemporaria(this.cfg.argon2, this.relogio.agora());
    const email = entrada.email.trim().toLowerCase();
    // `tenant_por_slug` só devolve o tenant ativo: empresa suspensa, encerrada ou inexistente = nada a avaliar nem gravar.
    const tenantId = await this.banco.semTenant((tx) => this.repo.tenantIdPorSlug(tx, entrada.empresa.trim().toLowerCase()));
    if (!tenantId) {
      registrarSemEnvio(log, 'empresa_inexistente_ou_suspensa');
      return null;
    }
    const gravou = await this.banco.comTenant(tenantId, async (tx) => {
      const usuario = await this.repo.usuarioPorEmail(tx, email);
      // `usuarioPorEmail` já exclui `deleted_at`; o tenant achado pelo slug está ativo.
      const avaliacao = avaliarPedidoSenhaEsquecida(usuario && { ativo: usuario.ativo, excluido: false }, { situacao: 'ativo' });
      if (!usuario || !avaliacao.enviar) return false;
      await repoCore.emitirSenhaTemporaria(tx, usuario.id, temporaria.hash, temporaria.expira_em);
      await aoGravar(tx, { tenant_id: tenantId, usuario_id: usuario.id });
      return true;
    });
    if (gravou) return mensagemSenhaTemporaria(email, temporaria.senha, entrada.empresa.trim().toUpperCase());
    registrarSemEnvio(log, 'conta_inexistente_ou_inativa');
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
    return { token_acesso: acesso.token, expira_em: acesso.expira_em, refresh, refresh_expira_em: linha.expira_em };
  }

  private async registrarFalha(tx: Transacao, u: UsuarioAuth, agora: Date): Promise<void> {
    // bloqueio antigo (de antes do hotfix, com prazo) já vencido: a contagem recomeça
    const travaVencida = u.bloqueado_ate !== null && u.bloqueado_ate.getTime() <= agora.getTime();
    const falhas = (travaVencida ? 0 : u.falhas_login) + 1;
    const trava = travaAposFalha(falhas, this.cfg);
    await this.repo.registrarFalha(tx, u.id, trava ? 0 : falhas, trava);
  }

  /** Confere contra um hash falso para o tempo de resposta não revelar se a empresa ou o e-mail existem. */
}
