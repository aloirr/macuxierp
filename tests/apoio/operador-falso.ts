/**
 * VM falsa para rodar o `scripts/deploy/producao/operador.sh` DE VERDADE nos testes: a pasta do compose (MACUXIERP_DIR)
 * com os .env fictícios e um `docker` no PATH que, para `docker compose ... run ... psql node <args>`, roda o Node da
 * sessão (NODE_REAL) com o ambiente limpo: só as variáveis pedidas com -e/--env (com ou sem =valor), as PG* do admin e,
 * se definidas, PGPASSWORD e as de `repassar` (o que o compose faria). Dados fictícios.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
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
