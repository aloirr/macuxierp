/**
 * F-10 (plano da v0.3.12; PF-1 da v0.3.13) e o dublê de clientes do Hub (`apoio/hub-clientes.ts`), sem banco e sem FDV.
 * - Contrato: as fixtures do `cliente-erp.ts` do FDV (v1.0.28 e v1.0.30) passam em `ClientesPendentesFdv`; o corpo que o
 *   ERP monta (`montarRetornoClienteFdv`) passa no `RetornoClienteFdv` e no oráculo do Hub no dublê, nos dois estados da
 *   opção `MACUXIERP_FDV_CLIENTE_REVISAO`; os 200 (`repetido`, `obsoleto`) passam em `RetornoClienteAceitoFdv`.
 * - Dublê: as respostas do desenho T-0059 §5.3 (200, 422 por código, 400, 403, 5xx/429 com `Retry-After`) pelo mesmo
 *   cliente HTTP do SDK que a agenda usa (`clienteDoSdk`).
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClientesPendentesFdv,
  RetornoClienteAceitoFdv,
  RetornoClienteFdv,
  montarRetornoClienteFdv,
  type ClienteParaErpFdv,
  type DecisaoPreCadastroFdv,
} from '../../packages/platform-sdk/src/index';
import { clienteDoSdk } from './apoio/adaptador-conector';
import { CredencialHub } from './apoio/config';
import { criarDubleHub, type DubleHub } from './apoio/duble-hub';
import {
  ACEITO_OBSOLETO,
  ACEITO_REPETIDO,
  ACEITO_V1028,
  ACEITO_V1030,
  PENDENTE_V1028,
  PENDENTE_V1030,
  PENDENTE_V1030_HASH_NULO,
  PENDENTE_V1030_REVISAO_2,
} from './apoio/fixtures-cliente-erp';
import {
  cadastrarNoFdv,
  clienteNoHub,
  perderRespostaDoRetornoCliente,
  reenviarCorrigidoNoFdv,
  removerClienteNoFdv,
  rotasClientesDuble,
  versaoDoHubClientes,
  vincularNoFdv,
  type PreCadastroFdv,
  type VersaoHubClientes,
} from './apoio/hub-clientes';
import { PRAZO_REENTREGA_MS, rotasPedidosDuble, semRecebePedidos } from './apoio/hub-pedidos';
import { RelogioDeTeste } from './apoio/relogio';

const T = 'tenant-clientes';
const CONECTOR = 'macuxierp-clientes';
const AGORA = '2026-11-24T23:30:00.000Z';
const VINCULADO: DecisaoPreCadastroFdv = { status: 'vinculado', external_id: 'C000777' };
const RECUSA: DecisaoPreCadastroFdv = {
  status: 'rejeitado_erp',
  motivo: 'Cadastro com 2 erros',
  erros: [
    { campo: 'documento', codigo: 'documento_invalido', mensagem: 'Documento inválido' },
    { campo: 'cidade', codigo: 'municipio_nao_encontrado', mensagem: 'Município não encontrado' },
  ],
};

const pre = (o: Partial<PreCadastroFdv> = {}): PreCadastroFdv => ({
  cliente_uuid: randomUUID(),
  recebido_em: '2026-11-24T19:00:00-04:00',
  razao_social: 'Mercado Fictício',
  documento: '11222333000181',
  cidade: 'Manaus',
  uf: 'AM',
  ...o,
});

describe('F-10 — contrato do pré-cadastro com as fixtures do FDV', () => {
  it('os pendentes da v1.0.28, da v1.0.30 (com hash nulo e revisão 2) passam em ClientesPendentesFdv e campo novo não derruba', () => {
    const lidos = ClientesPendentesFdv.parse({
      clientes: [PENDENTE_V1028, PENDENTE_V1030, PENDENTE_V1030_HASH_NULO, PENDENTE_V1030_REVISAO_2, { ...PENDENTE_V1030, campo_futuro: 1 }],
    }).clientes;
    expect(lidos.map((c) => c.revisao ?? 1)).toEqual([1, 1, 1, 2, 1]);
    expect(lidos[0]).not.toHaveProperty('codigo_fdv');
  });

  it('os 200 (v1.0.28 sem revisão, v1.0.30, repetido e obsoleto) passam em RetornoClienteAceitoFdv', () => {
    for (const r of [ACEITO_V1028, ACEITO_V1030, ACEITO_REPETIDO, ACEITO_OBSOLETO]) expect(RetornoClienteAceitoFdv.safeParse(r).success).toBe(true);
  });

  it('o corpo do ERP montado sobre as fixtures passa no RetornoClienteFdv, nos dois estados da opção', () => {
    for (const p of [PENDENTE_V1028, PENDENTE_V1030] as ClienteParaErpFdv[])
      for (const d of [VINCULADO, RECUSA])
        for (const aditivos of [true, false])
          expect(RetornoClienteFdv.safeParse(montarRetornoClienteFdv(p, d, { aditivos, ocorrido_em: AGORA })).success).toBe(true);
  });
});

describe('F-10 e dublê de clientes do Hub (HTTP, oráculo do desenho T-0059 §5.3)', () => {
  let relogio: RelogioDeTeste;
  let duble: DubleHub;
  let sdk: ReturnType<typeof clienteDoSdk>;

  const montar = async (versao: VersaoHubClientes = 'v1.0.32') => {
    duble = await criarDubleHub({ relogio, rotasExtras: [...rotasPedidosDuble(), ...rotasClientesDuble()] });
    const c = duble.registrarConector({ tenant: T, conectorId: CONECTOR });
    versaoDoHubClientes(duble, T, versao);
    sdk = clienteDoSdk({ url: duble.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: 'dev' });
  };
  const cadastrar = (...ps: PreCadastroFdv[]) => ps.map((p) => (cadastrarNoFdv(duble, T, p), p));
  /** Corpo do ERP com a opção ligada (o padrão de produção). */
  const corpoDe = (uuid: string, d: DecisaoPreCadastroFdv, revisao: number | undefined = 1) =>
    montarRetornoClienteFdv({ cliente_uuid: uuid, revisao }, d, { aditivos: true, ocorrido_em: AGORA });
  const pendentes = (limite = 50) => sdk.cliente.chamar(sdk.cred, { metodo: 'GET', caminho: `/clientes/pendentes?limite=${limite}` });
  const retorno = (uuid: string, corpo: unknown) => sdk.cliente.chamar(sdk.cred, { metodo: 'POST', caminho: `/clientes/${uuid}/retorno`, corpo });
  const lista = async (limite = 50) => {
    const r = await pendentes(limite);
    expect(r.tipo).toBe('ok');
    return ClientesPendentesFdv.parse((r as { corpo: unknown }).corpo).clientes;
  };
  const corpoOk = (r: Awaited<ReturnType<typeof retorno>>) => {
    expect(r).toMatchObject({ tipo: 'ok', status: 200 });
    return RetornoClienteAceitoFdv.parse((r as { corpo: unknown }).corpo);
  };

  beforeEach(() => {
    relogio = new RelogioDeTeste(new Date(AGORA));
  });
  afterEach(() => duble?.fechar());

  it('v1.0.32 (opção ligada): o pendente sai com codigo_fdv, revisão, hash e tentativa e passa no contrato; vinculado e recusa com erros dão 200', async () => {
    await montar('v1.0.32');
    const [a, b] = cadastrar(pre(), pre({ documento: '11222333000199' }));
    const l = await lista();
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ cliente_uuid: a!.cliente_uuid, revisao: 1, tentativa: 1 });
    expect(l[0]!.codigo_fdv).toMatch(/^\d{5,}$/);
    expect(l[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(corpoOk(await retorno(a!.cliente_uuid, montarRetornoClienteFdv(l[0]!, VINCULADO, { aditivos: true, ocorrido_em: AGORA })))).toEqual({
      cliente_uuid: a!.cliente_uuid, estado: 'vinculado', repetido: false, revisao: 1,
    });
    expect(corpoOk(await retorno(b!.cliente_uuid, montarRetornoClienteFdv(l[1]!, RECUSA, { aditivos: true, ocorrido_em: AGORA })))).toMatchObject({ estado: 'rejeitado', revisao: 1 });
    expect(clienteNoHub(duble, T, b!.cliente_uuid)!.retornos).toEqual([expect.objectContaining({ status: 'rejeitado_erp', revisao: 1, erros: 2 })]);
  });

  it('v1.0.28 (opção desligada): o pendente sai sem os aditivos; o corpo só com o motivo dá 200 sem revisão; com revisão ou erros, 400', async () => {
    await montar('v1.0.28');
    const [a, b] = cadastrar(pre(), pre());
    const l = await lista();
    for (const k of ['codigo_fdv', 'revisao', 'hash', 'tentativa']) expect(l[0]).not.toHaveProperty(k);
    const desligado = montarRetornoClienteFdv(l[0]!, RECUSA, { aditivos: false, ocorrido_em: AGORA });
    expect(corpoOk(await retorno(a!.cliente_uuid, desligado))).toEqual({ cliente_uuid: a!.cliente_uuid, estado: 'rejeitado', repetido: false });
    // o oráculo pega o ERP que liga os aditivos contra o Hub antigo (erros por campo no corpo)
    const ligado = montarRetornoClienteFdv(l[1]!, RECUSA, { aditivos: true, ocorrido_em: AGORA });
    expect(await retorno(b!.cliente_uuid, ligado)).toMatchObject({ tipo: 'recusa', status: 400, codigo: 'requisicao_invalida' });
    expect(await retorno(b!.cliente_uuid, { ...desligado, cliente_uuid: b!.cliente_uuid, revisao: 1 })).toMatchObject({ status: 400 });
    expect(clienteNoHub(duble, T, b!.cliente_uuid)!.estado).toBe('enviado');
  });

  it('sem retorno em 10 min o pré-cadastro volta com tentativa 2; com retorno, não volta; o limite vale de 1 a 100', async () => {
    await montar();
    const [a, b] = cadastrar(pre(), pre());
    await lista();
    expect(await lista()).toEqual([]);
    await retorno(a!.cliente_uuid, corpoDe(a!.cliente_uuid, VINCULADO));
    relogio.avancar(PRAZO_REENTREGA_MS - 1);
    expect(await lista()).toEqual([]);
    relogio.avancar(1);
    expect((await lista()).map((c) => [c.cliente_uuid, c.tentativa])).toEqual([[b!.cliente_uuid, 2]]);
    for (const lim of [0, 101]) expect(await pendentes(lim)).toMatchObject({ tipo: 'recusa', status: 422, codigo: 'valor_fora_da_faixa' });
    cadastrar(pre(), pre(), pre());
    expect(await lista(2)).toHaveLength(2);
  });

  it('o mesmo retorno de novo é 200 repetido; vinculado com outro código é 422 external_id_divergente; mudar de decisão é 422 transicao_invalida', async () => {
    await montar();
    const [a, b] = cadastrar(pre(), pre());
    await lista();
    const corpo = corpoDe(a!.cliente_uuid, VINCULADO);
    corpoOk(await retorno(a!.cliente_uuid, corpo));
    expect(corpoOk(await retorno(a!.cliente_uuid, corpo)).repetido).toBe(true);
    expect(await retorno(a!.cliente_uuid, corpoDe(a!.cliente_uuid, { status: 'vinculado', external_id: 'C000888' })))
      .toMatchObject({ tipo: 'recusa', status: 422, codigo: 'external_id_divergente' });
    expect(await retorno(a!.cliente_uuid, corpoDe(a!.cliente_uuid, RECUSA))).toMatchObject({ status: 422, codigo: 'transicao_invalida' });
    // linha do FDV já vinculada com outro código antes do 1º retorno do ERP (desenho §5.3)
    vincularNoFdv(duble, T, b!.cliente_uuid, 'C000999');
    expect(await retorno(b!.cliente_uuid, corpoDe(b!.cliente_uuid, VINCULADO))).toMatchObject({ status: 422, codigo: 'external_id_divergente' });
    expect(clienteNoHub(duble, T, a!.cliente_uuid)!.respostas.map((r) => [r.status, r.repetido, r.codigo])).toEqual([
      [200, false, null], [200, true, null], [422, null, 'external_id_divergente'], [422, null, 'transicao_invalida'],
    ]);
  });

  it('reenvio corrigido: revisão 2 sai de novo; recusa da revisão 1 é 200 obsoleto sem mudar nada; revisão 3 é 422 revisao_desconhecida', async () => {
    await montar();
    const [a] = cadastrar(pre({ documento: '11222333000199' }));
    const uuid = a!.cliente_uuid;
    await lista();
    corpoOk(await retorno(uuid, corpoDe(uuid, RECUSA)));
    reenviarCorrigidoNoFdv(duble, T, uuid, { documento: '11222333000181' });
    const [r2] = await lista();
    expect(r2).toMatchObject({ cliente_uuid: uuid, revisao: 2, tentativa: 1 });
    expect(corpoOk(await retorno(uuid, corpoDe(uuid, RECUSA)))).toMatchObject({ estado: 'enviado', obsoleto: true, revisao: 2, repetido: false });
    expect(await retorno(uuid, corpoDe(uuid, VINCULADO, 3))).toMatchObject({ status: 422, codigo: 'revisao_desconhecida' });
    expect(corpoOk(await retorno(uuid, corpoDe(uuid, VINCULADO, 2)))).toMatchObject({ estado: 'vinculado', revisao: 2 });
    expect(clienteNoHub(duble, T, uuid)!.retornos.map((r) => [r.status, r.revisao])).toEqual([['rejeitado_erp', 1], ['vinculado', 2]]);
  });

  it('desconhecido e não entregue: 422; corpo fora do contrato: 400; versão do contrato errada: 422', async () => {
    await montar();
    const a = pre();
    const corpo = corpoDe(a.cliente_uuid, VINCULADO, undefined);
    expect(await retorno(a.cliente_uuid, corpo)).toMatchObject({ status: 422, codigo: 'cliente_desconhecido' });
    cadastrar(a);
    expect(await retorno(a.cliente_uuid, corpo)).toMatchObject({ status: 422, codigo: 'cliente_nao_entregue' });
    await lista();
    expect(await retorno(a.cliente_uuid, { ...corpo, external_id: undefined })).toMatchObject({ status: 400, codigo: 'requisicao_invalida' });
    expect(await retorno(a.cliente_uuid, { ...corpo, cliente_uuid: randomUUID() })).toMatchObject({ status: 400 });
    expect(await retorno(a.cliente_uuid, { ...corpo, versao_contrato: 'v2' })).toMatchObject({ status: 422, codigo: 'versao_nao_suportada' });
    expect(await retorno('nao-e-uuid', corpo)).toMatchObject({ status: 400 });
    removerClienteNoFdv(duble, T, a.cliente_uuid);
    expect(await retorno(a.cliente_uuid, corpo)).toMatchObject({ status: 422, codigo: 'cliente_desconhecido' });
  });

  it('falha injetável: 503 e 429 com Retry-After são retentáveis; sem "Recebe pedidos" é 403; resposta perdida volta como repetido', async () => {
    await montar();
    const [a] = cadastrar(pre());
    const uuid = a!.cliente_uuid;
    duble.programarFalha({ rota: 'GET /clientes', status: 503, retryAfter: '7' });
    expect(await pendentes()).toMatchObject({ tipo: 'retentavel', status: 503, retryAfterMs: 7000 });
    await lista();
    const corpo = corpoDe(uuid, VINCULADO);
    duble.programarFalha({ rota: 'POST /clientes', status: 429, retryAfter: '3' });
    expect(await retorno(uuid, corpo)).toMatchObject({ tipo: 'retentavel', status: 429, retryAfterMs: 3000 });
    expect(clienteNoHub(duble, T, uuid)!.estado).toBe('enviado');
    perderRespostaDoRetornoCliente(duble, T, uuid);
    expect(await retorno(uuid, corpo)).toMatchObject({ tipo: 'retentavel', status: 503 });
    expect(corpoOk(await retorno(uuid, corpo)).repetido).toBe(true);
    expect(clienteNoHub(duble, T, uuid)!.retornos).toHaveLength(1);
    semRecebePedidos(duble, T, CONECTOR);
    expect(await pendentes()).toMatchObject({ status: 403, codigo: 'acesso_negado' });
  });

  it('o log de acesso do dublê não leva corpo nem dado do pré-cadastro (LGPD)', async () => {
    await montar();
    const [a] = cadastrar(pre({ email: 'fulano@exemplo.invalid', telefone: '92999990000' }));
    await lista();
    await retorno(a!.cliente_uuid, corpoDe(a!.cliente_uuid, RECUSA));
    const log = duble.log.join('\n');
    for (const s of ['Mercado Fictício', '11222333000181', 'fulano@exemplo.invalid', '92999990000', 'Documento inválido']) expect(log).not.toContain(s);
  });
});
