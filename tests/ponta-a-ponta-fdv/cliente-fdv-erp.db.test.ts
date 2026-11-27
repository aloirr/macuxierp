/**
 * PF-1 da v0.3.13: F-1 a F-6 do plano da v0.3.12 (desenho T-0059 §7, casos 1 a 6) de ponta a ponta — pré-cadastro gravado
 * no FDV → `GET /clientes/pendentes` (dublê com o oráculo do Hub, `apoio/hub-clientes.ts`) → porta real do cadastros
 * (`criarCriadorClienteFdv`) → espelho real (consumidor `cadastros.cliente.alterado@1` pelo despachante da outbox) →
 * `POST /clientes/{uuid}/retorno` → o Hub registra. PostgreSQL efêmero com RLS (papel `macuxierp_worker`) e a API de
 * produção (`montarApiPg`) para a filial e a rota do BKO. Sem FDV real e sem rede.
 *
 * As peças vêm do `montarPedidosFdv` e do `montarAgendas` do worker (`apoio/erp-clientes.ts`). Os dois defeitos achados
 * nesta bateria (24/11/2026, 23h13 e 23h17 de Manaus) ficam cobertos: agendas de clientes fora do `montarAgendas` (#620)
 * e o `macuxierp_worker` sem grant em `cadastros.cliente`, `cliente_endereco` e `cliente_contato` (0064, #621). A parte
 * "o lote só sai depois do 200" do F-1 é conferida pelo `aguarda_vinculo` do espelho, que é o que o conector lê para
 * reter o registro (desenho §5.4).
 * Sem Postgres pula.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMINHOS_INTEGRACAO_FDV_TENANT, PaginaClientesRecebidosFdv } from '../../packages/platform-sdk/src/index';
import { PG_DISPONIVEL, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';
import type { BancoPg } from '../../packages/platform-sdk/src/pg';
import { CNPJ_A, filialValida } from '../../modules/cadastros/api/fixtures-teste';
import { montarApiPg } from '../apoio/api-pg';
import { CredencialHub } from './apoio/config';
import { criarDubleHub, type DubleHub } from './apoio/duble-hub';
import { criarClienteHubClientes, criarLadoErpClientes, type LadoErpClientes } from './apoio/erp-clientes';
import { indicesCom } from './apoio/erp-pedidos';
import {
  cadastrarNoFdv,
  clienteNoHub,
  perderRespostaDoRetornoCliente,
  reenviarCorrigidoNoFdv,
  rotasClientesDuble,
  versaoDoHubClientes,
  vincularNoFdv,
  type PreCadastroFdv,
  type VersaoHubClientes,
} from './apoio/hub-clientes';
import { PRAZO_REENTREGA_MS, semRecebePedidos } from './apoio/hub-pedidos';
import { RelogioDeTeste } from './apoio/relogio';

const INICIO = new Date('2026-11-24T15:00:00.000Z');
/** Dado pessoal fictício que nunca pode ir a log nem a alerta (F-9, F-14). */
const RAZAO = 'Mercadinho Ficticio do Fulano';
const EMAIL = 'fulano.ficticio@exemplo.invalid';
const TELEFONE = '92988887777';
const CNPJ_VALIDO = '11444777000161';
const CNPJ_DV_ERRADO = '11444777000162';

describe.skipIf(!PG_DISPONIVEL)('F-1 a F-6 — pré-cadastro de cliente do FDV de ponta a ponta (dublê do Hub + PostgreSQL)', () => {
  const relogio = new RelogioDeTeste(INICIO);
  let api: Awaited<ReturnType<typeof montarApiPg<'A' | 'L'>>>;
  let b: BancoEfemero;
  let worker: BancoPg;
  /** Um dublê por versão do Hub: o A fala com a v1.0.32 (opção ligada) e o L com a v1.0.28 (opção desligada). */
  let duble: DubleHub;
  const hubs = {} as Record<'A' | 'L', ReturnType<typeof criarClienteHubClientes>>;
  const lados = {} as Record<'A' | 'L', LadoErpClientes>;
  const dubleT = { A: 'fdv-a', L: 'fdv-l' } as const;

  const pre = (o: Partial<PreCadastroFdv> = {}): PreCadastroFdv => ({
    cliente_uuid: randomUUID(),
    recebido_em: '2026-11-24T10:00:00-04:00',
    razao_social: RAZAO,
    documento: CNPJ_VALIDO,
    inscricao_estadual: null,
    email: EMAIL,
    telefone: TELEFONE,
    logradouro: 'Av. Djalma Batista',
    numero: '100',
    bairro: 'Chapada',
    cidade: 'Manaus',
    uf: 'AM',
    cep: '69050010',
    ...o,
  });
  const adm = async <L = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as L[];
  const recebidos = (t: string, uuid: string) =>
    adm<{ revisao: number; situacao: string; erros: { codigo: string }[] | null; cliente_id: string | null; tentativas_fdv: number }>(
      'SELECT revisao, situacao, erros, cliente_id, tentativas_fdv FROM integracao_fdv.cliente_recebido WHERE tenant_id = $1 AND cliente_uuid = $2 ORDER BY revisao',
      [t, uuid],
    );
  const retornos = (t: string, uuid: string) =>
    adm('SELECT revisao, status, estado, resposta_http, codigo_recusa FROM integracao_fdv.cliente_retorno WHERE tenant_id = $1 AND cliente_uuid = $2 ORDER BY created_at, id', [t, uuid]);
  const clientesComDocumento = async (t: string, doc: string) =>
    (await adm<{ n: number }>('SELECT count(*)::int AS n FROM cadastros.cliente WHERE tenant_id = $1 AND documento = $2 AND deleted_at IS NULL', [t, doc]))[0]!.n;
  const retido = async (t: string, clienteId: string) =>
    adm<{ entidade: string; aguarda_vinculo: boolean; registro_external_id: string }>(
      `SELECT entidade, aguarda_vinculo, registro_external_id FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND (erp_id = $2::uuid OR erp_id IN (SELECT id FROM cadastros.cliente_endereco WHERE cliente_id = $2::uuid))
        ORDER BY entidade`,
      [t, clienteId],
    );
  const ciclo = (q: 'A' | 'L') => lados[q].ciclo(api.t[q], hubs[q]);

  beforeAll(async () => {
    api = await montarApiPg({ A: ['cadastros', 'integracao-fdv'], L: ['cadastros', 'integracao-fdv'] }, { relogio });
    b = api.b;
    worker = b.banco('macuxierp_worker', 4);    duble = await criarDubleHub({ relogio, rotasExtras: rotasClientesDuble() });
    for (const [q, versao] of [['A', 'v1.0.32'], ['L', 'v1.0.28']] as [('A' | 'L'), VersaoHubClientes][]) {
      const f = await api.chamar(q, 'POST', '/v1/cadastros/filiais', filialValida({ cnpj: CNPJ_A, external_id: 'F01' }));
      expect(f.statusCode, f.body).toBe(201);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [api.t[q]]);
      const c = duble.registrarConector({ tenant: dubleT[q], conectorId: `macuxierp-${q}` });
      versaoDoHubClientes(duble, dubleT[q], versao);
      hubs[q] = criarClienteHubClientes({ url: duble.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: 'dev' });
      lados[q] = criarLadoErpClientes({ banco: worker, relogio, aditivos: versao === 'v1.0.32' });
    }
  }, 180_000);
  beforeEach(() => {
    relogio.avancar(PRAZO_REENTREGA_MS * 2); // cada caso começa sem reentrega pendente do anterior
  });
  afterAll(async () => {
    await duble?.fechar();
    await api?.fechar();
  });

  it('o worker registra as agendas do pré-cadastro com o recebimento ligado (#620)', () => {
    expect(lados.A.agendas).toEqual(expect.arrayContaining(['integracao-fdv.busca-clientes', 'integracao-fdv.retorno-clientes']));
  });

  it('F-1: pendente válido da v1.0.28 vira um cliente; o espelho fica retido até o 200 do vinculado; o external_id é a chave do Hub, nunca o codigo_fdv', async () => {
    const p = cadastrarNoFdv(duble, dubleT.L, pre({ documento: '21333444000119' }));
    const busca = await lados.L.buscar(api.t.L, hubs.L);
    // sem os grants do macuxierp_worker no cadastros (0064), a porta falha aqui com `pre_cadastro_falha_interna`
    expect(busca).toMatchObject({ buscados: 1, aceitos: 1, recusados: 0 });
    const [linha] = await recebidos(api.t.L, p.dados.cliente_uuid);
    expect(linha).toMatchObject({ revisao: 1, situacao: 'aceito' });
    const clienteId = linha!.cliente_id!;
    expect(await clientesComDocumento(api.t.L, '21333444000119')).toBe(1);
    // espelho antes do 200: cliente e endereço retidos (o conector não os põe em lote)
    await lados.L.despachar();
    const antes = await retido(api.t.L, clienteId);
    expect(antes.map((r) => r.entidade)).toEqual(['cliente', 'cliente_endereco']);
    expect(antes.every((r) => r.aguarda_vinculo)).toBe(true);
    // 200 do vinculado: libera
    expect(await lados.L.enviar(api.t.L, hubs.L)).toMatchObject({ enviados: 1, falhou: 0 });
    const noHub = clienteNoHub(duble, dubleT.L, p.dados.cliente_uuid)!;
    expect(noHub.estado).toBe('vinculado');
    const chave = antes.find((r) => r.entidade === 'cliente')!.registro_external_id;
    expect(noHub.externalId).toBe(chave);
    expect(noHub.externalId).not.toBe(noHub.codigoFdv);
    expect((await retido(api.t.L, clienteId)).every((r) => !r.aguarda_vinculo)).toBe(true);
    expect(await retornos(api.t.L, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ status: 'vinculado', estado: 'enviado', resposta_http: 200 })]);
  });

  it('F-2: CNPJ com DV errado e município inexistente: recusado com exatamente 2 erros, sem cliente; v1.0.28 recebe só o motivo e v1.0.32 recebe revisão e erros', async () => {
    const ruim = { documento: CNPJ_DV_ERRADO, cidade: 'Cidade Que Nao Existe' };
    const [pl, pa] = [cadastrarNoFdv(duble, dubleT.L, pre(ruim)), cadastrarNoFdv(duble, dubleT.A, pre(ruim))];
    const [rl, ra] = [await ciclo('L'), await ciclo('A')];
    for (const [q, p, r] of [['L', pl, rl], ['A', pa, ra]] as const) {
      expect(r.busca, q).toMatchObject({ recusados: 1, aceitos: 0 });
      const [l] = await recebidos(api.t[q], p.dados.cliente_uuid);
      expect(l!.situacao).toBe('recusado');
      expect(l!.erros!.map((e) => e.codigo).sort()).toEqual(['documento_invalido', 'municipio_nao_encontrado']);
      expect(await clientesComDocumento(api.t[q], CNPJ_DV_ERRADO)).toBe(0);
      expect(r.envio, q).toMatchObject({ enviados: 1, falhou: 0 });
    }
    // o oráculo do Hub da v1.0.28 recusaria (400) revisão ou erros no corpo: o 200 prova que foi só o motivo
    expect(clienteNoHub(duble, dubleT.L, pl.dados.cliente_uuid)!.retornos).toEqual([expect.objectContaining({ status: 'rejeitado_erp', erros: 0 })]);
    expect(clienteNoHub(duble, dubleT.A, pa.dados.cliente_uuid)!.retornos).toEqual([expect.objectContaining({ status: 'rejeitado_erp', revisao: 1, erros: 2 })]);
  });

  it('F-3: o mesmo pendente de novo (tentativa 2) não decide de novo nem duplica; a resposta perdida volta como repetido sem segunda linha de retorno', async () => {
    const p = cadastrarNoFdv(duble, dubleT.A, pre({ documento: '31444555000156' }));
    await lados.A.buscar(api.t.A, hubs.A);
    relogio.avancar(PRAZO_REENTREGA_MS); // o FDV não viu retorno: entrega de novo
    const segunda = await lados.A.buscar(api.t.A, hubs.A);
    expect(segunda).toMatchObject({ buscados: 1, repetidos: 1, aceitos: 0 });
    expect(await recebidos(api.t.A, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ tentativas_fdv: 2, situacao: 'aceito' })]);
    expect(await clientesComDocumento(api.t.A, '31444555000156')).toBe(1);
    await lados.A.despachar();
    perderRespostaDoRetornoCliente(duble, dubleT.A, p.dados.cliente_uuid);
    expect((await lados.A.enviar(api.t.A, hubs.A)).falhou).toBe(0);
    expect(await retornos(api.t.A, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ estado: 'pendente' })]);
    await lados.A.enviar(api.t.A, hubs.A);
    expect(clienteNoHub(duble, dubleT.A, p.dados.cliente_uuid)!.respostas.map((r) => [r.status, r.repetido])).toEqual([[503, null], [200, true]]);
    expect(await retornos(api.t.A, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ estado: 'enviado', resposta_http: 200 })]);
    expect(clienteNoHub(duble, dubleT.A, p.dados.cliente_uuid)!.retornos).toHaveLength(1);
  });

  it('F-4: reenvio corrigido (revisão 2): linha nova aceita, a revisão 1 fica recusada no histórico; a rota do BKO mostra uma linha, a da revisão 2', async () => {
    const p = cadastrarNoFdv(duble, dubleT.A, pre({ documento: CNPJ_DV_ERRADO }));
    await ciclo('A');
    reenviarCorrigidoNoFdv(duble, dubleT.A, p.dados.cliente_uuid, { documento: '51666777000120' });
    const r = await ciclo('A');
    expect(r.busca).toMatchObject({ buscados: 1, aceitos: 1 });
    expect((await recebidos(api.t.A, p.dados.cliente_uuid)).map((l) => [l.revisao, l.situacao])).toEqual([[1, 'recusado'], [2, 'aceito']]);
    expect(clienteNoHub(duble, dubleT.A, p.dados.cliente_uuid)!.retornos.map((x) => [x.status, x.revisao])).toEqual([['rejeitado_erp', 1], ['vinculado', 2]]);
    const rota = await api.chamar('A', 'GET', `/v1${CAMINHOS_INTEGRACAO_FDV_TENANT.clientesRecebidos}`);
    expect(rota.statusCode, rota.body).toBe(200);
    const doUuid = PaginaClientesRecebidosFdv.parse(rota.json()).itens.filter((i) => i.cliente_uuid === p.dados.cliente_uuid);
    expect(doUuid).toEqual([expect.objectContaining({ revisao: 2, situacao: 'aceito' })]);
  });

  it('F-5: 422 external_id_divergente: retorno falhou, conflito vinculo_divergente aberto e o cliente continua retido', async () => {
    const p = cadastrarNoFdv(duble, dubleT.A, pre({ documento: '41555666000193' }));
    vincularNoFdv(duble, dubleT.A, p.dados.cliente_uuid, 'CODIGO-DE-OUTRO-ERP');
    const r = await ciclo('A');
    expect(r.envio).toMatchObject({ falhou: 1 });
    const clienteId = (await recebidos(api.t.A, p.dados.cliente_uuid))[0]!.cliente_id!;
    expect(await retornos(api.t.A, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ estado: 'falhou', resposta_http: 422, codigo_recusa: 'external_id_divergente' })]);
    expect(await adm("SELECT codigo FROM integracao_fdv.conflito_chave WHERE tenant_id = $1 AND erp_id = $2 AND resolvido_em IS NULL", [api.t.A, clienteId])).toEqual([{ codigo: 'vinculo_divergente' }]);
    expect((await retido(api.t.A, clienteId)).every((x) => x.aguarda_vinculo)).toBe(true);
  });

  it('F-7 (RN-INF-09, #698): vendedor que não existe no espelho: recusado com vendedor_fdv_nao_encontrado, sem cliente; o retorno leva erros[{campo: vendedor_external_id}]', async () => {
    const p = cadastrarNoFdv(duble, dubleT.A, pre({ documento: '21333444000119', vendedor_external_id: 'V-NAO-EXISTE' }));
    const r = await ciclo('A');
    expect(r.busca).toMatchObject({ recusados: 1 }); // a busca também traz de novo o pendente retido do F-5
    const [l] = await recebidos(api.t.A, p.dados.cliente_uuid);
    expect(l).toMatchObject({ situacao: 'recusado', cliente_id: null });
    expect(l!.erros).toEqual([expect.objectContaining({ campo: 'vendedor_external_id', codigo: 'vendedor_fdv_nao_encontrado' })]);
    // a recusa guardada não leva dado pessoal do pré-cadastro (só campo, código e a mensagem do catálogo)
    expect(JSON.stringify(l!.erros)).not.toMatch(new RegExp([RAZAO, EMAIL, TELEFONE, '21333444000119'].join('|')));
    expect(await clientesComDocumento(api.t.A, '21333444000119')).toBe(0);
    // o retorno ao Hub (v1.0.32, com aditivos) é o rejeitado_erp com o erro do vendedor; o 200 do oráculo valida o corpo
    expect(r.envio).toMatchObject({ enviados: 1, falhou: 0 });
    const [corpo] = await adm<{ corpo: { status: string; erros?: { campo: string; codigo: string }[] } }>(
      'SELECT corpo FROM integracao_fdv.cliente_retorno WHERE tenant_id = $1 AND cliente_uuid = $2',
      [api.t.A, p.dados.cliente_uuid],
    );
    expect(corpo!.corpo.status).toBe('rejeitado_erp');
    expect(corpo!.corpo.erros).toEqual([expect.objectContaining({ campo: 'vendedor_external_id', codigo: 'vendedor_fdv_nao_encontrado' })]);
    expect(clienteNoHub(duble, dubleT.A, p.dados.cliente_uuid)!.retornos).toEqual([expect.objectContaining({ status: 'rejeitado_erp', erros: 1 })]);
  });

  it('F-6: 5xx e 429 com Retry-After mantêm o retorno pendente e o mesmo corpo sai depois, uma vez só; 403 na busca pausa por credencial', async () => {
    const p = cadastrarNoFdv(duble, dubleT.A, pre({ documento: '61777888000168' }));
    await lados.A.buscar(api.t.A, hubs.A);
    await lados.A.despachar();
    duble.programarFalha({ rota: 'POST /clientes', status: 503, retryAfter: '30' });
    duble.programarFalha({ rota: 'POST /clientes', status: 429, retryAfter: '5' });
    for (let i = 0; i < 2; i++) {
      expect((await lados.A.enviar(api.t.A, hubs.A)).falhou).toBe(0);
      expect(await retornos(api.t.A, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ estado: 'pendente' })]);
      relogio.avancar(60_000);
    }
    await lados.A.enviar(api.t.A, hubs.A);
    expect(await retornos(api.t.A, p.dados.cliente_uuid)).toEqual([expect.objectContaining({ estado: 'enviado', resposta_http: 200 })]);
    const corpos = duble.requisicoes.filter((x) => x.metodo === 'POST' && x.caminho.includes(p.dados.cliente_uuid)).map((x) => x.corpoSha256);
    expect(corpos).toHaveLength(3);
    expect(new Set(corpos).size).toBe(1);
    expect(clienteNoHub(duble, dubleT.A, p.dados.cliente_uuid)!.retornos).toHaveLength(1);
    semRecebePedidos(duble, dubleT.A, 'macuxierp-A');
    expect(await lados.A.buscar(api.t.A, hubs.A)).toMatchObject({ proxima: 'pausa', motivoPausa: 'credencial' });
  });

  it('LGPD (F-9, F-14): o log da bateria (com os alertas do monitor) não leva nome, documento, e-mail ou telefone', () => {
    expect(lados.A.lgpd.logs.length).toBeGreaterThan(0); // os alertas do monitor (F-5, F-6) saem pelo log
    for (const q of ['A', 'L'] as const) {
      expect(indicesCom(lados[q].lgpd.logs, [RAZAO, EMAIL, TELEFONE, CNPJ_VALIDO, CNPJ_DV_ERRADO, '21333444000119']), q).toEqual([]);
    }
  });
});
