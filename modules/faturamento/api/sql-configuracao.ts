/**
 * Adaptador PostgreSQL da bandeira por filial "faturamento real com NF-e simulada": `faturamento.configuracao_filial`
 * (0026; filial_id, faturamento_real_nfe_simulada, alterado_por obrigatório). Sem linha = false. O histórico é gravado só pelo gatilho do banco; o app não escreve nele.
 * `definir` faz UPDATE e, se nada mudou, INSERT (sem depender do nome da restrição única).
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
    const r = await tx.consultar<{ id: string }>(
      'UPDATE faturamento.configuracao_filial SET faturamento_real_nfe_simulada = $2, alterado_por = $3 WHERE filial_id = $1 AND deleted_at IS NULL RETURNING id',
      [filial_id, ligada, usuario_id],
    );
    if (r.length > 0) return;
    await tx.consultar(
      'INSERT INTO faturamento.configuracao_filial (tenant_id, filial_id, faturamento_real_nfe_simulada, alterado_por) VALUES (plataforma.tenant_atual(), $1, $2, $3)',
      [filial_id, ligada, usuario_id],
    );
  },
};
