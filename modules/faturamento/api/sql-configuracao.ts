/**
 * Adaptador PostgreSQL da bandeira por filial "faturamento real com NF-e simulada": `faturamento.configuracao_filial`
 * (0026; filial_id, faturamento_real_nfe_simulada, alterado_por obrigatório). Sem linha = false. O histórico é gravado só pelo gatilho do banco; o app não escreve nele.
 * `definir` é um `INSERT ... ON CONFLICT (tenant_id, filial_id) DO UPDATE` (atômico, sem 23505 em gravações simultâneas).
 */
import type { ConfiguracaoFaturamento } from './portas';

export const configuracaoFaturamentoSql: ConfiguracaoFaturamento = {
  async faturamentoRealComNfeSimulada(tx, filial_id) {
    const [l] = await tx.consultar<{ ligada: boolean }>(
      'SELECT faturamento_real_nfe_simulada AS ligada FROM faturamento.configuracao_filial WHERE filial_id = $1 AND deleted_at IS NULL',
      [filial_id],
    );
    return l?.ligada ?? false;
  },

  async lerBandeiraSegura(tx, filial_id, avisar) {
    // SAVEPOINT: o erro do Postgres (tabela inexistente) aborta a transação; o rollback ao savepoint a mantém viva.
    await tx.consultar('SAVEPOINT bandeira_filial');
    try {
      const ligada = await configuracaoFaturamentoSql.faturamentoRealComNfeSimulada(tx, filial_id);
      await tx.consultar('RELEASE SAVEPOINT bandeira_filial');
      return ligada;
    } catch (e) {
      await tx.consultar('ROLLBACK TO SAVEPOINT bandeira_filial');
      await tx.consultar('RELEASE SAVEPOINT bandeira_filial');
      avisar(`falha ao ler a bandeira (${(e as { code?: string } | null)?.code ?? 'erro'})`);
      return false;
    }
  },

  async definir(tx, filial_id, ligada, usuario_id) {
    // UPSERT atômico por (tenant_id, filial_id) (configuracao_filial_uq): gravações simultâneas não dão 23505. Só as colunas que o GRANT da 0026 libera.
    await tx.consultar(
      `INSERT INTO faturamento.configuracao_filial (tenant_id, filial_id, faturamento_real_nfe_simulada, alterado_por)
       VALUES (plataforma.tenant_atual(), $1, $2, $3)
       ON CONFLICT (tenant_id, filial_id) DO UPDATE SET faturamento_real_nfe_simulada = EXCLUDED.faturamento_real_nfe_simulada, alterado_por = EXCLUDED.alterado_por`,
      [filial_id, ligada, usuario_id],
    );
  },
};
