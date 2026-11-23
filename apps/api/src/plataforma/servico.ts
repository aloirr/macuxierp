/**
 * Login, sessão, saída e troca de senha do superadmin (ADR 0012 §2, §4 e §6). Só chama as funções da lista fechada da
 * 0033 (`superadmin_*`), dentro do `BancoPlataformaComLogin` (papel `macuxierp_config` só na transação):
 * - o token da sessão é opaco (32 bytes aleatórios, base64url) e só o SHA-256 vai ao banco; o token só existe no cookie;
 * - argon2id conferido na API (`conferirSenha`); `maxFalhas` falhas seguidas travam por `travaMinutos` (`ConfigAuth`,
 *   `travaAposFalha`); mensagem única e o mesmo custo de argon2 (`ConferenciaCustoIgual`) quando o e-mail não existe ou
 *   a conta está travada;
 * - nada de e-mail, senha, token ou nome em log ou erro.
 */
import { randomBytes } from 'node:crypto';
import { erros, sha256Hex, type BancoPlataformaComLogin, type Relogio, type SessaoPlataforma } from '@macuxierp/platform-sdk';
import { ConferenciaCustoIgual, travaAposFalha } from '../auth/apoio-login';
import { conferirSenha, gerarHashSenha } from '../auth/senha';
import { erroSenhaAtualIncorreta, erroSenhaIgual, erroSenhaNova, type ConfigAuth } from '../auth/servico';

export const FALHA_LOGIN_PLATAFORMA = 'E-mail ou senha inválidos';
/** Validade absoluta da sessão do superadmin (a ociosidade de 30 min é do banco). */
export const VALIDADE_SESSAO_PLATAFORMA_MS = 8 * 60 * 60 * 1000;
/** 32 bytes em base64url, sem preenchimento. */
const PADRAO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hashToken = sha256Hex;

export interface SessaoPlataformaLida extends SessaoPlataforma {
  nome: string;
  deve_trocar_senha: boolean;
  expira_em: Date;
}

export interface LoginPlataforma {
  token: string;
  expira_em: Date;
  superadmin_id: string;
}

interface LinhaLogin {
  id: string;
  senha_hash: string;
  ativo: boolean;
  falhas_login: number;
  bloqueado_ate: Date | null;
}

export class ServicoPlataforma {
  private readonly custoIgual: ConferenciaCustoIgual;

  constructor(
    private readonly banco: BancoPlataformaComLogin,
    private readonly cfg: Pick<ConfigAuth, 'maxFalhas' | 'travaMinutos' | 'argon2'>,
    private readonly relogio: Relogio,
  ) {
    this.custoIgual = new ConferenciaCustoIgual(cfg.argon2);
  }

  async entrar(email: string, senha: string): Promise<LoginPlataforma> {
    const agora = this.relogio.agora();
    // A falha é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.antesDaSessao(async (tx) => {
      const [sa] = await tx.consultar<LinhaLogin>(
        'SELECT id, senha_hash, ativo, falhas_login, bloqueado_ate FROM plataforma.superadmin_para_login($1)',
        [email],
      );
      if (!sa || !sa.ativo || (sa.bloqueado_ate && sa.bloqueado_ate.getTime() > agora.getTime())) return null;
      if (!(await conferirSenha(senha, sa.senha_hash))) {
        // A 0033 só sobe a contagem (zera no login certo): a partir da `maxFalhas`-ésima falha seguida, cada falha trava
        // por `travaMinutos`.
        const falhas = sa.falhas_login + 1;
        const trava = travaAposFalha(falhas, agora, this.cfg);
        await tx.consultar('SELECT plataforma.superadmin_registrar_falha($1::uuid, $2, $3)', [sa.id, falhas, trava]);
        return 'senha' as const;
      }
      const token = randomBytes(32).toString('base64url');
      const expira_em = new Date(agora.getTime() + VALIDADE_SESSAO_PLATAFORMA_MS);
      await tx.consultar('SELECT plataforma.superadmin_abrir_sessao($1::uuid, $2, $3)', [sa.id, hashToken(token), expira_em]);
      return { token, expira_em, superadmin_id: sa.id };
    });
    if (r === null) return this.custoIgual.falhar(senha, () => erros.naoAutenticado(FALHA_LOGIN_PLATAFORMA));
    if (r === 'senha') throw erros.naoAutenticado(FALHA_LOGIN_PLATAFORMA);
    return r;
  }

  /** A sessão válida do token do cookie (renova a ociosidade no banco); `null` se ausente, malformada ou inválida. */
  async sessaoDoToken(token: string | undefined): Promise<SessaoPlataformaLida | null> {
    if (!token || !PADRAO_TOKEN.test(token)) return null;
    const [l] = await this.banco.antesDaSessao((tx) =>
      tx.consultar<SessaoPlataformaLida>(
        'SELECT sessao_id, superadmin_id, nome, deve_trocar_senha, expira_em FROM plataforma.superadmin_sessao_por_token($1)',
        [hashToken(token)],
      ),
    );
    return l ?? null;
  }

  async sair(sessao: SessaoPlataforma): Promise<void> {
    await this.banco.comPlataforma(sessao, (tx) => tx.consultar('SELECT plataforma.superadmin_sair($1::uuid)', [sessao.sessao_id]));
  }

  /** Troca a senha (só hashes vão ao banco), na mesma ordem e com os mesmos 400 do ServicoAuth.trocarSenha. */
  async trocarSenha(sessao: SessaoPlataforma, senhaAtual: string, senhaNova: string): Promise<void> {
    const foraDaRegra = erroSenhaNova(senhaNova);
    if (foraDaRegra) throw foraDaRegra;
    await this.banco.comPlataforma(sessao, async (tx) => {
      const [l] = await tx.consultar<{ h: string | null }>('SELECT plataforma.superadmin_senha_atual() AS h');
      if (!l?.h || !(await conferirSenha(senhaAtual, l.h))) throw erroSenhaAtualIncorreta();
      if (senhaNova === senhaAtual) throw erroSenhaIgual();
      const nova = await gerarHashSenha(senhaNova, this.cfg.argon2);
      await tx.consultar('SELECT plataforma.superadmin_trocar_senha($1, $2)', [l.h, nova]);
    });
  }
}
