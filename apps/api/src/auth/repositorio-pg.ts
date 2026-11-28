/**
 * `RepositorioAuth` no PostgreSQL (migrações 0002 e 0004 do `db/`). Tudo roda na transação do `BancoPg` no papel
 * `macuxierp_app`: o login acha a conta por `plataforma.conta_por_email()` (0079, ADR 0021; sem tenant na transação) e o
 * resto passa pela RLS do tenant (`app.tenant_id`). O e-mail chega normalizado (minúsculas, sem espaços), como a tabela guarda.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { ContaPorEmail, FilialAuth, RepositorioAuth, SessaoRefresh, TenantAuth, UsuarioAuth } from './portas';

const USUARIO = `id, tenant_id, nome, email, senha_hash, perfil, filial_ids, ativo, falhas_login, bloqueado_ate, deve_trocar_senha,
  senha_temporaria_hash, senha_temporaria_expira_em`;
const SESSAO = 'id, tenant_id, usuario_id, familia, refresh_hash, expira_em, revogada_em';

/** Linha crua da `plataforma.conta_por_email` (0079): `suspensa` boolean ou, conforme a versão da função, `situacao_tenant`. */
export interface LinhaContaPorEmail {
  tipo: unknown;
  tenant_id: unknown;
  suspensa?: unknown;
  situacao_tenant?: unknown;
}

/**
 * Mapeia a linha da `conta_por_email` para a `ContaPorEmail`. Aceita os dois formatos da coluna da empresa suspensa
 * (`suspensa = true` ou `situacao_tenant = 'suspensa'`); linha fora do formato (tipo desconhecido, usuário sem tenant) =
 * nenhuma conta, que dá a mesma falha neutra do e-mail inexistente.
 */
export function contaDaLinha(l: LinhaContaPorEmail | null | undefined): ContaPorEmail | null {
  if (!l) return null;
  if (l.tipo === 'superadmin') return { tipo: 'superadmin', tenant_id: null, suspensa: false };
  if (l.tipo !== 'usuario' || typeof l.tenant_id !== 'string' || l.tenant_id === '') return null;
  return { tipo: 'usuario', tenant_id: l.tenant_id, suspensa: l.suspensa === true || l.situacao_tenant === 'suspensa' };
}

const primeira = async <L>(linhas: Promise<L[]>): Promise<L | null> => (await linhas)[0] ?? null;

export class RepositorioAuthPg implements RepositorioAuth {
  async contaPorEmail(tx: Transacao, email: string) {
    // A 0079 devolve no máximo uma linha de cada tipo, o usuário antes do superadmin (ADR 0021 §7, opção A); a ordem e o
    // LIMIT aqui garantem a regra mesmo se a função devolver as duas.
    const sql = "SELECT * FROM plataforma.conta_por_email($1) ORDER BY (tipo = 'usuario') DESC LIMIT 1";
    return contaDaLinha(await primeira(tx.consultar<LinhaContaPorEmail>(sql, [email])));
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

  /**
   * Consumo atômico e de uso único (T-0076): no READ COMMITTED, quem perde a corrida espera o lock, reavalia o WHERE
   * na linha nova, vê o hash nulo e sai sem linha. Zera também a trava (hotfix).
   */
  async consumirTemporaria(tx: Transacao, usuarioId: string) {
    const linhas = await tx.consultar<{ id: string }>(
      `UPDATE plataforma.usuario SET senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL, deve_trocar_senha = true,
          falhas_login = 0, bloqueado_ate = NULL
        WHERE id = $1 AND senha_temporaria_hash IS NOT NULL AND senha_temporaria_expira_em > now()
        RETURNING id`,
      [usuarioId],
    );
    return linhas.length === 1;
  }

  async trocarSenha(tx: Transacao, usuarioId: string, senhaHash: string) {
    await tx.consultar(
      'UPDATE plataforma.usuario SET senha_hash = $2, deve_trocar_senha = false, senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL WHERE id = $1',
      [usuarioId, senhaHash],
    );
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
