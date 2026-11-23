/**
 * Adaptador SQL do `RepositorioPlataforma` (ADR 0012, seção 4): chama só as funções SECURITY DEFINER de lista fechada da
 * 0033, dentro da transação de plataforma (`BancoPlataforma.comPlataforma`: papel `macuxierp_config` e a sessão do
 * superadmin na configuração local). Nenhum SELECT em tabela: o banco revalida a sessão e grava a auditoria.
 * O unique_violation (23505) de slug ou e-mail repetido vira `null` (409 na rota); os demais SQLSTATE seguem para a apps/api.
 */
import type { EmpresaPlataforma, Licenca, SituacaoEmpresaEntrada, Transacao } from '@macuxierp/platform-sdk';
import type { RepositorioPlataforma } from './plataforma';

const repetido = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505';

async function semRepetido<R>(fn: () => Promise<R>): Promise<R | null> {
  try {
    return await fn();
  } catch (e) {
    if (repetido(e)) return null;
    throw e;
  }
}

/** A função de plataforma devolve sempre uma linha; sem ela, o erro é de programação (500). */
async function primeiraLinha<L>(tx: Transacao, sql: string, parametros: readonly unknown[]): Promise<L> {
  const [l] = await tx.consultar<L>(sql, parametros);
  if (!l) throw new Error('função de plataforma sem retorno');
  return l;
}

const empresa = async (tx: Transacao, sql: string, parametros: readonly unknown[]): Promise<EmpresaPlataforma> =>
  (await primeiraLinha<{ e: EmpresaPlataforma }>(tx, sql, parametros)).e;

export class RepositorioPlataformaSql implements RepositorioPlataforma {
  async listarEmpresas(tx: Transacao, p: { busca?: string; cursor?: string; limite: number }): Promise<EmpresaPlataforma[]> {
    const ls = await tx.consultar<{ e: EmpresaPlataforma }>('SELECT e FROM plataforma.empresas_listar($1, $2::uuid, $3) e', [
      p.busca ?? null,
      p.cursor ?? null,
      p.limite,
    ]);
    return ls.map((l) => l.e);
  }

  async lerEmpresa(tx: Transacao, id: string): Promise<EmpresaPlataforma | null> {
    const [l] = await tx.consultar<{ e: EmpresaPlataforma | null }>('SELECT plataforma.empresa_ler($1::uuid) e', [id]);
    return l?.e ?? null;
  }

  criarEmpresa(tx: Transacao, p: { slug: string; nome: string; fuso: string; request_id: string }): Promise<EmpresaPlataforma | null> {
    return semRepetido(() => empresa(tx, 'SELECT plataforma.empresa_criar($1, $2, $3, $4) e', [p.slug, p.nome, p.fuso, p.request_id]));
  }

  alterarSituacao(tx: Transacao, p: { id: string; situacao: SituacaoEmpresaEntrada['situacao']; motivo: string; request_id: string }): Promise<EmpresaPlataforma> {
    return empresa(tx, 'SELECT plataforma.empresa_situacao($1::uuid, $2, $3, $4) e', [p.id, p.situacao, p.motivo, p.request_id]);
  }

  alterarModulos(tx: Transacao, p: { id: string; modulos: Licenca[]; request_id: string }): Promise<EmpresaPlataforma> {
    const modulos = p.modulos.map((m) => ({ modulo: m.modulo, ativo: m.ativo, valido_ate: m.valido_ate ? m.valido_ate.toISOString() : null }));
    return empresa(tx, 'SELECT plataforma.empresa_modulos($1::uuid, $2::jsonb, $3) e', [p.id, JSON.stringify(modulos), p.request_id]);
  }

  criarPrimeiroAdmin(
    tx: Transacao,
    p: { id: string; email: string; nome: string; senha_hash: string; request_id: string },
  ): Promise<{ usuario_id: string } | null> {
    return semRepetido(() =>
      primeiraLinha<{ usuario_id: string }>(tx, 'SELECT plataforma.empresa_primeiro_admin_criar($1::uuid, $2, $3, $4, $5) usuario_id', [
        p.id,
        p.email,
        p.nome,
        p.senha_hash,
        p.request_id,
      ]),
    );
  }

  redefinirSenhaPrimeiroAdmin(tx: Transacao, p: { id: string; senha_hash: string; request_id: string }): Promise<{ usuario_id: string }> {
    return primeiraLinha(tx, 'SELECT plataforma.empresa_primeiro_admin_senha($1::uuid, $2, $3) usuario_id', [p.id, p.senha_hash, p.request_id]);
  }
}
