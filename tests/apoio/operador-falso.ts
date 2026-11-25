/**
 * VM falsa para rodar o `scripts/deploy/producao/operador.sh` DE VERDADE nos testes: a pasta do compose (MACUXIERP_DIR)
 * com os .env fictícios e um `docker` no PATH que, para `docker compose ... run ... psql node <args>`, roda o Node da
 * sessão (NODE_REAL) com o ambiente limpo: só as variáveis pedidas com -e/--env (com ou sem =valor), as PG* do admin e,
 * se definidas, PGPASSWORD e as de `repassar` (o que o compose faria). Dados fictícios.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Cria `<pasta>/bin/docker` e `<pasta>/macuxierp/`; devolve os dois caminhos (bin vai no PATH; erp no MACUXIERP_DIR). */
export function criarDockerFalso(pasta: string, o: { repassar?: string[] } = {}): { bin: string; erp: string } {
  const bin = join(pasta, 'bin');
  const erp = join(pasta, 'macuxierp');
  for (const d of [bin, erp]) mkdirSync(d, { recursive: true });
  for (const f of ['.env', 'gerados.env', 'banco.env', 'admin.env', 'imagens.env']) writeFileSync(join(erp, f), 'MACUXIERP_FALSO=1\n');
  const repassar = ['PGPASSWORD', 'MACUXIERP_PSQL', ...(o.repassar ?? [])];
  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/usr/bin/env bash',
      'nomes=()',
      'while [ $# -gt 0 ] && [ "$1" != node ]; do',
      '  case "$1" in',
      '    -e|--env) nomes+=("$2"); shift 2; continue ;;',
      '    --env=*) nomes+=("${1#--env=}") ;;',
      '    -e?*) nomes+=("${1#-e}") ;;',
      '  esac',
      '  shift',
      'done',
      '[ "${1:-}" = node ] || { echo "docker falso: sem o comando node" >&2; exit 97; }',
      'shift',
      'amb=(PATH="$PATH" PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" PGDATABASE="$PGDATABASE" PGCONNECT_TIMEOUT=5)',
      `for n in ${repassar.join(' ')}; do [ -z "\${!n+x}" ] || amb+=("$n=\${!n}"); done`,
      'for n in "${nomes[@]}"; do case "$n" in *=*) amb+=("$n") ;; *) amb+=("$n=${!n-}") ;; esac; done',
      'exec env -i "${amb[@]}" "$NODE_REAL" "$@"',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return { bin, erp };
}

/** VM falsa com o psql de passagem: os caminhos do PATH, do MACUXIERP_DIR e dos registros do psql. */
export interface VmOperador {
  pasta: string;
  bin: string;
  erp: string;
  sqlLog: string;
  psqlLog: string;
}

/**
 * `criarDockerFalso` mais um `<bin>/psql-passagem` que guarda o SQL recebido (seguido de `separador`, se houver), o argv
 * e o ambiente, e repassa ao psql real (PSQL_REAL).
 */
export function criarPsqlPassagem(pasta: string, o: { separador?: string } = {}): VmOperador {
  const { bin, erp } = criarDockerFalso(pasta, { repassar: ['PSQL_REAL', 'SQL_LOG', 'PSQL_LOG'] });
  const fim = o.separador ? `${o.separador}\\n` : '';
  writeFileSync(
    join(bin, 'psql-passagem'),
    ['#!/usr/bin/env bash', 'sql="$(cat)"', `printf "%s\\n${fim}" "$sql" >> "$SQL_LOG"`, 'printf "%s\\n" "$@" >> "$PSQL_LOG"', 'env >> "$PSQL_LOG.ambiente"', 'exec "$PSQL_REAL" "$@" <<< "$sql"', ''].join(
      '\n',
    ),
  );
  chmodSync(join(bin, 'psql-passagem'), 0o755);
  return { pasta, bin, erp, sqlLog: join(pasta, 'sql.txt'), psqlLog: join(pasta, 'psql-argv.txt') };
}

/** Resultado de uma chamada do operador.sh: o SQL, o argv e o ambiente que chegaram ao psql NESTA chamada. */
export interface ChamadaOperador {
  status: number | null;
  saida: string;
  sql: string;
  psql: { argv: string; ambiente: string };
}

/** Roda o script do operador como na VM (`pg` = as PG* do admin do banco de teste), com a VM de `criarPsqlPassagem`. */
export function rodarOperador(vm: VmOperador, script: string, args: string[], pg: NodeJS.ProcessEnv): ChamadaOperador {
  const ambiente = `${vm.psqlLog}.ambiente`;
  for (const f of [vm.sqlLog, vm.psqlLog, ambiente]) writeFileSync(f, '');
  const r = spawnSync('bash', [script, ...args], {
    env: {
      ...pg,
      PATH: `${vm.bin}:${process.env.PATH ?? ''}`,
      HOME: vm.pasta,
      MACUXIERP_DIR: vm.erp,
      NODE_REAL: process.execPath,
      MACUXIERP_PSQL: join(vm.bin, 'psql-passagem'),
      PSQL_REAL: process.env.MACUXI_PSQL ?? 'psql',
      SQL_LOG: vm.sqlLog,
      PSQL_LOG: vm.psqlLog,
    },
    input: '',
    encoding: 'utf8',
    timeout: 120_000,
  });
  return {
    status: r.status,
    saida: `${r.stdout}${r.stderr}`,
    sql: readFileSync(vm.sqlLog, 'utf8'),
    psql: { argv: readFileSync(vm.psqlLog, 'utf8'), ambiente: readFileSync(ambiente, 'utf8') },
  };
}
