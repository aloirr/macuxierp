/** `RepositorioAuth` em memória, para os testes de unidade (no banco: `RepositorioAuthPg`). */
import { tenantDaTx } from '@macuxierp/platform-sdk/testes';
import type { Transacao } from '@macuxierp/platform-sdk';
import type { FilialAuth, RepositorioAuth, SessaoRefresh, TenantAuth, UsuarioAuth } from './portas';

export class RepositorioAuthMemoria implements RepositorioAuth {
  readonly tenants: TenantAuth[] = [];
  readonly usuarios: UsuarioAuth[] = [];
  readonly filiais: FilialAuth[] = [];
  readonly sessoes: SessaoRefresh[] = [];

  /** O `now()` do banco no consumo da temporária; os testes ligam ao `RelogioFixo`. */
  constructor(readonly agora: () => Date = () => new Date()) {}

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

  async tenantIdPorSlug(_tx: Transacao, slug: string) {
    return this.tenants.find((t) => t.slug === slug && t.situacao === 'ativo')?.id ?? null;
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
  /** Como o UPDATE do Pg (T-0076): zera as duas colunas e liga a troca obrigatória, só com a temporária vigente. */
  async consumirTemporaria(tx: Transacao, usuarioId: string) {
    const u = this.usuario(tx, usuarioId);
    if (!u.senha_temporaria_hash || !u.senha_temporaria_expira_em || u.senha_temporaria_expira_em.getTime() <= this.agora().getTime()) return false;
    Object.assign(u, { senha_temporaria_hash: null, senha_temporaria_expira_em: null, deve_trocar_senha: true });
    return true;
  }
  async trocarSenha(tx: Transacao, usuarioId: string, senhaHash: string) {
    Object.assign(this.usuario(tx, usuarioId), { senha_hash: senhaHash, deve_trocar_senha: false, senha_temporaria_hash: null, senha_temporaria_expira_em: null });
  }
  async revogarOutrasSessoes(tx: Transacao, usuarioId: string, exceto: string | null, agora: Date) {
    let n = 0;
    for (const s of this.visivel(tx, this.sessoes)) {
      if (s.usuario_id !== usuarioId || s.revogada_em || s.familia === exceto) continue;
      s.revogada_em = agora;
      n++;
    }
    return n;
  }
}
