/**
 * T-0057 (E3): isolamento e segredo da `/entrada/v1` (ADR 0014 §3 e §4; regras 5, 6, 8 e 9 do CLAUDE.md), com as
 * respostas do engenheiro às premissas P-1, P-4, P-10 e P-11 do plano (`docs/testes/T-0057.md`).
 *
 * O alvo é o `alvoEntrada()`: hoje a `/entrada/v1` falsa; com `MACUXI_CENARIO_B_ALVO=real`, a API real
 * (`appPgDeTeste`, módulos de produção, Postgres local). Os casos `it.skipIf(!API_REAL)` só fazem sentido com a API real
 * e passam a rodar quando o alvo real existir; cada um diz o PR que o libera (`PR_LIBERA`). Não é teste desligado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_REAL, PR_LIBERA, alvoEntrada, rotaEntrada, type AlvoEntrada } from './apoio/alvo-entrada';
import { CAMINHOS_ENTRADA_V1, MAX_BYTES_LOTE_ENTRADA, caminho, type RespostaHttp } from './apoio/conector-simulado';
import { montarMassaCenarioB } from './apoio/massa-cenario-b';

const massa = montarMassaCenarioB();
let alvo: AlvoEntrada;

beforeAll(async () => {
  alvo = await alvoEntrada();
});
afterAll(async () => {
  await alvo?.fechar();
});

/** O 401 neutro da P-10: o mesmo para JWT, Bearer inválido, chave de outro tenant e conector desconhecido. */
function esperar401Neutro(r: RespostaHttp) {
  expect(r.status).toBe(401);
  expect(r.corpo).toMatchObject({ codigo: 'NAO_AUTENTICADO', detalhes: { codigo: 'credencial_invalida' } });
}

/** Tudo o que nunca pode sair em resposta ou log: as chaves, os JWT e os dados pessoais da massa. */
const segredos = () => [
  alvo.credencial('a').chave,
  alvo.credencial('b').chave,
  alvo.jwtUsuario('a'),
  ...massa.sensiveis,
];
function semSegredo(texto: string, extras: readonly string[] = []) {
  for (const s of [...segredos(), ...extras]) expect(texto.includes(s), 'segredo ou dado pessoal vazou').toBe(false);
}

/** Todas as rotas da `/entrada/v1` com o método (da constante única; troca pelo SDK no -3, regra T-0066). */
const ROTAS: [string, string][] = [
  ['POST', CAMINHOS_ENTRADA_V1.lotes],
  ['GET', caminho(CAMINHOS_ENTRADA_V1.lote, { id: '00000000-0000-4000-8000-000000000001' })],
  ['GET', caminho(CAMINHOS_ENTRADA_V1.cursor, { entidade: 'produto' })],
  ['POST', CAMINHOS_ENTRADA_V1.sinal],
  ['GET', CAMINHOS_ENTRADA_V1.pedidosPendentes],
  ['POST', caminho(CAMINHOS_ENTRADA_V1.pedidoRetorno, { uuid: '00000000-0000-4000-8000-000000000002' })],
  ['GET', CAMINHOS_ENTRADA_V1.notasPendentes],
  ['POST', caminho(CAMINHOS_ENTRADA_V1.notaRetorno, { chave: '1'.repeat(44) })],
  ['GET', CAMINHOS_ENTRADA_V1.clientesPendentes],
  ['POST', caminho(CAMINHOS_ENTRADA_V1.clienteRetorno, { uuid: '00000000-0000-4000-8000-000000000003' })],
];

describe('E3-1: só a credencial de máquina entra na /entrada/v1 (§3; regra 6)', () => {
  it('a lista de rotas cobre toda a CAMINHOS_ENTRADA_V1 (P-8)', () => {
    const { prefixo: _p, ...rotas } = CAMINHOS_ENTRADA_V1;
    expect(ROTAS).toHaveLength(Object.keys(rotas).length);
  });

  it('JWT de usuário do BKO no POST /lotes: 401 credencial_invalida e nada gravado', async () => {
    const antes = await alvo.lotesGravados('a');
    const c = alvo.conector('a', { chave: alvo.jwtUsuario('a') });
    const [lote] = c.montarCargaCompleta('produto', massa.registros.produto);
    esperar401Neutro(await c.enviar(lote!));
    expect(await alvo.lotesGravados('a')).toBe(antes);
  });

  it.each(ROTAS)('JWT de usuário recusado em %s %s (todas as rotas, todos os métodos)', async (metodo, rel) => {
    const c = alvo.conector('a', { chave: alvo.jwtUsuario('a') });
    esperar401Neutro(await c.requisitar(metodo, rel, metodo === 'POST' ? '{}' : undefined));
  });

  it('sem Authorization: o mesmo 401 neutro', async () => {
    const r = await alvo.fetch(new URL(rotaEntrada(CAMINHOS_ENTRADA_V1.pedidosPendentes), alvo.url), {
      headers: { 'x-macuxi-conector-id': alvo.credencial('a').conectorId },
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ detalhes: { codigo: 'credencial_invalida' } });
  });

  // libera com o PR do plugin /entrada/v1 (ENG-API): a falsa não tem as rotas do BKO
  it.skipIf(!API_REAL)(`a chave do conector numa rota do BKO é recusada (${PR_LIBERA.ENG_API})`, async () => {
    const { chave, conectorId } = alvo.credencial('a');
    const r = await alvo.fetch(new URL('/v1/cadastros/produtos', alvo.url), {
      headers: { authorization: `Bearer ${chave}`, 'x-macuxi-conector-id': conectorId },
    });
    expect(r.status).toBe(401);
    semSegredo(await r.text());
  });
});

describe('E3-2: isolamento entre tenants e conectores (§3, §4; regra 5)', () => {
  it('a chave do tenant B com o conector_id do A: o mesmo 401 do JWT e do conector desconhecido', async () => {
    const comChaveDoB = alvo.conector('a', { chave: alvo.credencial('b').chave });
    const desconhecido = alvo.conector('a', { conectorId: 'conector-que-nao-existe' });
    const comJwt = alvo.conector('a', { chave: alvo.jwtUsuario('a') });
    const respostas = await Promise.all(
      [comChaveDoB, desconhecido, comJwt].map((c) => c.requisitar('GET', CAMINHOS_ENTRADA_V1.pedidosPendentes)),
    );
    for (const r of respostas) esperar401Neutro(r);
    // neutro: o corpo não diz qual parte da credencial falhou
    expect(respostas[0]!.corpo).toEqual(respostas[1]!.corpo);
    expect(respostas[1]!.corpo).toEqual(respostas[2]!.corpo);
  });

  it('conector desconhecido com chave válida de outro: 401 neutro e nada gravado', async () => {
    const antes = [await alvo.lotesGravados('a'), await alvo.lotesGravados('b')];
    const c = alvo.conector('b', { conectorId: 'conector-que-nao-existe' });
    const [lote] = c.montarDelta('filial', massa.registros.filial, null);
    esperar401Neutro(await c.enviar(lote!));
    expect([await alvo.lotesGravados('a'), await alvo.lotesGravados('b')]).toEqual(antes);
  });

  it('o lote do tenant A não existe para o conector do B (404), e existe para o A', async () => {
    const a = alvo.conector('a');
    const [lote] = a.montarDelta('vendedor', massa.registros.vendedor, null);
    const r = await a.enviar(lote!);
    expect(r.status).toBe(202);
    const { lote_id } = r.corpo as { lote_id: string };
    expect((await alvo.conector('b').consultarLote(lote_id)).status).toBe(404);
    expect((await a.consultarLote(lote_id)).status).toBe(200);
  });

  it('a troca de chave invalida a anterior na hora', async () => {
    // na real, libera com o ENG-API e a migração da entrada (troca pelo portal)
    const velho = alvo.conector('a');
    expect((await velho.pendentes('pedidos')).status).toBe(200);
    await alvo.trocarChave('a');
    esperar401Neutro(await velho.pendentes('pedidos'));
    expect((await alvo.conector('a').pendentes('pedidos')).status).toBe(200);
  });
});

describe('E3-3: sem pepper e força bruta (§4)', () => {
  it.skipIf(!API_REAL)(`sem MACUXIERP_PEPPER_ENTRADA a autenticação recusa tudo (${PR_LIBERA.ENG_API})`, async () => {
    const semPepper = await alvoEntrada({ semPepper: true });
    try {
      esperar401Neutro(await semPepper.conector('a').pendentes('pedidos'));
    } finally {
      await semPepper.fechar();
    }
  });

  it.skipIf(!API_REAL)(`o limite de tentativas por conector_id e IP segura a força bruta (${PR_LIBERA.ENG_API})`, async () => {
    const c = alvo.conector('a', { chave: 'cb_chave-errada-de-proposito' });
    const status: number[] = [];
    for (let i = 0; i < 50; i++) status.push((await c.pendentes('pedidos')).status);
    expect(status).toContain(429);
  });
});

describe('E3-4: o corpo e a chave fora da resposta e do log (§3; regras 8 e 9)', () => {
  it('nas recusas (401, 400, 409, 413 e 422) nem a chave, nem o corpo, nem dado pessoal aparecem', async () => {
    const inicio = alvo.log.length;
    const bom = alvo.conector('a');
    const [lote] = bom.montarCargaCompleta('cliente', massa.registros.cliente);
    const respostas: RespostaHttp[] = [];
    respostas.push(await alvo.conector('a', { chave: alvo.credencial('b').chave }).enviar(lote!)); // 401
    respostas.push(await bom.requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, lote!.corpo)); // 400 sem a chave
    expect((await bom.enviar(lote!)).status).toBe(202);
    const outro = { ...lote!.envelope, registros: lote!.envelope.registros.slice(1) };
    respostas.push(await bom.enviarComChave(lote!.chave, outro)); // 409
    respostas.push(await bom.enviarComChave('cb:fora:da:fase:0001', { ...lote!.envelope, entidade: 'titulo' })); // 422
    respostas.push(
      await bom.requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, lote!.corpo + ' '.repeat(MAX_BYTES_LOTE_ENTRADA), {
        'Idempotency-Key': 'cb:grande:0001',
      }),
    ); // 413
    expect(respostas.map((r) => r.status)).toEqual([401, 400, 409, 422, 413]);
    for (const r of respostas) semSegredo(JSON.stringify(r.corpo) + JSON.stringify(r.cabecalhos), [lote!.corpo]);
    const log = alvo.log.slice(inicio).join('\n');
    expect(log.length).toBeGreaterThan(0);
    semSegredo(log, [lote!.corpo]);
  });

  it('no lote aceito e processado, o LoteAceito, o LoteResultado e o log não levam chave nem dado pessoal', async () => {
    const inicio = alvo.log.length;
    const c = alvo.conector('b');
    const lotes = c.montarCargaCompleta('cliente', massa.registros.cliente);
    const aceitos = [];
    for (const l of lotes) aceitos.push(await c.enviar(l));
    await alvo.processarLotes();
    const resultados = [];
    for (const a of aceitos) resultados.push(await c.consultarLote((a.corpo as { lote_id: string }).lote_id));
    expect(resultados.map((r) => r.status)).toEqual(lotes.map(() => 200));
    for (const r of [...aceitos, ...resultados]) semSegredo(JSON.stringify(r.corpo), lotes.map((l) => l.corpo));
    semSegredo(alvo.log.slice(inicio).join('\n'), lotes.map((l) => l.corpo));
  });

  it.skipIf(!API_REAL)(`o erro por linha sai só com indice, external_id, campo e codigo, sem o valor (${PR_LIBERA.CAD})`, async () => {
    const c = alvo.conector('a');
    const ruim = { ...massa.registros.cliente[0]!, documento: 'nao-e-documento' };
    const [lote] = c.montarDelta('cliente', [ruim], null);
    const r = await c.enviar(lote!);
    await alvo.processarLotes();
    const res = await c.consultarLote((r.corpo as { lote_id: string }).lote_id);
    const erros = (res.corpo as { erros: Record<string, unknown>[] }).erros;
    expect(erros.length).toBeGreaterThan(0);
    const permitidos = ['indice', 'external_id', 'campo', 'codigo', 'mensagem', 'reprocessavel', 'origem'];
    for (const e of erros) expect(Object.keys(e).every((k) => permitidos.includes(k))).toBe(true);
    semSegredo(JSON.stringify(res.corpo), ['nao-e-documento']);
  });
});

describe('E3-5: nada gravado depois da recusa; o corpo zerado ao terminar (§3, §8)', () => {
  it('nenhuma recusa (401, 400 sem a chave ou fora do padrão, 409, 413, 422) grava lote', async () => {
    const c = alvo.conector('a');
    const [lote] = c.montarDelta('estoque', massa.registros.estoque, null);
    const antes = await alvo.lotesGravados('a');
    const status = [
      (await alvo.conector('a', { chave: alvo.jwtUsuario('a') }).enviar(lote!)).status,
      (await c.requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, lote!.corpo)).status,
      (await c.enviarComChave('curta', lote!.envelope)).status, // 5 caracteres: abaixo dos 8 do padrão (P-4)
      (await c.enviarComChave('x'.repeat(129), lote!.envelope)).status,
      (await c.enviarComChave('cb:nota:fora:0001', { ...lote!.envelope, entidade: 'nota' })).status,
      (
        await c.requisitar('POST', CAMINHOS_ENTRADA_V1.lotes, ' '.repeat(MAX_BYTES_LOTE_ENTRADA + 1), {
          'Idempotency-Key': 'cb:grande:0002',
        })
      ).status,
    ];
    expect(status).toEqual([401, 400, 400, 400, 422, 413]);
    expect(await alvo.lotesGravados('a')).toBe(antes);
  });

  it('mesma chave e mesmo corpo: o mesmo LoteAceito com repetido e idempotency-replayed; outro corpo: 409 sem lote (P-4)', async () => {
    const c = alvo.conector('a');
    const [lote] = c.montarDelta('preco', massa.registros.preco, null);
    const a = await c.enviar(lote!);
    const depois = await alvo.lotesGravados('a');
    const b = await c.enviar(lote!);
    expect(a.status).toBe(202);
    expect(a.corpo).toMatchObject({ status: 'recebido', entidade: 'preco', modo: 'delta', repetido: false });
    expect(b.status).toBe(202);
    expect(b.corpo).toEqual({ ...(a.corpo as object), repetido: true });
    expect(b.cabecalhos['idempotency-replayed']).toBeDefined();
    const conflito = await c.enviarComChave(lote!.chave, { ...lote!.envelope, registros: [] });
    expect(conflito.status).toBe(409);
    expect(conflito.corpo).toMatchObject({ codigo: 'CONFLITO', detalhes: { codigo: 'idempotencia_conflito' } });
    expect(await alvo.lotesGravados('a')).toBe(depois);
  });

  it.skipIf(!API_REAL)(`o corpo do lote é zerado ao terminar (${PR_LIBERA.BD} e ${PR_LIBERA.CAD})`, async () => {
    const c = alvo.conector('a');
    const [lote] = c.montarDelta('forma_pagamento', massa.registros.forma_pagamento, null);
    const r = await c.enviar(lote!);
    const id = (r.corpo as { lote_id: string }).lote_id;
    expect(await alvo.corpoDoLote(id)).not.toBeNull();
    await alvo.processarLotes();
    expect(await alvo.corpoDoLote(id)).toBeNull();
  });
});
