/**
 * `operador.sh saude` (D3, decisões 27 a 31 A; v0.3.18): a saúde da integração e das rotinas por empresa, para o
 * producao-publicar imprimir na issue depois do deploy. Só CONTAGENS, por código da empresa (UF + 4 dígitos), numa
 * transação READ ONLY: sem nome, e-mail, documento nem qualquer dado de cadastro.
 *
 * Por empresa (uma linha):
 * - sinal: o último sinal aceito pelo Hub (`integracao_fdv.sinal.ultimo_aceito_em`, UTC) e o último HTTP;
 * - pausas: os cadastros pausados, como `entidade:motivo`;
 * - lotes de envio em 24 h: aceitos (aceito, concluido, concluido_com_erros) e recusados (recusado, falhou);
 * - prazo médio: quantas auditorias da `completar_prazos_medios` em 24 h (a rotina do worker, T-0108).
 *
 * Mesmo molde do superadmin.mjs (SQL fixo pelo stdin do psql; MACUXIERP_PSQL troca o binário nos testes).
 * Saída 0 = ok; 1 = falha do banco.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const SEP = '\u001f';

export const SQL_SAUDE = `BEGIN READ ONLY;
SELECT concat_ws(E'\\x1f', 'saude', t.slug,
  coalesce(to_char(s.ultimo_aceito_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '-'),
  coalesce(s.ultimo_http::text, '-'),
  coalesce((SELECT string_agg(c.entidade::text || ':' || c.pausada_motivo, ',' ORDER BY c.entidade::text)
              FROM integracao_fdv.cursor_entidade c
             WHERE c.tenant_id = t.id AND c.pausada_motivo IS NOT NULL AND c.deleted_at IS NULL), '-'),
  (SELECT count(*) FROM integracao_fdv.lote_envio l
    WHERE l.tenant_id = t.id AND l.estado IN ('aceito', 'concluido', 'concluido_com_erros')
      AND l.created_at > now() - interval '24 hours')::text,
  (SELECT count(*) FROM integracao_fdv.lote_envio l
    WHERE l.tenant_id = t.id AND l.estado IN ('recusado', 'falhou') AND l.created_at > now() - interval '24 hours')::text,
  (SELECT count(*) FROM plataforma.auditoria a
    WHERE a.tenant_id = t.id AND a.acao = 'condicao_pagamento.completar_prazos_medios'
      AND a.created_at > now() - interval '24 hours')::text)
  FROM plataforma.tenant t
  LEFT JOIN integracao_fdv.sinal s ON s.tenant_id = t.id AND s.deleted_at IS NULL
 WHERE t.deleted_at IS NULL AND t.situacao = 'ativo'
 ORDER BY t.slug;
ROLLBACK;
`;

const SLUG = /^[a-z0-9-]{1,40}$/;
const CONTAGEM = /^\d+$/;

/** Só as linhas `saude` bem formadas; qualquer outra coisa do banco fica de fora. */
export function linhasSaude(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.split(SEP))
    .filter((c) => c.length === 8 && c[0] === 'saude' && SLUG.test(c[1]) && CONTAGEM.test(c[5]) && CONTAGEM.test(c[6]) && CONTAGEM.test(c[7]))
    .map(([, empresa, sinalOk, http, pausas, aceitos, recusados, prazoMedio]) => ({ empresa, sinalOk, http, pausas, aceitos, recusados, prazoMedio }));
}

export function main(env = process.env) {
  const r = spawnSync(env.MACUXIERP_PSQL || 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-At', '-f', '-'], {
    input: SQL_SAUDE,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (r.status !== 0) {
    // o erro do psql só com o código e a primeira linha (sem dado: a consulta não lê cadastro)
    const msg = r.error ? `psql não executou (${r.error.code ?? r.error.name})` : (r.stderr ?? '').split('\n')[0];
    console.error(`[saude] falhou (nada muda: a transação é READ ONLY).\n${msg}`);
    return 1;
  }
  const linhas = linhasSaude(r.stdout ?? '');
  console.log('[saude] por empresa ativa (só contagens; horas em UTC):');
  console.log('  empresa | último sinal aceito | http | pausas | lotes 24h aceitos/recusados | prazo médio 24h');
  for (const l of linhas) {
    console.log(`  ${l.empresa} | ${l.sinalOk} | ${l.http} | ${l.pausas} | ${l.aceitos}/${l.recusados} | ${l.prazoMedio}`);
  }
  console.log(`estado: saude ${linhas.length} empresa(s)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === '-') process.exitCode = main();
