/**
 * Partes comuns dos scripts do operador (`licenca.mjs`, `ambiente-fiscal.mjs`): erro de uso, leitura das opções,
 * padrões do slug e do operador, abertura do tenant na transação e conexão com MACUXIERP_DATABASE_URL_OPERADOR.
 */

/** Erro de uso ou de regra do operador: a mensagem vai ao terminal como está (sem dado de cliente). */
export class ErroUso extends Error {
  name = 'ErroUso';
}

/** Mesma regex do CHECK do `slug` de `plataforma.tenant` (db/migrations/0002_plataforma.sql); o teste compara as duas. */
export const PADRAO_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** Nome de quem executa (vai para a auditoria). */
export const PADRAO_OPERADOR = /^[a-z][a-z0-9._-]{1,39}$/;

/**
 * Lê `--opcao valor` e `--confirmar` de `resto`, aceitando só as opções da lista. A chave sai em camelCase
 * (`--arquivo-recado` vira `arquivoRecado`). Lança ErroUso para opção desconhecida ou sem valor.
 */
export function lerOpcoes(resto, opcoes) {
  const lidas = { confirmar: false };
  for (let i = 0; i < resto.length; i++) {
    const chave = resto[i];
    if (chave === '--confirmar') {
      lidas.confirmar = true;
      continue;
    }
    const valor = resto[i + 1];
    if (!opcoes.includes(chave)) throw new ErroUso(`opção desconhecida: ${chave}`);
    if (valor === undefined || valor.startsWith('--')) throw new ErroUso(`${chave} exige um valor`);
    lidas[chave.slice(2).replace(/-([a-z])/g, (_, l) => l.toUpperCase())] = valor;
    i++;
  }
  return lidas;
}

/**
 * Acha o tenant ativo e não excluído pelo slug e liga a RLS dele na transação já aberta (`set_config` local).
 * Lê `plataforma.tenant` direto, e não pela `plataforma.tenant_por_slug()` do login (0002), porque essa função devolve
 * só o uuid, e os scripts precisam também do slug e do nome (desenho T-0030, seção 4.5). Lança ErroUso se não achar.
 */
export async function abrirTenant(cliente, slug) {
  const t = await cliente.query("select id, slug, nome from plataforma.tenant where slug = $1 and situacao = 'ativo' and deleted_at is null", [slug]);
  const tenant = t.rows[0];
  if (!tenant) throw new ErroUso(`empresa não encontrada: ${slug}`);
  await cliente.query("select set_config('app.tenant_id', $1, true)", [tenant.id]);
  return tenant;
}

/**
 * Conecta com MACUXIERP_DATABASE_URL_OPERADOR (no .env do servidor; nunca em recado nem no repositório). Lança ErroUso
 * se a variável faltar; se a conexão falhar, fecha o cliente e repassa o erro.
 */
export async function conectarOperador(env = process.env) {
  const url = env.MACUXIERP_DATABASE_URL_OPERADOR;
  if (!url) throw new ErroUso('defina MACUXIERP_DATABASE_URL_OPERADOR (no .env do servidor)');
  const { default: pg } = await import('pg');
  const cliente = new pg.Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (e) {
    await cliente.end().catch(() => undefined);
    throw e;
  }
  return cliente;
}
