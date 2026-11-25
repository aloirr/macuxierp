/**
 * Portas do "Zerar dados" do portal `/config` (RN-CAD-10, T-0058, v0.3.6) que o plugin do cadastros pede
 * (`modules/cadastros/api/zeragem-portas.ts`). A apps/api só chama as funções `portal_*` dos donos (migração 0043), no `tx`
 * recebido (a transação do `comPlataforma`, papel `macuxierp_config` com a sessão do superadmin): nenhum SQL de tabela aqui.
 * O cadastros não importa pedido, faturamento, core nem integracao-fdv (regra 1); a junção dos resultados mora aqui.
 */
import type { DependenciasZeragemPlataforma, EstadoEntidadeIntegracao, EstadoIntegracaoPlataforma, RefsUso, UsoDaTabela, UsosCadastroPlataforma, UsuariosFiliaisPlataforma } from '@macuxierp/cadastros/api';
import type { Transacao } from '@macuxierp/platform-sdk';

/** Linha única `r` (jsonb) ou `n` (integer) das funções; sem linha é erro de programação (500), nunca dado do cliente. */
async function umaLinha<L>(tx: Transacao, sql: string, parametros: readonly unknown[], funcao: string): Promise<L> {
  const [l] = await tx.consultar<L>(sql, parametros);
  if (!l) throw new Error(`${funcao} sem retorno`);
  return l;
}

const jsonbDe = async <R>(tx: Transacao, sql: string, parametros: readonly unknown[], funcao: string): Promise<R> =>
  (await umaLinha<{ r: R }>(tx, sql, parametros, funcao)).r;

/**
 * `pedido.portal_usos_cadastros(tenant, refs)` e `faturamento.portal_usos_cadastros(tenant, refs)` com o mesmo `p_refs`, e
 * `core.portal_usos_filiais(tenant, refs.filial)` só quando há filial (motivo `fiscal`, filial com A1, aviso do A1 ou ambiente
 * fiscal). `emUso` = os `em_uso` das três na ordem pedido, faturamento, core; `filiaisComNota` vem só do faturamento.
 */
function usosCadastroPorFuncoes(): UsosCadastroPlataforma {
  return {
    async usos(tx, tenant, refs: RefsUso) {
      const p = JSON.stringify(refs);
      const pedido = await jsonbDe<{ em_uso: UsoDaTabela[] }>(tx, 'SELECT pedido.portal_usos_cadastros($1::uuid, $2::jsonb) AS r', [tenant, p], 'pedido.portal_usos_cadastros');
      const fat = await jsonbDe<{ em_uso: UsoDaTabela[]; filiais_com_nota: string[] }>(
        tx,
        'SELECT faturamento.portal_usos_cadastros($1::uuid, $2::jsonb) AS r',
        [tenant, p],
        'faturamento.portal_usos_cadastros',
      );
      const filiais = refs.filial ?? [];
      const core = filiais.length === 0
        ? { em_uso: [] as UsoDaTabela[] }
        : await jsonbDe<{ em_uso: UsoDaTabela[] }>(tx, 'SELECT core.portal_usos_filiais($1::uuid, $2::uuid[]) AS r', [tenant, filiais], 'core.portal_usos_filiais');
      return { emUso: [...pedido.em_uso, ...fat.em_uso, ...core.em_uso], filiaisComNota: fat.filiais_com_nota };
    },
  };
}

/** `integracao_fdv.portal_estado_entidades` (lote em voo por entidade). */
function estadoIntegracaoPorFuncoes(): EstadoIntegracaoPlataforma {
  return {
    async estado(tx, tenant, entidades) {
      const r = await jsonbDe<{ entidades: EstadoEntidadeIntegracao[] }>(
        tx,
        'SELECT integracao_fdv.portal_estado_entidades($1::uuid, $2::text[]) AS r',
        [tenant, [...entidades]],
        'integracao_fdv.portal_estado_entidades',
      );
      return r.entidades;
    },
  };
}

/** `plataforma.portal_tirar_filiais_dos_usuarios(tenant, ids)`: quantos usuários mudaram. */
function usuariosFiliaisPorFuncoes(): UsuariosFiliaisPlataforma {
  return {
    async tirarFiliais(tx, tenant, ids) {
      const l = await umaLinha<{ n: number }>(
        tx,
        'SELECT plataforma.portal_tirar_filiais_dos_usuarios($1::uuid, $2::uuid[]) AS n',
        [tenant, [...ids]],
        'plataforma.portal_tirar_filiais_dos_usuarios',
      );
      return Number(l.n);
    },
  };
}

/** As três portas de produção do plugin "Zerar dados". */
export function dependenciasZeragemProducao(): DependenciasZeragemPlataforma {
  return { usos: usosCadastroPorFuncoes(), integracao: estadoIntegracaoPorFuncoes(), usuarios: usuariosFiliaisPorFuncoes() };
}
