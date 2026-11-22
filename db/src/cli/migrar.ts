/**
 * pnpm --filter @macuxierp/db migrar — aplica as migrações e a carga das tabelas oficiais no banco do ambiente
 * (MACUXI_PG_* ou PG*; banco em MACUXIERP_BANCO, padrão macuxierp). Roda como o admin do DBaaS (sem superusuário).
 */
import { migrar } from '../migrar.ts';
import { conexaoDoAmbiente } from '../psql.ts';

const conexao = conexaoDoAmbiente();
try {
  const feitas = migrar(conexao);
  console.log(
    feitas.length ? `aplicado em ${conexao.banco}: ${feitas.join(', ')}` : `${conexao.banco} já está em dia`,
  );
} catch (e) {
  console.error(`[migrar] ${(e as Error).message}`);
  process.exit(1);
}
