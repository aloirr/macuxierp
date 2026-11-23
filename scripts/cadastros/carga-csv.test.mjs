// Testes da CLI de carga de CSV (T-0026, D10). Rodar: node --test scripts/cadastros/carga-csv.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  avisosObsoletos,
  CAMPO_ARQUIVOS,
  IGNORADAS,
  chaveIdempotencia,
  conferirPasta,
  contarLinhas,
  ErroUso,
  executar,
  formatarRelatorio,
  lerArgumentos,
  listarArquivos,
  MAX_ARQUIVOS_POR_POST,
  MAX_BYTES_LOTE,
  MAX_LINHAS_LOTE,
  montarLotes,
  ORDEM_CARGA,
  ROTA_CARGA,
} from './carga-csv.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SENTINELA = 'CELULA-SENTINELA-0026';
const pasta = mkdtempSync(join(tmpdir(), 'carga-csv-'));
writeFileSync(join(pasta, 'cliente.csv'), `external_id;razao_social\nc1;${SENTINELA}\n`);
writeFileSync(join(pasta, 'Filial.CSV'), 'external_id;nome\nf1;Matriz\n');
writeFileSync(join(pasta, 'rota.csv'), 'external_id\nr1\n');
writeFileSync(join(pasta, 'leia-me.txt'), 'não é csv');
after(() => rmSync(pasta, { recursive: true, force: true }));

const base = [
  '--api',
  'https://erp.exemplo.test',
  '--empresa',
  'empresa-teste',
  '--email',
  'adm@exemplo.test',
  '--pasta',
  pasta,
];

const RELATORIO = {
  lote_id: '00000000-0000-4000-8000-000000000001',
  modo: 'validar',
  entidades: [
    {
      entidade: 'filial',
      arquivo: 'Filial.CSV',
      situacao: 'processado',
      lidas: 1,
      inseridas: 1,
      atualizadas: 0,
      sem_mudanca: 0,
      recusadas: 0,
      colunas_ignoradas: [],
      avisos: [],
    },
    {
      entidade: 'cliente',
      arquivo: 'cliente.csv',
      situacao: 'processado',
      lidas: 1,
      inseridas: 0,
      atualizadas: 0,
      sem_mudanca: 0,
      recusadas: 1,
      colunas_ignoradas: ['telefone'],
      avisos: [],
    },
  ],
  erros: [
    {
      arquivo: 'cliente.csv',
      linha: 2,
      campo: 'documento',
      codigo: 'RN-CAD-01',
      motivo: 'CPF/CNPJ inválido',
    },
  ],
  erros_omitidos: 0,
};

/** fetch falso: guarda os pedidos e responde login e carga. */
function fetchFalso(replay = false) {
  const pedidos = [];
  const f = async (url, init) => {
    pedidos.push({ url, init });
    if (url.endsWith('/v1/auth/login'))
      return new Response(JSON.stringify({ token_acesso: 'token-falso' }), { status: 200 });
    return new Response(JSON.stringify(RELATORIO), {
      status: 200,
      headers: replay ? { 'idempotency-replayed': 'true' } : {},
    });
  };
  return { f, pedidos };
}

describe('carga-csv.mjs: argumentos', () => {
  it('valida por padrão; --gravar grava; senha nunca por argumento', () => {
    assert.equal(lerArgumentos(base).modo, 'validar');
    assert.equal(lerArgumentos([...base, '--gravar']).modo, 'gravar');
    assert.throws(() => lerArgumentos([...base, '--validar', '--gravar']), /não os dois/);
    assert.throws(() => lerArgumentos([...base, '--senha', 'x']), /não entra por argumento/);
  });

  it('exige https fora do localhost, empresa, e-mail, pasta e entidade conhecida', () => {
    assert.throws(() => lerArgumentos(['--api', 'http://erp.exemplo.test', ...base.slice(2)]), /https/);
    assert.equal(
      lerArgumentos(['--api', 'http://localhost:3000/x', ...base.slice(2)]).api,
      'http://localhost:3000',
    );
    assert.throws(() => lerArgumentos(base.slice(0, 6)), /--pasta/);
    assert.throws(() => lerArgumentos([...base, '--entidade', 'catalogo_no']), ErroUso);
    assert.deepEqual(lerArgumentos([...base, '--entidade', 'Cliente']).entidades, ['cliente']);
  });
});

describe('carga-csv.mjs: pasta e arquivos', () => {
  it('recusa pasta dentro de um checkout do git (este repositório ou outro)', () => {
    assert.throws(() => conferirPasta(AQUI), /dentro de um repositório git/);
    const outroRepo = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(outroRepo, '.git'));
    mkdirSync(join(outroRepo, 'dados'));
    try {
      assert.throws(() => conferirPasta(join(outroRepo, 'dados')), /dentro de um repositório git/);
    } finally {
      rmSync(outroRepo, { recursive: true, force: true });
    }
    assert.throws(() => conferirPasta(join(pasta, 'nao-existe')), /não existe/);
    assert.ok(conferirPasta(pasta));
  });

  it('só .csv, na ordem D13 (sem diferença de maiúsculas), ignorados no fim; --entidade filtra', () => {
    assert.deepEqual(
      listarArquivos(pasta).map((a) => a.nome),
      ['Filial.CSV', 'cliente.csv', 'rota.csv'],
    );
    assert.deepEqual(
      listarArquivos(pasta, ['cliente']).map((a) => a.nome),
      ['cliente.csv'],
    );
  });

  it('v0.3.6: condicoes_pagamento.csv vale condicao_pagamento; forma, prazo e cliente_endereco ficam de fora com aviso', async () => {
    const p = mkdtempSync(join(tmpdir(), 'carga-csv-v036-'));
    try {
      for (const n of [
        'cliente.csv',
        'Condicoes_Pagamento.csv',
        'forma_pagamento.csv',
        'prazo_pagamento.csv',
        'cliente_endereco.csv',
        'filial.csv',
      ])
        writeFileSync(join(p, n), 'external_id\nx1\n');
      assert.deepEqual(
        listarArquivos(p).map((a) => a.nome),
        ['filial.csv', 'Condicoes_Pagamento.csv', 'cliente.csv'],
      );
      assert.deepEqual(
        listarArquivos(p, ['condicao_pagamento']).map((a) => a.nome),
        ['Condicoes_Pagamento.csv'],
      );
      assert.deepEqual(avisosObsoletos(p), [
        'cliente_endereco.csv: desde a v0.3.6 vai em cliente.csv',
        'forma_pagamento.csv: desde a v0.3.6 vai em condicao_pagamento.csv',
        'prazo_pagamento.csv: desde a v0.3.6 vai em condicao_pagamento.csv',
      ]);
      assert.throws(() => lerArgumentos([...base, '--entidade', 'forma_pagamento']), ErroUso);
      const { f, pedidos } = fetchFalso();
      const saida = [];
      await executar(
        [
          '--api',
          'https://erp.exemplo.test',
          '--empresa',
          'empresa-teste',
          '--email',
          'adm@exemplo.test',
          '--pasta',
          p,
        ],
        {
          fetch: f,
          senha: async () => 's',
          escrever: (t) => saida.push(t),
        },
      );
      assert.deepEqual(
        pedidos[1].init.body.getAll(CAMPO_ARQUIVOS).map((a) => a.name),
        ['filial.csv', 'Condicoes_Pagamento.csv', 'cliente.csv'],
      );
      assert.equal(saida.filter((t) => /desde a v0\.3\.6/.test(t)).length, 3);
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  });

  it('conta linhas sem ler o conteúdo e divide o lote acima de D7 em um POST por arquivo', () => {
    assert.equal(contarLinhas(Buffer.from('a\nb\n')), 2);
    assert.equal(contarLinhas(Buffer.from('a\nb')), 2);
    const a = { nome: 'a.csv', bytes: Buffer.from('x'), linhas: MAX_LINHAS_LOTE };
    const b = { nome: 'b.csv', bytes: Buffer.from('y'), linhas: 1 };
    assert.equal(montarLotes([a]).length, 1);
    assert.deepEqual(montarLotes([a, b]), [[a], [b]]);
  });

  it('Idempotency-Key: SHA-256 do modo, nomes e conteúdos; muda se algum muda', () => {
    const lote = [{ nome: 'cliente.csv', bytes: Buffer.from('a') }];
    const k = chaveIdempotencia('validar', lote);
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.equal(chaveIdempotencia('validar', [{ nome: 'CLIENTE.csv', bytes: Buffer.from('a') }]), k);
    assert.notEqual(chaveIdempotencia('gravar', lote), k);
    assert.notEqual(chaveIdempotencia('validar', [{ nome: 'cliente.csv', bytes: Buffer.from('b') }]), k);
  });
});

describe('carga-csv.mjs: fluxo HTTP', () => {
  it('login, um multipart com modo e os arquivos no campo "arquivos", Idempotency-Key e relatório sem valor de célula', async () => {
    const { f, pedidos } = fetchFalso();
    const saida = [];
    const codigo = await executar(base, {
      fetch: f,
      senha: async () => 'senha-digitada',
      escrever: (t) => saida.push(t),
    });
    assert.equal(codigo, 1); // há linha recusada
    assert.equal(pedidos.length, 2);
    assert.equal(pedidos[0].url, 'https://erp.exemplo.test/v1/auth/login');
    assert.deepEqual(JSON.parse(pedidos[0].init.body), {
      empresa: 'empresa-teste',
      email: 'adm@exemplo.test',
      senha: 'senha-digitada',
    });
    const carga = pedidos[1];
    assert.equal(carga.url, `https://erp.exemplo.test${ROTA_CARGA}`);
    assert.equal(carga.init.headers.authorization, 'Bearer token-falso');
    assert.match(carga.init.headers['idempotency-key'], /^[0-9a-f]{64}$/);
    assert.equal(carga.init.body.get('modo'), 'validar');
    assert.deepEqual(
      carga.init.body.getAll(CAMPO_ARQUIVOS).map((a) => a.name),
      ['Filial.CSV', 'cliente.csv', 'rota.csv'],
    );
    const texto = saida.join('\n');
    assert.match(texto, /cliente\.csv:2 \[documento\] RN-CAD-01/);
    assert.match(texto, /colunas ignoradas telefone/);
    for (const proibido of [SENTINELA, 'senha-digitada', 'token-falso'])
      assert.ok(!texto.includes(proibido), `saída com ${proibido}`);
  });

  it('resposta repetida da API é avisada; login recusado sai com o status, sem a senha', async () => {
    const { f } = fetchFalso(true);
    const saida = [];
    await executar([...base, '--entidade', 'filial'], {
      fetch: f,
      senha: async () => 's',
      escrever: (t) => saida.push(t),
    });
    assert.match(saida.join('\n'), /relatório guardado/);
    const negado = async () => new Response(JSON.stringify({ codigo: 'NAO_AUTENTICADO' }), { status: 401 });
    await assert.rejects(
      executar(base, { fetch: negado, senha: async () => 'senha-x', escrever: () => {} }),
      (e) => /HTTP 401 NAO_AUTENTICADO/.test(e.message) && !e.message.includes('senha-x'),
    );
  });

  it('formatarRelatorio mostra a tabela por entidade e os erros omitidos', () => {
    const t = formatarRelatorio({ ...RELATORIO, erros_omitidos: 3 });
    assert.match(t, /^Lote 0{8}-/);
    assert.match(t, /filial\s+processado\s+1\s+1/);
    assert.match(t, /mais 3 erros/);
  });

  it('não abre banco: nenhum import de pg nem variável de conexão', () => {
    const fonte = readFileSync(join(AQUI, 'carga-csv.mjs'), 'utf8');
    assert.ok(!/from ['"]pg['"]|require\(['"]pg['"]\)|DATABASE_URL|PGPASSWORD/.test(fonte));
    assert.ok(!/process\.env/.test(fonte), 'nada lido do ambiente (senha nunca por variável)');
  });
});

// RD-0101: as cópias da CLI (o Node não importa o TS) conferidas contra a fonte. O SDK já está no main; o contrato da
// carga em modules/cadastros/contracts chega na etapa 2 do modulo-cadastros: enquanto ele não tiver nenhum dos nomes, a
// conferência do contrato sai como SKIP explícito; com qualquer um deles publicado, todos são exigidos e conferidos.
describe('carga-csv.mjs: sincronia com o SDK e o contrato de cadastros', () => {
  const RAIZ = join(AQUI, '..', '..');
  const ler = (rel) => {
    try {
      return readFileSync(join(RAIZ, rel), 'utf8');
    } catch {
      return '';
    }
  };
  /** Valor de `export const NOME = 10 * 1_048_576;` (só inteiros multiplicados); `undefined` se não existe. */
  const numero = (fonte, nome) => {
    const m = new RegExp(`export const ${nome}\\s*=\\s*([\\d_\\s*]+);`).exec(fonte);
    return m ? m[1].split('*').reduce((t, x) => t * Number(x.trim().replaceAll('_', '')), 1) : undefined;
  };
  const lista = (fonte, nome) => {
    const m = new RegExp(`export const ${nome}\\s*=\\s*\\[([^\\]]*)\\]`).exec(fonte);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : undefined;
  };
  const rotas = ler('packages/platform-sdk/src/rotas.ts');
  const idempotencia = ler('packages/platform-sdk/src/idempotencia.ts');
  const contrato = ler('modules/cadastros/contracts/index.ts');

  it('SDK: teto do multipart e quantidade de arquivos cobrem o lote; nomes dos cabeçalhos de idempotência', () => {
    assert.equal(numero(rotas, 'TAMANHO_MAXIMO_MULTIPART'), MAX_BYTES_LOTE);
    assert.ok(numero(rotas, 'QUANTIDADE_MAXIMA_ARQUIVOS') >= MAX_ARQUIVOS_POR_POST);
    assert.match(idempotencia, /export const CABECALHO_IDEMPOTENCIA = 'idempotency-key';/);
    assert.match(idempotencia, /export const CABECALHO_REPETIDA = 'idempotency-replayed';/);
    const fonte = readFileSync(join(AQUI, 'carga-csv.mjs'), 'utf8');
    assert.match(fonte, /'idempotency-key': chaveIdempotencia/);
    assert.match(fonte, /headers\.get\('idempotency-replayed'\)/);
  });

  it('SDK: ORDEM_CARGA é a ordem de CADASTROS_CARGA_PORTAL, com os 8 cadastros', () => {
    const portal = ler('packages/platform-sdk/src/portal-cargas.ts');
    const bloco = /export const CADASTROS_CARGA_PORTAL = Object\.freeze\(\[([\s\S]*?)\]\s*as const\)/.exec(portal);
    assert.ok(bloco, 'CADASTROS_CARGA_PORTAL não encontrado no SDK');
    const doSdk = [...bloco[1].matchAll(/cadastro: '([^']+)'/g)].map((x) => x[1]);
    assert.equal(doSdk.length, 8);
    assert.deepEqual(ORDEM_CARGA, doSdk);
  });

  it('contrato de cadastros: limites, máximo de arquivos e entidades ignoradas', (t) => {
    const nomes = [
      'MAX_BYTES_LOTE',
      'MAX_LINHAS_LOTE',
      'ENTIDADES_IGNORADAS',
      'CargaPedido',
    ];
    const existe = (nome) => new RegExp(`export const ${nome}\\b`).test(contrato);
    if (!nomes.some(existe)) {
      t.skip('contrato de cadastros sem os limites da carga ainda');
      return;
    }
    // Com o contrato publicado, todos os nomes têm de existir e casar com o formato esperado (senão o teste falha).
    for (const nome of nomes) assert.ok(existe(nome), `contrato de cadastros sem ${nome}`);
    assert.equal(
      numero(contrato, 'MAX_BYTES_LOTE'),
      MAX_BYTES_LOTE,
      'MAX_BYTES_LOTE fora do formato ou diferente',
    );
    assert.equal(
      numero(contrato, 'MAX_LINHAS_LOTE'),
      MAX_LINHAS_LOTE,
      'MAX_LINHAS_LOTE fora do formato ou diferente',
    );
    const maxArquivos = /arquivos:\s*z\.array\([\s\S]*?\)\.min\(1\)\.max\((\d+)\)/.exec(contrato);
    assert.ok(maxArquivos, 'CargaPedido.arquivos sem .min(1).max(N)');
    assert.equal(Number(maxArquivos[1]), MAX_ARQUIVOS_POR_POST);
    assert.deepEqual(lista(contrato, 'ENTIDADES_IGNORADAS'), IGNORADAS);
  });
});
