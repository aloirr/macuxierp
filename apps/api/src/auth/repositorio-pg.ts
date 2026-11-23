/**
 * `RepositorioAuth` no PostgreSQL (migrações 0002 e 0004 do `db/`). Tudo roda na transação do `BancoPg` no papel
 * `macuxierp_app`: o login acha o tenant por `plataforma.tenant_por_slug()` (sem tenant na transação) e o resto passa
 * pela RLS do tenant (`app.tenant_id`). O e-mail chega normalizado (minúsculas, sem espaços), como a tabela guarda.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { FilialAuth, RepositorioAuth, SessaoRefresh, TenantAuth, UsuarioAuth } from './portas';

const USUARIO = 'id, tenant_id, nome, email, senha_hash, perfil, filial_ids, ativo, falhas_login, bloqueado_ate, deve_trocar_senha';
const SESSAO = 'id, tenant_id, usuario_id, familia, refresh_hash, expira_em, revogada_em';

const primeira = async <L>(linhas: Promise<L[]>): Promise<L | null> => (await linhas)[0] ?? null;

export class RepositorioAuthPg implements RepositorioAuth {
  async tenantIdPorSlug(tx: Transacao, slug: string) {
    return (await primeira(tx.consultar<{ id: string | null }>('SELECT plataforma.tenant_por_slug($1) AS id', [slug])))?.id ?? null;
  }

  tenantPorId(tx: Transacao, id: string) {
    return primeira(
      tx.consultar<TenantAuth>(
        'SELECT id, slug, nome AS razao_social, fuso, situacao FROM plataforma.tenant WHERE id = $1 AND deleted_at IS NULL',
        [id],
      ),
    );
  }

  usuarioPorEmail(tx: Transacao, email: string) {
    return primeira(tx.consultar<UsuarioAuth>(`SELECT ${USUARIO} FROM plataforma.usuario WHERE email = $1 AND deleted_at IS NULL`, [email]));
  }

  usuarioPorId(tx: Transacao, id: string) {
    return primeira(tx.consultar<UsuarioAuth>(`SELECT ${USUARIO} FROM plataforma.usuario WHERE id = $1 AND deleted_at IS NULL`, [id]));
  }

  async filiaisPorIds(tx: Transacao, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const linhas = await tx.consultar<FilialAuth>('SELECT id, tenant_id, nome, cnpj FROM cadastros.filial_resumo WHERE id = ANY($1::uuid[])', [ids]);
    return ids.flatMap((id) => linhas.filter((f) => f.id === id));
  }

  async registrarFalha(tx: Transacao, usuarioId: string, falhas: number, bloqueadoAte: Date | null) {
    await tx.consultar('UPDATE plataforma.usuario SET falhas_login = $2, bloqueado_ate = $3 WHERE id = $1', [usuarioId, falhas, bloqueadoAte]);
  }

  async registrarAcesso(tx: Transacao, usuarioId: string, agora: Date) {
    await tx.consultar('UPDATE plataforma.usuario SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso_em = $2 WHERE id = $1', [usuarioId, agora]);
  }

  async criarSessao(tx: Transacao, s: SessaoRefresh) {
    await tx.consultar(
      `INSERT INTO plataforma.sessao (${SESSAO}) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.id, s.tenant_id, s.usuario_id, s.familia, s.refresh_hash, s.expira_em, s.revogada_em],
    );
  }

  sessaoPorHash(tx: Transacao, refreshHash: string) {
    return primeira(tx.consultar<SessaoRefresh>(`SELECT ${SESSAO} FROM plataforma.sessao WHERE refresh_hash = $1`, [refreshHash]));
  }

  async revogarSessao(tx: Transacao, id: string, agora: Date) {
    await tx.consultar('UPDATE plataforma.sessao SET revogada_em = $2 WHERE id = $1 AND revogada_em IS NULL', [id, agora]);
  }

  async revogarFamilia(tx: Transacao, familia: string, agora: Date) {
    await tx.consultar('UPDATE plataforma.sessao SET revogada_em = $2 WHERE familia = $1 AND revogada_em IS NULL', [familia, agora]);
  }

  async trocarSenha(tx: Transacao, usuarioId: string, senhaHash: string) {
    await tx.consultar('UPDATE plataforma.usuario SET senha_hash = $2, deve_trocar_senha = false WHERE id = $1', [usuarioId, senhaHash]);
  }

  async revogarOutrasSessoes(tx: Transacao, usuarioId: string, exceto: string | null, agora: Date) {
    const linhas = await tx.consultar<{ id: string }>(
      `UPDATE plataforma.sessao SET revogada_em = $3
       WHERE usuario_id = $1 AND revogada_em IS NULL AND ($2::uuid IS NULL OR familia <> $2::uuid) RETURNING id`,
      [usuarioId, exceto, agora],
    );
    return linhas.length;
  }
}
