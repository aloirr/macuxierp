/**
 * Porta de identidade (desenho T-0002, D1 e D2): `plataforma.tenant`, `plataforma.usuario` e `plataforma.sessao`.
 * Adaptador PostgreSQL: `RepositorioAuthPg`; testes de unidade: `RepositorioAuthMemoria`.
 *
 * `tenantIdPorSlug` roda em `banco.semTenant` (o login ainda não conhece o tenant): no banco, a função
 * `plataforma.tenant_por_slug()` (`SECURITY DEFINER`), que devolve só o id do tenant ativo. O resto roda em
 * `banco.comTenant` (RLS).
 * `filiaisPorIds` alimenta o `GET /v1/auth/eu` (nome e CNPJ das filiais do usuário): no banco, a visão
 * `cadastros.filial_resumo` (`security_invoker`, a RLS da filial vale).
 */
import type { Perfil, Transacao } from '@macuxierp/platform-sdk';

export interface TenantAuth {
  id: string;
  slug: string;
  /** `plataforma.tenant.nome` (a plataforma não lê `core.empresa`). */
  razao_social: string;
  fuso: string;
  situacao: 'ativo' | 'suspenso' | 'encerrado';
}

export interface UsuarioAuth {
  id: string;
  tenant_id: string;
  nome: string;
  email: string;
  senha_hash: string;
  perfil: Perfil;
  filial_ids: string[];
  ativo: boolean;
  falhas_login: number;
  bloqueado_ate: Date | null;
  /** Senha provisória (portal `/config` ou operador): troca obrigatória antes de qualquer rota (T-0052, 0036). */
  deve_trocar_senha: boolean;
  /** Hash argon2id da senha temporária do "Esqueci a senha" (T-0076, 0048); `null`/ausente = nenhuma. */
  senha_temporaria_hash?: string | null;
  /** Vencimento da temporária (72 h); consumida = as duas colunas nulas. */
  senha_temporaria_expira_em?: Date | null;
}

export interface FilialAuth {
  id: string;
  tenant_id: string;
  /** Nome fantasia ou, sem ele, a razão social da filial. */
  nome: string;
  cnpj: string;
}

export interface SessaoRefresh {
  id: string;
  tenant_id: string;
  usuario_id: string;
  /** Família de rotação: o refresh reutilizado revoga a família inteira. */
  familia: string;
  /** SHA-256 (hex) do refresh; o valor em claro só existe no cookie. */
  refresh_hash: string;
  expira_em: Date;
  revogada_em: Date | null;
}

export interface RepositorioAuth {
  /** Id do tenant ativo com esse slug; suspenso, encerrado ou inexistente = `null`. */
  tenantIdPorSlug(tx: Transacao, slug: string): Promise<string | null>;
  tenantPorId(tx: Transacao, id: string): Promise<TenantAuth | null>;
  usuarioPorEmail(tx: Transacao, email: string): Promise<UsuarioAuth | null>;
  usuarioPorId(tx: Transacao, id: string): Promise<UsuarioAuth | null>;
  /** Filiais do tenant com esses ids (as do usuário), na ordem dos ids; id sem filial fica de fora. */
  filiaisPorIds(tx: Transacao, ids: readonly string[]): Promise<FilialAuth[]>;
  registrarFalha(tx: Transacao, usuarioId: string, falhas: number, bloqueadoAte: Date | null): Promise<void>;
  /** Zera as falhas, solta a trava e grava `ultimo_acesso_em`. */
  registrarAcesso(tx: Transacao, usuarioId: string, agora: Date): Promise<void>;
  criarSessao(tx: Transacao, sessao: SessaoRefresh): Promise<void>;
  sessaoPorHash(tx: Transacao, refreshHash: string): Promise<SessaoRefresh | null>;
  revogarSessao(tx: Transacao, id: string, agora: Date): Promise<void>;
  revogarFamilia(tx: Transacao, familia: string, agora: Date): Promise<void>;
  /**
   * Consome a senha temporária de forma atômica e de uso único (T-0076): zera as duas colunas e liga `deve_trocar_senha`
   * só se ainda há temporária vigente. `false` = perdeu a corrida, venceu ou já foi usada. A senha atual não muda.
   */
  consumirTemporaria(tx: Transacao, usuarioId: string): Promise<boolean>;
  /** Grava o hash novo e zera `deve_trocar_senha` e a senha temporária (troca pelo próprio usuário, T-0052, T-0076). */
  trocarSenha(tx: Transacao, usuarioId: string, senhaHash: string): Promise<void>;
  /** Revoga as sessões abertas do usuário, menos as da família `exceto` (`null` = todas); devolve quantas caíram. */
  revogarOutrasSessoes(tx: Transacao, usuarioId: string, exceto: string | null, agora: Date): Promise<number>;
}
