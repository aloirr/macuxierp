/**
 * Troca sem parada (troca.sh, v0.3.23, decisão 48 A; ADR 0003, adendo 48 A), com um `docker` falso que guarda cada chamada
 * e simula as réplicas do projeto macuxierp. Confere: a nova sobe ao lado da velha; a velha só sai do túnel, para e é
 * removida depois da nova saudável; com a nova doente, sai a nova e a velha nem deixa o túnel; stop, rm e disconnect só
 * recebem ids das réplicas do projeto; e o piso de memória.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

let n = 0;
/** Roda um trecho de bash com o comum.sh e o troca.sh carregados, num estado novo. */
function rodar(trecho, { replicas = { 'macuxierp-web': ['velho1'] }, saude = {}, env = {} } = {}) {
  const est = join(raiz, `e${n++}`);
  const bin = join(est, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'docker'), DOCKER_FALSO);
  chmodSync(join(bin, 'docker'), 0o755);
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
    env: { PATH: `${bin}:${process.env.PATH}`, EST: est, MACUXIERP_TROCA_DRENO_S: '0', MACUXIERP_TROCA_PASSO_S: '1', MACUXIERP_TROCA_ESPERA_S: '3', ...env },
    timeout: 30_000,
  });
  const ler = (f) => (existsSync(join(est, f)) ? readFileSync(join(est, f), 'utf8').split('\n').filter(Boolean) : []);
  return { ...r, chamadas: ler('chamadas'), replicas: (svc) => ler(`svc_${svc}`), fora: ler('fora_do_tunel'), parados: ler('parados'), est };
}
const indice = (chamadas, re) => chamadas.findIndex((c) => re.test(c));

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
