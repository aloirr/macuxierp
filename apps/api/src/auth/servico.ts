/**
 * Login, refresh rotativo e saída (desenho T-0002, seção 2, "Plataforma"):
 * - login por empresa (slug), e-mail e senha (D2); argon2id; trava após 5 falhas por 15 min;
 * - JWT de acesso de 15 min + refresh rotativo (cookie httpOnly, posto pela rota);
 * - refresh reutilizado (já revogado) revoga a família inteira;
 * - troca da própria senha (T-0052, RN-CORE-10): a senha provisória (`deve_trocar_senha`) vai no JWT de acesso e o
 *   `trocarSenha` a zera, revogando as outras sessões do usuário (a família do refresh corrente continua).
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
  type Sessao,
  type Transacao,
} from '@macuxierp/platform-sdk';
import { ConferenciaCustoIgual, travaAposFalha } from './apoio-login';
import { emitirTokenAcesso, type SessaoAcesso } from './jwt';
import type { RepositorioAuth, SessaoRefresh, UsuarioAuth } from './portas';
import { ARGON2_PADRAO, conferirSenha, gerarHashSenha, type ParametrosArgon2 } from './senha';

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

const FALHA_LOGIN = 'Empresa, e-mail ou senha inválidos';

/** 400 `VALIDACAO` da senha atual errada na troca (tenant e superadmin): `campos.senha_atual` com o texto da marca. */
export const erroSenhaAtualIncorreta = (): ErroApi => erros.validacao({ senha_atual: MENSAGEM_SENHA_ATUAL_INCORRETA });

/** 400 `VALIDACAO` da senha nova igual à atual na troca (tenant e superadmin): `campos.senha_nova`. */
export const erroSenhaIgual = (): ErroApi => erros.validacao({ senha_nova: MENSAGEM_SENHA_IGUAL });

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

  async entrar(entrada: { empresa: string; email: string; senha: string }): Promise<ResultadoLogin> {
    const agora = this.relogio.agora();
    const tenantId = await this.banco.semTenant((tx) => this.repo.tenantIdPorSlug(tx, entrada.empresa.trim().toLowerCase()));
    if (!tenantId) return this.falharSemUsuario(entrada.senha);
    // A falha é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.comTenant(tenantId, async (tx) => {
      const usuario = await this.repo.usuarioPorEmail(tx, entrada.email.trim().toLowerCase());
      if (!usuario || !usuario.ativo) return 'sem_usuario' as const;
      if (usuario.bloqueado_ate && usuario.bloqueado_ate.getTime() > agora.getTime()) return 'travado' as const;
      if (!(await conferirSenha(entrada.senha, usuario.senha_hash))) {
        await this.registrarFalha(tx, usuario, agora);
        return 'senha' as const;
      }
      await this.repo.registrarAcesso(tx, usuario.id, agora);
      return this.abrirSessao(tx, usuario, randomUUID(), agora);
    });
    if (r === 'sem_usuario') return this.falharSemUsuario(entrada.senha);
    if (r === 'travado') {
      throw erros.muitasTentativas(`Acesso travado por ${this.cfg.travaMinutos} minutos após ${this.cfg.maxFalhas} tentativas`);
    }
    if (r === 'senha') throw erros.naoAutenticado(FALHA_LOGIN);
    return r;
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
      return this.abrirSessao(tx, usuario, atual.familia, agora);
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
   * o banco) → senha atual (400 em `senha_atual`; NÃO conta como falha de login) → nova igual à atual (400 em
   * `senha_nova`) → grava o hash, zera `deve_trocar_senha`, revoga as outras sessões (a família do `refresh` corrente,
   * se for deste usuário, continua) e chama `aoTrocar` na mesma transação (a auditoria). Devolve quantas sessões caíram.
   */
  async trocarSenha(
    sessao: Sessao,
    refresh: string | undefined,
    entrada: { senha_atual: string; senha_nova: string },
    aoTrocar: (tx: Transacao, sessoesRevogadas: number) => Promise<void>,
  ): Promise<number> {
    const foraDaRegra = erroSenhaNova(entrada.senha_nova);
    if (foraDaRegra) throw foraDaRegra;
    const agora = this.relogio.agora();
    return this.banco.comTenant(sessao.tenant_id, async (tx) => {
      const usuario = await this.repo.usuarioPorId(tx, sessao.usuario_id);
      if (!usuario || !usuario.ativo) throw erros.naoAutenticado();
      if (!(await conferirSenha(entrada.senha_atual, usuario.senha_hash))) throw erroSenhaAtualIncorreta();
      if (entrada.senha_nova === entrada.senha_atual) throw erroSenhaIgual();
      await this.repo.trocarSenha(tx, usuario.id, await gerarHashSenha(entrada.senha_nova, this.cfg.argon2));
      const corrente = refresh && tenantDoRefresh(refresh) === sessao.tenant_id ? await this.repo.sessaoPorHash(tx, hashRefresh(refresh)) : null;
      const familia = corrente && corrente.usuario_id === usuario.id && !corrente.revogada_em ? corrente.familia : null;
      const revogadas = await this.repo.revogarOutrasSessoes(tx, usuario.id, familia, agora);
      await aoTrocar(tx, revogadas);
      return revogadas;
    });
  }

  private async abrirSessao(tx: Transacao, u: UsuarioAuth, familia: string, agora: Date): Promise<ResultadoLogin> {
    const sessao: SessaoAcesso = {
      usuario_id: u.id,
      tenant_id: u.tenant_id,
      perfil: u.perfil,
      filial_ids: u.filial_ids,
      ...(u.deve_trocar_senha ? { deve_trocar_senha: true as const } : {}),
    };
    const refresh = `${u.tenant_id}.${randomBytes(32).toString('base64url')}`;
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
    return this.custoIgual.falhar(senha, () => erros.naoAutenticado(FALHA_LOGIN));
  }
}
