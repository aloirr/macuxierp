/**
 * Repositório PostgreSQL do core sobre a `Transacao` do tenant (RLS por `app.tenant_id`; as inserções usam
 * `plataforma.tenant_atual()`). Só o schema `core` e as tabelas da plataforma que o core administra (usuário,
 * licença, auditoria, arquivo). O certificado: o app nunca lê `pfx_cifrado` nem `senha_cifrada` (ADR 0005), então o
 * SELECT de resumo lista as colunas uma a uma.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { ORIGEM_CERTIFICADO_PADRAO } from '@macuxierp/platform-sdk/certificado-origem';
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

const COLUNAS_USUARIO = 'id, nome, email::text AS email, perfil, filial_ids, ativo, external_id, ultimo_acesso_em, bloqueado_ate, updated_at';
const COLUNAS_CERTIFICADO = 'id, filial_id, titular, cnpj::text AS cnpj, valido_de, valido_ate, impressao_digital::text AS impressao_digital, ativo, origem';
const COLUNAS_EMPRESA = 'id, razao_social, nome_fantasia, cnpj::text AS cnpj, ie, fuso, updated_at';

/**
 * Concorrência otimista atômica: o token é o `updated_at` lido, com precisão de ms (o ISO do JS); o `updated_at` do banco
 * tem µs, então a comparação trunca para ms. O token vai na condição do próprio UPDATE (sem token, a escrita segue);
 * 0 linhas = alguém gravou no meio, e a rota responde 409.
 */
const igualToken = (n: number) => `date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${n}::timestamptz)`;

/** Escapa `%`, `_` e `\` para o ILIKE da busca. */
const likeSeguro = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export class RepositorioCoreSql implements RepositorioCore {
  async empresa(tx: Transacao): Promise<LinhaEmpresa | null> {
    const [e] = await tx.consultar<LinhaEmpresa>(`SELECT ${COLUNAS_EMPRESA} FROM core.empresa WHERE deleted_at IS NULL`);
    return e ?? null;
  }

  async atualizarEmpresa(tx: Transacao, d: Omit<LinhaEmpresa, 'id' | 'cnpj' | 'updated_at'>, _agora?: Date, token?: Date): Promise<LinhaEmpresa | null> {
    const [e] = await tx.consultar<LinhaEmpresa>(
      `UPDATE core.empresa SET razao_social = $1, nome_fantasia = $2, ie = $3, fuso = $4 WHERE deleted_at IS NULL AND ($5::timestamptz IS NULL OR ${igualToken(5)}) RETURNING ${COLUNAS_EMPRESA}`,
      [d.razao_social, d.nome_fantasia, d.ie, d.fuso, token ?? null],
    );
    return e ?? null;
  }

  async listarUsuarios(tx: Transacao, f: { limite: number; cursor?: string; busca?: string; inativos: boolean }): Promise<LinhaUsuario[]> {
    return tx.consultar<LinhaUsuario>(
      `SELECT ${COLUNAS_USUARIO} FROM plataforma.usuario
        WHERE deleted_at IS NULL AND ($1::boolean OR ativo)
          AND ($2::uuid IS NULL OR id > $2::uuid)
          AND ($3::text IS NULL OR nome ILIKE '%' || $3 || '%' OR email::text ILIKE '%' || $3 || '%')
        ORDER BY id LIMIT $4`,
      [f.inativos, f.cursor ?? null, f.busca ? likeSeguro(f.busca) : null, f.limite],
    );
  }

  async usuarioPorId(tx: Transacao, id: string): Promise<LinhaUsuario | null> {
    const [u] = await tx.consultar<LinhaUsuario>(`SELECT ${COLUNAS_USUARIO} FROM plataforma.usuario WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return u ?? null;
  }

  async usuarioPorEmail(tx: Transacao, email: string): Promise<LinhaUsuario | null> {
    const [u] = await tx.consultar<LinhaUsuario>(`SELECT ${COLUNAS_USUARIO} FROM plataforma.usuario WHERE email = $1 AND deleted_at IS NULL`, [email]);
    return u ?? null;
  }

  /** RN-CORE-18. Enquanto a visão global da 0079 (banco-dados) não chega, enxerga só o tenant da transação (RLS). */
  async existeEmailVivoEmOutraConta(tx: Transacao, email: string, exceto?: string): Promise<boolean> {
    const [u] = await tx.consultar<{ id: string }>(
      'SELECT id FROM plataforma.usuario WHERE lower(email::text) = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1',
      [email, exceto ?? null],
    );
    return Boolean(u);
  }

  async usuarioPorExternalId(tx: Transacao, externalId: string): Promise<LinhaUsuario | null> {
    const [u] = await tx.consultar<LinhaUsuario>(`SELECT ${COLUNAS_USUARIO} FROM plataforma.usuario WHERE external_id = $1 AND deleted_at IS NULL`, [externalId]);
    return u ?? null;
  }

  async criarUsuario(tx: Transacao, u: NovoUsuario): Promise<LinhaUsuario> {
    const [linha] = await tx.consultar<LinhaUsuario>(
      // T-0052: a senha inicial é provisória, então o primeiro acesso exige a troca.
      `INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids, ativo, external_id, deve_trocar_senha)
       VALUES ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6::uuid[], $7, $8, true) RETURNING ${COLUNAS_USUARIO}`,
      [u.id, u.email, u.nome, u.senha_hash, u.perfil, u.filial_ids, u.ativo, u.external_id],
    );
    if (!linha) throw new Error('plataforma.usuario: insert sem retorno');
    return linha;
  }

  async atualizarUsuario(tx: Transacao, id: string, p: PatchUsuario, _agora?: Date, token?: Date): Promise<LinhaUsuario | null> {
    const [linha] = await tx.consultar<LinhaUsuario>(
      `UPDATE plataforma.usuario SET
         nome = COALESCE($2, nome), perfil = COALESCE($3, perfil), filial_ids = COALESCE($4::uuid[], filial_ids),
         ativo = COALESCE($5, ativo)
       WHERE id = $1 AND deleted_at IS NULL AND ($6::timestamptz IS NULL OR ${igualToken(6)}) RETURNING ${COLUNAS_USUARIO}`,
      [id, p.nome ?? null, p.perfil ?? null, p.filial_ids ?? null, p.ativo ?? null, token ?? null],
    );
    return linha ?? null;
  }

  /** RN-CORE-17: Inativar não grava deleted_at (reversível); só o Excluir grava, e o e-mail volta a ficar livre (0078). */
  async excluirUsuario(tx: Transacao, id: string, _agora?: Date): Promise<LinhaUsuario | null> {
    const [linha] = await tx.consultar<LinhaUsuario>(
      `UPDATE plataforma.usuario SET ativo = false, deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLUNAS_USUARIO}`,
      [id],
    );
    return linha ?? null;
  }

  /** RN-CORE-13 (0048). */
  async emitirSenhaTemporaria(tx: Transacao, usuarioId: string, hash: string, expiraEm: Date): Promise<void> {
    await tx.consultar('UPDATE plataforma.usuario SET senha_temporaria_hash = $2, senha_temporaria_expira_em = $3 WHERE id = $1', [usuarioId, hash, expiraEm]);
  }
  /** RN-CORE-13 (T-0083). */
  async cancelarSenhaTemporaria(tx: Transacao, usuarioId: string): Promise<boolean> {
    const linhas = await tx.consultar<{ id: string }>(
      'UPDATE plataforma.usuario SET senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL WHERE id = $1 AND senha_temporaria_hash IS NOT NULL RETURNING id',
      [usuarioId],
    );
    return linhas.length > 0;
  }
  async definirSenha(tx: Transacao, id: string, senhaHash: string): Promise<void> {
    // Nova senha provisória também zera a trava do login; T-0052: e exige a troca no próximo acesso; 0048: e descarta a temporária.
    await tx.consultar(
      'UPDATE plataforma.usuario SET senha_hash = $2, deve_trocar_senha = true, falhas_login = 0, bloqueado_ate = NULL, senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL WHERE id = $1',
      [id, senhaHash],
    );
  }

  async travarAdministradoresAtivos(tx: Transacao): Promise<void> {
    // RN-CORE-01: trava os administradores ativos antes de contar. Ordem por id: duas transações travam na mesma ordem
    // (sem deadlock) e a segunda espera a primeira confirmar, então duas inativações simultâneas se serializam.
    await tx.consultar(`SELECT id FROM plataforma.usuario WHERE perfil = 'administrador' AND ativo AND deleted_at IS NULL ORDER BY id FOR UPDATE`);
  }

  async contarAdministradoresAtivos(tx: Transacao, exceto: string): Promise<number> {
    const [r] = await tx.consultar<{ n: string }>(
      `SELECT count(*)::text AS n FROM plataforma.usuario WHERE perfil = 'administrador' AND ativo AND deleted_at IS NULL AND id <> $1`,
      [exceto],
    );
    return Number(r?.n ?? 0);
  }

  async licencas(tx: Transacao): Promise<LinhaLicenca[]> {
    return tx.consultar<LinhaLicenca>('SELECT modulo, ativo, valido_ate FROM plataforma.tenant_modulo WHERE deleted_at IS NULL ORDER BY modulo');
  }

  async certificados(tx: Transacao, filialId?: string): Promise<LinhaCertificado[]> {
    return tx.consultar<LinhaCertificado>(
      `SELECT ${COLUNAS_CERTIFICADO} FROM core.certificado WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR filial_id = $1::uuid)
        ORDER BY ativo DESC, valido_ate DESC, id`,
      [filialId ?? null],
    );
  }

  async substituirCertificado(tx: Transacao, n: NovoCertificado, agora: Date): Promise<void> {
    await tx.consultar('UPDATE core.certificado SET ativo = false, substituido_em = $2 WHERE filial_id = $1 AND ativo AND deleted_at IS NULL', [n.filial_id, agora]);
    await tx.consultar(
      `INSERT INTO core.certificado (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital,
         pfx_cifrado, pfx_nonce, senha_cifrada, senha_nonce, chave_versao, origem)
       VALUES ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [n.id, n.filial_id, n.titular, n.cnpj, n.valido_de, n.valido_ate, n.impressao_digital, n.pfx_cifrado, n.pfx_nonce, n.senha_cifrada, n.senha_nonce, n.chave_versao, n.origem ?? ORIGEM_CERTIFICADO_PADRAO],
    );
  }

  async ambientes(tx: Transacao, filialId?: string): Promise<LinhaAmbiente[]> {
    return tx.consultar<LinhaAmbiente>(
      `SELECT filial_id, ambiente, recado_aprovacao FROM core.ambiente_fiscal
        WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR filial_id = $1::uuid) ORDER BY filial_id`,
      [filialId ?? null],
    );
  }

  async gravarAmbiente(tx: Transacao, a: LinhaAmbiente & { ambiente: 'homologacao'; alterado_por: string }): Promise<void> {
    await tx.consultar(
      `INSERT INTO core.ambiente_fiscal (tenant_id, filial_id, ambiente, recado_aprovacao, alterado_por)
       VALUES (plataforma.tenant_atual(), $1, $2, $3, $4)
       ON CONFLICT (tenant_id, filial_id) DO UPDATE
         SET ambiente = EXCLUDED.ambiente, recado_aprovacao = EXCLUDED.recado_aprovacao, alterado_por = EXCLUDED.alterado_por, deleted_at = NULL`,
      [a.filial_id, a.ambiente, a.recado_aprovacao, a.alterado_por],
    );
  }

  async auditoria(tx: Transacao, f: { entidade?: string; usuario_id?: string; de?: Date; ate?: Date; limite: number; cursor?: string }): Promise<LinhaAuditoria[]> {
    return tx.consultar<LinhaAuditoria>(
      `SELECT id, usuario_id, acao, entidade, entidade_id::text AS entidade_id, antes, depois, ocorrido_em FROM plataforma.auditoria
        WHERE ($1::text IS NULL OR entidade = $1) AND ($2::timestamptz IS NULL OR ocorrido_em >= $2)
          AND ($3::timestamptz IS NULL OR ocorrido_em <= $3) AND ($4::uuid IS NULL OR id > $4::uuid)
          AND ($6::uuid IS NULL OR usuario_id = $6::uuid)
        ORDER BY id LIMIT $5`,
      [f.entidade ?? null, f.de ?? null, f.ate ?? null, f.cursor ?? null, f.limite, f.usuario_id ?? null],
    );
  }

  async criarExportacao(tx: Transacao, id: string, pedidoPor: string): Promise<LinhaExportacao> {
    const [e] = await tx.consultar<LinhaExportacao>(
      `INSERT INTO core.exportacao (id, tenant_id, pedido_por) VALUES ($1, plataforma.tenant_atual(), $2)
       RETURNING id, estado, arquivo_id, concluida_em, expira_em`,
      [id, pedidoPor],
    );
    if (!e) throw new Error('core.exportacao: insert sem retorno');
    return e;
  }

  async exportacao(tx: Transacao, id: string): Promise<LinhaExportacao | null> {
    const [e] = await tx.consultar<LinhaExportacao>('SELECT id, estado, arquivo_id, concluida_em, expira_em FROM core.exportacao WHERE id = $1 AND deleted_at IS NULL', [id]);
    return e ?? null;
  }

  async chaveDoArquivo(tx: Transacao, arquivoId: string): Promise<string | null> {
    const [a] = await tx.consultar<{ chave_s3: string }>('SELECT chave_s3 FROM plataforma.arquivo WHERE id = $1', [arquivoId]);
    return a?.chave_s3 ?? null;
  }

  async parametros(tx: Transacao): Promise<{ chave: string; valor: unknown }[]> {
    return tx.consultar('SELECT chave, valor FROM core.parametro WHERE deleted_at IS NULL ORDER BY chave');
  }

  async gravarParametro(tx: Transacao, chave: string, valor: unknown): Promise<string> {
    const [p] = await tx.consultar<{ id: string }>(
      `INSERT INTO core.parametro (tenant_id, chave, valor) VALUES (plataforma.tenant_atual(), $1, $2::jsonb)
       ON CONFLICT (tenant_id, chave) DO UPDATE SET valor = EXCLUDED.valor, deleted_at = NULL RETURNING id`,
      [chave, JSON.stringify(valor)],
    );
    if (!p) throw new Error('core.parametro: upsert sem retorno');
    return p.id;
  }
}
