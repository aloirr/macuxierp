/**
 * Login, refresh rotativo e saída (desenho T-0002, seção 2, "Plataforma"):
 * - login por empresa (slug), e-mail e senha (D2); argon2id; trava após 5 falhas por 15 min;
 * - JWT de acesso de 15 min + refresh rotativo (cookie httpOnly, posto pela rota);
 * - refresh reutilizado (já revogado) revoga a família inteira.
 * Mensagem de falha única ("empresa, e-mail ou senha inválidos"), sem dizer qual campo errou.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { erros, PADRAO_UUID, type Banco, type Relogio, type Sessao, type Transacao } from '@macuxierp/platform-sdk';
import { emitirTokenAcesso } from './jwt';
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

const hashRefresh = (refresh: string) => createHash('sha256').update(refresh).digest('hex');

/** O refresh carrega o tenant (`<tenant_id>.<aleatório>`) para a busca rodar dentro da RLS dele. */
function tenantDoRefresh(refresh: string): string | null {
  const [tenant, aleatorio] = refresh.split('.');
  return tenant && aleatorio && PADRAO_UUID.test(tenant) && aleatorio.length >= 40 ? tenant : null;
}

export class ServicoAuth {
  private hashFalso: Promise<string> | undefined;

  constructor(
    private readonly banco: Banco,
    private readonly repo: RepositorioAuth,
    private readonly cfg: ConfigAuth,
    private readonly relogio: Relogio,
  ) {}

  async entrar(entrada: { empresa: string; email: string; senha: string }): Promise<ResultadoLogin> {
    const agora = this.relogio.agora();
    const tenant = await this.banco.semTenant((tx) => this.repo.tenantPorSlug(tx, entrada.empresa.trim().toLowerCase()));
    if (!tenant || tenant.situacao !== 'ativo') return this.falharSemUsuario(entrada.senha);
    // A falha é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.comTenant(tenant.id, async (tx) => {
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

  private async abrirSessao(tx: Transacao, u: UsuarioAuth, familia: string, agora: Date): Promise<ResultadoLogin> {
    const sessao: Sessao = { usuario_id: u.id, tenant_id: u.tenant_id, perfil: u.perfil, filial_ids: u.filial_ids };
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
    const trava = falhas >= this.cfg.maxFalhas ? new Date(agora.getTime() + this.cfg.travaMinutos * 60_000) : null;
    await this.repo.registrarFalha(tx, u.id, trava ? 0 : falhas, trava);
  }

  /** Confere contra um hash falso para o tempo de resposta não revelar se a empresa ou o e-mail existem. */
  private async falharSemUsuario(senha: string): Promise<never> {
    this.hashFalso ??= gerarHashSenha(randomUUID(), this.cfg.argon2);
    await conferirSenha(senha, await this.hashFalso);
    throw erros.naoAutenticado(FALHA_LOGIN);
  }
}
