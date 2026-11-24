// Testes da fumaça em produção (T-0065 b): funções puras e ponta a ponta contra um node:http local (sem rede externa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UUID_FICTICIO,
  classificarResposta,
  filtrarRotas,
  lerCampo,
  normalizarOrigem,
  passosDoCampo,
  relatorio,
  resolverParametros,
} from './fumaca-producao.mjs';

const SCRIPT = fileURLToPath(new URL('./fumaca-producao.mjs', import.meta.url));
// O corpo exato do setNotFoundHandler do apps/api (apps/api/src/app.ts).
const ROTA_INEXISTENTE = { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada' };
const FICTICIO_JSON = '9f000000-0000-4000-8000-000000000001';
const NOTAS = { tipo: 'lista', de: 'GET /v1/faturamento/notas', campo: 'itens[0].id' };

const rodar = (env) =>
  new Promise((ok) => {
    // env limpo: nada de FUMACA_* do ambiente de quem roda o teste
    const base = { PATH: process.env.PATH, HOME: process.env.HOME };
    execFile(
      process.execPath,
      [SCRIPT],
      { env: { ...base, ...env }, timeout: 20_000 },
      (erro, stdout, stderr) => ok({ codigo: erro ? erro.code : 0, saida: `${stdout}${stderr}` }),
    );
  });

// ---- classificação ----
test('classificação: 200 passa', () => {
  assert.deepEqual(classificarResposta({ status: 200 }), { ok: true, motivo: null });
});
test('classificação: 404 genérico (Rota não encontrada) falha', () => {
  assert.deepEqual(classificarResposta({ status: 404, corpo: ROTA_INEXISTENTE }), {
    ok: false,
    motivo: '404 genérico',
  });
});
test('classificação: 404 padrão do Fastify e 404 sem JSON também são genéricos', () => {
  assert.equal(
    classificarResposta({ status: 404, corpo: { message: 'Route GET:/v1/x not found', statusCode: 404 } }).ok,
    false,
  );
  assert.equal(classificarResposta({ status: 404, corpo: null }).ok, false);
});
test('classificação: 404 de regra passa (mesmo com o código NAO_ENCONTRADO, mas com outra mensagem)', () => {
  assert.equal(
    classificarResposta({ status: 404, corpo: { codigo: 'NAO_ENCONTRADO', mensagem: 'Nota não encontrado' } })
      .ok,
    true,
  );
  assert.equal(
    classificarResposta({ status: 404, corpo: { codigo: 'NOTA_INEXISTENTE', mensagem: 'x' } }).ok,
    true,
  );
});
test('classificação: 403 e 422 passam', () => {
  assert.equal(classificarResposta({ status: 403, corpo: null }).ok, true);
  assert.equal(classificarResposta({ status: 422, corpo: null }).ok, true);
});
test('classificação: 3xx falha (diferença documentada: o critério do testes aceita)', () => {
  assert.deepEqual(classificarResposta({ status: 302 }), { ok: false, motivo: 'redirecionamento' });
});
test('classificação: 500, 502, timeout e erro de rede falham', () => {
  assert.deepEqual(classificarResposta({ status: 500 }), { ok: false, motivo: '5xx' });
  assert.deepEqual(classificarResposta({ status: 502 }), { ok: false, motivo: '5xx' });
  assert.deepEqual(classificarResposta({ status: 0, erro: 'timeout' }), { ok: false, motivo: 'timeout' });
  assert.deepEqual(classificarResposta({ status: 0, erro: 'rede' }), { ok: false, motivo: 'erro de rede' });
});

// ---- filtro ----
test('filtro: só GET do BKO; plataforma fica de fora', () => {
  const { rotas, recusadas } = filtrarRotas({
    rotas: [
      { metodo: 'GET', caminho: '/v1/core/empresa', area: 'bko' },
      { metodo: 'GET', caminho: '/v1/plataforma/empresas', area: 'plataforma' },
    ],
  });
  assert.deepEqual(rotas, [{ metodo: 'GET', caminho: '/v1/core/empresa', origem: null }]);
  assert.deepEqual(recusadas, []);
});
test('filtro: método diferente de GET ou caminho fora de /v1 é recusado', () => {
  const { rotas, recusadas } = filtrarRotas({
    rotas: [
      { metodo: 'POST', caminho: '/v1/core/usuarios', area: 'bko' },
      { metodo: 'GET', caminho: 'https://outro.exemplo/v1/x', area: 'bko' },
      { metodo: 'GET', caminho: '/v1/core/empresa', area: 'bko' },
    ],
  });
  assert.equal(rotas.length, 1);
  assert.deepEqual(
    recusadas.map((r) => r.metodo),
    ['POST', 'GET'],
  );
});
test('filtro: JSON sem rotas[] é erro', () => {
  assert.ok(filtrarRotas({}).erro);
});
test('filtro: metodo ausente é GET', () => {
  const { rotas } = filtrarRotas({ formato: 1, rotas: [{ caminho: '/v1/core/empresa', area: 'bko' }] });
  assert.deepEqual(rotas, [{ metodo: 'GET', caminho: '/v1/core/empresa', origem: null }]);
});
test('formato 1: uuid_ficticio e origem vêm do JSON', () => {
  const r = filtrarRotas({
    formato: 1,
    uuid_ficticio: FICTICIO_JSON,
    rotas: [{ metodo: 'GET', caminho: '/v1/faturamento/notas/:id', area: 'bko', origem: NOTAS }],
  });
  assert.equal(r.erro, null);
  assert.equal(r.uuidFicticio, FICTICIO_JSON);
  assert.deepEqual(r.rotas[0].origem, { de: '/v1/faturamento/notas', campo: 'itens[0].id' });
});
test('formato 1 sem uuid_ficticio (ou inválido): usa o fixo', () => {
  assert.equal(filtrarRotas({ formato: 1, rotas: [] }).uuidFicticio, UUID_FICTICIO);
  assert.equal(filtrarRotas({ formato: 1, uuid_ficticio: 'x', rotas: [] }).uuidFicticio, UUID_FICTICIO);
});
test('formato antigo (sem formato): UUID fixo e todo parâmetro fictício, mesmo com origem', () => {
  const r = filtrarRotas({
    uuid_ficticio: FICTICIO_JSON,
    rotas: [{ metodo: 'GET', caminho: '/v1/faturamento/notas/:id', area: 'bko', origem: NOTAS }],
  });
  assert.equal(r.erro, null);
  assert.equal(r.uuidFicticio, UUID_FICTICIO);
  assert.equal(r.rotas[0].origem, null);
});
test('formato 2 (ou inválido) falha com mensagem clara', () => {
  const r = filtrarRotas({ formato: 2, rotas: [] });
  assert.match(r.erro, /formato 2.*só conhece até o formato 1/);
  assert.match(filtrarRotas({ formato: 'um', rotas: [] }).erro, /formato da lista de rotas inválido/);
});
test('formato 1: origem desconhecida ou lista fora de GET /v1 é recusada', () => {
  const { recusadas } = filtrarRotas({
    formato: 1,
    rotas: [
      { caminho: '/v1/a/:id', area: 'bko', origem: { tipo: 'outro' } },
      { caminho: '/v1/b/:id', area: 'bko', origem: { tipo: 'contexto', nome: 'toString' } },
      {
        caminho: '/v1/c/:id',
        area: 'bko',
        origem: { tipo: 'lista', de: 'POST /v1/c', campo: 'itens[0].id' },
      },
      { caminho: '/v1/d/:id', area: 'bko', origem: { tipo: 'lista', de: 'GET https://x/v1', campo: 'id' } },
      { caminho: '/v1/e/:id', area: 'bko', origem: { tipo: 'lista', de: 'GET /v1/e', campo: 'itens[*].id' } },
    ],
  });
  assert.equal(recusadas.length, 5);
  assert.ok(recusadas.every((r) => r.motivo));
});
test('origem: cada tipo normalizado', () => {
  assert.equal(normalizarOrigem(undefined), null);
  assert.equal(normalizarOrigem({ tipo: 'ficticio' }), null);
  assert.deepEqual(normalizarOrigem({ tipo: 'contexto', nome: 'filial' }), {
    de: '/v1/cadastros/filiais',
    campo: 'itens[0].id',
  });
  assert.deepEqual(normalizarOrigem({ tipo: 'contexto', nome: 'empresa' }), {
    de: '/v1/auth/eu',
    campo: 'empresa.id',
  });
  assert.deepEqual(normalizarOrigem(NOTAS), { de: '/v1/faturamento/notas', campo: 'itens[0].id' });
});
test('campo: notação a[0].b', () => {
  assert.deepEqual(passosDoCampo('itens[0].id'), ['itens', 0, 'id']);
  assert.equal(passosDoCampo('itens[x].id'), null);
  assert.equal(passosDoCampo('a..b'), null);
  assert.equal(lerCampo({ itens: [{ id: 'a' }], proximo_cursor: null }, 'itens[0].id'), 'a');
  assert.equal(lerCampo({ empresa: { id: 'e1' } }, 'empresa.id'), 'e1');
  assert.equal(lerCampo({ itens: [] }, 'itens[0].id'), null);
  assert.equal(lerCampo({ itens: { 0: { id: 'a' } } }, 'itens[0].id'), null);
  assert.equal(lerCampo(null, 'itens[0].id'), null);
  assert.equal(lerCampo({ itens: [{ id: 7 }] }, 'itens[0].id'), null);
});
test('filtro: a lista commitada só tem GET e tem rotas do BKO', () => {
  const raiz = fileURLToPath(new URL('../../', import.meta.url));
  const arquivo = join(raiz, 'tests/integracao/rotas/fumaca-rotas.json');
  if (!existsSync(arquivo)) return;
  const { rotas, recusadas, erro } = filtrarRotas(JSON.parse(readFileSync(arquivo, 'utf8')));
  assert.equal(erro, null);
  assert.deepEqual(recusadas, []);
  assert.ok(rotas.length > 0);
});

// ---- parâmetros ----
const origemNotas = normalizarOrigem(NOTAS);
test('parâmetros: lista → o campo do primeiro item, só no primeiro parâmetro', async () => {
  const chamadas = [];
  const ler = async (de, campo) => (chamadas.push(`${de} ${campo}`), 'id-real-1');
  const c = await resolverParametros('/v1/faturamento/notas/:id/x/:outro', {
    origem: origemNotas,
    uuidFicticio: FICTICIO_JSON,
    ler,
  });
  assert.equal(c, `/v1/faturamento/notas/id-real-1/x/${FICTICIO_JSON}`);
  assert.deepEqual(chamadas, ['/v1/faturamento/notas itens[0].id']);
});
test('parâmetros: contexto filial e empresa leem a lista certa', async () => {
  const chamadas = [];
  const ler = async (de) => (chamadas.push(de), de === '/v1/auth/eu' ? 'emp-1' : 'fil-1');
  const filial = await resolverParametros('/v1/faturamento/filiais/:id/configuracao', {
    origem: normalizarOrigem({ tipo: 'contexto', nome: 'filial' }),
    ler,
  });
  const empresa = await resolverParametros('/v1/plataforma/empresas/:id', {
    origem: normalizarOrigem({ tipo: 'contexto', nome: 'empresa' }),
    ler,
  });
  assert.equal(filial, '/v1/faturamento/filiais/fil-1/configuracao');
  assert.equal(empresa, '/v1/plataforma/empresas/emp-1');
  assert.deepEqual(chamadas, ['/v1/cadastros/filiais', '/v1/auth/eu']);
});
test('parâmetros: fictício, sem origem e lista vazia usam o uuid_ficticio, sem chamar lista à toa', async () => {
  const chamadas = [];
  const ler = async (de) => (chamadas.push(de), null);
  const opcoes = { uuidFicticio: FICTICIO_JSON, ler };
  for (const origem of [normalizarOrigem({ tipo: 'ficticio' }), null])
    assert.equal(
      await resolverParametros('/v1/core/exportacoes/:id', { ...opcoes, origem }),
      `/v1/core/exportacoes/${FICTICIO_JSON}`,
    );
  assert.deepEqual(chamadas, []);
  assert.equal(
    await resolverParametros('/v1/faturamento/notas/:id/xml', { ...opcoes, origem: origemNotas }),
    `/v1/faturamento/notas/${FICTICIO_JSON}/xml`,
  );
  assert.deepEqual(chamadas, ['/v1/faturamento/notas']);
});
test('parâmetros: sem uuidFicticio, o fixo', async () => {
  assert.equal(await resolverParametros('/v1/a/:id', { ler: async () => null }), `/v1/a/${UUID_FICTICIO}`);
});
test('relatório: método, caminho com :id e status', () => {
  const r = relatorio([{ metodo: 'GET', caminho: '/v1/x/:id', status: 404, motivo: '404 genérico' }], 3);
  assert.match(r, /1 de 3/);
  assert.match(r, /`GET \/v1\/x\/:id` — 404 \(404 genérico\)/);
});

// ---- execução ----
test('sem secrets: avisa e sai com 0', async () => {
  const { codigo, saida } = await rodar({ FUMACA_BASE_URL: 'http://127.0.0.1:9' });
  assert.equal(codigo, 0);
  assert.match(saida, /::warning::Fumaça em produção pulada: secrets FUMACA_\* ausentes/);
});

test('ponta a ponta (formato 1): login, origens, cache da lista, 404 genérico vira falha com relatório, logout e log sem dado pessoal', async () => {
  const ID_REAL = '3f1c2b9a-7d4e-4c1a-9b2f-5e6d7c8b9a01';
  const FILIAL = '4a1c2b9a-7d4e-4c1a-9b2f-5e6d7c8b9a02';
  const EMPRESA = '5b1c2b9a-7d4e-4c1a-9b2f-5e6d7c8b9a03';
  const EMAIL = 'leitura.fumaca@empresa-teste.exemplo';
  const TOKEN = 'token-de-acesso-secreto';
  const REFRESH = 'refresh-secreto';
  const vistos = [];
  let logout = null;
  const servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => (corpo += d));
    req.on('end', () => {
      vistos.push(`${req.method} ${req.url}`);
      const json = (status, obj, extra = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extra });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'POST' && req.url === '/v1/auth/login') {
        const e = JSON.parse(corpo);
        if (e.empresa !== 'empresa-teste' || e.email !== EMAIL || e.senha !== 's3nh@')
          return json(401, { codigo: 'X' });
        return json(
          200,
          { token_acesso: TOKEN, expira_em: new Date().toISOString() },
          {
            'set-cookie': `macuxierp_refresh=${REFRESH}; Path=/v1/auth; HttpOnly; Secure`,
          },
        );
      }
      if (req.method === 'POST' && req.url === '/v1/auth/sair') {
        logout = { autorizacao: req.headers.authorization, cookie: req.headers.cookie };
        res.writeHead(204).end();
        return;
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { codigo: 'SEM_SESSAO' });
      if (req.method !== 'GET') return json(405, {});
      if (req.url === '/v1/pedido/pedidos')
        return json(200, { itens: [{ id: ID_REAL, cliente: 'x' }], proximo_cursor: null });
      if (req.url === `/v1/pedido/pedidos/${ID_REAL}`) return json(200, { id: ID_REAL });
      if (req.url === '/v1/cadastros/filiais') return json(200, { itens: [{ id: FILIAL }] });
      if (req.url === `/v1/faturamento/filiais/${FILIAL}/configuracao`) return json(200, {});
      if (req.url === '/v1/auth/eu') return json(200, { usuario: { id: 'u' }, empresa: { id: EMPRESA } });
      if (req.url === `/v1/teste/empresas/${EMPRESA}`) return json(200, {});
      if (req.url === '/v1/faturamento/notas') return json(200, { itens: [], proximo_cursor: null });
      if (
        req.url.startsWith(`/v1/faturamento/notas/${FICTICIO_JSON}`) ||
        req.url === `/v1/core/exportacoes/${FICTICIO_JSON}`
      )
        return json(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Objeto não encontrado' });
      if (req.url === '/v1/core/empresa') return json(200, { nome: 'Empresa' });
      return json(404, ROTA_INEXISTENTE);
    });
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = servidor.address().port;
  const dir = mkdtempSync(join(tmpdir(), 'fumaca-'));
  const rotas = join(dir, 'rotas.json');
  const rel = join(dir, 'relatorio.md');
  writeFileSync(
    rotas,
    JSON.stringify({
      formato: 1,
      uuid_ficticio: FICTICIO_JSON,
      rotas: [
        { metodo: 'GET', caminho: '/v1/core/empresa', area: 'bko' },
        { metodo: 'GET', caminho: '/v1/pedido/pedidos', area: 'bko' },
        {
          caminho: '/v1/pedido/pedidos/:id',
          area: 'bko',
          origem: { tipo: 'lista', de: 'GET /v1/pedido/pedidos', campo: 'itens[0].id' },
        },
        { metodo: 'GET', caminho: '/v1/core/exportacoes/:id', area: 'bko', origem: { tipo: 'ficticio' } },
        {
          metodo: 'GET',
          caminho: '/v1/faturamento/filiais/:id/configuracao',
          area: 'bko',
          origem: { tipo: 'contexto', nome: 'filial' },
        },
        { caminho: '/v1/teste/empresas/:id', area: 'bko', origem: { tipo: 'contexto', nome: 'empresa' } },
        { metodo: 'GET', caminho: '/v1/faturamento/notas/:id', area: 'bko', origem: NOTAS },
        { metodo: 'GET', caminho: '/v1/faturamento/notas/:id/xml', area: 'bko', origem: NOTAS },
        { metodo: 'GET', caminho: '/v1/sumiu/rota', area: 'bko' },
        {
          metodo: 'GET',
          caminho: '/v1/plataforma/empresas/:id',
          area: 'plataforma',
          origem: { tipo: 'contexto', nome: 'empresa' },
        },
      ],
    }),
  );
  try {
    const { codigo, saida } = await rodar({
      FUMACA_BASE_URL: `http://127.0.0.1:${porta}/`,
      FUMACA_EMAIL: EMAIL,
      FUMACA_SENHA: 's3nh@',
      FUMACA_EMPRESA_ID: 'empresa-teste',
      FUMACA_ROTAS_JSON: rotas,
      FUMACA_RELATORIO: rel,
    });
    assert.equal(codigo, 1, saida);
    // login, lista antes do :id, plataforma fora, logout com Bearer e cookie de refresh
    assert.equal(vistos[0], 'POST /v1/auth/login');
    assert.ok(vistos.includes(`GET /v1/pedido/pedidos/${ID_REAL}`));
    assert.ok(!vistos.some((v) => v.includes('/v1/plataforma')));
    assert.ok(vistos.includes(`GET /v1/faturamento/filiais/${FILIAL}/configuracao`));
    assert.ok(vistos.includes(`GET /v1/teste/empresas/${EMPRESA}`));
    // lista vazia → fictício do JSON; a lista `de` é chamada uma vez só (cache)
    assert.ok(vistos.includes(`GET /v1/faturamento/notas/${FICTICIO_JSON}/xml`));
    assert.equal(vistos.filter((v) => v === 'GET /v1/faturamento/notas').length, 1);
    assert.ok(!vistos.some((v) => v.includes(UUID_FICTICIO)));
    assert.equal(vistos.at(-1), 'POST /v1/auth/sair');
    assert.deepEqual(logout, { autorizacao: `Bearer ${TOKEN}`, cookie: `macuxierp_refresh=${REFRESH}` });
    // log: uma linha por rota, caminho com :id
    assert.match(saida, /^GET \/v1\/pedido\/pedidos\/:id 200$/m);
    assert.match(saida, /^GET \/v1\/core\/exportacoes\/:id 404$/m);
    assert.match(saida, /^GET \/v1\/sumiu\/rota 404 404 genérico$/m);
    // relatório só com a rota que caiu
    const texto = readFileSync(rel, 'utf8');
    assert.match(texto, /1 de 9/);
    assert.match(texto, /`GET \/v1\/sumiu\/rota` — 404 \(404 genérico\)/);
    assert.doesNotMatch(texto, /pedidos/);
    // nada de id real, e-mail, senha, token ou refresh no log nem no relatório
    for (const segredo of [ID_REAL, FILIAL, EMPRESA, EMAIL, 's3nh@', TOKEN, REFRESH]) {
      assert.ok(!saida.includes(segredo), `log contém ${segredo === ID_REAL ? 'o id real' : 'um segredo'}`);
      assert.ok(!texto.includes(segredo));
    }
  } finally {
    servidor.close();
  }
});

test('ponta a ponta: tudo ok sai 0 com "N rotas ok"; timeout vira falha', async () => {
  let atrasar = false;
  const servidor = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/v1/auth/login') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ token_acesso: 't' }));
      }
      if (req.url === '/v1/lenta' && atrasar) return setTimeout(() => res.writeHead(200).end(), 1500);
      res.writeHead(req.url === '/v1/auth/sair' ? 204 : 200).end();
    });
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const dir = mkdtempSync(join(tmpdir(), 'fumaca-'));
  const rotas = join(dir, 'rotas.json');
  writeFileSync(
    rotas,
    JSON.stringify({
      rotas: [
        { metodo: 'GET', caminho: '/v1/a', area: 'bko' },
        { metodo: 'GET', caminho: '/v1/lenta', area: 'bko' },
      ],
    }),
  );
  const env = {
    FUMACA_BASE_URL: `http://127.0.0.1:${servidor.address().port}`,
    FUMACA_EMAIL: 'a@b.c',
    FUMACA_SENHA: 'x',
    FUMACA_EMPRESA_ID: 'e',
    FUMACA_ROTAS_JSON: rotas,
    FUMACA_TIMEOUT_MS: '300',
  };
  try {
    const ok = await rodar(env);
    assert.equal(ok.codigo, 0, ok.saida);
    assert.match(ok.saida, /^2 rotas ok$/m);
    atrasar = true;
    const lento = await rodar(env);
    assert.equal(lento.codigo, 1, lento.saida);
    assert.match(lento.saida, /^GET \/v1\/lenta timeout$/m);
  } finally {
    servidor.closeAllConnections?.();
    servidor.close();
  }
});

test('login recusado: sai 1 sem chamar rota nenhuma', async () => {
  const vistos = [];
  const servidor = createServer((req, res) => {
    vistos.push(req.url);
    req.resume();
    req.on('end', () => res.writeHead(401, { 'content-type': 'application/json' }).end('{}'));
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const dir = mkdtempSync(join(tmpdir(), 'fumaca-'));
  const rotas = join(dir, 'rotas.json');
  writeFileSync(rotas, JSON.stringify({ rotas: [{ metodo: 'GET', caminho: '/v1/a', area: 'bko' }] }));
  try {
    const r = await rodar({
      FUMACA_BASE_URL: `http://127.0.0.1:${servidor.address().port}`,
      FUMACA_EMAIL: 'a@b.c',
      FUMACA_SENHA: 'x',
      FUMACA_EMPRESA_ID: 'e',
      FUMACA_ROTAS_JSON: rotas,
    });
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /login da empresa de teste falhou/);
    assert.deepEqual(vistos, ['/v1/auth/login']);
  } finally {
    servidor.close();
  }
});

test('trava: título e rótulo que o publicar lê do scripts/ci/producao-trava.mjs', async () => {
  const m = await import('../../scripts/ci/producao-trava.mjs');
  assert.equal(m.tituloDaIssue('v1.2.3'), 'Aprovar deploy v1.2.3');
  assert.equal(m.ROTULO_TRAVA, 'trava-deploy');
});
