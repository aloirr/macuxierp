/**
 * Login, sessão, saída e troca de senha do superadmin (ADR 0012 §2, §4 e §6). Só chama as funções da lista fechada da
 * 0033 (`superadmin_*`), dentro do `BancoPlataformaComLogin` (papel `macuxierp_config` só na transação):
 * - o token da sessão é opaco (32 bytes aleatórios, base64url) e só o SHA-256 vai ao banco; o token só existe no cookie;
 * - argon2id conferido na API (`conferirSenha`); `maxFalhas` falhas seguidas travam por `travaMinutos` (`ConfigAuth`,
 *   `travaAposFalha`); mensagem única e o mesmo custo de argon2 (`ConferenciaCustoIgual`) quando o e-mail não existe ou
 *   a conta está travada;
 * - nada de e-mail, senha, token ou nome em log ou erro;
 * - senha temporária do "Esqueci a senha" (T-0076): as regras do login e da troca são as do `auth/servico.ts`; aqui, pelas
 *   funções da 0048, `superadmin_emitir_temporaria(p_id, p_hash, p_expira_em)` (pedido; substitui a anterior) e
 *   `superadmin_consumir_temporaria(p_id) → boolean` (login; atômica, de uso único, zera as duas colunas e liga a troca;
 *   desde a 0051, zera também a trava, que a `superadmin_abrir_sessao` da 0033 exige zerada).
 *   A marca da temporária (`marcaTemporaria`) vai no começo do próprio token; `superadmin_trocar_senha` zera a temporária.
 */
import { randomBytes } from 'node:crypto';
import { avaliarEntrada, temporariaValida } from '@macuxierp/core/api';
import { CODIGO_SUPERADMIN_LOGIN, erros, sha256Hex, type BancoPlataformaComLogin, type Relogio, type SessaoPlataforma } from '@macuxierp/platform-sdk';
import { conferirTemporaria, custoTemporariaDescartada, emitirTemporaria, lerMarcaTemporaria, marcaTemporaria, mensagemSenhaTemporaria } from '../auth/senha-temporaria';
import { registrarSemEnvio, type LogEsqueci } from '../auth/esqueci-log';
import type { TrocaPendente } from '../auth/troca-senha';
import type { MensagemEmail } from '../email/porta';
import { chaveEmpresaEmail, EMPRESA_PLATAFORMA, TravaContaMemoria } from './limite-ip';
import { ConferenciaCustoIgual, contaTravada, travaAposFalha } from '../auth/apoio-login';
import { conferirSenha, gerarHashSenha } from '../auth/senha';
import { erroSenhaAtualIncorreta, erroSenhaNova, exigirSenhaAtual, type ConfigAuth } from '../auth/servico';

export const FALHA_LOGIN_PLATAFORMA = 'E-mail ou senha inválidos';
/** Validade absoluta da sessão do superadmin (a ociosidade de 30 min é do banco). */
export const VALIDADE_SESSAO_PLATAFORMA_MS = 8 * 60 * 60 * 1000;
/** 32 bytes em base64url, sem preenchimento; com `<marcaTemporaria>.` na frente = sessão aberta pela temporária (T-0076). */
const PADRAO_TOKEN = /^(?:(t\d{1,12})\.)?[A-Za-z0-9_-]{43}$/;

const hashToken = sha256Hex;

/** A sessão lida; a `TrocaPendente` (T-0076) só com a troca ainda pendente. */
export interface SessaoPlataformaLida extends SessaoPlataforma, TrocaPendente {
  nome: string;
  deve_trocar_senha: boolean;
  expira_em: Date;
}

export interface LoginPlataforma {
  token: string;
  expira_em: Date;
  superadmin_id: string;
  /** RN-CORE-15 (T-0111): entrou com a temporária numa conta travada, que ficou desbloqueada. Só no sucesso. */
  desbloqueou?: true;
}

interface LinhaLogin {
  id: string;
  senha_hash: string;
  ativo: boolean;
  falhas_login: number;
  bloqueado_ate: Date | null;
  senha_temporaria_hash: string | null;
  senha_temporaria_expira_em: Date | null;
}

const SQL_PARA_LOGIN =
  'SELECT id, senha_hash, ativo, falhas_login, bloqueado_ate, senha_temporaria_hash, senha_temporaria_expira_em FROM plataforma.superadmin_para_login($1)';

export class ServicoPlataforma {
  private readonly custoIgual: ConferenciaCustoIgual;
  /** RN-CORE-15 (T-0111): a trava em memória da chave `plataforma` + e-mail (uma por processo, compartilhada pelas duas rotas de login). */
  readonly travaConta: TravaContaMemoria;

  constructor(
    private readonly banco: BancoPlataformaComLogin,
    private readonly cfg: Pick<ConfigAuth, 'maxFalhas' | 'travaMinutos' | 'argon2'>,
    private readonly relogio: Relogio,
  ) {
    this.custoIgual = new ConferenciaCustoIgual(cfg.argon2);
    this.travaConta = new TravaContaMemoria(cfg);
  }

  /**
   * Login do superadmin (RN-CORE-15, T-0111; decisão R-20261126-175321): a mesma regra do tenant (`avaliarEntrada` do core),
   * com a trava em memória da chave `plataforma` + e-mail só para a conta que não existe. Travada sem a temporária = 423
   * `CONTA_BLOQUEADA`, o mesmo corpo do tenant e do e-mail inexistente, com uma conferência argon2 em todos os caminhos.
   */
  async entrar(email: string, senha: string): Promise<LoginPlataforma> {
    const agora = this.relogio.agora();
    const chave = chaveEmpresaEmail(EMPRESA_PLATAFORMA, email);
    const naMemoria = this.travaConta.travada(chave, agora.getTime());
    // A falha é devolvida, não lançada, dentro da transação: o erro desfaria a contagem de falhas gravada.
    const r = await this.banco.antesDaSessao(async (tx) => {
      const [sa] = await tx.consultar<LinhaLogin>(SQL_PARA_LOGIN, [email]);
      if (!sa || !sa.ativo) return null;
      // A conta que existe segue só a trava do banco (o operador destrava na hora); a memória é a da conta que não existe.
      const travada = contaTravada(sa.bloqueado_ate, agora);
      const atual = !travada && (await conferirSenha(senha, sa.senha_hash));
      const fimTemporaria = atual ? null : await conferirTemporaria(senha, sa.senha_temporaria_hash, sa.senha_temporaria_expira_em, agora);
      const resultado = avaliarEntrada({ travada, temporariaVigente: fimTemporaria !== null, senhaConfere: atual || fimTemporaria !== null });
      if (resultado === 'bloqueada') {
        const custou = !!sa.senha_temporaria_hash && !!sa.senha_temporaria_expira_em && temporariaValida(sa.senha_temporaria_expira_em, agora);
        return { bloqueada: true, custou } as const;
      }
      if (resultado === 'falha') {
        // Senha errada, temporária errada ou vencida: a 0033 só sobe a contagem (zera no login certo); a partir da
        // `maxFalhas`-ésima falha seguida, cada falha trava por `travaMinutos`.
        const falhas = sa.falhas_login + 1;
        const trava = travaAposFalha(falhas, agora, this.cfg);
        await tx.consultar('SELECT plataforma.superadmin_registrar_falha($1::uuid, $2, $3)', [sa.id, falhas, trava]);
        return 'senha' as const;
      }
      if (fimTemporaria) {
        // 0048/0051: atômica e de uso único, zera a trava; só abre a sessão com true (quem perde a corrida recebe a falha neutra).
        const [c] = await tx.consultar<{ ok: boolean | null }>('SELECT plataforma.superadmin_consumir_temporaria($1::uuid) AS ok', [sa.id]);
        if (c?.ok !== true) return 'corrida' as const;
      }
      const marca = fimTemporaria ? marcaTemporaria({ motivo_troca: 'temporaria', temporaria_expira_em: fimTemporaria }) : null;
      const token = `${marca ? `${marca}.` : ''}${randomBytes(32).toString('base64url')}`;
      const expira_em = new Date(agora.getTime() + VALIDADE_SESSAO_PLATAFORMA_MS);
      await tx.consultar('SELECT plataforma.superadmin_abrir_sessao($1::uuid, $2, $3)', [sa.id, hashToken(token), expira_em]);
      return { token, expira_em, superadmin_id: sa.id, ...(resultado === 'entra_desbloqueando' ? { desbloqueou: true as const } : {}) };
    });
    if (r === null) {
      if (naMemoria) return this.custoIgual.falhar(senha, () => erros.contaBloqueada());
      this.travaConta.falhou(chave, agora.getTime());
      return this.custoIgual.falhar(senha, () => erros.naoAutenticado(FALHA_LOGIN_PLATAFORMA));
    }
    if (r === 'senha' || r === 'corrida') throw erros.naoAutenticado(FALHA_LOGIN_PLATAFORMA);
    if ('bloqueada' in r) {
      if (r.custou) throw erros.contaBloqueada();
      return this.custoIgual.falhar(senha, () => erros.contaBloqueada());
    }
    return r;
  }

  /** Pedido de senha temporária (T-0076), pela `superadmin_emitir_temporaria`. Ordem e regras: auth/esqueci.ts. */
  async esqueci(email: string, log?: LogEsqueci): Promise<MensagemEmail | null> {
    const para = email.trim().toLowerCase();
    const temporaria = await emitirTemporaria(this.cfg.argon2, this.relogio.agora());
    const gravou = await this.banco.antesDaSessao(async (tx) => {
      const [sa] = await tx.consultar<LinhaLogin>(SQL_PARA_LOGIN, [para]);
      if (!sa || !sa.ativo) return false;
      await tx.consultar('SELECT plataforma.superadmin_emitir_temporaria($1::uuid, $2, $3)', [sa.id, temporaria.hash, temporaria.expira_em]);
      return true;
    });
    if (gravou) return mensagemSenhaTemporaria(para, temporaria.senha, CODIGO_SUPERADMIN_LOGIN);
    registrarSemEnvio(log, 'conta_inexistente_ou_inativa');
    return null;
  }

  /** Pedido com o e-mail desligado (T-0076): o mesmo custo de argon2 do `esqueci`, sem banco, sem temporária e sem envio. */
  esqueciSemEnvio(log?: LogEsqueci): Promise<null> {
    registrarSemEnvio(log, 'email_desligado');
    return custoTemporariaDescartada(this.cfg.argon2);
  }

  /** A sessão válida do token do cookie (renova a ociosidade no banco); `null` se ausente, malformada ou inválida. */
  async sessaoDoToken(token: string | undefined): Promise<SessaoPlataformaLida | null> {
    const formato = token ? PADRAO_TOKEN.exec(token) : null;
    if (!token || !formato) return null;
    const [l] = await this.banco.antesDaSessao((tx) =>
      tx.consultar<SessaoPlataformaLida>(
        'SELECT sessao_id, superadmin_id, nome, deve_trocar_senha, expira_em FROM plataforma.superadmin_sessao_por_token($1)',
        [hashToken(token)],
      ),
    );
    if (!l) return null;
    return l.deve_trocar_senha ? { ...l, ...lerMarcaTemporaria(formato[1]) } : l;
  }

  /**
   * O 401 neutro com o mesmo custo de argon2 de uma conferência (`ConferenciaCustoIgual`), sem tocar o banco: o login
   * único com o código MACUXI sem o `CABECALHO_CSRF_CONFIG` (ADR 0018 §5 e §6).
   */
  recusarComCustoIgual(senha: string): Promise<never> {
    return this.custoIgual.falhar(senha, () => erros.naoAutenticado(FALHA_LOGIN_PLATAFORMA));
  }

  async sair(sessao: SessaoPlataforma): Promise<void> {
    await this.banco.comPlataforma(sessao, (tx) => tx.consultar('SELECT plataforma.superadmin_sair($1::uuid)', [sessao.sessao_id]));
  }

  /**
   * Troca a senha (só hashes vão ao banco), na mesma ordem e com os mesmos 400 do ServicoAuth.trocarSenha. Na sessão de
   * motivo 'temporaria' (T-0076), a senha atual é dispensada; `superadmin_trocar_senha` zera a temporária.
   */
  async trocarSenha(sessao: SessaoPlataforma & Pick<TrocaPendente, 'motivo_troca'>, senhaAtual: string | undefined, senhaNova: string): Promise<void> {
    const foraDaRegra = erroSenhaNova(senhaNova);
    if (foraDaRegra) throw foraDaRegra;
    await this.banco.comPlataforma(sessao, async (tx) => {
      const [l] = await tx.consultar<{ h: string | null }>('SELECT plataforma.superadmin_senha_atual() AS h');
      if (!l?.h) throw erroSenhaAtualIncorreta();
      if (sessao.motivo_troca !== 'temporaria') await exigirSenhaAtual(senhaAtual, senhaNova, l.h);
      const nova = await gerarHashSenha(senhaNova, this.cfg.argon2);
      await tx.consultar('SELECT plataforma.superadmin_trocar_senha($1, $2)', [l.h, nova]);
    });
  }
}
