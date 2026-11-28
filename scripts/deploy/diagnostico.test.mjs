/**
 * Diagnóstico de produção só de leitura (T-0120, v0.3.27): diagnostico.sql e diagnostico.sh.
 * SQL: começa em BEGIN READ ONLY e termina em ROLLBACK; no meio, só SELECT, \echo e comentários; nenhuma escrita, DDL,
 * troca de papel nem função com efeito; nenhuma coluna de dado pessoal na saída (o CNPJ só em comparação; o payload só
 * no ->> 'request_id'). SH: com um `docker` falso pelo PATH (molde do troca.test.mjs), chama o serviço psql do compose
 * com o SQL pelo stdin, só leitura, sem o macuxierp_leitura, e devolve o código do psql.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), 'producao');
const SQL = readFileSync(join(PRODUCAO, 'diagnostico.sql'), 'utf8');
const SH = join(PRODUCAO, 'diagnostico.sh');
const raiz = mkdtempSync(join(tmpdir(), 'diagnostico-'));
after(() => rmSync(raiz, { recursive: true, force: true }));

/** Linhas com conteúdo, sem as de comentário. */
const linhas = SQL.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'));
const selects = linhas.filter((l) => /^SELECT\b/.test(l));

describe('diagnostico.sql (T-0120)', () => {
  it('abre com BEGIN READ ONLY e fecha com ROLLBACK, uma vez cada', () => {
    assert.equal(linhas[0], 'BEGIN READ ONLY;');
    assert.equal(linhas.at(-1), 'ROLLBACK;');
    const codigo = linhas.join('\n');
    assert.equal(codigo.match(/\bBEGIN\b/g)?.length, 1);
    assert.equal(codigo.match(/\bROLLBACK\b/g)?.length, 1);
    assert.doesNotMatch(codigo, /\b(COMMIT|END|SAVEPOINT|RELEASE)\b/i);
  });

  it('no meio, só SELECT de uma linha e \\echo com rótulo "== "', () => {
    for (const l of linhas.slice(1, -1)) {
      assert.ok(/^SELECT\b.*;$/.test(l) || /^\\echo '== [^']+'$/.test(l), `linha fora do permitido: ${l}`);
    }
    assert.equal(selects.length, 8);
    // cada SELECT vem logo depois de um \echo
    linhas.forEach((l, i) => {
      if (/^SELECT\b/.test(l)) assert.match(linhas[i - 1], /^\\echo '== /, `SELECT sem rótulo: ${l}`);
    });
  });

  it('nenhuma escrita, DDL, troca de papel, COPY nem função com efeito', () => {
    const corpo = selects.join('\n');
    assert.doesNotMatch(linhas.slice(1, -1).join('\n'), /\\(o|w|g|gexec|!|copy|set|setenv|i|ir|connect|c)\b/);
    for (const proibido of [
      /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|CLUSTER|LOCK|CALL|DO)\b/i,
      /\bSET\b/i,
      /\bRESET\b/i,
      /\bFOR\s+(UPDATE|SHARE|NO KEY|KEY)\b/i,
      /\b(pg_terminate_backend|pg_cancel_backend|set_config|pg_advisory\w*|nextval|setval|pg_reload_conf|pg_rotate_logfile|lo_\w+|pg_read_\w+|pg_ls_\w+|dblink\w*)\s*\(/i,
    ]) {
      assert.doesNotMatch(corpo, proibido);
    }
    // a única função chamada fora dos agregados é a plataforma.tenant_referencia() (constante, sem efeito)
    const funcoes = [...corpo.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((f) => !['filter', 'in', 'and', 'or'].includes(f));
    assert.deepEqual([...new Set(funcoes)].sort(), ['count', 'plataforma.tenant_referencia']);
  });

  it('nenhuma coluna de dado pessoal: CNPJ só em comparação, payload só no ->> request_id', () => {
    for (const s of selects) {
      // o único "nome" aceito é o do evento (plataforma.evento.nome), no WHERE
      const semNomeDoEvento = s.replace("WHERE e.nome = 'core.empresa.cnpj_alterado@1'", '');
      assert.doesNotMatch(semNomeDoEvento, /\b(email|e_mail|nome|nome_fantasia|razao_social|senha|senha_hash|token|telefone|cpf|ie|logradouro|corpo_bruto)\b/i, s);
      // corpo só como "corpo IS NOT NULL"
      for (const m of s.matchAll(/\bcorpo\b(.{0,12})/g)) assert.match(m[1], /^ IS NOT NULL/, s);
      // payload só como payload ->> 'request_id'
      for (const m of s.matchAll(/\bpayload\b(.{0,18})/g)) assert.match(m[1], /^ ->> 'request_id'/, s);
      // cnpj só em comparação ou teste de nulo
      const semLiterais = s.replace(/'[^']*'/g, "''");
      for (const m of semLiterais.matchAll(/(.{0,6})\b(\w+\.)?cnpj\b(.{0,12})/g)) {
        assert.ok(/^ (=|<>|IS (NOT )?NULL)/.test(m[3]) || /(=|<>) $/.test(m[1]), `cnpj fora de comparação: ${m[0]}`);
      }
      // a lista de saída (entre SELECT e o primeiro FROM de nível zero) só tem tenant_id, entidade, codigo e contagens
      const saida = s.replace(/^SELECT /, '').split(/ FROM (?![^()]*\))/)[0];
      for (const coluna of saida.split(/,(?![^()]*\))/).map((c) => c.trim())) {
        assert.match(coluna, /^((e\.)?tenant_id|t\.id AS tenant_id|t\.situacao|r\.uf_origem|entidade|codigo|count\(.*\)( - count\(.*\))?( FILTER \(WHERE .*\))? AS [a-z_0-9]+)$/, coluna);
      }
    }
  });

  it('as consultas são as da T-0120 (tabelas e colunas do main)', () => {
    for (const trecho of [
      'FROM integracao_fdv.registro_publicado WHERE deleted_at IS NULL',
      'FILTER (WHERE pendente)',
      'hash_confirmado IS NOT NULL',
      'FROM integracao_fdv.lote_erro WHERE resolvido_em IS NULL AND deleted_at IS NULL',
      'FROM cadastros.entrada_lote',
      "c.consumidor = 'cadastros.cnpj-empresa'",
      "e.nome = 'core.empresa.cnpj_alterado@1'",
      "e.erro LIKE 'falhou:%'",
      't.id <> plataforma.tenant_referencia()',
      "e.receita_fonte = 'manual'",
      "receita_fonte = 'manual' AND receita_consultada_em IS NULL",
      'FROM plataforma.tenant t LEFT JOIN fiscal.regra_tributaria r ON r.tenant_id = t.id',
      "r.tributo = 'icms'",
      'GROUP BY t.id, t.situacao, r.uf_origem ORDER BY t.id, r.uf_origem NULLS FIRST;',
    ]) {
      assert.ok(SQL.includes(trecho), trecho);
    }
  });
});

const DOCKER_FALSO = `#!/usr/bin/env bash
# docker falso: guarda o argv (uma linha), o PGOPTIONS passado e o stdin; devolve $EST/saida e sai com $EST/codigo (padrão 0)
printf '%s\\n' "$*" >> "$EST/chamadas"
cat > "$EST/stdin"
[ -f "$EST/saida" ] && cat "$EST/saida"
exit "$(cat "$EST/codigo" 2>/dev/null || echo 0)"
`;

function preparar(nome) {
  const est = join(raiz, nome);
  const bin = join(est, 'bin');
  const vm = join(est, 'vm');
  mkdirSync(bin, { recursive: true });
  mkdirSync(vm, { recursive: true });
  writeFileSync(join(bin, 'docker'), DOCKER_FALSO);
  chmodSync(join(bin, 'docker'), 0o755);
  writeFileSync(join(vm, '.env'), 'MACUXIERP_BANCO=macuxierp\n');
  writeFileSync(join(vm, 'gerados.env'), 'MACUXIERP_SENHA_APP=segredo-que-nao-sai\nMACUXIERP_SENHA_LEITURA=outro-segredo\n');
  writeFileSync(join(vm, 'banco.env'), 'MACUXI_PG_HOST=db.exemplo.invalid\n');
  writeFileSync(join(vm, 'admin.env'), 'MACUXI_PG_ADMIN_SENHA=senha-do-admin\n');
  writeFileSync(join(vm, 'imagens.env'), 'MACUXIERP_IMAGEM_API=ghcr.io/aloirr/macuxierp-api:v9\n');
  return { est, bin, vm };
}

function rodar({ est, bin, vm }, args = [], env = {}) {
  const r = spawnSync('bash', [SH, ...args], {
    env: { PATH: `${bin}:${process.env.PATH}`, EST: est, MACUXIERP_DIR: vm, MACUXIERP_TRAVA_VM: join(est, 'trava.lock'), ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const ler = (f) => {
    try {
      return readFileSync(join(est, f), 'utf8');
    } catch {
      return '';
    }
  };
  return { ...r, chamadas: ler('chamadas'), stdin: ler('stdin') };
}

describe('diagnostico.sh (T-0120)', () => {
  it('chama o serviço psql do compose, como o admin, com o SQL pelo stdin e só leitura; sem o macuxierp_leitura', () => {
    const c = preparar('ok');
    writeFileSync(join(c.est, 'saida'), '== 4. core.empresa: fonte manual e total\nfonte_manual | empresas\n0 | 3\n');
    const r = rodar(c);
    assert.equal(r.status, 0, r.stderr);
    const chamadas = r.chamadas.trim().split('\n');
    assert.equal(chamadas.length, 1);
    const [cmd] = chamadas;
    assert.match(cmd, /^compose --env-file \.env --env-file gerados\.env --env-file banco\.env --env-file imagens\.env --profile ferramentas run --rm --no-deps -T /);
    assert.match(cmd, / -e PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000 psql psql -X /);
    assert.match(cmd, / -v ON_ERROR_STOP=1 /);
    assert.match(cmd, / -A -F {2}\| {2}-d macuxierp -f -$/);
    assert.doesNotMatch(cmd, /macuxierp_leitura|macuxierp_app|macuxierp_worker|PGUSER|-U\b/);
    assert.equal(r.stdin, SQL);
    assert.match(r.stdout, /fonte_manual \| empresas\n0 \| 3\n/);
    assert.match(r.stdout, /\[diagnostico\] pronto\n$/);
    assert.match(r.stdout, /trava da VM obtida/);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /segredo|senha-do-admin|db\.exemplo/);
  });

  it('falha do psql: sai com o código dele, sem "pronto" e sem segredo', () => {
    const c = preparar('falha');
    writeFileSync(join(c.est, 'codigo'), '3');
    const r = rodar(c);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /psql falhou \(código 3/);
    assert.doesNotMatch(r.stdout, /pronto/);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /segredo|senha-do-admin/);
  });

  it('trava da VM ocupada (publicação em andamento): sai 1 sem chamar o docker', () => {
    const c = preparar('trava');
    const trava = join(c.est, 'trava.lock');
    // segura a trava pelo tempo do teste (o diagnostico.sh espera 0 s)
    const segura = spawnSync('bash', ['-c', `exec 8>'${trava}'; flock 8; bash '${SH}'; s=$?; exit $s`], {
      env: { PATH: `${c.bin}:${process.env.PATH}`, EST: c.est, MACUXIERP_DIR: c.vm, MACUXIERP_TRAVA_VM: trava, MACUXI_TRAVA_ESPERA_S: '0' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    // o pai segura a trava no fd 8; o diagnostico.sh abre o arquivo de novo (exec 9>): outra descrição, o flock recusa
    assert.equal(segura.status, 1, segura.stderr);
    assert.match(segura.stderr, /trava da VM ficou ocupada por mais de 0 s/);
    assert.equal(readFileSync(join(c.est, 'chamadas'), { flag: 'a+' }).toString(), '');
  });

  it('arquivo da VM ausente ou opção: sai 2 sem chamar o docker', () => {
    const c = preparar('sem-admin');
    rmSync(join(c.vm, 'admin.env'));
    const r = rodar(c);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /admin\.env ausente/);
    assert.equal(r.chamadas, '');
    const o = rodar(preparar('opcao'), ['--escrever']);
    assert.equal(o.status, 2);
    assert.equal(o.chamadas, '');
  });
});
