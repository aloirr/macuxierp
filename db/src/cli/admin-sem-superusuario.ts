/**
 * pnpm --filter @macuxierp/db admin-sem-superusuario — cria, com o superusuário do Postgres descartável do CI (ou do
 * db/scripts/pg-local.sh), o admin que imita o do DBaaS do FDV: LOGIN, CREATEDB e CREATEROLE, sem superusuário e sem
 * BYPASSRLS. Depois, a suíte do @macuxierp/db roda com ele (MACUXI_PG_ADMIN_SEM_SUPER=1). Nunca rodar em produção.
 */
import { ADMIN_SEM_SUPER, criarAdminSemSuperusuario } from '../admin.ts';
import { conexaoDoAmbiente } from '../psql.ts';

try {
  const papel = criarAdminSemSuperusuario(conexaoDoAmbiente(process.env, 'postgres'));
  console.log(
    `${ADMIN_SEM_SUPER.usuario}: superusuário=${papel.rolsuper}, createdb=${papel.rolcreatedb}, ` +
      `createrole=${papel.rolcreaterole}, bypassrls=${papel.rolbypassrls}`,
  );
} catch (e) {
  console.error(`[admin-sem-superusuario] ${(e as Error).message}`);
  process.exit(1);
}
