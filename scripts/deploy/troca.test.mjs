/**
 * Troca sem parada (troca.sh, v0.3.23, decisão 48 A; ADR 0003, adendo 48 A), com um `docker` falso que guarda cada chamada
 * e simula as réplicas do projeto macuxierp. Confere: a nova sobe ao lado da velha; a velha só sai do túnel, para e é
 * removida depois da nova saudável; com a nova doente, sai a nova e a velha nem deixa o túnel; stop, rm e disconnect só
 * recebem ids das réplicas do projeto; e o piso de memória.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const PRODUCAO = resolve(dirname(fileURLToPath(import.meta.url)), 'producao');
const raiz = mkdtempSync(join(tmpdir(), 'troca-'));
after(() => rmSync(raiz, { recursive: true, force: true }));

const DOCKER_FALSO = `#!/usr/bin/env bash
# docker falso: réplicas em $EST/svc_<serviço> (um id por linha), saúde em $EST/saude_<id> (padrão healthy)
echo "$*" >> "$EST/chamadas"
if [ "$1" = compose ]; then
  shift
  while [ "\${1:-}" = --env-file ]; do shift 2; done
  cmd="$1"; shift
  svc="\${*: -1}"
  case "$cmd" in
    ps) cat "$EST/svc_$svc" 2>/dev/null; exit 0 ;;
    up)
      n="$(printf '%s' "$*" | sed -n 's/.*--scale [^=]*=\\([0-9]\\).*/\\1/p')"
      [ -n "$n" ] || { [ -s "$EST/svc_$svc" ] || echo "novo0" > "$EST/svc_$svc"; exit 0; }
      atual="$(sed '/^$/d' "$EST/svc_$svc" 2>/dev/null | wc -l)"
      while [ "$atual" -lt "$n" ]; do
        c="$(cat "$EST/cont")"; c=$((c + 1)); echo "$c" > "$EST/cont"
        echo "novo$c" >> "$EST/svc_$svc"; atual=$((atual + 1))
      done
      exit 0 ;;
  esac
  exit 0
fi
id="\${*: -1}"
case "$1" in
  inspect) cat "$EST/saude_$id" 2>/dev/null || echo healthy ;;
  network) echo "$id" >> "$EST/fora_do_tunel" ;;
  stop) echo "$id" >> "$EST/parados" ;;
  rm) for f in "$EST"/svc_*; do sed -i "/^$id\\$/d" "$f"; done ;;
esac
exit 0
`;

// curl falso (laço pelo domínio, v0.3.24; -w completo na v0.3.25): a n-ésima chamada de <caminho> devolve a linha n de
// $EST/codigos_<caminho> (padrão 200), tempo de n ms e connect de 1 ms; 000 leva 3001 ms, sai com 28 e traz o %{errormsg}
// do timeout. CURL_SEM_ERRORMSG=1 imita o curl sem a variável (nada no lugar dela). Cada chamada vai para $EST/curl_chamadas.
const CURL_FALSO = `#!/usr/bin/env bash
url="\${*: -1}"; p="\${url#*://*/}"; p="\${p//\\//_}"
fmt=""; ant=""; for a in "$@"; do [ "$ant" = -w ] && fmt="$a"; ant="$a"; done
echo "$$ $url" >> "$EST/curl_chamadas"
n=$(( $(cat "$EST/ncurl_$p" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$EST/ncurl_$p"
cod="$(sed -n "\${n}p" "$EST/codigos_$p" 2>/dev/null)"; cod="\${cod:-200}"
[ -n "\${CURL_DORME:-}" ] && sleep "$CURL_DORME"
t="$(printf '0.%03d' "$n")"; msg=""; tc=0.001
[ "$cod" = 000 ] && { t=3.001; tc=0.000; msg="Operation timed out after 3001 milliseconds with 0 bytes received"; }
[ -n "\${CURL_SEM_ERRORMSG:-}" ] && msg=""
fmt="\${fmt//'%{http_code}'/$cod}"; fmt="\${fmt//'%{time_total}'/$t}"; fmt="\${fmt//'%{time_connect}'/$tc}"; fmt="\${fmt//'%{errormsg}'/$msg}"
printf '%s' "$fmt"
[ "$cod" = 000 ] && exit 28
exit 0
`;
// date falso: a hora do laço só sai em UTC (date -u), como o log() do implantar.sh
const DATE_FALSO = `#!/usr/bin/env bash
if [ "$1" = -u ] && [ "\${2:-}" = +%H:%M:%S ]; then echo 09:08:07; exit 0; fi
if [ "$1" = +%H:%M:%S ]; then echo FUSO-ERRADO; exit 0; fi
exec /bin/date "$@"
`;

let n = 0;
/** Roda um trecho de bash com o comum.sh e o troca.sh carregados, num estado novo. */
function rodar(trecho, { replicas = { 'macuxierp-web': ['velho1'] }, saude = {}, env = {}, codigos = {} } = {}) {
  const est = join(raiz, `e${n++}`);
  const bin = join(est, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(est, 'tmp'));
  for (const [nome, corpo] of Object.entries({ docker: DOCKER_FALSO, curl: CURL_FALSO, date: DATE_FALSO })) {
    writeFileSync(join(bin, nome), corpo);
    chmodSync(join(bin, nome), 0o755);
  }
  for (const [p, lista] of Object.entries(codigos)) writeFileSync(join(est, `codigos_${p}`), lista.map((c) => `${c}\n`).join(''));
  writeFileSync(join(est, 'cont'), '0');
  for (const [svc, ids] of Object.entries(replicas)) writeFileSync(join(est, `svc_${svc}`), ids.map((i) => `${i}\n`).join(''));
  for (const [id, st] of Object.entries(saude)) writeFileSync(join(est, `saude_${id}`), `${st}\n`);
  const script = `set -uo pipefail
log() { echo "[t] $*"; }
source '${PRODUCAO}/comum.sh'
source '${PRODUCAO}/troca.sh'
REDE_TUNEL=rede-do-tunel
${trecho}`;
  const r = spawnSync('bash', ['-c', script], {
    cwd: est,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, EST: est, TMPDIR: join(est, 'tmp'), MACUXIERP_TROCA_DRENO_S: '0', MACUXIERP_TROCA_PASSO_S: '1', MACUXIERP_TROCA_ESPERA_S: '3', ...env },
    timeout: 30_000,
  });
  const ler = (f) => (existsSync(join(est, f)) ? readFileSync(join(est, f), 'utf8').split('\n').filter(Boolean) : []);
  return { ...r, chamadas: ler('chamadas'), replicas: (svc) => ler(`svc_${svc}`), fora: ler('fora_do_tunel'), parados: ler('parados'), curl: () => ler('curl_chamadas'), tmp: () => readdirSync(join(est, 'tmp')), ler, est };
}
const indice = (chamadas, re) => chamadas.findIndex((c) => re.test(c));
const LINHA = (rot, codigos, fim = '') => new RegExp(`^\\[implantar\\] 09:08:07 laço ${rot} durante a troca: (\\d+) chamadas, códigos \\{${codigos}\\}, maior tempo (\\d+) ms${fim}$`, 'm');
const AVISO = ' \\(aviso: 000 isolado tolerado\\)';
const TIMEOUT = 'Operation timed out after 3001 milliseconds with 0 bytes received';
const diagnosticos = (saida, rot) => saida.split('\n').filter((l) => l.startsWith(`[implantar] 09:08:07 laço ${rot}: `));
const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('troca.sh (48 A): troca sem parada', () => {
  it('caminho feliz: a nova sobe ao lado, fica saudável, e só então a velha sai do túnel, para e é removida', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"');
    assert.match(r.stdout, /saida=0/, r.stderr);
    assert.deepEqual(r.replicas('macuxierp-web'), ['novo1']);
    const c = r.chamadas;
    const subiu = indice(c, /compose .*up -d --no-deps --no-recreate --scale macuxierp-web=2 macuxierp-web$/);
    const saude = indice(c, /^inspect .* novo1$/);
    const fora = indice(c, /^network disconnect rede-do-tunel velho1$/);
    const parou = indice(c, /^stop -t 30 velho1$/);
    const removeu = indice(c, /^rm -f velho1$/);
    const escala1 = indice(c, /compose .*--scale macuxierp-web=1 macuxierp-web$/);
    for (const [nome, i] of Object.entries({ subiu, saude, fora, parou, removeu, escala1 })) assert.ok(i >= 0, `${nome} não aconteceu:\n${c.join('\n')}`);
    assert.ok(subiu < saude && saude < fora && fora < parou && parou < removeu && removeu < escala1, c.join('\n'));
    assert.deepEqual(r.fora, ['velho1']);
  });

  it('a nova não fica saudável: a nova sai, a velha nunca deixa o túnel e segue no ar (saída 1)', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { saude: { novo1: 'unhealthy' } });
    assert.match(r.stdout, /saida=1/);
    assert.match(r.stderr, /a réplica nova não ficou saudável/);
    assert.deepEqual(r.replicas('macuxierp-web'), ['velho1']);
    assert.deepEqual(r.parados, ['novo1']);
    assert.ok(!r.fora.includes('velho1') && !r.parados.includes('velho1'));
  });

  it('a nova saudável mas a conferência extra falha (api sem a versão): o mesmo caminho de volta', () => {
    const r = rodar('nao_confere() { return 1; }; trocar_servico macuxierp-api nao_confere; echo "saida=$?"', { replicas: { 'macuxierp-api': ['velho1'] } });
    assert.match(r.stdout, /saida=1/);
    assert.deepEqual(r.replicas('macuxierp-api'), ['velho1']);
    assert.ok(!r.parados.includes('velho1'));
  });

  it('a nova em "starting" até o fim da espera conta como não saudável', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { saude: { novo1: 'starting' } });
    assert.match(r.stdout, /saida=1/);
    assert.deepEqual(r.replicas('macuxierp-web'), ['velho1']);
  });

  it('sem réplica no ar (1º deploy do serviço): sobe direto, com --wait, sem scale nem stop', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { replicas: { 'macuxierp-web': [] } });
    assert.match(r.stdout, /saida=0/);
    assert.ok(indice(r.chamadas, /compose .*up -d --no-deps --wait --wait-timeout 3 macuxierp-web$/) >= 0, r.chamadas.join('\n'));
    assert.equal(indice(r.chamadas, /--scale/), -1);
    assert.deepEqual(r.parados, []);
  });

  it('duas réplicas antes da troca (sobra de uma troca interrompida): recusa sem mexer em nada', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { replicas: { 'macuxierp-web': ['a1', 'a2'] } });
    assert.match(r.stdout, /saida=1/);
    assert.match(r.stderr, /mais de uma réplica/);
    assert.equal(indice(r.chamadas, /up |stop|rm |network/), -1, r.chamadas.join('\n'));
  });

  it('FDV intocado: stop, rm e network disconnect só recebem ids das réplicas do projeto; todo compose passa pelo dc()', () => {
    const r = rodar('trocar_servico macuxierp-api; trocar_servico macuxierp-web', { replicas: { 'macuxierp-api': ['velhoapi'], 'macuxierp-web': ['velhoweb'] } });
    const permitidos = new Set(['velhoapi', 'velhoweb', 'novo1', 'novo2']);
    for (const c of r.chamadas.filter((x) => /^(stop|rm|network)/.test(x))) assert.ok(permitidos.has(c.split(' ').at(-1)), c);
    for (const c of r.chamadas.filter((x) => x.startsWith('compose'))) assert.match(c, /^compose --env-file \.env --env-file gerados\.env --env-file banco\.env --env-file imagens\.env /);
    assert.equal(indice(r.chamadas, /\bdown\b|system prune|network (rm|create)|restart/), -1);
    assert.deepEqual(r.replicas('macuxierp-api'), ['novo1']);
    assert.deepEqual(r.replicas('macuxierp-web'), ['novo2']);
  });

  it('piso de memória: MemAvailable abaixo de MACUXIERP_TROCA_MIN_MIB recusa a troca; acima, aceita', () => {
    const meminfo = join(raiz, 'meminfo');
    writeFileSync(meminfo, 'MemTotal: 8000000 kB\nMemAvailable: 1048576 kB\n');
    const baixo = rodar('memoria_para_troca; echo "m=$?"', { env: { MACUXIERP_MEMINFO: meminfo, MACUXIERP_TROCA_MIN_MIB: '1280' } });
    assert.match(baixo.stdout, /m=1/);
    assert.match(baixo.stdout, /MemAvailable\): 1024 MiB \(piso da troca sem parada: 1280 MiB\)/);
    const alto = rodar('memoria_para_troca; echo "m=$?"', { env: { MACUXIERP_MEMINFO: meminfo, MACUXIERP_TROCA_MIN_MIB: '1000' } });
    assert.match(alto.stdout, /m=0/);
    const semArquivo = rodar('memoria_para_troca; echo "m=$?"', { env: { MACUXIERP_MEMINFO: join(raiz, 'nao-existe') } });
    assert.match(semArquivo.stdout, /m=1/);
    assert.match(semArquivo.stdout, /MemAvailable\): \? MiB/);
  });
  it('todas_ok (conferência do implantar.sh): sem réplica falha; uma réplica que não passa derruba o todo; recebe o id e os args', () => {
    const r = rodar(`so_a2() { [ "$1" = a2 ] && [ "$2" = v9 ]; }; sempre() { [ "$2" = v9 ]; }
todas_ok macuxierp-web sempre v9; echo "vazio=$?"
todas_ok macuxierp-api sempre v9; echo "todas=$?"
todas_ok macuxierp-api so_a2 v9; echo "uma=$?"`, { replicas: { 'macuxierp-web': [], 'macuxierp-api': ['a1', 'a2'] } });
    assert.match(r.stdout, /vazio=1/);
    assert.match(r.stdout, /todas=0/);
    assert.match(r.stdout, /uma=1/);
  });
});

describe('troca.sh (v0.3.24, adendo 48 A): laço de curl pelo domínio durante a troca', () => {
  it('(a) todas 200: uma linha por URL no formato, hora em UTC, base padrão, sem diagnóstico, e a troca passa', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { env: { MACUXIERP_TROCA_DRENO_S: '2' } });
    assert.match(r.stdout, /saida=0/, r.stderr);
    for (const rot of ['/login', '/v1/saude']) {
      const linhas = r.stdout.split('\n').filter((l) => l.includes(`laço ${rot} `));
      assert.equal(linhas.length, 1, r.stdout);
      const m = linhas[0].match(LINHA(rot, '200: (\\d+)'));
      assert.ok(m, linhas[0]);
      assert.ok(Number(m[1]) >= 2, `poucas chamadas num dreno de 2 s: ${linhas[0]}`);
      assert.equal(m[2], m[1]);
      assert.equal(m[3], m[1], 'maior tempo = a última chamada do curl falso (n ms)');
    }
    assert.doesNotMatch(r.stdout, /FUSO-ERRADO|aviso/);
    assert.deepEqual([...diagnosticos(r.stdout, '/login'), ...diagnosticos(r.stdout, '/v1/saude')], []);
    const urls = new Set(r.curl().map((l) => l.split(' ')[1]));
    assert.deepEqual([...urls].sort(), ['https://erp.macuxifdv.com.br/login', 'https://erp.macuxifdv.com.br/v1/saude']);
    assert.deepEqual(r.tmp(), [], 'sobrou arquivo temporário');
  });

  it('a base vem de MACUXIERP_URL_PUBLICA (ambiente ou .env), sem barra dupla', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { env: { MACUXIERP_URL_PUBLICA: 'https://outra.invalid/' } });
    assert.match(r.stdout, /saida=0/, r.stderr);
    assert.ok(r.curl().every((l) => /^\d+ https:\/\/outra\.invalid\/(login|v1\/saude)$/.test(l)), r.curl().join('\n'));
    const e = rodar('echo MACUXIERP_URL_PUBLICA=https://env.invalid > .env; laco_url_base');
    assert.match(e.stdout, /^https:\/\/env\.invalid$/m);
  });

  it('(b) um 502 no meio: a linha agrupa os códigos e a troca falha (o implantar.sh volta atrás pelo mesmo caminho)', () => {
    const r = rodar(
      `trocar_servico macuxierp-web; echo "saida=$?"
trocar_servico macuxierp-web; echo "volta=$?"`,
      { env: { MACUXIERP_TROCA_DRENO_S: '3' }, codigos: { v1_saude: [200, 502] } },
    );
    assert.match(r.stdout, /saida=1/);
    assert.match(r.stderr, /macuxierp-web: o laço pelo domínio falhou durante a troca \(000 seguido ou código diferente de 200 e 000\): volta atrás/);
    const [primeira] = r.stdout.split('\n').filter((l) => l.includes('laço /v1/saude '));
    assert.match(primeira, LINHA('/v1/saude', '200: \\d+, 502: 1'));
    assert.doesNotMatch(primeira, /aviso/);
    // 502 sem errormsg do curl: a linha diz a saída do curl (0)
    assert.deepEqual(diagnosticos(r.stdout, '/v1/saude'), ['[implantar] 09:08:07 laço /v1/saude: 502 em 2 ms (curl saída 0, connect 1 ms)']);
    assert.match(r.stdout, LINHA('/login', '200: \\d+'));
    // a troca seguinte (a volta, com todas 200) passa e deixa uma réplica só
    assert.match(r.stdout, /volta=0/, r.stderr);
    assert.deepEqual(r.replicas('macuxierp-web'), ['novo2']);
    assert.deepEqual(r.tmp(), []);
  });

  it('(v0.3.25) um 000 isolado por URL: aviso, linha de diagnóstico com o errormsg, e a troca passa', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', {
      env: { MACUXIERP_TROCA_DRENO_S: '2' },
      codigos: { login: ['200', '000'], v1_saude: ['200', '000'] },
    });
    assert.match(r.stdout, /saida=0/, r.stderr);
    assert.doesNotMatch(r.stderr, /volta atrás/);
    for (const rot of ['/login', '/v1/saude']) {
      assert.match(r.stdout, LINHA(rot, '000: 1, 200: \\d+', AVISO));
      assert.deepEqual(diagnosticos(r.stdout, rot), [`[implantar] 09:08:07 laço ${rot}: 000 em 3001 ms (${TIMEOUT}, connect 0 ms)`]);
    }
    assert.deepEqual(r.tmp(), []);
  });

  it('(v0.3.25) dois 000 seguidos na mesma URL: falha (volta atrás), sem aviso, um diagnóstico por chamada', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', { env: { MACUXIERP_TROCA_DRENO_S: '2' }, codigos: { login: ['000', '000'] } });
    assert.match(r.stdout, /saida=1/);
    assert.match(r.stderr, /volta atrás/);
    const [linha] = r.stdout.split('\n').filter((l) => l.includes('laço /login '));
    assert.match(linha, LINHA('/login', '000: 2(, 200: \\d+)?'));
    assert.doesNotMatch(linha, /aviso/);
    assert.equal(diagnosticos(r.stdout, '/login').length, 2);
    assert.match(r.stdout, LINHA('/v1/saude', '200: \\d+'));
  });

  it('(v0.3.25) laco_resumo: 000 não vizinhos passam com aviso; 000 seguidos, 5xx/4xx e zero chamadas falham; curl sem errormsg mostra a saída', () => {
    const caso = (nome, linhas) => `printf '%s' '${linhas.map((l) => `${l}\n`).join('')}' > ${nome}; laco_resumo ${nome} /login; echo "${nome}=$?"`;
    const L = (cod, extra = '') => `11:12:13 ${cod === '000' ? 28 : 0} ${cod} ${cod === '000' ? '3.001 0.000' : '0.010 0.002'}${extra}`;
    const r = rodar([
      caso('alternado', [L('000', ` ${TIMEOUT}`), L('200'), L('000', ` ${TIMEOUT}`)]),
      caso('seguidos', [L('200'), L('000'), L('000'), L('200')]),
      caso('erro503', [L('200'), L('503')]),
      caso('erro404', [L('404')]),
      caso('so200', [L('200'), L('200')]),
      caso('antigo', [L('000', ' %{errormsg}')]),
      ': > vazio; laco_resumo vazio /login; echo "vazio=$?"',
    ].join('\n'));
    assert.match(r.stdout, /^alternado=0$/m);
    assert.match(r.stdout, LINHA('/login', '000: 2, 200: 1', AVISO));
    assert.match(r.stdout, /^\[implantar\] 11:12:13 laço \/login: 000 em 3001 ms \(Operation timed out after 3001 milliseconds with 0 bytes received, connect 0 ms\)$/m);
    assert.match(r.stdout, /^seguidos=1$/m);
    assert.match(r.stdout, /^\[implantar\] 11:12:13 laço \/login: 000 em 3001 ms \(curl saída 28, connect 0 ms\)$/m);
    assert.match(r.stdout, /^erro503=1$/m);
    assert.match(r.stdout, /^\[implantar\] 11:12:13 laço \/login: 503 em 10 ms \(curl saída 0, connect 2 ms\)$/m);
    assert.match(r.stdout, /^erro404=1$/m);
    assert.match(r.stdout, /^so200=0$/m);
    assert.match(r.stdout, /^antigo=0$/m);
    assert.match(r.stdout, /^vazio=1$/m);
    assert.match(r.stdout, /laço \/login durante a troca: 0 chamadas, códigos \{\}, maior tempo 0 ms$/m);
  });

  it('(v0.3.25) curl sem %{errormsg}: a linha de diagnóstico traz a saída do curl (28 no timeout)', () => {
    const r = rodar('trocar_servico macuxierp-web; echo "saida=$?"', {
      env: { MACUXIERP_TROCA_DRENO_S: '2', CURL_SEM_ERRORMSG: '1' },
      codigos: { login: ['200', '000'] },
    });
    assert.match(r.stdout, /saida=0/, r.stderr);
    assert.deepEqual(diagnosticos(r.stdout, '/login'), ['[implantar] 09:08:07 laço /login: 000 em 3001 ms (curl saída 28, connect 0 ms)']);
    assert.match(r.stdout, LINHA('/login', '000: 1, 200: \\d+', AVISO));
  });

  it('(c) a troca falha (nova doente): o laço é encerrado, sem processo órfão nem arquivo temporário', () => {
    const r = rodar(
      `pega() { echo "$TROCA_LACO_PID" > "$EST/laco_pid"; return 1; }
trocar_servico macuxierp-web pega; echo "saida=$?"; echo "pid_depois=[$TROCA_LACO_PID]"; jobs -p | wc -l | sed 's/^/jobs=/'`,
      { env: { CURL_DORME: '0.3' } },
    );
    assert.match(r.stdout, /saida=1/);
    assert.match(r.stderr, /a réplica nova não ficou saudável/);
    assert.match(r.stdout, /pid_depois=\[\]/);
    assert.match(r.stdout, /jobs=0/);
    assert.match(r.stdout, LINHA('/login', '200: \\d+'));
    const pid = Number(r.ler('laco_pid')[0]);
    assert.ok(pid > 0);
    assert.equal(vivo(pid), false, 'o laço sobreviveu à troca');
    const antes = r.curl().length;
    spawnSync('sleep', ['1.5']);
    assert.equal(r.curl().length, antes, 'o curl continuou sendo chamado depois da troca');
    for (const l of r.curl()) assert.equal(vivo(Number(l.split(' ')[0])), false, `curl órfão: ${l}`);
    assert.deepEqual(r.tmp(), []);
  });

  it('(c) o script sai no meio da troca: o trap EXIT mata o laço e apaga o mktemp', () => {
    const r = rodar(`sai() { echo "$TROCA_LACO_PID" > "$EST/laco_pid"; exit 7; }
trocar_servico macuxierp-web sai; echo "nao-chega"`, { env: { CURL_DORME: '0.3' } });
    assert.equal(r.status, 7, r.stderr);
    assert.doesNotMatch(r.stdout, /nao-chega/);
    const pid = Number(r.ler('laco_pid')[0]);
    assert.equal(vivo(pid), false, 'o laço sobreviveu à saída do script');
    const antes = r.curl().length;
    spawnSync('sleep', ['1.5']);
    assert.equal(r.curl().length, antes);
    assert.deepEqual(r.tmp(), []);
  });
});
