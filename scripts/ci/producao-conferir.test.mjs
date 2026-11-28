// Testes da conferência de produção (R-20261114-121700-alexandre). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { conferir, conferirCommit, conferirSuite, digestNoGhcr, erroDaRef, errosDaEntrada, tagExiste } from './producao-conferir.mjs';

const SHA = '839a082'.padEnd(40, '0');
const ler = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('ref: publicar só roda em tag v*, por push ou disparo manual na tag', () => {
  assert.equal(erroDaRef({ evento: 'push', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), null);
  assert.equal(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), null);
  assert.match(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/heads/main', tag: 'main' }), /só tag v\*/);
  assert.match(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/heads/v1', tag: 'v1' }), /só tag v\*/);
  assert.match(erroDaRef({ evento: 'workflow_run', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), /não publica/);
  assert.match(erroDaRef({ evento: 'push', ref: 'refs/tags/v1 x', tag: 'v1 x' }), /tag inválida/);
});

test('entrada do liberar: vX.Y.Z, SHA de 40 hex e disparo pelo main', () => {
  assert.deepEqual(errosDaEntrada({ versao: 'v1.0.7', sha: SHA, ref: 'refs/heads/main' }), []);
  for (const versao of ['1.0.7', 'v1.0', 'v1.0.7-rc1', 'v01.0.7', 'v1.0.7 ', '', undefined])
    assert.equal(errosDaEntrada({ versao, sha: SHA, ref: 'refs/heads/main' }).length, 1, String(versao));
  for (const sha of ['839a082', SHA.toUpperCase().replace(/0/g, 'A'), `${SHA}0`, 'g'.repeat(40), ''])
    assert.equal(errosDaEntrada({ versao: 'v1.0.7', sha, ref: 'refs/heads/main' }).length, 1, sha);
  assert.match(errosDaEntrada({ versao: 'v1.0.7', sha: SHA, ref: 'refs/heads/nuvem/x' })[0], /pelo main/);
});

test('tag existente: só o nome exato conta (matching-refs devolve por prefixo)', () => {
  assert.equal(tagExiste([{ ref: 'refs/tags/v1.0.7' }], 'v1.0.7'), true);
  assert.equal(tagExiste([{ ref: 'refs/tags/v1.0.70' }], 'v1.0.7'), false);
  assert.equal(tagExiste([], 'v1.0.7'), false);
  assert.equal(tagExiste(null, 'v1.0.7'), false);
});

/** exec falso: cada chave é o primeiro argumento relevante; valor = saída ou Error. */
function execFalso({ main = true, ancestral = true, ci = '1', digest = `sha256:${'a'.repeat(64)}` } = {}) {
  const chamadas = [];
  const exec = (cmd, args) => {
    chamadas.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'rev-parse') { if (!main) throw new Error('x'); return 'abc\n'; }
    if (cmd === 'git' && args[0] === 'merge-base') { if (!ancestral) throw new Error('x'); return ''; }
    if (cmd === 'gh') { if (ci instanceof Error) throw ci; return `${ci}\n`; }
    if (cmd === 'bash') { if (digest instanceof Error) throw digest; return `${digest}\n`; }
    throw new Error(`inesperado: ${cmd}`);
  };
  return { exec, chamadas };
}

/** Erro do execFileSync quando o docker diz que a tag não existe (a saída do comando vem no stdout do ghcr-tentar). */
const ausente = () => Object.assign(new Error('Command failed'), { stdout: 'ERROR: ghcr.io/aloirr/macuxierp-api:x: not found\n' });

const ALVO = { sha: SHA, versao: 'v1.0.7', dono: 'AloirR', repositorio: 'aloirr/macuxierp' };

test('conferir: no main, CI verde e imagem → api por digest e dono minúsculo', () => {
  const { exec, chamadas } = execFalso();
  const r = conferir(ALVO, exec);
  assert.equal(r.erro, undefined);
  assert.equal(r.dono, 'aloirr');
  assert.equal(r.api, `ghcr.io/aloirr/macuxierp-api@sha256:${'a'.repeat(64)}`);
  const gh = chamadas.find((c) => c[0] === 'gh');
  for (const f of [`head_sha=${SHA}`, 'event=push', 'branch=main', 'status=success']) assert.ok(gh.includes(f), f);
  assert.ok(chamadas.find((c) => c[0] === 'bash').includes(`ghcr.io/aloirr/macuxierp-api:${SHA}`));
});

test('conferir: cada falha vira erro e para antes do passo seguinte', () => {
  assert.match(conferir(ALVO, execFalso({ main: false }).exec).erro, /origin\/main ausente/);
  assert.match(conferir(ALVO, execFalso({ ancestral: false }).exec).erro, /não está no main/);
  assert.match(conferir(ALVO, execFalso({ ci: '0' }).exec).erro, /CI verde/);
  assert.match(conferir(ALVO, execFalso({ ci: new Error('rede') }).exec).erro, /CI verde/);
  assert.match(conferir(ALVO, execFalso({ digest: '' }).exec).erro, /digest inválido/);
  assert.match(conferir(ALVO, execFalso({ digest: ausente() }).exec).erro, /não está no GHCR.*liberar versão/);
  assert.match(conferir(ALVO, execFalso({ digest: new Error('rede') }).exec).erro, /não consegui consultar/);
  assert.match(conferir({ ...ALVO, sha: 'abc' }, execFalso().exec).erro, /SHA inválido/);
});

test('commit: no main e CI verde, sem consultar o GHCR (o liberar confere antes de montar a imagem)', () => {
  const { exec, chamadas } = execFalso({ digest: new Error('não deveria consultar') });
  assert.deepEqual(conferirCommit(ALVO, exec), { ci: 1 });
  assert.ok(!chamadas.some((c) => c[0] === 'bash'));
  assert.match(conferirCommit(ALVO, execFalso({ ancestral: false }).exec).erro, /não está no main/);
  assert.match(conferirCommit(ALVO, execFalso({ ci: '0' }).exec).erro, /CI verde/);
  assert.match(conferirCommit({ ...ALVO, sha: 'abc' }, execFalso().exec).erro, /SHA inválido/);
});

test('imagem no GHCR: só "não existe" do registro libera o build; falha de consulta nunca remonta a tag', () => {
  const img = `ghcr.io/aloirr/macuxierp-api:${SHA}`;
  assert.deepEqual(digestNoGhcr(img, execFalso().exec), { digest: `sha256:${'a'.repeat(64)}` });
  assert.deepEqual(digestNoGhcr(img, execFalso({ digest: ausente() }).exec), { ausente: true });
  for (const stdout of ['manifest unknown', 'MANIFEST_UNKNOWN: manifest unknown'])
    assert.deepEqual(digestNoGhcr(img, execFalso({ digest: Object.assign(new Error('x'), { stdout }) }).exec), { ausente: true });
  assert.match(digestNoGhcr(img, execFalso({ digest: Object.assign(new Error('x'), { stdout: '403 Forbidden' }) }).exec).erro, /não consegui/);
  assert.match(digestNoGhcr(img, execFalso({ digest: 'lixo' }).exec).erro, /digest inválido/);
});

test('workflows: liberar, aprovar e publicar usam a mesma conferência; só o aprovar cria a tag e dispara o publicar', () => {
  const pub = ler('.github/workflows/producao-publicar.yml');
  const lib = ler('.github/workflows/producao-liberar.yml');
  const apr = ler('.github/workflows/producao-aprovar.yml');
  assert.match(pub, /^ {2}workflow_dispatch:/m);
  assert.match(pub, /producao-conferir\.mjs ref/);
  assert.match(pub, /producao-conferir\.mjs conferir/);
  assert.match(pub, /name: PRODUCAO/);
  for (const wf of [lib, apr]) {
    assert.match(wf, /producao-conferir\.mjs entrada/);
    assert.match(wf, /producao-conferir\.mjs conferir/);
    assert.doesNotMatch(wf, /environment:/, 'liberar e aprovar não usam o PRODUCAO: os segredos ficam só no publicar');
  }
  for (const wf of [pub, lib, apr]) assert.doesNotMatch(wf, /actions\/workflows\/ci\.yml\/runs/, 'conferência duplicada fora do script');
  assert.match(apr, /gh workflow run producao-publicar\.yml -R "\$GITHUB_REPOSITORY" --ref "\$VERSAO"/);
  assert.doesNotMatch(lib, /gh workflow run|git\/refs|contents: write|actions: write/, 'o liberar para na issue: sem tag e sem disparo');
});

test('liberar monta a imagem da API (ADR 0051): CI verde antes do build, só se a tag não existe, do código do commit', () => {
  const lib = ler('.github/workflows/producao-liberar.yml');
  const iCommit = lib.indexOf('producao-conferir.mjs commit');
  const iImagem = lib.indexOf('producao-conferir.mjs imagem');
  const iBuild = lib.indexOf('docker/build-push-action');
  assert.ok(iCommit > 0 && iCommit < iImagem && iImagem < iBuild, 'commit → imagem existe? → build');
  assert.ok(iBuild < lib.lastIndexOf('producao-conferir.mjs conferir'), 'o digest é fixado depois do envio');
  // todo passo de build/envio depende de a tag não existir
  const passos = lib.slice(iImagem).split(/\n {6}- /).slice(1);
  for (const p of passos.filter((x) => /setup-buildx|build-push|docker push|ref: \$\{\{ inputs\.sha \}\}/.test(x)))
    assert.match(p, /if: steps\.existe\.outputs\.existe == '0'/, p.split('\n')[0]);
  assert.match(lib, /context: alvo\n\s+file: alvo\/apps\/api\/Dockerfile/);
  assert.doesNotMatch(lib, /macuxierp-api:main|--force|push: true/);
  assert.match(lib, /needs: imagem/);
});

test('suíte completa uma vez por versão (R-20261120-073449-alexandre): o liberar roda o ci.yml no SHA antes da imagem', () => {
  const lib = ler('.github/workflows/producao-liberar.yml');
  const ci = ler('.github/workflows/ci.yml');
  const suite = lib.slice(lib.indexOf('\n  suite:\n'), lib.indexOf('\n  imagem:\n'));
  assert.match(suite, /needs: conferir\n/);
  assert.match(suite, /uses: \.\/\.github\/workflows\/ci\.yml\n/);
  assert.match(suite, /sha: \$\{\{ inputs\.sha \}\}/);
  assert.doesNotMatch(suite, /secrets|if:/, 'a suíte sempre roda e sem segredo');
  // a imagem (e a issue, que depende dela) só sai com a suíte verde: sem if que a deixe passar com a suíte falha
  const imagem = lib.slice(lib.indexOf('\n  imagem:\n'), lib.indexOf('\n    steps:', lib.indexOf('\n  imagem:\n')));
  assert.match(imagem, /needs: \[conferir, suite\]/);
  assert.doesNotMatch(imagem, /\bif:/);
  assert.match(lib, /\n {2}abrir:\n[^]*?needs: imagem\n/);
  // o ci.yml aceita a chamada com o SHA, e todo checkout usa esse SHA
  assert.match(ci, /^ {2}workflow_call:\n {4}inputs:\n {6}sha:\n[^]*?required: true/m);
  assert.doesNotMatch(ci, /^ {2}schedule:/m, 'sem o semanal: a suíte do main só no manual e no liberar');
  const checkouts = ci.split('uses: actions/checkout@v4').slice(1);
  assert.ok(checkouts.length >= 5);
  for (const c of checkouts) assert.match(c.slice(0, 200), /ref: \$\{\{ inputs\.sha \}\}/);
  // com o SHA da versão, o ci-ok fica vermelho sem as duas suítes e sem os e2e (decisão 137 A)
  assert.match(ci, /SHA_DA_VERSAO: \$\{\{ inputs\.sha \}\}/);
  assert.match(ci, /index\("testes-pacotes"\) != null and index\("testes-integracao"\) != null and index\("e2e"\) != null/);
});

test('e2e no liberar (decisão 137 A): um job do ci.yml, um script de tests/e2e/rodar-*.sh por parte, exigido pelo ci-ok', () => {
  const ci = ler('.github/workflows/ci.yml');
  const ini = ci.indexOf('\n  e2e:\n');
  assert.ok(ini > 0, 'o ci.yml tem o job e2e');
  const e2e = ci.slice(ini, ci.indexOf('\n  ci-ok:\n'));
  // só quando o escopo pede (matriz completa: o liberar e o manual com sha ou completo), nunca no PR
  assert.match(e2e, /needs: escopo\n/);
  assert.match(e2e, /if: \$\{\{ !cancelled\(\) && contains\(needs\.escopo\.outputs\.jobs, '"e2e"'\) \}\}/);
  // a matriz é exatamente a lista dos executores de tests/e2e
  const scripts = readdirSync(new URL('../../tests/e2e/', import.meta.url))
    .filter((f) => /^rodar-.+\.sh$/.test(f))
    .map((f) => f.slice('rodar-'.length, -'.sh'.length))
    .sort();
  const matriz = e2e.match(/\n {8}script: \[([^\]]+)\]/)?.[1].split(',').map((s) => s.trim()).sort();
  assert.deepEqual(matriz, scripts);
  assert.match(e2e, /fail-fast: false/);
  assert.match(e2e, /\n {4}services:\n {6}postgres:\n/);
  assert.match(e2e, /ref: \$\{\{ inputs\.sha \}\}/);
  assert.match(e2e, /bash "tests\/e2e\/rodar-\$SCRIPT\.sh"/);
  assert.match(e2e, /bash tests\/e2e\/rodar-prints\.sh "\$v"/);
  assert.doesNotMatch(e2e, /secrets\./, 'sem segredo');
  // o ci-ok espera pelo e2e (job fora da lista do escopo tem de ficar "skipped"; na lista, "success")
  assert.match(ci, /\n {2}ci-ok:\n[^]*?needs: \[escopo, governanca, estatico, testes-pacotes, testes-integracao, e2e\]/);
});

const ARVORE = 'e'.repeat(40);
const RUN_LIBERAR = { id: 7, path: '.github/workflows/producao-liberar.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: 'f'.repeat(40) };
const JOBS_LIBERAR = [
  { name: 'conferir', conclusion: 'success' },
  ...[1, 2, 3].map((s) => ({ name: `suíte completa no SHA da versão / testes dos pacotes (${s}/3)`, conclusion: 'success' })),
  ...[1, 2, 3].map((s) => ({ name: `suíte completa no SHA da versão / testes de integração (tests/, ${s}/3)`, conclusion: 'success' })),
  { name: 'imagem', conclusion: null },
];

/** exec falso da suíte: runs = { id: { run, jobs } }; falhas = { 'rev-parse'|'artifacts'|'runs'|'merge-base': Error }. */
function execSuite({ runs = { 7: { run: RUN_LIBERAR, jobs: JOBS_LIBERAR } }, ids = Object.keys(runs).map(Number), falhas = {} } = {}) {
  const chamadas = [];
  const exec = (cmd, args) => {
    chamadas.push([cmd, ...args]);
    const falha = (k) => { if (falhas[k]) throw falhas[k]; };
    if (cmd === 'git' && args[0] === 'rev-parse') return falha('rev-parse'), `${ARVORE}\n`;
    if (cmd === 'git' && args[0] === 'merge-base') return falha('merge-base'), '';
    const caminho = cmd === 'gh' ? args[3] : '';
    if (caminho.endsWith('/actions/artifacts'))
      return falha('artifacts'), JSON.stringify({ artifacts: ids.map((id) => ({ expired: id === 8, workflow_run: { id } })) });
    const m = caminho.match(/\/actions\/runs\/(\d+)(\/jobs)?$/);
    if (m) return falha('runs'), JSON.stringify(m[2] ? { jobs: runs[m[1]].jobs } : runs[m[1]].run);
    throw new Error(`inesperado: ${cmd} ${args.join(' ')}`);
  };
  return { exec, chamadas };
}

const ALVO_SUITE = { sha: SHA, repositorio: 'aloirr/macuxierp' };

test('suíte: artefato ci-verde-completa-<árvore> do liberar ou do ci.yml manual do main, com os testes verdes', () => {
  const { exec, chamadas } = execSuite();
  assert.deepEqual(conferirSuite(ALVO_SUITE, exec), { run: 7 });
  assert.deepEqual(chamadas[0], ['git', 'rev-parse', `${SHA}^{tree}`]);
  assert.ok(chamadas[1].includes(`name=ci-verde-completa-${ARVORE}`));
  assert.ok(chamadas.some((c) => c[0] === 'git' && c[1] === 'merge-base' && c.includes(RUN_LIBERAR.head_sha)));
  const jobsCi = JOBS_LIBERAR.map((j) => ({ ...j, name: j.name.replace('suíte completa no SHA da versão / ', '') }));
  const ci = { run: { ...RUN_LIBERAR, id: 8, path: '.github/workflows/ci.yml' }, jobs: jobsCi };
  assert.deepEqual(conferirSuite(ALVO_SUITE, execSuite({ runs: { 8: ci } }).exec), { run: 8 }, 'ci.yml manual (artefato expirado vale)');
});

test('suíte: run de branch, PR, push, outro workflow ou fora do main é recusado; procura o próximo artefato', () => {
  for (const muda of [{ head_branch: 'nuvem/x' }, { event: 'pull_request' }, { event: 'push' }, { path: '.github/workflows/outro.yml' }, { head_sha: 'abc' }])
    assert.match(conferirSuite(ALVO_SUITE, execSuite({ runs: { 7: { run: { ...RUN_LIBERAR, ...muda }, jobs: JOBS_LIBERAR } } }).exec).erro,
      /não tem a suíte completa verde.*liberar versão/, JSON.stringify(muda));
  assert.match(conferirSuite(ALVO_SUITE, execSuite({ falhas: { 'merge-base': new Error('x') } }).exec).erro, /não tem a suíte/, 'tag "main"');
  const ruim = { run: { ...RUN_LIBERAR, id: 6, head_branch: 'nuvem/x' }, jobs: JOBS_LIBERAR };
  assert.deepEqual(conferirSuite(ALVO_SUITE, execSuite({ runs: { 6: ruim, 7: { run: RUN_LIBERAR, jobs: JOBS_LIBERAR } } }).exec), { run: 7 });
  assert.match(conferirSuite(ALVO_SUITE, execSuite({ ids: [] }).exec).erro, /não tem a suíte completa verde/);
});

test('suíte: job de testes falho, cancelado ou ausente é recusado', () => {
  const com = (jobs) => conferirSuite(ALVO_SUITE, execSuite({ runs: { 7: { run: RUN_LIBERAR, jobs } } }).exec);
  assert.match(com(JOBS_LIBERAR.map((j) => (/pacotes \(2/.test(j.name) ? { ...j, conclusion: 'failure' } : j))).erro, /não tem a suíte/);
  assert.match(com(JOBS_LIBERAR.map((j) => (/integração \(tests\/, 3/.test(j.name) ? { ...j, conclusion: 'cancelled' } : j))).erro, /não tem a suíte/);
  assert.match(com(JOBS_LIBERAR.filter((j) => !/integração/.test(j.name))).erro, /não tem a suíte/);
  assert.match(com(JOBS_LIBERAR.filter((j) => !/pacotes/.test(j.name))).erro, /não tem a suíte/);
});

test('suíte: falha de consulta ou SHA inválido é erro (nunca passa)', () => {
  for (const k of ['rev-parse', 'artifacts', 'runs'])
    assert.match(conferirSuite(ALVO_SUITE, execSuite({ falhas: { [k]: new Error('rede') } }).exec).erro, /não consegui conferir a suíte/, k);
  for (const sha of ['abc', SHA.toUpperCase().replace(/0/g, 'A'), '', undefined])
    assert.match(conferirSuite({ ...ALVO_SUITE, sha }, execSuite().exec).erro, /SHA inválido/, String(sha));
  assert.match(conferirSuite({ sha: SHA }, execSuite().exec).erro, /GITHUB_REPOSITORY/);
});

test('suíte nos workflows: aprovar e publicar conferem antes do conferir; o liberar não chama o modo suite', () => {
  for (const p of ['producao-aprovar', 'producao-publicar']) {
    const wf = ler(`.github/workflows/${p}.yml`);
    const iSuite = wf.indexOf('producao-conferir.mjs suite');
    assert.ok(iSuite > 0 && iSuite < wf.indexOf('producao-conferir.mjs conferir'), p);
  }
  assert.doesNotMatch(ler('.github/workflows/producao-liberar.yml'), /producao-conferir\.mjs suite/);
});

test('demo desligada: nenhum workflow publica nem entra na VM da demo', () => {
  for (const wf of ['demo-publicar', 'demo-recriar-base', 'dbaas-teste'])
    assert.throws(() => ler(`.github/workflows/${wf}.yml`), /ENOENT/, wf);
  for (const wf of ['producao-liberar', 'producao-aprovar', 'producao-publicar'])
    assert.doesNotMatch(ler(`.github/workflows/${wf}.yml`), /DEMO_|scope=macuxi-bko\b(?!-)|macuxi-demo-arquivos'/, wf);
});

test('caminhos: todo scripts/deploy/... citado no conferir e na trava existe no repositório (T-0024)', () => {
  const faltando = [];
  for (const arq of ['scripts/ci/producao-conferir.mjs', 'scripts/ci/producao-trava.mjs']) {
    for (const [caminho] of ler(arq).matchAll(/scripts\/deploy\/[\w./-]*\w/g)) {
      if (!existsSync(new URL(`../../${caminho}`, import.meta.url))) faltando.push(`${arq}: ${caminho}`);
    }
  }
  assert.deepEqual(faltando, []);
});

// A chave do host (impressão digital fixada, HostKeyAlias e o resumo sem o host) é testada em .github/scripts/chave-host.test.mjs.
