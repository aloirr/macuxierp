import { ErroApi, pode, type ContextoRota, type Perfil, type RotaModulo, type Sessao } from '@macuxierp/platform-sdk';
import { EVENTO_PEDIDO_APROVADO } from '@macuxierp/pedido/contracts';
import { describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { nfeProcDeTeste } from '../domain/fixtures-danfe';
import { TRABALHO_CONSULTAR_NOTA, TRABALHO_PROCESSAR_EVENTO, TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_TRANSMITIR_NOTA } from '../contracts';
import { configuracaoFake, depsFake, titulosFake, NPROT, tx, TENANT, uuid } from './apoio-teste';
import { criarConsumidorPedidoAprovado } from './consumidor';
import { criarPluginFaturamento } from './index';
import type { DepsRotas } from './rotas';

const sessao = (perfil: Perfil): Sessao => ({ usuario_id: uuid(5), tenant_id: TENANT, perfil, filial_ids: [] });

function ambiente(perfil: Perfil = 'faturista', danfe?: DepsRotas['danfe']) {
  const f = depsFake();
  const tit = titulosFake();
  const cfg = configuracaoFake();
  const deps = { ...f.deps, titulos: tit.repo, configuracao: cfg.repo } as DepsRotas;
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
  return { ...f.r, tit, cfg, deps: f.deps, pedido: f.pedido, plugin, trabalhos, auditoria, chamar, rota };
}
const emitirCorpo = { pedido_id: IDS.pedido, idempotencia: 'idem-0000001' };

describe('rotas /v1/faturamento', () => {
  it('RN-CORE-02: toda rota declara ação do módulo; a emissão e o XML pedem faturista/fiscal/administrador; leitura é aberta aos perfis de leitura', () => {
    const a = ambiente();
    expect(a.plugin.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`).sort()).toEqual([
      'GET /filiais/:id/configuracao faturamento.ver',
      'GET /notas faturamento.ver',
      'GET /notas/:id faturamento.ver',
      'GET /notas/:id/danfe faturamento.ver',
      'GET /notas/:id/eventos faturamento.ver',
      'GET /notas/:id/xml faturamento.nota.emitir',
      'GET /rejeicoes faturamento.ver',
      'GET /titulos faturamento.ver',
      'GET /titulos/:id faturamento.ver',
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
  });
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

describe('consumidor de pedido.pedido.aprovado@1', () => {
  type Fila = Map<string, string>;
  const montarC = (situacao: { status: 'aprovado' | 'cancelado' | 'faturado' | 'faturado_parcial'; itens: { sequencia: number; quantidade: number; quantidade_faturada: number }[] }) => {
    const fila: Fila = new Map();
    const c = criarConsumidorPedidoAprovado({
      situacao: { situacao: async () => situacao },
      pedidos: {
        obter: async () => null,
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
