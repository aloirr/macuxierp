/**
 * Teste automático de vazamento entre tenants (regra 5, docs/produto/04): para TODA tabela dos schemas pedidos, cada
 * papel da aplicação, no tenant A, lê só linhas de A (e alguma, para provar que a massa cobre a tabela); sem tenant,
 * nada; e não altera nem apaga linha de B nem move linha para B. A exceção é o despachante do worker nas filas
 * (política worker_global, D10). Devolve a lista de problemas (vazia = sem vazamento).
 */
import { type Conexao } from '../src/psql.ts';
import {
  consultar,
  contarComo,
  erroDe,
  PAPEIS_APP,
  papelLe,
  rodarScript,
  tabelasDos,
  type Tabela,
} from './apoio.ts';

function nome(t: Tabela): string {
  return `${t.esquema}.${t.tabela}`;
}

function tabelasComPolitica(c: Conexao, politica: string): Set<string> {
  return new Set(
    consultar<{ t: string }>(
      c,
      `SELECT schemaname || '.' || tablename AS t FROM pg_policies WHERE policyname = '${politica}'`,
    ).map((r) => r.t),
  );
}

function tabelasOficiais(c: Conexao): Set<string> {
  return new Set(
    consultar<{ t: string }>(
      c,
      `SELECT schemaname || '.' || tablename AS t FROM pg_policies
       WHERE policyname = 'isolamento_tenant' AND qual LIKE '%tenant_referencia()%'`,
    ).map((r) => r.t),
  );
}

function assinaturaDe(c: Conexao, t: Tabela, tenant: string): string {
  const [r] = consultar<{ n: number; u: string | null }>(
    c,
    `SELECT count(*)::int AS n, max(updated_at)::text AS u FROM ${nome(t)} WHERE tenant_id = '${tenant}'`,
  );
  return JSON.stringify(r);
}

function tentar(c: Conexao, sql: string, tenant: string): string | null {
  return erroDe(() =>
    rodarScript(c, `SET ROLE macuxierp_app;\nSET app.tenant_id = '${tenant}';\n${sql}`, { transacao: true }),
  );
}

export function verificarVazamento(c: Conexao, esquemas: readonly string[], a: string, b: string): string[] {
  const problemas: string[] = [];
  const globais = tabelasComPolitica(c, 'worker_global');
  const oficiais = tabelasOficiais(c);
  // Leitura geral (D9): as linhas do tenant de referência são de todos e não contam como vazamento.
  const gerais = tabelasComPolitica(c, 'leitura_geral');
  const tabelas = tabelasDos(c, esquemas).filter((t) => !oficiais.has(nome(t)));
  if (tabelas.length === 0) problemas.push(`nenhuma tabela em ${esquemas.join(', ')}`);

  for (const t of tabelas) {
    for (const papel of PAPEIS_APP) {
      if (!papelLe(c, papel, t)) continue;
      const global = papel === 'macuxierp_worker' && globais.has(nome(t));
      const comA = contarComo(c, papel, a, t, a, gerais.has(nome(t)));
      if (comA.total === 0)
        problemas.push(`${nome(t)} (${papel}): a massa não tem linha visível do tenant A`);
      if (!global && comA.alheias > 0)
        problemas.push(`${nome(t)} (${papel}): VAZOU ${comA.alheias} linha(s) de outro tenant`);
      if (global && comA.alheias === 0)
        problemas.push(`${nome(t)} (${papel}): o worker deveria ver a fila de todos`);
      const semTenant = contarComo(c, papel, null, t, a, gerais.has(nome(t)));
      if (!global && semTenant.total > 0)
        problemas.push(`${nome(t)} (${papel}): sem tenant na sessão leu ${semTenant.total}`);
    }

    // Escrita do app: nunca em linha de B, nunca movendo linha de A para B.
    const [priv] = consultar<{ upd: boolean; del: boolean }>(
      c,
      `SELECT has_table_privilege('macuxierp_app', '${nome(t)}', 'UPDATE') AS upd,
              has_table_privilege('macuxierp_app', '${nome(t)}', 'DELETE') AS del`,
    );
    const antes = assinaturaDe(c, t, b);
    if (priv?.upd) {
      const erro = tentar(c, `UPDATE ${nome(t)} SET tenant_id = '${b}';`, a);
      if (erro === null) problemas.push(`${nome(t)}: o app moveu linha do tenant A para o B`);
      tentar(c, `UPDATE ${nome(t)} SET updated_at = updated_at WHERE tenant_id = '${b}';`, a);
    }
    if (priv?.del) tentar(c, `DELETE FROM ${nome(t)} WHERE tenant_id = '${b}';`, a);
    if (assinaturaDe(c, t, b) !== antes)
      problemas.push(`${nome(t)}: o app (tenant A) alterou ou apagou linha do tenant B`);
  }
  return problemas;
}
