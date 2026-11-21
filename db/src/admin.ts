/** Admin sem superusuário que imita o do DBaaS (docs/produto/04, "Banco"); usado só no CI e no pg-local.sh. */
import { type Conexao, consultar, literal, rodarScript } from './psql.ts';

/** Senha pública do Postgres descartável (a mesma do tests/scripts/rodar-antes-do-push.sh); não é segredo. */
export const ADMIN_SEM_SUPER = {
  usuario: 'macuxi_admin_sem_super',
  senha: 'macuxi_admin_sem_super_ci',
} as const;

export interface AtributosPapel {
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolbypassrls: boolean;
}

export function criarAdminSemSuperusuario(superusuario: Conexao): AtributosPapel {
  const { usuario, senha } = ADMIN_SEM_SUPER;
  rodarScript(
    superusuario,
    `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(usuario)}) THEN
    CREATE ROLE ${usuario} LOGIN CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD ${literal(senha)};
  END IF;
END $$;`,
    { transacao: true },
  );
  const [papel] = consultar<AtributosPapel>(
    superusuario,
    `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = ${literal(usuario)}`,
  );
  if (!papel || papel.rolsuper || papel.rolbypassrls || !papel.rolcreatedb || !papel.rolcreaterole) {
    throw new Error(`${usuario} existe com atributos errados: ${JSON.stringify(papel)}`);
  }
  return papel;
}
