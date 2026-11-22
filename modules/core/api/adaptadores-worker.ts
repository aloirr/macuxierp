/**
 * Adaptadores SQL do core para as portas do worker (T-0035 e T-0040). Mesmas assinaturas das portas de
 * `apps/worker/src/alerta-a1.ts` e `exportacao-lgpd.ts`, por forma estrutural: o core não importa `apps/worker`
 * (fronteira, regra 1). Cada função roda na `Transacao` que o worker abre (`comTenant`, RLS do tenant), exceto
 * `tenantsAtivos`, que roda em `semTenant`.
 *
 * Segredos (regras 8 e 9): nenhuma consulta daqui lê `pfx_cifrado`, `senha_cifrada`, nonce, `senha_hash` nem token.
 * As colunas são listadas uma a uma, então a coluna sensível nem sai do banco. Nada é logado.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { ExportacaoEstado } from '../contracts';

/** Espelha `CertificadoVencendo` do worker. */
export interface CertificadoVencendoLinha {
  id: string;
  filial_id: string;
  valido_ate: Date;
}

/** Aviso do A1: espelha `AvisoA1` do worker e é o que o BKO lê (selo do `GET /v1/auth/eu`). `dia` é `AAAA-MM-DD` em UTC. */
export interface AvisoA1 {
  certificado_id: string;
  filial_id: string;
  valido_ate: Date;
  dias: number;
  dia: string;
}

/** `FonteTenants` do worker: roda em `semTenant`, pela função `plataforma.tenants_ativos()` (só os ids). */
export const fonteTenantsSql = {
  async ativos(tx: Transacao): Promise<string[]> {
    const linhas = await tx.consultar<{ id: string }>('SELECT t AS id FROM plataforma.tenants_ativos() t');
    return linhas.map((l) => l.id);
  },
};

/**
 * `FonteCertificados` do worker. `valido_ate < limite` (exclusivo; o limite vem do worker).
 * A rotina ainda confere cada linha com `alertaVencimento`.
 */
export const fonteCertificadosSql = {
  async vencendoAte(tx: Transacao, limite: Date): Promise<CertificadoVencendoLinha[]> {
    return tx.consultar<CertificadoVencendoLinha>(
      'SELECT id, filial_id, valido_ate FROM core.certificado WHERE ativo AND deleted_at IS NULL AND valido_ate < $1 ORDER BY valido_ate, id',
      [limite],
    );
  },
};

/** `DestinoAvisos` do worker: idempotente por `(tenant, certificado, dia UTC)`; `false` quando o aviso do dia já existia. */
export const destinoAvisosSql = {
  async registrarA1(tx: Transacao, a: AvisoA1): Promise<boolean> {
    const linhas = await tx.consultar<{ id: string }>(
      `INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia)
       VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5::date)
       ON CONFLICT (tenant_id, certificado_id, dia) DO NOTHING RETURNING id`,
      [a.certificado_id, a.filial_id, a.valido_ate, a.dias, a.dia],
    );
    return linhas.length > 0;
  },
};

/**
 * Leitura do selo do BKO: os avisos do `dia` (`AAAA-MM-DD`, UTC) dos certificados ativos e não excluídos (um A1 já
 * trocado não acende o selo), um por filial (RLS). A API do `/v1/auth/eu` chama isto quando o contrato ganhar o campo.
 */
export async function avisosA1MaisRecentes(tx: Transacao, dia: string): Promise<AvisoA1[]> {
  return tx.consultar<AvisoA1>(
    `SELECT DISTINCT ON (a.filial_id) a.filial_id, a.certificado_id, a.valido_ate, a.dias, to_char(a.dia, 'YYYY-MM-DD') AS dia
       FROM core.aviso_a1 a JOIN core.certificado c ON c.id = a.certificado_id AND c.ativo AND c.deleted_at IS NULL
      WHERE a.deleted_at IS NULL AND a.dia = $1::date ORDER BY a.filial_id, a.created_at DESC`,
    [dia],
  );
}

/** `RegistroExportacoes` do worker sobre `core.exportacao`. */
export const registroExportacoesSql = {
  async estado(tx: Transacao, id: string): Promise<ExportacaoEstado | null> {
    const [e] = await tx.consultar<{ estado: ExportacaoEstado }>('SELECT estado FROM core.exportacao WHERE id = $1 AND deleted_at IS NULL', [id]);
    return e?.estado ?? null;
  },
  /** Só sai de pendente ou gerando (nunca regrava uma exportação já pronta). */
  async concluir(tx: Transacao, id: string, arquivoId: string, agora: Date): Promise<void> {
    await tx.consultar(
      `UPDATE core.exportacao SET estado = 'pronta', arquivo_id = $2, concluida_em = $3, updated_at = $3
        WHERE id = $1 AND deleted_at IS NULL AND estado IN ('pendente', 'gerando')`,
      [id, arquivoId, agora],
    );
  },
  async falhar(tx: Transacao, id: string, agora: Date): Promise<void> {
    await tx.consultar(
      `UPDATE core.exportacao SET estado = 'falhou', updated_at = $2
        WHERE id = $1 AND deleted_at IS NULL AND estado IN ('pendente', 'gerando')`,
      [id, agora],
    );
  },
};

/**
 * `ExportadorModulo` do core (RF-CORE-06, RN-CORE-07): as tabelas do core do tenant e o que o core administra na
 * plataforma (usuários, licenças, auditoria), como linhas JSON. Fora do arquivo, por construção: `senha_hash`, contadores
 * de login, sessão e refresh token, `.pfx` e senha do A1 cifrados, nonces. O certificado sai só como resumo.
 */
export const exportadorCore = {
  modulo: 'core' as const,
  async exportar(tx: Transacao): Promise<Record<string, readonly unknown[]>> {
    const q = (sql: string) => tx.consultar(sql);
    return {
      empresa: await q('SELECT id, razao_social, nome_fantasia, cnpj::text AS cnpj, ie, fuso, created_at, updated_at, external_id FROM core.empresa WHERE deleted_at IS NULL ORDER BY id'),
      certificado: await q(
        `SELECT id, filial_id, titular, cnpj::text AS cnpj, valido_de, valido_ate, impressao_digital::text AS impressao_digital, ativo, substituido_em, created_at, updated_at, external_id
           FROM core.certificado WHERE deleted_at IS NULL ORDER BY id`,
      ),
      ambiente_fiscal: await q('SELECT id, filial_id, ambiente, recado_aprovacao, alterado_por, created_at, updated_at, external_id FROM core.ambiente_fiscal WHERE deleted_at IS NULL ORDER BY id'),
      parametro: await q('SELECT id, chave, valor, created_at, updated_at, external_id FROM core.parametro WHERE deleted_at IS NULL ORDER BY id'),
      aviso_a1: await q("SELECT id, certificado_id, filial_id, valido_ate, dias, to_char(dia, 'YYYY-MM-DD') AS dia, created_at FROM core.aviso_a1 WHERE deleted_at IS NULL ORDER BY id"),
      exportacao: await q('SELECT id, estado, pedido_por, concluida_em, expira_em, created_at, updated_at FROM core.exportacao WHERE deleted_at IS NULL ORDER BY id'),
      usuario: await q(
        `SELECT id, nome, email::text AS email, perfil, filial_ids, ativo, ultimo_acesso_em, created_at, updated_at, external_id
           FROM plataforma.usuario WHERE deleted_at IS NULL ORDER BY id`,
      ),
      licenca: await q('SELECT modulo, ativo, valido_ate FROM plataforma.tenant_modulo WHERE deleted_at IS NULL ORDER BY modulo'),
      auditoria: await q('SELECT id, usuario_id, acao, entidade, entidade_id, antes, depois, ocorrido_em FROM plataforma.auditoria WHERE deleted_at IS NULL ORDER BY ocorrido_em, id'),
    };
  },
};
