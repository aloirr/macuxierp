/**
 * T-0012: teste unitário do próprio dublê do Hub (`apoio/duble-hub.ts`), por HTTP cru (sem o emissor do arnês), contra
 * o guia do integrador do FDV (commit b75ab88). Se o dublê se afastar do contrato, é aqui que aparece.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnvelopeLote, LoteAceito, LoteResultado, RegistroHub } from './apoio/contrato-hub';
import {
  criarDubleHub,
  ErroBkoDuble,
  FILIAL_PADRAO_DUBLE,
  gerarChaveConector,
  type ConectorDuble,
  type DubleHub,
  type OpcoesDuble,
} from './apoio/duble-hub';
import { cnpjFicticio } from './apoio/massa';
import { RelogioDeTeste } from './apoio/relogio';

const INICIO = new Date('2026-11-21T15:00:00.000Z');
const T = (s: number) => new Date(INICIO.getTime() + s * 1000).toISOString();
const CHAVE_IDEM = 'chave-de-teste-0000000001';

let relogio: RelogioDeTeste;
let duble: DubleHub;
let con: ConectorDuble;

async function subir(o: Omit<OpcoesDuble, 'relogio'> = {}) {
  await duble?.fechar();
  relogio = new RelogioDeTeste(INICIO);
  duble = await criarDubleHub({ relogio, ...o });
  con = duble.registrarConector({ tenant: 'tenant-a', conectorId: 'erp-a' });
}

beforeEach(async () => {
  await subir();
});
afterEach(async () => {
  await duble.fechar();
});

interface Chamada {
  corpo?: unknown;
  bruto?: string;
  chave?: string | null;
  cab?: Record<string, string>;
  conector?: ConectorDuble;
}

async function chamar(metodo: 'GET' | 'POST', caminho: string, c: Chamada = {}) {
  const k = c.conector ?? con;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${k.chave}`,
    'X-Macuxi-Conector-Id': k.conectorId,
    'X-Macuxi-Conector-Versao': '1.4.0',
    ...c.cab,
  };
  if (c.chave !== null) headers['Idempotency-Key'] = c.chave ?? CHAVE_IDEM;
  const body = c.bruto ?? (c.corpo === undefined ? undefined : JSON.stringify(c.corpo));
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${duble.url}${caminho}`, { method: metodo, headers, body });
  const texto = await r.text();
  return {
    status: r.status,
    h: r.headers,
    json: (texto ? JSON.parse(texto) : null) as Record<string, unknown>,
  };
}

const env = (
  entidade: string,
  registros: RegistroHub[],
  extra: Partial<EnvelopeLote> = {},
): EnvelopeLote => ({
  versao_contrato: 'v1',
  entidade,
  modo: 'delta',
  registros,
  ...extra,
});

const forma = (id: string, s = 0, nome = 'Boleto'): RegistroHub => ({
  external_id: id,
  alterado_em: T(s),
  ativo: true,
  codigo: id.toUpperCase(),
  nome,
});
const filial = (id: string, extra: Record<string, unknown> = {}): RegistroHub => ({
  external_id: id,
  alterado_em: T(0),
  codigo: '1234',
  nome: 'Filial X',
  cnpj: cnpjFicticio('1234'),
  logradouro: 'Rua A',
  numero: '1',
  bairro: 'Centro',
  cep: '69301000',
  cidade: 'Boa Vista',
  uf: 'RR',
  ...extra,
});

/** Envia e consulta até o estado final. */
async function enviarEConcluir(
  e: EnvelopeLote,
  chave = `k-${Math.random().toString(36).slice(2)}-0000000000`,
) {
  const r = await chamar('POST', '/lotes', { corpo: e, chave });
  expect(r.status).toBe(202);
  const id = (r.json as unknown as LoteAceito).lote_id;
  await chamar('GET', `/lotes/${id}`);
  const fim = await chamar('GET', `/lotes/${id}`);
  return fim.json as unknown as LoteResultado;
}

describe('T-0012 — dublê do Hub: autenticação e cabeçalhos', () => {
  it('sem Authorization, chave fora do formato, chave desconhecida ou Conector errado: 401 genérico com X-Request-Id', async () => {
    const casos: Record<string, string>[] = [
      { 'X-Macuxi-Conector-Id': 'erp-a' },
      { Authorization: 'Bearer abc', 'X-Macuxi-Conector-Id': 'erp-a' },
      { Authorization: `Bearer ${gerarChaveConector()}`, 'X-Macuxi-Conector-Id': 'erp-a' },
      { Authorization: `Bearer ${con.chave}`, 'X-Macuxi-Conector-Id': 'erp-b' },
      { Authorization: `Bearer ${con.chave}` },
    ];
    for (const headers of casos) {
      const r = await fetch(`${duble.url}/cursores/filial`, { headers });
      const j = (await r.json()) as Record<string, unknown>;
      expect(r.status).toBe(401);
      expect(j).toMatchObject({ codigo: 'credencial_invalida', mensagem: 'Credencial inválida.' });
      expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(j.requisicao_id).toBe(r.headers.get('x-request-id'));
    }
  });

  it('o registro das requisições mascara a chave e guarda os cabeçalhos do Conector', async () => {
    await chamar('GET', '/cursores/filial', { cab: { 'User-Agent': 'macuxierp/0.1.0' } });
    const vista = duble.requisicoes.at(-1)!;
    expect(vista.cabecalhos.authorization).toBe('Bearer mxc_***');
    expect(vista.cabecalhos['user-agent']).toBe('macuxierp/0.1.0');
    expect(vista.cabecalhos['x-macuxi-conector-versao']).toBe('1.4.0');
    expect(JSON.stringify(duble.requisicoes) + duble.log.join('\n')).not.toContain(con.chave);
  });

  it('rota fora de /integracao/v1 ou desconhecida: 404', async () => {
    expect((await chamar('GET', '/nada')).status).toBe(404);
    expect((await fetch(duble.url.replace('/integracao/v1', '/outra'))).status).toBe(404);
    expect((await chamar('GET', '/cursores/pedido')).json.codigo).toBe('entidade_desconhecida');
  });
});

describe('T-0012 — dublê do Hub: envelope de POST /lotes', () => {
  it('Idempotency-Key ausente: 400; fora de 16 a 128 caracteres [A-Za-z0-9._:-]: 422 (premissa do arnês); nada é criado', async () => {
    const corpo = env('forma_pagamento', [forma('f1')]);
    const ausente = await chamar('POST', '/lotes', { corpo, chave: null });
    expect([ausente.status, ausente.json.codigo]).toEqual([400, 'chave_idempotencia_invalida']);
    for (const chave of [
      'curta',
      'a'.repeat(15),
      'a'.repeat(129),
      'chave/com/barra-0000000',
      'chave com espaco-000000',
      'chave+mais=igual-000000',
    ]) {
      const r = await chamar('POST', '/lotes', { corpo, chave });
      expect({
        chave: chave.length,
        status: r.status,
        codigo: r.json.codigo,
        campo: (r.json.erros as { campo: string }[])[0]?.campo,
      }).toEqual({
        chave: chave.length,
        status: 422,
        codigo: 'chave_idempotencia_invalida',
        campo: 'Idempotency-Key',
      });
    }
    expect(duble.estado('tenant-a').lotes.size).toBe(0);
    expect(duble.contar('tenant-a', 'forma_pagamento')).toBe(0);
  });

  it('Idempotency-Key no formato: 16 e 128 caracteres, com letras, números, ponto, hífen, sublinhado e dois-pontos, são aceitas', async () => {
    for (const [i, chave] of [
      'a'.repeat(16),
      'Z'.repeat(128),
      'lote:forma_pag.0-1',
      'A1b2C3d4E5f6G7h8',
    ].entries()) {
      const r = await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma(`f${i}`)]), chave });
      expect([chave.length, r.status]).toEqual([chave.length, 202]);
    }
  });

  it('acima de 5.000 registros: 422 acima_do_limite no campo registros; nenhum lote, nenhum registro', async () => {
    const r = await chamar('POST', '/lotes', {
      corpo: env(
        'forma_pagamento',
        Array.from({ length: 5001 }, (_, i) => forma(`f${i}`)),
      ),
    });
    expect([r.status, r.json.codigo, (r.json.erros as { campo: string }[])[0]?.campo]).toEqual([
      422,
      'acima_do_limite',
      'registros',
    ]);
    expect(duble.estado('tenant-a').lotes.size).toBe(0);
    expect(duble.estado('tenant-a').idempotencia.size).toBe(0);
    expect(duble.contar('tenant-a', 'forma_pagamento')).toBe(0);
  });

  it('recusas 422 do envelope, sem criar lote', async () => {
    const casos: [EnvelopeLote, string][] = [
      [{ ...env('forma_pagamento', [forma('f1')]), versao_contrato: 'v2' }, 'versao_nao_suportada'],
      [env('pedido', [forma('f1')]), 'entidade_desconhecida'],
      [env('forma_pagamento', []), 'lote_vazio'],
      [
        env(
          'forma_pagamento',
          Array.from({ length: 5001 }, (_, i) => forma(`f${i}`)),
        ),
        'acima_do_limite',
      ],
      [env('forma_pagamento', [forma('f1')], { modo: 'completo' }), 'sessao_ausente'],
      [
        env('forma_pagamento', [forma('f1')], {
          sessao: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', parte: 1, ultimo: true },
        }),
        'sessao_nao_se_aplica',
      ],
    ];
    for (const [i, [e, codigo]] of casos.entries()) {
      const r = await chamar('POST', '/lotes', { corpo: e, chave: `recusa-${i}-000000000000` });
      expect([r.status, r.json.codigo]).toEqual([422, codigo]);
    }
    expect(duble.estado('tenant-a').lotes.size).toBe(0);
    expect(duble.contar('tenant-a', 'forma_pagamento')).toBe(0);
  });

  it('5.000 registros passam (o limite é inclusivo)', async () => {
    const r = await chamar('POST', '/lotes', {
      corpo: env(
        'forma_pagamento',
        Array.from({ length: 5000 }, (_, i) => forma(`f${i}`)),
      ),
    });
    expect(r.status).toBe(202);
    expect(r.json.recebidos).toBe(5000);
  });

  it('JSON inválido: 400; corpo acima de 8 MiB: 413 corpo_grande', async () => {
    expect((await chamar('POST', '/lotes', { bruto: '{nao json' })).json.codigo).toBe('envelope_invalido');
    const grande = await chamar('POST', '/lotes', {
      bruto: JSON.stringify({ x: 'a'.repeat(8 * 1024 * 1024 + 10) }),
    });
    expect([grande.status, grande.json.codigo]).toEqual([413, 'corpo_grande']);
  });
});

describe('T-0012 — dublê do Hub: lote, idempotência e consulta', () => {
  it('202 LoteAceito; GET /lotes/{id} passa por recebido e chega ao final; o cursor só avança no final', async () => {
    const r = await chamar('POST', '/lotes', {
      corpo: env('forma_pagamento', [forma('f2', 1), forma('f1', 1)]),
    });
    expect(r.status).toBe(202);
    const aceito = r.json as unknown as LoteAceito;
    expect(aceito).toMatchObject({
      status: 'recebido',
      entidade: 'forma_pagamento',
      modo: 'delta',
      recebidos: 2,
      repetido: false,
      consulta: `/integracao/v1/lotes/${aceito.lote_id}`,
    });
    expect(r.h.get('idempotent-replay')).toBeNull();
    expect((await chamar('GET', `/lotes/${aceito.lote_id}`)).json.status).toBe('recebido');
    expect((await chamar('GET', '/cursores/forma_pagamento')).json.cursor).toBeNull();
    const fim = (await chamar('GET', `/lotes/${aceito.lote_id}`)).json as unknown as LoteResultado;
    expect(fim).toMatchObject({
      status: 'concluido',
      contagens: { recebidas: 2, novas: 2, com_erro: 0 },
      erros: [],
      erros_total: 0,
    });
    expect((await chamar('GET', '/cursores/forma_pagamento')).json.cursor).toEqual({
      alterado_em: T(1),
      external_id: 'f2',
    });
  });

  it('mesma chave e mesmo conteúdo: 202, Idempotent-Replay: true, mesmo lote_id e nada muda; outro conteúdo: 409', async () => {
    const e = env('forma_pagamento', [forma('f1')]);
    const a = await chamar('POST', '/lotes', { corpo: e });
    const b = await chamar('POST', '/lotes', { corpo: { ...e, enviado_em: T(99) } });
    expect(b.status).toBe(202);
    expect(b.h.get('idempotent-replay')).toBe('true');
    expect(b.json).toMatchObject({ lote_id: a.json.lote_id, repetido: true });
    expect(duble.estado('tenant-a').lotes.size).toBe(1);
    expect(duble.contar('tenant-a', 'forma_pagamento')).toBe(1);
    const c = await chamar('POST', '/lotes', {
      corpo: env('forma_pagamento', [forma('f1', 0, 'Outro nome')]),
    });
    expect([c.status, c.json.codigo]).toEqual([409, 'chave_idempotencia_reutilizada']);
    expect(c.h.get('idempotent-replay')).toBeNull();
    // o 409 não muda nada: o registro continua o do primeiro envio
    expect(duble.estado('tenant-a').lotes.size).toBe(1);
    expect(duble.registro('tenant-a', 'forma_pagamento', 'f1')?.nome).toBe('Boleto');
  });

  it('lote de outro Conector ou inexistente: 404; limite_erros fora de 0–5.500: 400', async () => {
    const r = await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]) });
    const outro = duble.registrarConector({ tenant: 'tenant-b', conectorId: 'erp-b' });
    expect((await chamar('GET', `/lotes/${String(r.json.lote_id)}`, { conector: outro })).json.codigo).toBe(
      'lote_nao_encontrado',
    );
    expect((await chamar('GET', '/lotes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).status).toBe(404);
    expect((await chamar('GET', '/lotes/nao-uuid')).status).toBe(400);
    expect((await chamar('GET', `/lotes/${String(r.json.lote_id)}?limite_erros=5501`)).status).toBe(400);
  });

  it('tenants separados pela chave: o lote de um não aparece no outro', async () => {
    const outro = duble.registrarConector({ tenant: 'tenant-b', conectorId: 'erp-b' });
    await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]) });
    expect(duble.contar('tenant-b', 'forma_pagamento')).toBe(0);
    expect((await chamar('GET', '/cursores/forma_pagamento', { conector: outro })).json.cursor).toBeNull();
  });
});

describe('T-0012 — dublê do Hub: erro por linha e upsert', () => {
  it('referência ainda não carregada vira referencia_ausente reprocessável; depois da filial, a mesma linha entra', async () => {
    const vend = {
      external_id: 'v1',
      alterado_em: T(1),
      nome: 'Vendedora Ficticia',
      filial_external_id: 'fil-1',
    };
    const r1 = await enviarEConcluir(env('vendedor', [vend]));
    expect(r1.status).toBe('concluido_com_erros');
    expect(r1.erros).toEqual([
      expect.objectContaining({
        indice: 0,
        external_id: 'v1',
        codigo: 'referencia_ausente',
        campo: 'filial_external_id',
        reprocessavel: true,
        origem: 'hub',
      }),
    ]);
    expect(r1.erros[0]!.mensagem).not.toContain('fil-1');
    expect((await enviarEConcluir(env('filial', [filial('fil-1')]))).contagens.novas).toBe(1);
    expect((await enviarEConcluir(env('vendedor', [vend]))).contagens).toMatchObject({
      novas: 1,
      com_erro: 0,
    });
  });

  it('vendedor sem filial_external_id volta como linha referencia_ausente no campo filial_external_id (nada é gravado)', async () => {
    const r = await enviarEConcluir(
      env('vendedor', [
        { external_id: 'v-sem', alterado_em: T(1), nome: 'Vendedora Sem Filial' },
        { external_id: 'v-vazia', alterado_em: T(2), nome: 'Vendedora Vazia', filial_external_id: ' ' },
      ]),
    );
    expect(r.status).toBe('concluido_com_erros');
    expect(r.erros.map((e) => [e.external_id, e.codigo, e.campo, e.origem])).toEqual([
      ['v-sem', 'referencia_ausente', 'filial_external_id', 'hub'],
      ['v-vazia', 'referencia_ausente', 'filial_external_id', 'hub'],
    ]);
    expect(JSON.stringify(r.erros)).not.toContain('Vendedora');
    expect(duble.contar('tenant-a', 'vendedor')).toBe(0);
  });

  it('preço e estoque sem filial_external_id vão para a filial padrão do tenant; com a filial, ficam nela', async () => {
    await enviarEConcluir(
      env('filial', [filial('fil-1'), filial('fil-2', { codigo: '1235', cnpj: cnpjFicticio('1235') })]),
    );
    await enviarEConcluir(
      env('produto', [{ external_id: 'p1', alterado_em: T(1), sku: 'P1', nome: 'Produto 1', unidade: 'UN' }]),
    );
    const preco = (id: string, extra: Record<string, unknown> = {}): RegistroHub => ({
      external_id: id,
      alterado_em: T(2),
      tabela_external_id: 'tab',
      tabela_nome: 'Tabela',
      vigencia_inicio: '2026-11-01',
      produto_external_id: 'p1',
      preco_cents: 990,
      ...extra,
    });
    const estoque = (id: string, extra: Record<string, unknown> = {}): RegistroHub => ({
      external_id: id,
      alterado_em: T(3),
      deposito_external_id: 'dep',
      produto_external_id: 'p1',
      saldo: '1',
      ...extra,
    });
    expect(
      (
        await enviarEConcluir(
          env('preco', [preco('pr-sem'), preco('pr-fil2', { filial_external_id: 'fil-2' })]),
        )
      ).contagens,
    ).toMatchObject({ novas: 2, com_erro: 0 });
    expect(
      (
        await enviarEConcluir(
          env('estoque', [estoque('es-sem'), estoque('es-nulo', { filial_external_id: null })]),
        )
      ).contagens,
    ).toMatchObject({ novas: 2, com_erro: 0 });
    expect(duble.filialAplicada('tenant-a', 'preco', 'pr-sem')).toBe(FILIAL_PADRAO_DUBLE);
    expect(duble.filialAplicada('tenant-a', 'estoque', 'es-sem')).toBe(FILIAL_PADRAO_DUBLE);
    expect(duble.filialAplicada('tenant-a', 'estoque', 'es-nulo')).toBe(FILIAL_PADRAO_DUBLE);
    expect(duble.filialAplicada('tenant-a', 'preco', 'pr-fil2')).toBe('fil-2');
    // com a filial padrão apontada para uma filial carregada, o registro sem filial vai para ela
    duble.definirFilialPadrao('tenant-a', 'fil-1');
    await enviarEConcluir(env('preco', [preco('pr-sem-2')]));
    expect(duble.filialAplicada('tenant-a', 'preco', 'pr-sem-2')).toBe('fil-1');
    // só preço e estoque têm filial aplicada
    expect(duble.filialAplicada('tenant-a', 'produto', 'p1')).toBeNull();
  });

  it('campo obrigatório, centavos negativos, CNPJ da filial e UF: erro com o campo, mensagem sem o valor', async () => {
    const r = await enviarEConcluir(
      env('filial', [
        filial('a', { cnpj: undefined }),
        filial('b', { cnpj: '11222333000199' }),
        filial('c', { uf: 'R1' }),
        filial('d', { cep: '' }),
      ]),
    );
    expect(r.erros.map((e) => [e.external_id, e.codigo, e.campo])).toEqual([
      ['a', 'campo_obrigatorio', 'cnpj'],
      ['b', 'registro_invalido', 'cnpj'],
      ['c', 'registro_invalido', 'uf'],
      ['d', 'campo_obrigatorio', 'cep'],
    ]);
    expect(JSON.stringify(r.erros)).not.toContain('11222333000199');
    const t = await enviarEConcluir(
      env('cliente', [
        { external_id: 'c1', alterado_em: T(0), razao_social: 'Empresa Ficticia', limite_credito_cents: -1 },
        { external_id: 'c2', alterado_em: 'ontem', razao_social: 'X' },
      ]),
    );
    expect(t.erros.map((e) => [e.codigo, e.campo])).toEqual([
      ['valor_fora_da_faixa', 'limite_credito_cents'],
      ['campo_obrigatorio', 'alterado_em'],
    ]);
    expect(JSON.stringify(t.erros)).not.toContain('Empresa Ficticia');
  });

  it('T-0085: parcelas_dias do prazo recusado sai na linha com codigo e campo certos (a tabela completa fica em prazo-contrato.test.ts)', async () => {
    const prazo = (id: string, parcelas_dias: unknown) => ({
      external_id: id,
      alterado_em: T(0),
      forma_external_id: 'f1',
      codigo: id,
      parcelas_dias,
    });
    await enviarEConcluir(
      env('forma_pagamento', [{ external_id: 'f1', alterado_em: T(0), codigo: 'BOL', nome: 'Boleto' }]),
    );
    const r = await enviarEConcluir(
      env('prazo_pagamento', [prazo('lista', [28, 56]), prazo('texto', '28/56')]),
    );
    expect(r.contagens).toMatchObject({ novas: 1, com_erro: 1 });
    expect(r.erros.map((e) => [e.external_id, e.codigo, e.campo])).toEqual([
      ['texto', 'registro_invalido', 'parcelas_dias'],
    ]);
  });

  it('T-0108: contrato v2 do prazo (ADR 0072 do FDV): aceito só no prazo_pagamento, com descrição e prazo médio obrigatórios e o médio entre as parcelas', async () => {
    const prazo = (id: string, extra: Record<string, unknown> = {}) => ({
      external_id: id,
      alterado_em: T(0),
      forma_external_id: 'f1',
      codigo: id,
      descricao: `Prazo ${id}`,
      parcelas_dias: [30, 45],
      prazo_medio_dias: 38,
      ...extra,
    });
    await enviarEConcluir(
      env('forma_pagamento', [{ external_id: 'f1', alterado_em: T(0), codigo: 'BOL', nome: 'Boleto' }]),
    );
    const r = await enviarEConcluir({
      ...env('prazo_pagamento', [
        prazo('ok'),
        prazo('sem-medio', { prazo_medio_dias: undefined }),
        prazo('sem-descricao', { descricao: '' }),
        prazo('decresce', { parcelas_dias: [45, 30] }),
        prazo('fora', { prazo_medio_dias: 60 }),
      ]),
      versao_contrato: 'v2',
    });
    expect(r.contagens).toMatchObject({ novas: 1, com_erro: 4 });
    expect(r.erros.map((e) => [e.external_id, e.codigo, e.campo])).toEqual([
      ['sem-medio', 'campo_obrigatorio', 'prazo_medio_dias'],
      ['sem-descricao', 'campo_obrigatorio', 'descricao'],
      ['decresce', 'registro_invalido', 'parcelas_dias'],
      ['fora', 'registro_invalido', 'prazo_medio_dias'],
    ]);
    expect(duble.registro('tenant-a', 'prazo_pagamento', 'ok')).toMatchObject({ prazo_medio_dias: 38 });
    // na v1 o prazo médio ausente continua aceito
    const v1 = await enviarEConcluir(env('prazo_pagamento', [prazo('v1-sem-medio', { prazo_medio_dias: undefined })]));
    expect(v1.contagens).toMatchObject({ novas: 1, com_erro: 0 });
  });

  it('upsert monotônico: inalterada (mesmo conteúdo), atualizada (mais nova), obsoleta (mais velha); duplicada no lote conta uma vez', async () => {
    await enviarEConcluir(env('forma_pagamento', [forma('f1', 10)]));
    const r = await enviarEConcluir(
      env('forma_pagamento', [forma('f1', 20), forma('f2', 1), forma('f2', 2, 'Pix')]),
    );
    expect(r.contagens).toMatchObject({ recebidas: 3, inalteradas: 1, novas: 1, duplicadas_no_lote: 1 });
    expect(duble.registro('tenant-a', 'forma_pagamento', 'f2')?.nome).toBe('Pix');
    expect(
      (await enviarEConcluir(env('forma_pagamento', [forma('f1', 30, 'Boleto bancário')]))).contagens
        .atualizadas,
    ).toBe(1);
    expect(
      (await enviarEConcluir(env('forma_pagamento', [forma('f1', 5, 'Velho')]))).contagens.obsoletas,
    ).toBe(1);
    expect(duble.registro('tenant-a', 'forma_pagamento', 'f1')?.nome).toBe('Boleto bancário');
  });

  it('linhas_invalidas do Conector viram erro de origem conector', async () => {
    const r = await enviarEConcluir(
      env('forma_pagamento', [], {
        linhas_invalidas: [{ external_id: 'f9', codigo: 'campo_obrigatorio', campo: 'nome' }],
      }),
    );
    expect(r.erros).toEqual([
      expect.objectContaining({
        external_id: 'f9',
        codigo: 'campo_obrigatorio',
        campo: 'nome',
        origem: 'conector',
      }),
    ]);
  });

  it('carga completa: inativa o que não veio até 30 %; acima disso fica aguardando confirmação', async () => {
    const sessao = (id: string) => ({ modo: 'completo' as const, sessao: { id, parte: 1, ultimo: true } });
    const dez = Array.from({ length: 10 }, (_, i) => forma(`f${i}`));
    expect(
      (await enviarEConcluir(env('forma_pagamento', dez, sessao('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'))))
        .inativacao,
    ).toEqual({ situacao: 'nada_a_inativar', quantidade: 0 });
    expect(
      (
        await enviarEConcluir(
          env('forma_pagamento', dez.slice(0, 7), sessao('aaaaaaaa-aaaa-4aaa-8aaa-000000000002')),
        )
      ).inativacao,
    ).toEqual({ situacao: 'aplicada', quantidade: 3 });
    expect(duble.contar('tenant-a', 'forma_pagamento', { ativos: true })).toBe(7);
    expect(
      (
        await enviarEConcluir(
          env('forma_pagamento', dez.slice(0, 2), sessao('aaaaaaaa-aaaa-4aaa-8aaa-000000000003')),
        )
      ).inativacao,
    ).toEqual({ situacao: 'aguardando_confirmacao', quantidade: 5 });
    expect(duble.contar('tenant-a', 'forma_pagamento', { ativos: true })).toBe(7);
  });
});

describe('T-0012 — dublê do Hub: um Conector por entidade (RN-INT-13 do FDV)', () => {
  const KIT = 'kit-thathyany';
  const naoMuda = () => ({
    lotes: duble.estado('tenant-t').lotes.size,
    formas: duble.contar('tenant-t', 'forma_pagamento'),
  });

  /** Tenant "como na thathyany hoje": o kit dono de todas as entidades, o Conector do ERP sem nenhuma. */
  function comoNaThathyanyHoje(): { kit: ConectorDuble; erp: ConectorDuble } {
    const kit = duble.registrarConector({ tenant: 'tenant-t', conectorId: KIT });
    const erp = duble.registrarConector({ tenant: 'tenant-t', conectorId: 'macuxierp', entidades: [] });
    return { kit, erp };
  }

  it('o dublê guarda o dono de cada entidade; sem lista, o Conector fica com todas', () => {
    const { kit } = comoNaThathyanyHoje();
    expect(kit.entidades).toHaveLength(16);
    expect(duble.donoDaEntidade('tenant-t', 'forma_pagamento')).toBe(KIT);
    expect(duble.donoDaEntidade('tenant-t', 'nota')).toBe(KIT);
    expect(duble.donoDaEntidade('outro-tenant', 'forma_pagamento')).toBeNull();
  });

  it('topologia conflitante: cadastrar ou mudar um Conector com entidade de outro dá 409 topologia_conflitante e nada muda', () => {
    comoNaThathyanyHoje();
    const tentativas = [
      () =>
        duble.registrarConector({
          tenant: 'tenant-t',
          conectorId: 'macuxierp-2',
          entidades: ['forma_pagamento'],
        }),
      () => duble.registrarConector({ tenant: 'tenant-t', conectorId: 'macuxierp-3' }),
      () => duble.alterarEntidades('tenant-t', 'macuxierp', ['prazo_pagamento', 'forma_pagamento']),
    ];
    for (const t of tentativas) {
      let erro: unknown = null;
      try {
        t();
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ErroBkoDuble);
      expect(erro).toMatchObject({ status: 409, codigo: 'topologia_conflitante' });
    }
    expect(duble.donoDaEntidade('tenant-t', 'forma_pagamento')).toBe(KIT);
    expect(duble.donoDaEntidade('tenant-t', 'prazo_pagamento')).toBe(KIT);
  });

  it('lote de entidade de outro Conector: 422 entidade_de_outro_conector, sem lote, sem registro, sem chave guardada', async () => {
    const { erp } = comoNaThathyanyHoje();
    const r = await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]), conector: erp });
    expect([r.status, r.json.codigo, (r.json.erros as { campo: string }[])[0]?.campo]).toEqual([
      422,
      'entidade_de_outro_conector',
      'entidade',
    ]);
    expect(naoMuda()).toEqual({ lotes: 0, formas: 0 });
    expect(duble.estado('tenant-t').idempotencia.size).toBe(0);
  });

  it('virada de uma entidade (o kit solta, depois o ERP assume): o ERP envia; o kit passa a receber 422 nela', async () => {
    const { kit, erp } = comoNaThathyanyHoje();
    duble.alterarEntidades(
      'tenant-t',
      KIT,
      kit.entidades.filter((e) => e !== 'forma_pagamento'),
    );
    duble.alterarEntidades('tenant-t', 'macuxierp', ['forma_pagamento']);
    expect(duble.donoDaEntidade('tenant-t', 'forma_pagamento')).toBe('macuxierp');
    expect(
      (await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]), conector: erp }))
        .status,
    ).toBe(202);
    const doKit = await chamar('POST', '/lotes', {
      corpo: env('forma_pagamento', [forma('f2')]),
      conector: kit,
      chave: 'kit-chave-000000000001',
    });
    expect([doKit.status, doKit.json.codigo]).toEqual([422, 'entidade_de_outro_conector']);
    expect(
      (
        await chamar('POST', '/lotes', {
          corpo: env('prazo_pagamento', [
            {
              external_id: 'p',
              alterado_em: T(0),
              forma_external_id: 'f1',
              codigo: '28',
              parcelas_dias: [28],
            },
          ]),
          conector: erp,
          chave: 'erp-prazo-000000000001',
        })
      ).json.codigo,
    ).toBe('entidade_de_outro_conector');
  });

  it('semear grava como se o kit já tivesse enviado: o mesmo registro reenviado pelo ERP fica inalterado', async () => {
    const { kit, erp } = comoNaThathyanyHoje();
    duble.semear('tenant-t', 'forma_pagamento', [forma('f1', 5)]);
    duble.alterarEntidades(
      'tenant-t',
      KIT,
      kit.entidades.filter((e) => e !== 'forma_pagamento'),
    );
    duble.alterarEntidades('tenant-t', 'macuxierp', ['forma_pagamento']);
    expect((await chamar('GET', '/cursores/forma_pagamento', { conector: erp })).json.cursor).toBeNull();
    const r = await chamar('POST', '/lotes', {
      corpo: env('forma_pagamento', [forma('f1', 5)]),
      conector: erp,
    });
    const id = String(r.json.lote_id);
    await chamar('GET', `/lotes/${id}`, { conector: erp });
    const fim = (await chamar('GET', `/lotes/${id}`, { conector: erp })).json as unknown as LoteResultado;
    expect(fim.contagens).toMatchObject({ recebidas: 1, novas: 0, atualizadas: 0, inalteradas: 1 });
  });
});

describe('T-0012 — dublê do Hub: taxa, falhas, versão e o que fica para a T-0017', () => {
  it('balde de lotes vazio: 429 limite_de_taxa com Retry-After inteiro; o tempo repõe', async () => {
    await subir({ taxa: { lotes: { balde: 2, porMinuto: 20 } } });
    const e = (i: number) => ({
      corpo: env('forma_pagamento', [forma(`f${i}`)]),
      chave: `taxa-${i}-000000000000`,
    });
    expect((await chamar('POST', '/lotes', e(1))).status).toBe(202);
    expect((await chamar('POST', '/lotes', e(2))).status).toBe(202);
    const r = await chamar('POST', '/lotes', e(3));
    expect([r.status, r.json.codigo, r.h.get('retry-after')]).toEqual([429, 'limite_de_taxa', '3']);
    expect((await chamar('GET', '/cursores/filial')).status).toBe(200); // o balde geral é outro
    relogio.avancar(3000);
    expect((await chamar('POST', '/lotes', e(3))).status).toBe(202);
  });

  it('falha programada: 503 com Retry-After na próxima chamada da rota, depois volta ao normal', async () => {
    duble.programarFalha({ rota: 'POST /lotes', status: 503, retryAfter: '5' });
    const a = await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]) });
    expect([a.status, a.json.codigo, a.h.get('retry-after')]).toEqual([503, 'servico_indisponivel', '5']);
    expect((await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]) })).status).toBe(
      202,
    );
  });

  it('426 por versão mínima só na entidade configurada; o sinal continua liberado', async () => {
    await subir({ versaoMinimaPorEntidade: { cliente: '2.0.0' } });
    const r = await chamar('POST', '/lotes', {
      corpo: env('cliente', [{ external_id: 'c', alterado_em: T(0), razao_social: 'X' }]),
    });
    expect([r.status, r.json.codigo]).toEqual([426, 'abaixo_da_minima']);
    expect((await chamar('POST', '/lotes', { corpo: env('forma_pagamento', [forma('f1')]) })).status).toBe(
      202,
    );
    expect((await chamar('POST', '/sinal', { corpo: { versao_contrato: 'v1' }, chave: null })).status).toBe(
      200,
    );
  });

  it('pedidos (T-0017): 501 até a T-0017 registrar o tratador; rotasExtras substitui e recebe o estado do tenant', async () => {
    expect((await chamar('GET', '/pedidos/pendentes')).json.codigo).toBe('nao_implementado_no_duble');
    expect(
      (await chamar('POST', '/pedidos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/retorno', { corpo: {} })).status,
    ).toBe(501);
    await subir({
      rotasExtras: [
        {
          metodo: 'GET',
          padrao: /^\/pedidos\/pendentes$/,
          tratar: (ctx) => ({
            status: 200,
            corpo: { pedidos: [], tenant: ctx.conector.tenant, lotes: ctx.estado.lotes.size },
          }),
        },
      ],
    });
    expect((await chamar('GET', '/pedidos/pendentes')).json).toEqual({
      pedidos: [],
      tenant: 'tenant-a',
      lotes: 0,
    });
  });
});
