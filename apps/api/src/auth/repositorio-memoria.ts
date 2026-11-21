/** `RepositorioAuth` em memória, para os testes de unidade até o adaptador PostgreSQL (depois da T-0003). */
import { tenantDaTx } from '@macuxierp/platform-sdk/testes';
import type { Transacao } from '@macuxierp/platform-sdk';
import type { FilialAuth, RepositorioAuth, SessaoRefresh, TenantAuth, UsuarioAuth } from './portas';

export class RepositorioAuthMemoria implements RepositorioAuth {
  readonly tenants: TenantAuth[] = [];
  readonly usuarios: UsuarioAuth[] = [];
  readonly filiais: FilialAuth[] = [];
  readonly sessoes: SessaoRefresh[] = [];

  /** Simula a RLS: com tenant na transação, só enxerga as linhas dele. */
  private visivel<T extends { tenant_id: string }>(tx: Transacao, linhas: T[]): T[] {
    const t = tenantDaTx(tx);
    if (t === null) throw new Error('consulta de tabela com RLS fora de comTenant');
    return linhas.filter((l) => l.tenant_id === t);
  }

  private usuario(tx: Transacao, id: string): UsuarioAuth {
    const u = this.visivel(tx, this.usuarios).find((x) => x.id === id);
    if (!u) throw new Error('usuário fora do tenant');
    return u;
  }

  async tenantPorSlug(_tx: Transacao, slug: string) {
    return this.tenants.find((t) => t.slug === slug) ?? null;
  }
  async tenantPorId(tx: Transacao, id: string) {
    return tenantDaTx(tx) === id ? (this.tenants.find((t) => t.id === id) ?? null) : null;
  }
  async usuarioPorEmail(tx: Transacao, email: string) {
    return this.visivel(tx, this.usuarios).find((u) => u.email.toLowerCase() === email) ?? null;
  }
  async usuarioPorId(tx: Transacao, id: string) {
    return this.visivel(tx, this.usuarios).find((u) => u.id === id) ?? null;
  }
  async filiaisPorIds(tx: Transacao, ids: readonly string[]) {
    const visiveis = this.visivel(tx, this.filiais);
    return ids.flatMap((id) => visiveis.filter((f) => f.id === id));
  }
  async registrarFalha(tx: Transacao, usuarioId: string, falhas: number, bloqueadoAte: Date | null) {
    Object.assign(this.usuario(tx, usuarioId), { falhas_login: falhas, bloqueado_ate: bloqueadoAte });
  }
  async registrarAcesso(tx: Transacao, usuarioId: string) {
    Object.assign(this.usuario(tx, usuarioId), { falhas_login: 0, bloqueado_ate: null });
  }
  async criarSessao(tx: Transacao, sessao: SessaoRefresh) {
    if (tenantDaTx(tx) !== sessao.tenant_id) throw new Error('sessão fora do tenant');
    this.sessoes.push({ ...sessao });
  }
  async sessaoPorHash(tx: Transacao, refreshHash: string) {
    return this.visivel(tx, this.sessoes).find((s) => s.refresh_hash === refreshHash) ?? null;
  }
  async revogarSessao(tx: Transacao, id: string, agora: Date) {
    for (const s of this.visivel(tx, this.sessoes)) if (s.id === id && !s.revogada_em) s.revogada_em = agora;
  }
  async revogarFamilia(tx: Transacao, familia: string, agora: Date) {
    for (const s of this.visivel(tx, this.sessoes)) if (s.familia === familia && !s.revogada_em) s.revogada_em = agora;
  }
}
