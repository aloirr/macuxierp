import { ErroApi, pode, type ContextoRota, type Perfil, type RotaModulo, type Sessao } from '@macuxierp/platform-sdk';
import { EVENTO_PEDIDO_APROVADO } from '@macuxierp/pedido/contracts';
import { describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { nfeProcDeTeste } from '../domain/fixtures-danfe';
import { ConfiguracaoFilialResposta, PedidoAFaturarDetalhe, TRABALHO_CONSULTAR_NOTA, TRABALHO_PROCESSAR_EVENTO, TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_TRANSMITIR_NOTA } from '../contracts';
import { configuracaoFake, contingenciaFake, depsFake, titulosFake, NPROT, tx, TENANT, uuid } from './apoio-teste';
import { criarConsumidorPedidoAprovado } from './consumidor';
import { criarPluginFaturamento } from './index';
import type { DepsRotas } from './rotas';

/** Notas EPEC de teste: autorizadas há 2 h (no prazo), 165 h (perto do fim: faltam 3 h) e 170 h (vencida) em relação ao `agora` do ctx. */
const AGORA_CTX = new Date('2026-11-21T14:30:00Z').getTime();
const haHoras = (h: number): string => new Date(AGORA_CTX - h * 3_600_000).toISOString();
const epecDeTeste = [[2, 1], [170, 2], [165, 3]].map(([h, n]) => ({ id: uuid(80_000 + n!), filial_id: IDS.filial, ambiente: 'homologacao' as const, serie: 1, numero: n!, chave_acesso: null, status: 'emitida_contingencia' as const, epec_protocolo: '113260000000001', epec_autorizada_em: haHoras(h!) }));
const sessao = (perfil: Perfil): Sessao => ({ usuario_id: uuid(5), tenant_id: TENANT, perfil, filial_ids: [] });

function ambiente(perfil: Perfil = 'faturista', danfe?: DepsRotas['danfe']) {
  const f = depsFake();
  const tit = titulosFake();
  const cfg = configuracaoFake();
  const cont = contingenciaFake(epecDeTeste);
  const deps = { ...f.deps, titulos: tit.repo, configuracao: cfg.repo, contingencia: cont.repo, epecLigada: true } as DepsRotas; // os testes da EPEC cobrem o caminho ligado; o teste da bandeira desliga
  if (danfe) deps.danfe = danfe;
  const plugin = criarPluginFaturamento(deps);
  const trabalhos: { tipo: string; payload: Record<string, unknown>; external_id?: string }[] = [];
  const auditoria: string[] = [];
  const ctx: ContextoRota = {
    sessao: sessao(perfil),
    tx,
    request_id: 'req-1',
    agora: new Date('2026-11-21T14:30:00Z'),
    publicar: async () => {
      throw new Error('a API não publica evento de nota');
    },
    auditar: async (d) => void auditoria.push(d.acao),
    enfileirar: async (p) => (trabalhos.push(p), { id: uuid(9) }),
  };
  const rota = (metodo: string, caminho: string): RotaModulo => plugin.rotas.find((r) => r.metodo === metodo && r.caminho === caminho) as RotaModulo;
  const chamar = async (metodo: string, caminho: string, e: { corpo?: unknown; consulta?: unknown; params?: Record<string, string> } = {}) => {
    const r = rota(metodo, caminho);
    const corpo = r.corpo ? r.corpo.parse(e.corpo) : undefined;
    const consulta = r.consulta ? r.consulta.parse(e.consulta ?? {}) : undefined;
    return r.executar(ctx, { corpo, consulta, params: e.params ?? {} } as never);
  };
  return { ...f.r, ctx, tit, cfg, cont, deps, pedido: f.pedido, plugin, trabalhos, auditoria, chamar, rota };
}
const emitirCorpo = { pedido_id: IDS.pedido, idempotencia: 'idem-0000001' };

describe('rotas /v1/faturamento', () => {
  it('RN-CORE-02: toda rota declara ação do módulo; a emissão e o XML pedem faturista/fiscal/administrador; leitura é aberta aos perfis de leitura', () => {
    const a = ambiente();
    expect(a.plugin.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`).sort()).toEqual([
      'GET /contingencia/epec-pendentes faturamento.ver',
      'GET /contingencia/epec-pendentes/alerta faturamento.ver',
      'GET /contingencia/epec-pendentes/exportar faturamento.ver',
      'GET /filiais/:id/configuracao faturamento.ver',
      'GET /filiais/:id/contingencia faturamento.ver',
      'GET /notas faturamento.ver',
      'GET /notas/:id faturamento.ver',
      'GET /notas/:id/danfe faturamento.ver',
      'GET /notas/:id/eventos faturamento.ver',
      'GET /notas/:id/xml faturamento.nota.emitir',
      'GET /notas/exportar faturamento.ver',
      'GET /pedidos-a-faturar faturamento.ver',
      'GET /pedidos-a-faturar/:id faturamento.ver',
      'GET /pedidos-a-faturar/exportar faturamento.ver',
      'GET /rejeicoes faturamento.ver',
      'GET /rejeicoes/exportar faturamento.ver',
      'GET /titulos faturamento.ver',
      'GET /titulos/:id faturamento.ver',
      'GET /titulos/exportar faturamento.ver',
      'POST /contingencia/epec-pendentes/transmitir faturamento.nota.emitir',
      'POST /filiais/:id/contingencia faturamento.nota.emitir',
      'POST /filiais/:id/contingencia/encerrar faturamento.nota.emitir',
      'POST /inutilizacoes faturamento.nota.emitir',
      'POST /notas faturamento.nota.emitir',
      'POST /notas/:id/cancelar faturamento.nota.emitir',
      'POST /notas/:id/carta-correcao faturamento.nota.emitir',
      'POST /notas/:id/consultar faturamento.nota.emitir',
      'POST /notas/:id/reenviar faturamento.nota.emitir',
      'POST /titulos/:id/baixas faturamento.ver',
      'POST /titulos/:id/baixas/:baixa_id/estornar faturamento.ver',
      'PUT /filiais/:id/configuracao faturamento.ver',
    ]);
    expect(pode('leitura', 'faturamento.nota.emitir')).toBe(false);
    expect(pode('faturista', 'faturamento.nota.emitir')).toBe(true);
  });

  it('RF-FAT-01 / RN-FAT-03: POST /notas emite (201), audita e enfileira a transmissão; a repetição devolve 200 sem novo número; só enfileira de novo se a nota ainda está em rascunho', async () => {
    const a = ambiente();
    const r = await a.chamar('POST', '/notas', { corpo: emitirCorpo });
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ status: 'rascunho', numero: 100, total_centavos: 4500 }); // a API não assina: o worker leva a em_autorizacao
    expect(a.trabalhos).toHaveLength(1);
    expect(a.trabalhos[0]).toMatchObject({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id: (r.corpo as { id: string }).id } });
    expect(a.auditoria).toEqual(['faturamento.nota.emitir']);
    const repetida = await a.chamar('POST', '/notas', { corpo: emitirCorpo });
    expect(repetida.status).toBe(200);
    expect(a.estado.reservas).toBe(1);
    expect(a.auditoria).toEqual(['faturamento.nota.emitir']); // a repetição não audita de novo
    // nota ainda em rascunho (trabalho perdido): a repetição enfileira outra vez, com external_id próprio (não some na deduplicação)
    expect(a.trabalhos).toHaveLength(2);
    expect(a.trabalhos[1]).toMatchObject({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id: (r.corpo as { id: string }).id } });
    expect(a.trabalhos[1]?.external_id).not.toBe(a.trabalhos[0]?.external_id);
    // já assinada pelo worker (em_autorizacao): a repetição não enfileira nada
    const id = (r.corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'em_autorizacao' });
    expect((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).status).toBe(200);
    expect(a.trabalhos).toHaveLength(2);
  });

  it('RN-PED-02: violação de regra vira 422 com a RN; violação de dado, 400; nenhum número é queimado', async () => {
    const a = ambiente();
    const svc = a.deps;
    svc.situacao = { situacao: async () => ({ status: 'cancelado', itens: [] }) };
    const e1 = await criarPluginFaturamento({ ...svc, titulos: titulosFake().repo, configuracao: configuracaoFake().repo }).rotas.find((r) => r.metodo === 'POST')!.executar({ ...({} as ContextoRota), tx, sessao: sessao('faturista'), enfileirar: async () => ({ id: 'x' }), auditar: async () => undefined } as ContextoRota, { corpo: emitirCorpo, params: {}, cabecalhos: {}, arquivos: {}, todosArquivos: {} } as never).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ErroApi);
    expect(e1).toMatchObject({ status: 422, codigo: 'RN-PED-02' });
    expect(a.estado.reservas).toBe(0);
  });

  it('RF-FAT-01: corpo sem idempotência é 400 de validação (Zod)', async () => {
    await expect(ambiente().chamar('POST', '/notas', { corpo: { pedido_id: IDS.pedido } })).rejects.toThrow();
  });

  it('RN-FAT-07: POST /notas/:id/reenviar só aceita a rejeitada ou o rascunho (não assinado) e enfileira de novo', async () => {
    const a = ambiente();
    const emitida = await a.chamar('POST', '/notas', { corpo: emitirCorpo });
    const id = (emitida.corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'em_autorizacao' });
    await expect(a.chamar('POST', '/notas/:id/reenviar', { params: { id } })).rejects.toMatchObject({ codigo: 'RN-FAT-07' });
    a.notas.set(id, { ...a.notas.get(id)!, status: 'rejeitada' });
    const r = await a.chamar('POST', '/notas/:id/reenviar', { params: { id } });
    expect(r.corpo).toMatchObject({ status: 'rejeitada', numero: 100 }); // o worker assina e vai a em_autorizacao
    expect(a.trabalhos).toHaveLength(2);
    expect(a.trabalhos[1]?.external_id).toBe(`${id}:req-1`);
  });

  it('RF-FAT-01: GET /notas lista, GET /notas/:id detalha e id inexistente é 404', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    expect(((await a.chamar('GET', '/notas')).corpo as { itens: unknown[] }).itens).toHaveLength(1);
    expect((await a.chamar('GET', '/notas/:id', { params: { id } })).corpo).toMatchObject({ id, itens: [{ sequencia: 1 }, { sequencia: 2 }] });
    await expect(a.chamar('GET', '/notas/:id', { params: { id: uuid(404) } })).rejects.toMatchObject({ status: 404 });
    await expect(a.chamar('GET', '/notas/:id', { params: { id: 'lixo' } })).rejects.toMatchObject({ status: 404 });
  });

  it('RN-FAT-03: GET /notas/:id/xml devolve o nfeProc guardado; sem guarda, 404', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    await expect(a.chamar('GET', '/notas/:id/xml', { params: { id } })).rejects.toMatchObject({ status: 404 });
    a.xmls.push({ id, conteudo: '<nfeProc/>', protocolo: NPROT });
    const r = await a.chamar('GET', '/notas/:id/xml', { params: { id } });
    expect(r.corpo).toBe('<nfeProc/>');
    expect(r.cabecalhos).toMatchObject({ 'content-type': expect.stringContaining('application/xml') });
  });

  it('RF-FAT-03: GET /notas/:id/danfe gera o PDF só de nota autorizada ou cancelada com nfeProc guardado; vendedor recebe 403', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    await expect(a.chamar('GET', '/notas/:id/danfe', { params: { id } })).rejects.toMatchObject({ status: 422 }); // rascunho
    a.notas.set(id, { ...a.notas.get(id)!, status: 'autorizada' });
    await expect(a.chamar('GET', '/notas/:id/danfe', { params: { id } })).rejects.toMatchObject({ status: 404 }); // sem nfeProc
    a.xmls.push({ id, conteudo: nfeProcDeTeste(), protocolo: NPROT });
    const r = await a.chamar('GET', '/notas/:id/danfe', { params: { id } });
    expect(r.cabecalhos).toMatchObject({ 'content-type': 'application/pdf' });
    expect(Buffer.from(r.corpo as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    a.notas.set(id, { ...a.notas.get(id)!, status: 'cancelada' });
    expect(((await a.chamar('GET', '/notas/:id/danfe', { params: { id } })).corpo as Buffer).length).toBeGreaterThan(1000);
    await expect(ambiente('vendedor').chamar('GET', '/notas/:id/danfe', { params: { id } })).rejects.toMatchObject({ status: 403 });
  });

  it('RN-FAT-08: GET /notas/:id/danfe da EPEC com o evento registrado (emitida_contingencia) sai da <NFe> assinada, com o protocolo do evento; sem o evento, 422; SVC autorizada usa o nfeProc e leva o aviso', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    const proc = nfeProcDeTeste().replace('<tpAmb>2</tpAmb></ide>', '<tpEmis>4</tpEmis><dhCont>2026-11-21T09:00:00-04:00</dhCont><xJust>SEFAZ-AM fora do ar desde as 9h</xJust><tpAmb>2</tpAmb></ide>');
    a.assinados.push({ id, versao: 1, xml: /<NFe>[\s\S]*<\/NFe>/.exec(proc)![0], sha256: 'x' });
    a.notas.set(id, { ...a.notas.get(id)!, status: 'emitida_contingencia', tp_emis: 4, epec_protocolo: null, epec_autorizada_em: null });
    await expect(a.chamar('GET', '/notas/:id/danfe', { params: { id } })).rejects.toMatchObject({ status: 422 });
    a.notas.set(id, { ...a.notas.get(id)!, epec_protocolo: '891260000000007', epec_autorizada_em: '2026-11-21T14:05:00.000Z' });
    const r = await a.chamar('GET', '/notas/:id/danfe', { params: { id } });
    expect(Buffer.from(r.corpo as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    a.notas.set(id, { ...a.notas.get(id)!, status: 'em_autorizacao' });
    expect((await a.chamar('GET', '/notas/:id/danfe', { params: { id } })).cabecalhos).toMatchObject({ 'content-type': 'application/pdf' });
    a.notas.set(id, { ...a.notas.get(id)!, status: 'rascunho' });
    await expect(a.chamar('GET', '/notas/:id/danfe', { params: { id } })).rejects.toMatchObject({ status: 422 });
  });

  it('RN-FAT-03: GET /notas/:id/danfe com vDup ilegível vira 422 RN-FAT-03, sem dado do XML na resposta', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'autorizada' });
    a.xmls.push({ id, conteudo: nfeProcDeTeste({ duplicatas: true }).replace(/<vDup>[^<]*<\/vDup>/, '<vDup>100.005</vDup>'), protocolo: NPROT });
    const e = await a.chamar('GET', '/notas/:id/danfe', { params: { id } }).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 422 });
    const txt = JSON.stringify({ m: (e as Error).message, d: (e as { detalhes?: unknown }).detalhes, c: (e as { codigo?: unknown }).codigo, r: (e as { regra?: unknown }).regra });
    expect(txt).toContain('RN-FAT-03');
    expect(txt).not.toContain('100.005');
    expect(txt).not.toContain('<');
  });

  it('marca §4: GET /notas/:id/danfe sem o ativo do rodapé responde 503 "Ativo de marca do DANFE não encontrado", nunca um PDF sem rodapé', async () => {
    const a = ambiente('faturista', { assinaturaMarca: async () => null });
    const b = ambiente();
    (b.deps as DepsRotas).ativosDanfe = { ok: false, faltando: ['macuxi-erp-a-mono-preto-400.png'] };
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'autorizada' });
    a.xmls.push({ id, conteudo: nfeProcDeTeste(), protocolo: NPROT });
    await expect(a.chamar('GET', '/notas/:id/danfe', { params: { id } })).rejects.toMatchObject({ status: 503, message: 'Ativo de marca do DANFE não encontrado' });
    // resultado do boot (verificarAtivosDanfe) com ok=false: 503 mesmo com o ativo legível na hora
    const id2 = ((await b.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    b.notas.set(id2, { ...b.notas.get(id2)!, status: 'autorizada' });
    b.xmls.push({ id: id2, conteudo: nfeProcDeTeste(), protocolo: NPROT });
    await expect(b.chamar('GET', '/notas/:id/danfe', { params: { id: id2 } })).rejects.toMatchObject({ status: 503, message: 'Ativo de marca do DANFE não encontrado' });
  });

  it('RF-FAT-08: GET /rejeicoes lista as rejeitadas com a ação sugerida', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'rejeitada' });
    const r = await a.chamar('GET', '/rejeicoes');
    expect((r.corpo as { itens: { acao_sugerida: string }[] }).itens[0]?.acao_sugerida).toContain('NCM');
  });

  it('RF-FAT-08: vendedor não acessa as notas (403), mesmo que o perfil leia o módulo', async () => {
    const a = ambiente('vendedor');
    await expect(a.chamar('GET', '/notas')).rejects.toMatchObject({ status: 403 });
    await expect(a.chamar('GET', '/rejeicoes')).rejects.toMatchObject({ status: 403 });
    await expect(a.chamar('GET', '/pedidos-a-faturar')).rejects.toMatchObject({ status: 403 });
    await expect(a.chamar('GET', '/pedidos-a-faturar/:id', { params: { id: uuid(1) } })).rejects.toMatchObject({ status: 403 });
  });

  it('RF-FAT-01: GET /pedidos-a-faturar lista a fila do repositório com o cursor da consulta; o perfil de leitura enxerga, o filtro inválido é recusado', async () => {
    const a = ambiente('leitura');
    const chamadas: unknown[] = [];
    a.deps.pedidos.listar = async (_tx, f) => (chamadas.push(f), { itens: [], proximo_cursor: null });
    const r = await a.chamar('GET', '/pedidos-a-faturar', { consulta: { status: 'faturado_parcial', de: '2026-11-01' } });
    expect(r.corpo).toEqual({ itens: [], proximo_cursor: null });
    expect(chamadas[0]).toMatchObject({ status: 'faturado_parcial', de: '2026-11-01', limite: 50 });
    await expect(a.chamar('GET', '/pedidos-a-faturar', { consulta: { status: 'inventado' } })).rejects.toBeDefined();
  });

  it('RF-FAT-01: GET /pedidos-a-faturar/:id devolve o resumo com os itens e o saldo conforme o contrato; inexistente ou id inválido é 404', async () => {
    const a = ambiente('leitura');
    const detalhe = {
      id: uuid(1), pedido_id: IDS.pedido, numero: 7, filial_id: IDS.filial, cliente_id: IDS.cliente, cliente_razao_social: 'Mercado', status: 'faturado_parcial' as const, ambiente: 'homologacao' as const, total_centavos: 30_000, recebido_em: '2026-11-21T14:00:00.000Z',
      itens: [{ sequencia: 1, produto_id: uuid(2), descricao: 'Refrigerante 2L', quantidade_pedida: 20_000, quantidade_faturada: 5_000, saldo: 15_000, valor_unitario_centavos: 1000 }],
    };
    const pedidos: string[] = [];
    const situacoes: unknown[] = [];
    a.deps.situacao.situacao = async () => ({ status: 'faturado_parcial', itens: [{ sequencia: 1, quantidade: 20_000, quantidade_faturada: 5_000 }] });
    a.deps.pedidos.detalhar = async (_tx, id, situacaoDe) => (pedidos.push(id), situacoes.push(await situacaoDe(IDS.pedido)), id === uuid(1) ? detalhe : null);
    const r = await a.chamar('GET', '/pedidos-a-faturar/:id', { params: { id: uuid(1) } });
    expect(PedidoAFaturarDetalhe.parse(r.corpo)).toEqual(detalhe);
    await expect(a.chamar('GET', '/pedidos-a-faturar/:id', { params: { id: uuid(2) } })).rejects.toMatchObject({ status: 404, message: 'Pedido não encontrado' });
    await expect(a.chamar('GET', '/pedidos-a-faturar/:id', { params: { id: 'nao-e-uuid' } })).rejects.toMatchObject({ status: 404 });
    expect(pedidos).toEqual([uuid(1), uuid(2)]);
    // o detalhe lê a situação do pedido pela porta `situacao` (mesma conta da emissão)
    expect(situacoes[0]).toMatchObject({ status: 'faturado_parcial' });
  });

describe('rotas de eventos /v1/faturamento (lote 2)', () => {
  const JUST = { justificativa: 'Cliente desistiu da compra do pedido' };
  async function autorizada(perfil: Perfil = 'faturista') {
    const a = ambiente(perfil);
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'autorizada', protocolo: NPROT, autorizada_em: '2026-11-21T14:00:00.000Z' });
    a.trabalhos.length = 0;
    a.auditoria.length = 0;
    return { a, id };
  }

  it('RN-CORE-05: cancelar, CC-e e inutilizar exigem Idempotency-Key; consultar aceita', () => {
    const a = ambiente();
    const idem = Object.fromEntries(a.plugin.rotas.map((r) => [`${r.metodo} ${r.caminho}`, r.idempotencia]));
    expect(idem['POST /notas/:id/cancelar']).toBe('obrigatoria');
    expect(idem['POST /notas/:id/carta-correcao']).toBe('obrigatoria');
    expect(idem['POST /inutilizacoes']).toBe('obrigatoria');
    expect(idem['POST /notas/:id/consultar']).toBe('opcional');
  });

  it('RN-CORE-02: vendedor e leitura não emitem evento (a ação da rota não é deles) e vendedor não lê os eventos (403)', async () => {
    expect(pode('vendedor', 'faturamento.nota.emitir')).toBe(false);
    expect(pode('leitura', 'faturamento.nota.emitir')).toBe(false);
    const { a, id } = await autorizada('vendedor');
    await expect(a.chamar('GET', '/notas/:id/eventos', { params: { id } })).rejects.toMatchObject({ status: 403 });
  });

  it('RN-FAT-02: POST cancelar devolve 202 com o pedido pendente, audita e enfileira o trabalho do worker; repetir não enfileira de novo', async () => {
    const { a, id } = await autorizada();
    const r = await a.chamar('POST', '/notas/:id/cancelar', { corpo: JUST, params: { id } });
    expect(r.status).toBe(202);
    expect(r.corpo).toMatchObject({ tipo: 'cancelamento', status: 'pendente' });
    expect(r.corpo).not.toHaveProperty('dh_evento');
    expect(a.trabalhos).toMatchObject([{ tipo: TRABALHO_PROCESSAR_EVENTO, payload: { evento_id: (r.corpo as { id: string }).id } }]);
    expect(a.auditoria).toEqual(['faturamento.nota.cancelar']);
    await a.chamar('POST', '/notas/:id/cancelar', { corpo: JUST, params: { id } });
    expect(a.trabalhos).toHaveLength(1);
    const lista = await a.chamar('GET', '/notas/:id/eventos', { params: { id } });
    expect((lista.corpo as { itens: unknown[] }).itens).toHaveLength(1);
  });

  it('RN-FAT-02: cancelar nota não autorizada ou fora do prazo é 422 com a RN; nota inexistente é 404; justificativa curta é 400 (Zod)', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    await expect(a.chamar('POST', '/notas/:id/cancelar', { corpo: JUST, params: { id } })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-02' });
    await expect(a.chamar('POST', '/notas/:id/cancelar', { corpo: JUST, params: { id: uuid(404) } })).rejects.toMatchObject({ status: 404 });
    await expect(a.chamar('POST', '/notas/:id/cancelar', { corpo: { justificativa: 'curta' }, params: { id } })).rejects.toThrow();
  });

  it('RN-FAT-02: POST carta-correcao devolve 202 com o evento e os avisos', async () => {
    const { a, id } = await autorizada();
    const r = await a.chamar('POST', '/notas/:id/carta-correcao', { corpo: { texto: 'Corrigir o valor total da nota' }, params: { id } });
    expect(r.status).toBe(202);
    expect(r.corpo).toMatchObject({ evento: { tipo: 'cce', n_seq_evento: 1 }, avisos: [{ grupo: 'valor' }] });
    expect(a.trabalhos[0]?.tipo).toBe(TRABALHO_PROCESSAR_EVENTO);
  });

  it('RN-FAT-01: POST inutilizacoes grava o pedido, enfileira e recusa a faixa fora da regra (422)', async () => {
    const { a } = await autorizada();
    const ok = await a.chamar('POST', '/inutilizacoes', { corpo: { filial_id: IDS.filial, numero_inicial: 101, numero_final: 102, justificativa: 'Numeração pulada por falha do sistema' } });
    expect(ok.status).toBe(202);
    expect(a.trabalhos).toMatchObject([{ tipo: TRABALHO_PROCESSAR_INUTILIZACAO }]);
    await expect(a.chamar('POST', '/inutilizacoes', { corpo: { filial_id: IDS.filial, numero_inicial: 103, numero_final: 300, justificativa: 'Numeração pulada por falha do sistema' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-01' });
    await expect(a.chamar('POST', '/inutilizacoes', { corpo: { filial_id: IDS.filial, numero_inicial: 5, numero_final: 4, justificativa: 'Numeração pulada por falha do sistema' } })).rejects.toThrow();
  });

  it('RN-FAT-02: POST consultar enfileira a consulta (a SEFAZ é do worker) e devolve 202', async () => {
    const { a, id } = await autorizada();
    const r = await a.chamar('POST', '/notas/:id/consultar', { params: { id } });
    expect(r.status).toBe(202);
    expect(a.trabalhos).toMatchObject([{ tipo: TRABALHO_CONSULTAR_NOTA, payload: { nota_id: id } }]);
    await expect(a.chamar('POST', '/notas/:id/consultar', { params: { id: uuid(404) } })).rejects.toMatchObject({ status: 404 });
  });
});

describe('rotas de títulos e da bandeira da filial', () => {
  const semente = (a: ReturnType<typeof ambiente>) => {
    const nota = uuid(500);
    a.notas.set(nota, { id: nota, tenant_id: TENANT, pedido_id: IDS.pedido, pedido_uuid: null, filial_id: IDS.filial, cliente_id: IDS.cliente, vendedor_id: null, ambiente: 'producao', vai_ao_fdv: true, serie: 1, numero: 1, cnf: '1', chave_acesso: 'x', tp_emis: 1, status: 'autorizada', emitida_em: '2026-11-21T14:00:00.000Z', total_centavos: 3000, protocolo: NPROT, autorizada_em: null, recibo: null, idempotencia: 'i', revisao: 1, itens_solicitados: null, itens: [] });
    return a.tit.repo.inserirParcelas(tx, { id: nota, filial_id: IDS.filial, cliente_id: IDS.cliente, conta_como_real: false }, [{ parcela: 1, total_parcelas: 1, vencimento: '2026-12-21', valor_centavos: 3000, ambiente: 'producao' }]).then(([t]) => t!.id);
  };

  it('RN-FAT-06: GET /titulos filtra por cliente, status e vencimento e GET /titulos/:id traz as baixas', async () => {
    const a = ambiente('leitura');
    const id = await semente(a);
    const l = (await a.chamar('GET', '/titulos', { consulta: { cliente_id: IDS.cliente, status: 'aberto', vencimento_ate: '2026-12-31' } })).corpo as { itens: { id: string }[] };
    expect(l.itens.map((t) => t.id)).toEqual([id]);
    expect(((await a.chamar('GET', '/titulos', { consulta: { status: 'baixado' } })).corpo as { itens: unknown[] }).itens).toEqual([]);
    expect((await a.chamar('GET', '/titulos/:id', { params: { id } })).corpo).toMatchObject({ id, baixas: [] });
    await expect(a.chamar('GET', '/titulos/:id', { params: { id: uuid(404) } })).rejects.toMatchObject({ status: 404 });
  });

  it('RN-FAT-06: baixa e estorno só para administrador, gerente e faturista (fiscal, leitura e vendedor recebem 403)', async () => {
    for (const perfil of ['fiscal', 'leitura', 'vendedor'] as const) {
      const a = ambiente(perfil);
      const id = await semente(a);
      await expect(a.chamar('POST', '/titulos/:id/baixas', { params: { id }, corpo: { valor_centavos: 100, forma: 'pix' } })).rejects.toMatchObject({ status: 403 });
      await expect(a.chamar('POST', '/titulos/:id/baixas/:baixa_id/estornar', { params: { id, baixa_id: uuid(1) } })).rejects.toMatchObject({ status: 403 });
    }
    for (const perfil of ['administrador', 'gerente', 'faturista'] as const) {
      const a = ambiente(perfil);
      const id = await semente(a);
      const r = await a.chamar('POST', '/titulos/:id/baixas', { params: { id }, corpo: { valor_centavos: 1000, forma: 'pix' } });
      expect(r.status).toBe(201);
      const baixa = (r.corpo as { baixa: { id: string } }).baixa.id;
      expect(((await a.chamar('POST', '/titulos/:id/baixas/:baixa_id/estornar', { params: { id, baixa_id: baixa } })).corpo as { titulo: { saldo_centavos: number } }).titulo.saldo_centavos).toBe(3000);
      expect(a.auditoria).toEqual(['faturamento.titulo.baixar', 'faturamento.titulo.estornar']);
    }
    expect(ambiente().rota('POST', '/titulos/:id/baixas').idempotencia).toBe('obrigatoria');
  });

  it('RN-FAT-04: GET /filiais/:id/configuracao devolve também o ambiente vigente da filial (o mesmo da emissão), para o diálogo de inutilizar', async () => {
    const a = ambiente('faturista');
    const corpo = (await a.chamar('GET', '/filiais/:id/configuracao', { params: { id: IDS.filial } })).corpo;
    expect(ConfiguracaoFilialResposta.parse(corpo)).toEqual({ filial_id: IDS.filial, faturamento_real_nfe_simulada: false, ambiente: 'producao' });
    const h = ambiente('leitura');
    (h.deps.ambiente as { ambiente: () => Promise<string> }).ambiente = async () => 'homologacao';
    expect(((await h.chamar('GET', '/filiais/:id/configuracao', { params: { id: IDS.filial } })).corpo as { ambiente: string }).ambiente).toBe('homologacao');
    await expect(ambiente('vendedor').chamar('GET', '/filiais/:id/configuracao', { params: { id: IDS.filial } })).rejects.toMatchObject({ status: 403 });
  });

  it('RF-FAT-08: o CSV da lista para no teto de 10.000 linhas (a leitura por páginas de 200 não passa do teto)', async () => {
    const a = ambiente('faturista');
    let paginas = 0;
    const linha = { id: uuid(1), filial_id: IDS.filial, cliente_id: uuid(2), pedido_id: uuid(3), ambiente: 'homologacao', serie: 1, numero: 1, chave_acesso: null, status: 'autorizada', emitida_em: '2026-11-21T14:30:00.000Z', total_centavos: 100, protocolo: null, c_stat: null, x_motivo: null };
    const pagina = Array.from({ length: 200 }, () => linha); // a mesma referência: sem 10 mil objetos
    a.deps.notas.listar = async () => ({ itens: (paginas++, pagina), proximo_cursor: 'sempre-mais' }) as never;
    const r = await a.chamar('GET', '/notas/exportar');
    expect(paginas).toBe(50);
    const linhas = (r.corpo as string).split('\r\n').filter((l) => l !== '');
    expect(linhas.length).toBe(10_001); // cabeçalho + 10.000
  });

  it('RN-FAT-04: PUT /filiais/:id/configuracao só do administrador, com Idempotency-Key, audita e confere a filial; o padrão é desligada', async () => {
    const adm = ambiente('administrador');
    expect(((await adm.chamar('GET', '/filiais/:id/configuracao', { params: { id: IDS.filial } })).corpo as { faturamento_real_nfe_simulada: boolean }).faturamento_real_nfe_simulada).toBe(false);
    const r = await adm.chamar('PUT', '/filiais/:id/configuracao', { params: { id: IDS.filial }, corpo: { faturamento_real_nfe_simulada: true } });
    expect(r.corpo).toEqual({ filial_id: IDS.filial, faturamento_real_nfe_simulada: true });
    expect(adm.cfg.linhas.get(IDS.filial)).toEqual({ ligada: true, alterado_por: uuid(5) });
    expect(adm.auditoria).toEqual(['faturamento.filial.configurar']);
    expect(adm.rota('PUT', '/filiais/:id/configuracao').idempotencia).toBe('obrigatoria');
    for (const perfil of ['gerente', 'faturista', 'fiscal', 'leitura'] as const) {
      await expect(ambiente(perfil).chamar('PUT', '/filiais/:id/configuracao', { params: { id: IDS.filial }, corpo: { faturamento_real_nfe_simulada: true } })).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('CSV das listas (RF-FAT-08)', () => {
  const nota = (a: ReturnType<typeof ambiente>, n: number, status: 'autorizada' | 'rejeitada', total: number, razao?: string) => {
    const id = uuid(600 + n);
    a.notas.set(id, { id, tenant_id: TENANT, pedido_id: IDS.pedido, pedido_uuid: null, filial_id: IDS.filial, cliente_id: IDS.cliente, vendedor_id: null, ambiente: 'homologacao', vai_ao_fdv: true, serie: 1, numero: n, cnf: '1', chave_acesso: 'x', tp_emis: 1, status, emitida_em: '2026-11-21T14:00:00.000Z', total_centavos: total, protocolo: NPROT, autorizada_em: null, recibo: null, idempotencia: `i${n}`, revisao: 1, itens_solicitados: null, itens: [] });
    return razao;
  };
  const corpoDe = (r: { corpo?: unknown }) => r.corpo as string;

  it('RF-FAT-08: /notas/exportar entrega o CSV com os mesmos filtros da lista, cabeçalho de arquivo e valor em reais', async () => {
    const a = ambiente('leitura');
    nota(a, 1, 'autorizada', 12345);
    nota(a, 2, 'rejeitada', 500);
    const r = await a.chamar('GET', '/notas/exportar', { consulta: { status: 'autorizada' } });
    expect(r.cabecalhos).toMatchObject({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="notas-fiscais.csv"' });
    const linhas = corpoDe(r).trim().split('\r\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain('Número/Série');
    expect(linhas[1]).toContain('123,45');
    expect(corpoDe(r)).not.toContain('5,00');
  });

  it('RD-0772: /notas/exportar usa um fuso do tenant diferente do padrão (America/Rio_Branco, UTC-5) na hora do CSV e o repassa ao listar', async () => {
    const a = ambiente('leitura');
    nota(a, 1, 'autorizada', 12345); // emitida_em 14:00Z
    a.ctx.fuso = 'America/Rio_Branco';
    const r = await a.chamar('GET', '/notas/exportar');
    expect(corpoDe(r)).toContain('21/11/2026 09:00');
    const vistos: unknown[] = [];
    const listar = a.deps.notas.listar;
    a.deps.notas.listar = async (tx, f, fuso) => (vistos.push(fuso), listar(tx, f, fuso));
    a.ctx.fuso = 'America/Rio_Branco';
    await a.chamar('GET', '/notas');
    expect(vistos).toEqual(['America/Rio_Branco']);
  });

  it('RF-FAT-08: /rejeicoes/exportar e /pedidos-a-faturar/exportar respondem CSV com o nome de arquivo da lista', async () => {
    const a = ambiente('gerente');
    nota(a, 3, 'rejeitada', 100);
    const rej = await a.chamar('GET', '/rejeicoes/exportar');
    expect(rej.cabecalhos).toMatchObject({ 'content-disposition': 'attachment; filename="rejeicoes.csv"' });
    expect(corpoDe(rej)).toContain('Rejeicao: NCM inexistente');
    const ped = await a.chamar('GET', '/pedidos-a-faturar/exportar');
    expect(ped.cabecalhos).toMatchObject({ 'content-disposition': 'attachment; filename="pedidos-a-faturar.csv"' });
    expect(corpoDe(ped).trim().split('\r\n')[0]).toContain('Pedido');
  });

  it('RF-FAT-08: /titulos/exportar respeita os filtros de status e vencimento', async () => {
    const a = ambiente('fiscal');
    const nid = uuid(700);
    a.notas.set(nid, { id: nid, tenant_id: TENANT, pedido_id: IDS.pedido, pedido_uuid: null, filial_id: IDS.filial, cliente_id: IDS.cliente, vendedor_id: null, ambiente: 'producao', vai_ao_fdv: true, serie: 1, numero: 9, cnf: '1', chave_acesso: 'x', tp_emis: 1, status: 'autorizada', emitida_em: '2026-11-21T14:00:00.000Z', total_centavos: 3000, protocolo: NPROT, autorizada_em: null, recibo: null, idempotencia: 'i', revisao: 1, itens_solicitados: null, itens: [] });
    await a.tit.repo.inserirParcelas(tx, { id: nid, filial_id: IDS.filial, cliente_id: IDS.cliente, conta_como_real: false }, [{ parcela: 1, total_parcelas: 1, vencimento: '2026-12-21', valor_centavos: 3000, ambiente: 'producao' }]);
    const r = await a.chamar('GET', '/titulos/exportar', { consulta: { status: 'aberto', vencimento_ate: '2026-12-31' } });
    expect(r.cabecalhos).toMatchObject({ 'content-disposition': 'attachment; filename="titulos-a-receber.csv"' });
    expect(corpoDe(r)).toContain('21/12/2026');
    expect(corpoDe(r)).toContain('30,00');
    const vazio = await a.chamar('GET', '/titulos/exportar', { consulta: { status: 'baixado' } });
    expect(corpoDe(vazio).trim().split('\r\n')).toHaveLength(1);
  });

  it('RN-CORE-02: o vendedor recebe 403 nas 4 exportações; consulta inválida é recusada pelo contrato', async () => {
    for (const caminho of ['/pedidos-a-faturar/exportar', '/notas/exportar', '/rejeicoes/exportar', '/titulos/exportar']) {
      await expect(ambiente('vendedor').chamar('GET', caminho)).rejects.toMatchObject({ status: 403 });
    }
    await expect(ambiente().chamar('GET', '/notas/exportar', { consulta: { status: 'inexistente' } })).rejects.toBeTruthy();
  });

  it('proteção contra fórmula: célula que começa com "=" sai com apóstrofo (o SDK faz)', async () => {
    const a = ambiente('administrador');
    const id = uuid(800);
    a.notas.set(id, { id, tenant_id: TENANT, pedido_id: IDS.pedido, filial_id: IDS.filial, cliente_id: IDS.cliente, ambiente: 'producao', serie: 1, numero: 1, status: 'rejeitada', emitida_em: '2026-11-21T14:00:00.000Z', total_centavos: 1, itens: [] } as never);
    const r = await a.chamar('GET', '/rejeicoes/exportar');
    expect(corpoDe(r)).not.toMatch(/;=|\r\n=/);
  });
});

describe('consumidor de pedido.pedido.aprovado@1', () => {
  type Fila = Map<string, string>;
  const montarC = (situacao: { status: 'aprovado' | 'cancelado' | 'faturado' | 'faturado_parcial'; itens: { sequencia: number; quantidade: number; quantidade_faturada: number }[] }) => {
    const fila: Fila = new Map();
    const c = criarConsumidorPedidoAprovado({
      situacao: { situacao: async () => situacao },
      pedidos: {
        ...depsFake().deps.pedidos,
        gravar: async (_t, p, status = 'a_faturar') => {
          const novo = !fila.has(p.pedido_id);
          const igual = fila.get(p.pedido_id) === status;
          fila.set(p.pedido_id, status);
          return novo && !igual ? 'novo' : 'repetido';
        },
        marcarCancelado: async (_t, id) => {
          if (fila.has(id)) fila.set(id, 'cancelado');
        },
      },
    });
    return { c, fila };
  };
  const evento = () => ({ id: uuid(1), nome: EVENTO_PEDIDO_APROVADO, tenant_id: TENANT, agregado_id: IDS.pedido, versao: 1, ocorrido_em: '2026-11-21T14:00:00.000Z', ator: 'sistema' as const, request_id: 'r', payload: pedidoAprovado([itemPedido(1, 10_000, 1000)]) as unknown as Record<string, unknown> });

  it('RF-FAT-01: grava o pedido aprovado na fila a faturar, idempotente', async () => {
    const { c, fila } = montarC({ status: 'aprovado', itens: [{ sequencia: 1, quantidade: 10_000, quantidade_faturada: 0 }] });
    expect(c.eventos).toEqual([EVENTO_PEDIDO_APROVADO]);
    await c.tratar(evento(), tx);
    await c.tratar(evento(), tx);
    expect([...fila.entries()]).toEqual([[IDS.pedido, 'a_faturar']]);
    await expect(c.tratar({ ...evento(), payload: { lixo: true } }, tx)).rejects.toThrow();
  });

  it('RF-FAT-01: reentrega de aprovado antigo de pedido CANCELADO não entra na fila (e marca cancelado se já estava)', async () => {
    const { c, fila } = montarC({ status: 'cancelado', itens: [{ sequencia: 1, quantidade: 10_000, quantidade_faturada: 0 }] });
    await c.tratar(evento(), tx);
    expect(fila.size).toBe(0);
    fila.set(IDS.pedido, 'a_faturar');
    await c.tratar(evento(), tx);
    expect(fila.get(IDS.pedido)).toBe('cancelado');
  });

  it('RF-FAT-01: reentrega de aprovado antigo de pedido JÁ FATURADO grava faturado; saldo parcial, faturado_parcial; idempotente', async () => {
    const total = montarC({ status: 'faturado', itens: [{ sequencia: 1, quantidade: 10_000, quantidade_faturada: 10_000 }] });
    await total.c.tratar(evento(), tx);
    await total.c.tratar(evento(), tx);
    expect(total.fila.get(IDS.pedido)).toBe('faturado');
    const parcial = montarC({ status: 'faturado_parcial', itens: [{ sequencia: 1, quantidade: 10_000, quantidade_faturada: 4_000 }] });
    await parcial.c.tratar(evento(), tx);
    expect(parcial.fila.get(IDS.pedido)).toBe('faturado_parcial');
  });
});
  describe('contingência por filial (T-0021, lote 4)', () => {
    const MOTIVO = 'SEFAZ-AM sem resposta há 10 min';
    const abrirCorpo = (extra: object = {}) => ({ filial_id: IDS.filial, modalidade: 'svc_rs', motivo: MOTIVO, ...extra });
    const params = { id: IDS.filial };

    it('RN-FAT-05 (decisão do Alexandre, 23/11 07h40): abrir e encerrar só pelo administrador; faturista, fiscal, gerente, leitura e vendedor recebem 403 e nada é gravado; os GETs seguem abertos a quem lê', async () => {
      for (const perfil of ['faturista', 'fiscal', 'gerente', 'leitura', 'vendedor'] as const) {
        const a = ambiente(perfil);
        await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() })).rejects.toMatchObject({ status: 403 });
        await expect(a.chamar('POST', '/filiais/:id/contingencia/encerrar', { params })).rejects.toMatchObject({ status: 403 });
        expect(a.auditoria).toEqual([]);
      }
      for (const perfil of ['faturista', 'fiscal'] as const) {
        expect((await ambiente(perfil).chamar('GET', '/filiais/:id/contingencia', { params })).corpo).toMatchObject({ aberta: null });
      }
      expect((await ambiente('administrador').chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() })).status).toBe(201);
    });

    it('RN-FAT-05: abre a contingência no ambiente da filial, com ligada_por da sessão e auditoria; a leitura devolve a aberta', async () => {
      const a = ambiente('administrador');
      const r = await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() });
      expect(r.status).toBe(201);
      expect(r.corpo).toMatchObject({ filial_id: IDS.filial, ambiente: 'producao', modalidade: 'svc_rs', motivo: MOTIVO, fim_em: null, ligada_por: uuid(5), desligada_por: null });
      expect(a.auditoria).toContain('faturamento.contingencia.abrir');
      const g = await a.chamar('GET', '/filiais/:id/contingencia', { params });
      expect(g.corpo).toMatchObject({ filial_id: IDS.filial, ambiente: 'producao', aberta: { modalidade: 'svc_rs' }, historico: [] });
    });

    it('RN-FAT-05: justificativa curta, início no futuro e modalidade desconhecida são recusados (422 RN-FAT-05 ou 400 do contrato)', async () => {
      const a = ambiente('administrador');
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ motivo: 'curto' }) })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-05' });
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ inicio_em: '2026-11-21T14:31:00.000Z' }) })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-05' });
      expect(() => a.rota('POST', '/filiais/:id/contingencia').corpo!.parse(abrirCorpo({ modalidade: 'fs_da' }))).toThrow();
      expect(a.cont.linhas).toHaveLength(0);
    });

    it('RN-FAT-05: EPEC desligada na v0.3.0: abrir com modalidade epec dá 422 RN-FAT-05 com mensagem curta e nada é gravado; SVC abre', async () => {
      const a = ambiente('administrador');
      a.deps.epecLigada = false; // o padrão do módulo (EPEC_LIGADA)
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ modalidade: 'epec' }) })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-05', message: 'A EPEC ainda não está disponível. Use SVC.' });
      expect(a.cont.linhas).toHaveLength(0);
      expect((await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ modalidade: 'svc_rs' }) })).status).toBe(201);
    });

    it('RN-FAT-10: filial com NF-e simulada não entra em contingência (422)', async () => {
      const a = ambiente('administrador');
      a.cfg.linhas.set(IDS.filial, { ligada: true, alterado_por: 'teste' });
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-10' });
      expect(a.cont.linhas).toHaveLength(0);
    });

    it('RN-FAT-05: já havendo aberta na filial e no ambiente, a segunda abertura é 409', async () => {
      const a = ambiente('administrador');
      await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() });
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ modalidade: 'epec' }) })).rejects.toMatchObject({ status: 409 });
      expect(a.cont.linhas).toHaveLength(1);
    });

    it('RN-FAT-04: o ambiente do corpo, se vier, tem de ser o da filial; filial de outra URL e filial desconhecida', async () => {
      const a = ambiente('administrador');
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ ambiente: 'homologacao' }) })).rejects.toMatchObject({ status: 422, codigo: 'RN-FAT-04' });
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params: { id: uuid(99) }, corpo: abrirCorpo() })).rejects.toMatchObject({ status: 400 });
      await expect(a.chamar('POST', '/filiais/:id/contingencia', { params: { id: 'x' }, corpo: abrirCorpo() })).rejects.toMatchObject({ status: 404 });
      expect((await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ ambiente: 'producao' }) })).status).toBe(201);
    });

    it('RN-FAT-09: encerra com fim_em agora e desligada_por da sessão; sem aberta, 404; o histórico mostra a encerrada e a filial pode abrir de novo', async () => {
      const a = ambiente('administrador');
      await expect(a.chamar('POST', '/filiais/:id/contingencia/encerrar', { params })).rejects.toMatchObject({ status: 404 });
      await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() });
      const r = await a.chamar('POST', '/filiais/:id/contingencia/encerrar', { params });
      expect(r.corpo).toMatchObject({ fim_em: '2026-11-21T14:30:00.000Z', desligada_por: uuid(5), ligada_por: uuid(5) });
      expect(a.auditoria).toContain('faturamento.contingencia.encerrar');
      const g = await a.chamar('GET', '/filiais/:id/contingencia', { params });
      expect(g.corpo).toMatchObject({ aberta: null, historico: [{ modalidade: 'svc_rs' }] });
      expect((await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() })).status).toBe(201);
    });

    it('RN-FAT-09: encerrar a EPEC enfileira a volta de cada nota emitida_contingencia da filial e do ambiente (external_id com a contingência); encerrar SVC não enfileira nada', async () => {
      const a = ambiente('administrador');
      a.deps.ambiente = { ambiente: async () => 'homologacao' as const }; // as EPEC de teste são de homologação: a volta filtra por filial E ambiente
      await a.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo({ modalidade: 'epec' }) });
      const r = await a.chamar('POST', '/filiais/:id/contingencia/encerrar', { params });
      const id = (r.corpo as { id: string }).id;
      expect(a.trabalhos.map((t) => t.tipo)).toEqual([TRABALHO_TRANSMITIR_NOTA, TRABALHO_TRANSMITIR_NOTA, TRABALHO_TRANSMITIR_NOTA]);
      expect(a.trabalhos.map((t) => t.external_id).sort()).toEqual(epecDeTeste.map((n) => `${n.id}:volta:${id}`).sort());
      const b = ambiente('administrador');
      b.deps.ambiente = { ambiente: async () => 'homologacao' as const };
      await b.chamar('POST', '/filiais/:id/contingencia', { params, corpo: abrirCorpo() });
      await b.chamar('POST', '/filiais/:id/contingencia/encerrar', { params });
      expect(b.trabalhos).toEqual([]);
    });

    it('RN-FAT-09: POST /contingencia/epec-pendentes/transmitir é só do administrador, exige Idempotency-Key, enfileira as pendentes (com a contagem das vencidas) e audita sem dado pessoal', async () => {
      const a = ambiente('administrador');
      expect(a.rota('POST', '/contingencia/epec-pendentes/transmitir')).toMatchObject({ acao: 'faturamento.nota.emitir', idempotencia: 'obrigatoria' });
      const r = await a.chamar('POST', '/contingencia/epec-pendentes/transmitir', { corpo: {} });
      expect(r).toMatchObject({ status: 202, corpo: { enfileiradas: 3, vencidas: 1 } });
      expect(a.trabalhos.every((t) => t.tipo === TRABALHO_TRANSMITIR_NOTA && /:volta:req-1$/.test(t.external_id!))).toBe(true);
      expect(a.auditoria).toContain('faturamento.epec.transmitir_pendentes');
      for (const perfil of ['faturista', 'fiscal', 'gerente', 'vendedor'] as const) {
        await expect(ambiente(perfil).chamar('POST', '/contingencia/epec-pendentes/transmitir', { corpo: {} })).rejects.toMatchObject({ status: 403 });
      }
      expect((await a.chamar('POST', '/contingencia/epec-pendentes/transmitir', { corpo: { filial_id: uuid(99) } })).corpo).toMatchObject({ enfileiradas: 0 });
    });

    it('RN-FAT-09: GET /contingencia/epec-pendentes/alerta: vencida acende o sinal vermelho (vendedor 403)', async () => {
      const a = ambiente('administrador');
      expect((await a.chamar('GET', '/contingencia/epec-pendentes/alerta')).corpo).toEqual({ sinal: 'vermelho', total: 3, no_prazo: 1, perto_do_fim: 1, vencidas: 1, prazo_mais_proximo: new Date(AGORA_CTX - 170 * 3_600_000 + 168 * 3_600_000).toISOString() });
      expect((await a.chamar('GET', '/contingencia/epec-pendentes/alerta', { consulta: { filial_id: uuid(99) } })).corpo).toMatchObject({ sinal: 'verde', total: 0 });
      await expect(ambiente('vendedor').chamar('GET', '/contingencia/epec-pendentes/alerta')).rejects.toMatchObject({ status: 403 });
    });

    it('RN-CORE-02: rotas pedem Idempotency-Key; vendedor não lê', async () => {
      const a = ambiente();
      expect(a.rota('POST', '/filiais/:id/contingencia')).toMatchObject({ acao: 'faturamento.nota.emitir', idempotencia: 'obrigatoria' });
      expect(a.rota('POST', '/filiais/:id/contingencia/encerrar')).toMatchObject({ acao: 'faturamento.nota.emitir', idempotencia: 'obrigatoria' });
      for (const perfil of ['gerente', 'leitura'] as const) expect(pode(perfil, 'faturamento.nota.emitir')).toBe(false);
      for (const perfil of ['administrador', 'faturista', 'fiscal'] as const) expect(pode(perfil, 'faturamento.nota.emitir')).toBe(true);
      const v = ambiente('vendedor');
      await expect(v.chamar('GET', '/filiais/:id/contingencia', { params })).rejects.toMatchObject({ status: 403 });
      await expect(v.chamar('GET', '/contingencia/epec-pendentes')).rejects.toMatchObject({ status: 403 });
      await expect(v.chamar('GET', '/contingencia/epec-pendentes/exportar')).rejects.toMatchObject({ status: 403 });
    });

    it('sem o adaptador de contingência ligado, a rota responde 503 (nunca 500)', async () => {
      const a = ambiente();
      delete (a.deps as { contingencia?: unknown }).contingencia;
      await expect(a.chamar('GET', '/filiais/:id/contingencia', { params })).rejects.toMatchObject({ status: 503 });
    });

    it('RN-FAT-09: as EPEC pendentes saem com o prazo de 168 h da autorização do EPEC e a situação (vencida, perto do fim, no prazo), da mais urgente à menos', async () => {
      const a = ambiente('leitura');
      const r = await a.chamar('GET', '/contingencia/epec-pendentes');
      const itens = (r.corpo as { itens: { numero: number; prazo_ate: string; situacao_prazo: string }[] }).itens;
      expect(itens.map((i) => [i.numero, i.situacao_prazo])).toEqual([[2, 'vencido'], [3, 'perto_do_fim'], [1, 'no_prazo']]);
      expect(itens[0]!.prazo_ate).toBe(new Date(AGORA_CTX - 170 * 3_600_000 + 168 * 3_600_000).toISOString());
      const so = await a.chamar('GET', '/contingencia/epec-pendentes', { consulta: { situacao: 'vencido' } });
      expect((so.corpo as { itens: unknown[] }).itens).toHaveLength(1);
      const p1 = await a.chamar('GET', '/contingencia/epec-pendentes', { consulta: { limite: 2 } });
      const cursor = (p1.corpo as { proximo_cursor: string }).proximo_cursor;
      expect(cursor).toBe(uuid(80_003));
      const p2 = await a.chamar('GET', '/contingencia/epec-pendentes', { consulta: { limite: 2, cursor } });
      expect((p2.corpo as { itens: { numero: number }[]; proximo_cursor: unknown })).toMatchObject({ itens: [{ numero: 1 }], proximo_cursor: null });
      const csv = await a.chamar('GET', '/contingencia/epec-pendentes/exportar');
      expect(String(csv.corpo)).toContain('Vencido');
    });
  });
});
