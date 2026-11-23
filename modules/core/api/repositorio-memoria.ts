/** Repositório em memória para os testes de rota (o `BancoMemoria` do SDK não executa SQL). Não entra em produção. */
import type { Transacao } from '@macuxierp/platform-sdk';
import type {
  LinhaAmbiente,
  LinhaAuditoria,
  LinhaCertificado,
  LinhaEmpresa,
  LinhaExportacao,
  LinhaLicenca,
  LinhaUsuario,
  PatchUsuario,
  NovoCertificado,
  NovoUsuario,
  RepositorioCore,
} from './portas';

export class RepositorioCoreMemoria implements RepositorioCore {
  empresaLinha: LinhaEmpresa | null = null;
  usuarios: (LinhaUsuario & { senha_hash: string })[] = [];
  licencasLinhas: LinhaLicenca[] = [];
  certificadosLinhas: (LinhaCertificado & Partial<NovoCertificado>)[] = [];
  ambientesLinhas: (LinhaAmbiente & { alterado_por?: string })[] = [];
  auditoriaLinhas: LinhaAuditoria[] = [];
  exportacoes: LinhaExportacao[] = [];
  arquivos = new Map<string, string>();
  parametrosLinhas = new Map<string, unknown>();

  async empresa(): Promise<LinhaEmpresa | null> {
    return this.empresaLinha;
  }
  async atualizarEmpresa(_tx: Transacao, dados: Omit<LinhaEmpresa, 'id' | 'cnpj' | 'updated_at'>, agora: Date, token?: Date): Promise<LinhaEmpresa | null> {
    if (!this.empresaLinha) throw new Error('sem empresa');
    if (token && token.getTime() !== this.empresaLinha.updated_at.getTime()) return null;
    this.empresaLinha = { ...this.empresaLinha, ...dados, updated_at: agora };
    return this.empresaLinha;
  }

  async listarUsuarios(_tx: Transacao, f: { limite: number; cursor?: string; busca?: string; inativos: boolean }): Promise<LinhaUsuario[]> {
    const busca = f.busca?.toLowerCase();
    return this.usuarios
      .filter((u) => (f.inativos ? true : u.ativo))
      .filter((u) => !busca || u.nome.toLowerCase().includes(busca) || u.email.includes(busca))
      .filter((u) => !f.cursor || u.id > f.cursor)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, f.limite);
  }
  async usuarioPorId(_tx: Transacao, id: string): Promise<LinhaUsuario | null> {
    return this.usuarios.find((u) => u.id === id) ?? null;
  }
  async usuarioPorEmail(_tx: Transacao, email: string): Promise<LinhaUsuario | null> {
    return this.usuarios.find((u) => u.email === email) ?? null;
  }
  async usuarioPorExternalId(_tx: Transacao, externalId: string): Promise<LinhaUsuario | null> {
    return this.usuarios.find((u) => u.external_id === externalId) ?? null;
  }
  async criarUsuario(_tx: Transacao, u: NovoUsuario, agora: Date): Promise<LinhaUsuario> {
    const linha = { ...u, ultimo_acesso_em: null, updated_at: agora, deve_trocar_senha: true };
    this.usuarios.push(linha);
    return linha;
  }
  async atualizarUsuario(_tx: Transacao, id: string, patch: PatchUsuario, agora: Date, token?: Date): Promise<LinhaUsuario | null> {
    const u = this.usuarios.find((x) => x.id === id);
    if (!u) throw new Error('sem usuário');
    if (token && token.getTime() !== u.updated_at.getTime()) return null;
    Object.assign(u, patch, { updated_at: agora });
    return u;
  }
  async definirSenha(_tx: Transacao, id: string, senhaHash: string, agora: Date): Promise<void> {
    const u = this.usuarios.find((x) => x.id === id);
    if (u) Object.assign(u, { senha_hash: senhaHash, deve_trocar_senha: true, updated_at: agora });
  }
  /** Registra a ordem das chamadas para o teste de RN-CORE-01 (trava antes da contagem). */
  chamadasAdministradores: string[] = [];
  async travarAdministradoresAtivos(): Promise<void> {
    this.chamadasAdministradores.push('travar');
  }
  async contarAdministradoresAtivos(_tx: Transacao, exceto: string): Promise<number> {
    this.chamadasAdministradores.push('contar');
    return this.usuarios.filter((u) => u.id !== exceto && u.perfil === 'administrador' && u.ativo).length;
  }

  async licencas(): Promise<LinhaLicenca[]> {
    return this.licencasLinhas;
  }

  async certificados(_tx: Transacao, filialId?: string): Promise<LinhaCertificado[]> {
    return this.certificadosLinhas.filter((c) => !filialId || c.filial_id === filialId);
  }
  async substituirCertificado(_tx: Transacao, novo: NovoCertificado): Promise<void> {
    for (const c of this.certificadosLinhas) if (c.filial_id === novo.filial_id) c.ativo = false;
    this.certificadosLinhas.push({ ...novo, ativo: true });
  }

  async ambientes(_tx: Transacao, filialId?: string): Promise<LinhaAmbiente[]> {
    return this.ambientesLinhas.filter((a) => !filialId || a.filial_id === filialId);
  }
  async gravarAmbiente(_tx: Transacao, a: LinhaAmbiente & { ambiente: 'homologacao'; alterado_por: string }): Promise<void> {
    // Imita a RLS do banco (0008): o app só grava homologação (RN-CORE-08, ADR 0006).
    if ((a.ambiente as string) !== 'homologacao') throw new Error('RLS: o app só grava ambiente fiscal em homologação');
    this.ambientesLinhas = this.ambientesLinhas.filter((x) => x.filial_id !== a.filial_id);
    this.ambientesLinhas.push(a);
  }

  async auditoria(_tx: Transacao, f: { entidade?: string; de?: Date; ate?: Date; limite: number; cursor?: string }): Promise<LinhaAuditoria[]> {
    return this.auditoriaLinhas
      .filter((a) => !f.entidade || a.entidade === f.entidade)
      .filter((a) => !f.de || a.ocorrido_em >= f.de)
      .filter((a) => !f.ate || a.ocorrido_em <= f.ate)
      .filter((a) => !f.cursor || a.id > f.cursor)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, f.limite);
  }

  async criarExportacao(_tx: Transacao, id: string): Promise<LinhaExportacao> {
    const e: LinhaExportacao = { id, estado: 'pendente', arquivo_id: null, concluida_em: null, expira_em: null };
    this.exportacoes.push(e);
    return e;
  }
  async exportacao(_tx: Transacao, id: string): Promise<LinhaExportacao | null> {
    return this.exportacoes.find((e) => e.id === id) ?? null;
  }
  async chaveDoArquivo(_tx: Transacao, arquivoId: string): Promise<string | null> {
    return this.arquivos.get(arquivoId) ?? null;
  }

  async parametros(): Promise<{ chave: string; valor: unknown }[]> {
    return [...this.parametrosLinhas].map(([chave, valor]) => ({ chave, valor }));
  }
  async gravarParametro(_tx: Transacao, chave: string, valor: unknown): Promise<string> {
    this.parametrosLinhas.set(chave, valor);
    return `00000000-0000-4000-8000-${String(this.parametrosLinhas.size).padStart(12, '0')}`;
  }
}
