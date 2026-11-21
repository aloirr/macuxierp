/**
 * Porta de identidade (desenho T-0002, D1 e D2): `plataforma.tenant`, `plataforma.usuario` e `plataforma.sessao`.
 * O adaptador PostgreSQL entra depois do schema `plataforma` da T-0003; os testes usam `RepositorioAuthMemoria`.
 *
 * `tenantPorSlug` roda em `banco.semTenant` (o login ainda não conhece o tenant): no banco, uma função
 * `SECURITY DEFINER` que devolve só id, razão social, fuso e situação do slug (pedido ao banco-dados, T-0003).
 * O resto roda em `banco.comTenant` (RLS).
 * `filiaisPorIds` alimenta o `GET /v1/auth/eu` (nome e CNPJ das filiais do usuário): no banco, uma visão só de
 * leitura de `cadastros.filial` com id, nome e CNPJ (pedido ao banco-dados, T-0003).
 */
import type { Perfil, Transacao } from '@macuxierp/platform-sdk';

export interface TenantAuth {
  id: string;
  slug: string;
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
  tenantPorSlug(tx: Transacao, slug: string): Promise<TenantAuth | null>;
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
}
