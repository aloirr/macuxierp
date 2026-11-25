import { PERFIS, pode, type Perfil } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { TRANSICOES } from '../domain';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { CPF_DO_CLIENTE, IDS, MOTIVO_LIVRE, OBSERVACAO, RAZAO_DO_CLIENTE, pedidoFdv, pedidoManual, prazoDoCliente, prazoMedioDaCondicao, prepararCadastros, unidadeDoProduto } from './fixtures-teste';
import { idFaturadoDaNota } from './eventos';
import { criarPluginPedido } from './index';
import { criarRecebedorFdv } from './recebedor';
import { dependenciasEmMemoria } from './memoria';

type Montagem = ReturnType<typeof montar>;
function montar(o: { limite?: number; saldo?: number; notaEmAutorizacao?: boolean; notasAutorizadas?: string[] } = {}) {
  const m = dependenciasEmMemoria(o);
  prepararCadastros(m.cadastros, o);
  const amb = criarAmbiente(criarPluginPedido(m.deps));
  return { ...m, ...amb };
}
const adm = sessaoDe('administrador');
const gerente = sessaoDe('gerente');
const faturista = sessaoDe('faturista');
const vendedorA = sessaoDe('vendedor', IDS.usuarioVendedor);
const vendedorB = sessaoDe('vendedor', IDS.usuarioOutroVendedor);

let contador = 0;
const chave = () => ({ 'idempotency-key': `chave-de-teste-${++contador}-abcdef` });
const lancar = (t: Montagem, corpo = pedidoManual(), sessao = adm) => t.chamar('POST', '/pedidos', { sessao, corpo, cabecalhos: chave() });
const unidades = (n: number, preco = 1000) => ({ produto_id: IDS.produto1, quantidade: n * 10_000, preco_unitario_centavos: preco, desconto_centavos: 0 });
/** Pedido manual em análise: sem condição de pagamento (pendência não bloqueante `condicao_ausente`). */
const emAnalise = async (t: Montagem, sobre = {}) => {
  const r = await lancar(t, pedidoManual({ condicao_pagamento_id: null, ...sobre }));
  expect(r.status).toBe(201);
  expect(r.corpo.status).toBe('em_analise');
  return r.corpo as { id: string; updated_at: string };
};

describe('plugin', () => {
  it('declara só rotas do módulo pedido, sem repetir método e caminho', () => {
    const { deps } = dependenciasEmMemoria();
    expect(() => criarPluginPedido(deps)).not.toThrow();
  });
  it('GET /motivos devolve o catálogo de recusa e de cancelamento com o texto em português', async () => {
    const t = montar();
    const r = await t.chamar('GET', '/motivos', { sessao: sessaoDe('leitura') });
    expect(r.status).toBe(200);
    expect(r.corpo.recusa).toContainEqual({ codigo: 'credito_insuficiente', texto: 'Crédito insuficiente' });
    expect(r.corpo.cancelamento).toContainEqual({ codigo: 'solicitacao_cliente', texto: 'Solicitação do cliente' });
  });
});

describe('permissões (T-0013 §9.1, item 3)', () => {
  const rotas: { acao: string; metodo: 'GET' | 'POST' | 'PUT'; caminho: string; corpo?: unknown }[] = [
    { acao: 'pedido.ver', metodo: 'GET', caminho: '/pedidos' },
    { acao: 'pedido.ver', metodo: 'GET', caminho: '/pedidos/exportar' },
    { acao: 'pedido.ver', metodo: 'GET', caminho: `/pedidos/${IDS.desconhecido}` },
    { acao: 'pedido.ver', metodo: 'GET', caminho: '/motivos' },
    { acao: 'pedido.pedido.lancar', metodo: 'PUT', caminho: `/pedidos/${IDS.desconhecido}`, corpo: pedidoManual() },
    { acao: 'pedido.pedido.lancar', metodo: 'POST', caminho: `/pedidos/${IDS.desconhecido}/revalidar` },
    { acao: 'pedido.pedido.aprovar', metodo: 'POST', caminho: `/pedidos/${IDS.desconhecido}/aprovar`, corpo: {} },
    { acao: 'pedido.pedido.aprovar', metodo: 'POST', caminho: `/pedidos/${IDS.desconhecido}/recusar`, corpo: { motivo_codigo: 'preco_divergente' } },
    { acao: 'pedido.pedido.cancelar', metodo: 'POST', caminho: `/pedidos/${IDS.desconhecido}/cancelar`, corpo: { motivo_codigo: 'erro_lancamento' } },
  ];
  for (const perfil of PERFIS) {
    for (const r of rotas) {
      const permitido = pode(perfil as Perfil, r.acao as Parameters<typeof pode>[1]);
      it(`${perfil} ${permitido ? 'passa' : 'é barrado (403)'} em ${r.metodo} ${r.caminho.replace(IDS.desconhecido, ':id')}`, async () => {
        const t = montar();
        const resp = await t.chamar(r.metodo, r.caminho, { sessao: sessaoDe(perfil as Perfil, IDS.usuarioVendedor), corpo: r.corpo, cabecalhos: { 'if-match': '2026-11-21T15:00:00.001Z' } });
        if (permitido) expect(resp.status).not.toBe(403);
        else expect(resp).toMatchObject({ status: 403, corpo: { codigo: 'PERFIL_SEM_PERMISSAO' } });
      });
    }
  }
  it('RN-CORE-02 (T-0013 §9.1, item 4): sem licença do módulo pedido, toda rota dá 403 MODULO_INATIVO', async () => {
    const t = montar();
    for (const r of rotas) {
      const resp = await t.chamar(r.metodo, r.caminho, { sessao: adm, corpo: r.corpo, semLicenca: true });
      expect(resp, `${r.metodo} ${r.caminho}`).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
    }
    expect((await t.chamar('POST', '/pedidos', { sessao: adm, corpo: pedidoManual(), cabecalhos: chave(), semLicenca: true })).status).toBe(403);
    expect(t.armazem.pedidos).toHaveLength(0);
  });
  it('faturista lança mas não aprova; gerente aprova, recusa e cancela', async () => {
    const t = montar();
    const p = await emAnalise(t);
    expect((await lancar(t, pedidoManual(), faturista)).status).toBe(201);
    expect((await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: faturista, corpo: { justificativa: 'ok' } })).status).toBe(403);
    expect((await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'ok' } })).status).toBe(200);
  });
});

describe('lançamento manual (RF-PED-02, RN-PED-03)', () => {
  it('RN-PED-03: sem pendência vai direto a aprovado, com aprovação automática, recebido@1 e aprovado@1 e auditoria', async () => {
    const t = montar();
    const r = await lancar(t);
    expect(r.status).toBe(201);
    // O corpo é o Pedido inteiro: o `id` fica no topo (o shell abre o detalhe com ele).
    expect(r.corpo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.corpo).toMatchObject({ numero: 1, origem: 'bko', status: 'aprovado', total_centavos: 1000, pendencias: [], decisao: { automatica: true, decisao: 'aprovado', decidido_por: null } });
    expect(r.corpo.historico.map((h: { de: string | null; para: string }) => [h.de, h.para])).toEqual([[null, 'recebido'], ['recebido', 'aprovado']]);
    expect(t.eventos.map((e) => e.nome)).toEqual(['pedido.pedido.recebido@1', 'pedido.pedido.aprovado@1']);
    expect(t.eventos[0]?.payload).toMatchObject({ status: 'aprovado', status_anterior: null, pendencias: [], origem: 'bko', pedido_uuid: null });
    expect(t.eventos[1]?.payload).toMatchObject({ automatica: true, status_anterior: 'recebido' });
    expect(t.auditoria).toEqual([expect.objectContaining({ acao: 'pedido.lancar', entidade: 'pedido', entidade_id: r.corpo.id })]);
  });
  it('P9: o recebido@1 não leva o retrato do cliente; o aprovado@1 leva (o faturamento usa na nota)', async () => {
    const t = montar();
    await lancar(t);
    expect(JSON.stringify(t.eventos[0]?.payload)).not.toContain(CPF_DO_CLIENTE);
    expect(JSON.stringify(t.eventos[1]?.payload)).toContain(CPF_DO_CLIENTE);
  });
  it('T-0021: o aprovado@1 leva forma_tpag, forma_codigo e forma_nome da condição, municipio_nome do cliente, origem do produto e frete sem valor', async () => {
    const t = montar();
    const p1 = t.cadastros.produtosPorId.get(IDS.produto1);
    if (!p1) throw new Error('fixture');
    t.cadastros.produtosPorId.set(IDS.produto1, { ...p1, origem: '2' });
    await lancar(t);
    const pedido = (t.eventos[1]?.payload as { pedido: { cliente_retrato: { endereco: { municipio_nome: string } }; itens: { produto_retrato: { origem: string } }[]; frete: unknown } }).pedido;
    expect(pedido).toMatchObject({ forma_tpag: '15', forma_codigo: 'BOL', forma_nome: 'Boleto' });
    expect(pedido.cliente_retrato.endereco.municipio_nome).toBe('Manaus');
    expect(pedido.itens[0]?.produto_retrato.origem).toBe('2');
    expect(pedido.frete).toBeNull();
  });
  it('T-0021: sem condição de pagamento, forma_tpag, forma_codigo e forma_nome saem nulos no aprovado@1', async () => {
    const t = montar();
    const p = await emAnalise(t);
    const r = await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: adm, corpo: { justificativa: 'ok' } });
    expect(r.status).toBe(200);
    expect((t.eventos.at(-1)?.payload as { pedido: unknown }).pedido).toMatchObject({ forma_tpag: null, forma_codigo: null, forma_nome: null });
  });
  it('RN-PED-03: com pendência vai a em_analise, só com recebido@1, e a lista de pendências sai sem valor no evento', async () => {
    const t = montar();
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 0);
    const r = await lancar(t);
    expect(r.corpo).toMatchObject({ status: 'em_analise', decisao: null });
    expect(r.corpo.pendencias).toEqual([expect.objectContaining({ codigo: 'estoque_insuficiente', bloqueante: false, esperado: 0, informado: 10_000 })]);
    expect(t.eventos.map((e) => e.nome)).toEqual(['pedido.pedido.recebido@1']);
    expect(t.eventos[0]?.payload).toMatchObject({ status: 'em_analise', pendencias: ['estoque_insuficiente'] });
  });
  it('o número começa em 1 e cresce de 1 em 1', async () => {
    const t = montar();
    expect((await lancar(t)).corpo.numero).toBe(1);
    expect((await lancar(t)).corpo.numero).toBe(2);
  });
  it('RN-CORE-05: sem Idempotency-Key é 400', async () => {
    const t = montar();
    const r = await t.chamar('POST', '/pedidos', { sessao: adm, corpo: pedidoManual() });
    expect(r).toMatchObject({ status: 400, corpo: { codigo: 'VALIDACAO' } });
    expect(t.armazem.pedidos).toHaveLength(0);
  });
  it('RN-CORE-05: a mesma Idempotency-Key devolve o mesmo pedido, sem criar outro nem evento novo', async () => {
    const t = montar();
    const cab = chave();
    const a = await t.chamar('POST', '/pedidos', { sessao: adm, corpo: pedidoManual(), cabecalhos: cab });
    const eventos = t.eventos.length;
    const b = await t.chamar('POST', '/pedidos', { sessao: adm, corpo: pedidoManual(), cabecalhos: cab });
    expect(b).toMatchObject({ status: 201, repetida: true });
    expect(b.corpo.id).toBe(a.corpo.id);
    expect(t.armazem.pedidos).toHaveLength(1);
    expect(t.eventos).toHaveLength(eventos);
    const c = await t.chamar('POST', '/pedidos', { sessao: adm, corpo: pedidoManual({ observacao: 'outro corpo' }), cabecalhos: cab });
    expect(c).toMatchObject({ status: 409, corpo: { codigo: 'CONFLITO' } });
  });
  it('RN-PED-01: o mesmo external_id com o mesmo conteúdo devolve o pedido (200); com outro conteúdo é 409 com o pedido existente', async () => {
    const t = montar();
    const a = await lancar(t, pedidoManual({ external_id: 'EXT-1' }));
    expect(a.status).toBe(201);
    const mesmo = await lancar(t, pedidoManual({ external_id: 'EXT-1' }));
    expect(mesmo).toMatchObject({ status: 200 });
    expect(mesmo.corpo.id).toBe(a.corpo.id);
    const outro = await lancar(t, pedidoManual({ external_id: 'EXT-1', itens: [unidades(2)] }));
    expect(outro).toMatchObject({ status: 409, corpo: { codigo: 'CONFLITO', pedido: { id: a.corpo.id } } });
    expect(t.armazem.pedidos).toHaveLength(1);
    expect(t.eventos).toHaveLength(2);
  });
  it('RN-PED-07: prazo médio da condição acima do prazo médio do cliente é 422 RN-PED-07 no condicao_pagamento_id, e nada é gravado', async () => {
    const t = montar();
    prazoDoCliente(t.cadastros, 20);
    const r = await lancar(t);
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-07', campos: { condicao_pagamento_id: expect.any(String) } } });
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
  });
  it('RN-PED-07: prazo incompleto é 422 RN-PED-07 e nada é gravado', async () => {
    const t = montar();
    prazoMedioDaCondicao(t.cadastros, IDS.condicao30, null);
    expect(await lancar(t)).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-07', campos: { condicao_pagamento_id: expect.any(String) } } });
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
  });
  it('RN-PED-07: a edição também recusa o prazo acima do cliente (422) e mantém o pedido como estava', async () => {
    const t = montar();
    const p = await emAnalise(t);
    prazoDoCliente(t.cadastros, 10);
    const r = await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: adm, corpo: pedidoManual(), cabecalhos: { 'if-match': p.updated_at } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-07' } });
    expect(t.armazem.pedidos[0]).toMatchObject({ status: 'em_analise', condicao_pagamento_id: null });
  });
  it('RN-PED-07: a aprovação de pedido em análise revalida; cliente com prazo médio menor bloqueia (422 RN-PED-03 com prazo_acima_do_cliente) e, voltando ao normal, aprova', async () => {
    const t = montar();
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 0);
    const p = (await lancar(t)).corpo;
    expect(p.status).toBe('em_analise');
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 1_000_000);
    prazoDoCliente(t.cadastros, 10);
    const r = await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'ok' } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-03', detalhes: { bloqueantes: ['prazo_acima_do_cliente'] } } });
    prazoDoCliente(t.cadastros, 30);
    expect((await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente })).status).toBe(200);
  });
  it('RN-PED-03: desconto maior que o valor do item é 422 RN-PED-03 e nada é gravado', async () => {
    const t = montar();
    const r = await lancar(t, pedidoManual({ itens: [{ ...unidades(1), desconto_centavos: 1001 }] }));
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-03', campos: { 'itens[0].desconto_centavos': expect.any(String) } } });
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
  });
  it('RN-CAD-17: fração em produto de unidade UN é 422 RN-CAD-17 em itens[0].quantidade, e nada é gravado; em KG a fração passa', async () => {
    const t = montar();
    const r = await lancar(t, pedidoManual({ itens: [{ ...unidades(1), quantidade: 15_000 }] }));
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-17', campos: { 'itens[0].quantidade': expect.any(String) } } });
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(t.eventos).toHaveLength(0);
    unidadeDoProduto(t.cadastros, IDS.produto1, 'KG');
    const ok = await lancar(t, pedidoManual({ itens: [{ ...unidades(1), quantidade: 15_000 }] }));
    expect(ok.status).toBe(201);
    expect(ok.corpo.total_centavos).toBe(1500); // valorItem do SDK: 1,5 × R$ 10,00
  });
  it('RN-CAD-17: a edição também recusa a fração fora de KG e M (422) e mantém o pedido como estava', async () => {
    const t = montar();
    const p = await emAnalise(t);
    const r = await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: adm, corpo: pedidoManual({ itens: [{ ...unidades(1), quantidade: 15_000 }] }), cabecalhos: { 'if-match': p.updated_at } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-CAD-17', campos: { 'itens[0].quantidade': expect.any(String) } } });
    expect(t.armazem.pedidos[0]).toMatchObject({ status: 'em_analise', condicao_pagamento_id: null });
  });
  it('cliente, filial, condição, produto e endereço inexistentes são 400 pelo campo', async () => {
    const t = montar();
    const r = await lancar(t, pedidoManual({ cliente_id: IDS.desconhecido, filial_id: IDS.desconhecido, condicao_pagamento_id: IDS.desconhecido, itens: [{ ...unidades(1), produto_id: IDS.desconhecido }] }));
    expect(r.status).toBe(400);
    expect(Object.keys(r.corpo.campos)).toEqual(expect.arrayContaining(['cliente_id', 'filial_id', 'condicao_pagamento_id', 'itens[0].produto_id']));
    expect((await lancar(t, pedidoManual({ endereco_entrega_id: IDS.desconhecido }))).corpo.campos).toHaveProperty('endereco_entrega_id');
  });
  it('o endereço de entrega escolhido por id vai no pedido; o vendedor do cliente é o padrão', async () => {
    const t = montar();
    const r = await lancar(t, pedidoManual({ endereco_entrega_id: IDS.endereco }));
    expect(r.corpo.endereco_entrega).toMatchObject({ endereco_id: IDS.endereco, retrato: { logradouro: 'Rua das Flores' } });
    expect(r.corpo.vendedor_id).toBe(IDS.vendedor);
  });
  it('RN-PED-03: cliente, produto e filial sem emissão viram pendência bloqueante, não erro', async () => {
    const t = montar();
    const r = await lancar(t, pedidoManual({ cliente_id: IDS.clienteInativo, filial_id: IDS.filialSemEmissao, itens: [{ ...unidades(1), produto_id: IDS.produtoInativo }] }));
    expect(r.status).toBe(201);
    expect(r.corpo.pendencias.filter((p: { bloqueante: boolean }) => p.bloqueante).map((p: { codigo: string }) => p.codigo)).toEqual(['cliente_inativo', 'produto_inativo', 'filial_nao_emissora']);
  });
  it('RN-PED-04: crédito exatamente igual ao limite passa; 1 centavo acima cai em análise com os valores', async () => {
    const t = montar();
    expect((await lancar(t, pedidoManual({ itens: [unidades(100)] }))).corpo.status).toBe('aprovado'); // 100.000 = limite
    const t2 = montar({ saldo: 100_000_000 });
    unidadeDoProduto(t2.cadastros, IDS.produto1, 'KG'); // 100,001 só é possível em unidade fracionável (RN-CAD-17)
    const r = await lancar(t2, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 1_000_010, preco_unitario_centavos: 1000, desconto_centavos: 0 }] })); // 100.001
    expect(r.corpo.status).toBe('em_analise');
    expect(r.corpo.pendencias).toEqual([expect.objectContaining({ codigo: 'credito_excedido', esperado: 100_000, informado: 100_001 })]);
  });
  it('RN-PED-04: o compromisso dos pedidos aprovados a prazo conta; o do pedido à vista não conta (premissa f), mas o estoque conta', async () => {
    const t = montar({ saldo: 10_000_000 });
    const aVista = await lancar(t, pedidoManual({ condicao_pagamento_id: IDS.condicaoAVista, itens: [unidades(150)] })); // acima do limite, mas à vista
    expect(aVista.corpo).toMatchObject({ status: 'aprovado', pendencias: [] });
    const a = await lancar(t, pedidoManual({ itens: [unidades(60)] }));
    expect(a.corpo.status).toBe('aprovado'); // o à vista de R$ 1.500 não entrou no compromisso
    const b = await lancar(t, pedidoManual({ itens: [unidades(60)] })); // 60.000 + 60.000 > 100.000
    expect(b.corpo.pendencias).toEqual([expect.objectContaining({ codigo: 'credito_excedido', informado: 120_000 })]);
    // estoque: o saldo é 1.000.000 (100 un); os dois aprovados já comprometem 210 un
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 2_200_000);
    const c = await lancar(t, pedidoManual({ condicao_pagamento_id: IDS.condicaoAVista, itens: [unidades(20)] }));
    expect(c.corpo.pendencias).toEqual([expect.objectContaining({ codigo: 'estoque_insuficiente', esperado: 100_000, informado: 200_000 })]);
  });
  it('RN-PED-04: cartão (03) com limite 0 passa; o pedido aprovado no cartão não soma no compromisso de outro a prazo; boleto soma', async () => {
    const t = montar({ saldo: 10_000_000 });
    const cartao = await lancar(t, pedidoManual({ condicao_pagamento_id: IDS.condicaoCartao, itens: [unidades(150)] })); // acima do limite de R$ 1.000
    expect(cartao.corpo).toMatchObject({ status: 'aprovado', pendencias: [] });
    expect(t.armazem.pedidos.find((p) => p.id === cartao.corpo.id)!.a_vista).toBe(true);
    const a = await lancar(t, pedidoManual({ itens: [unidades(60)] }));
    expect(a.corpo.status).toBe('aprovado'); // o cartão não entrou no compromisso
    expect(t.armazem.pedidos.find((p) => p.id === a.corpo.id)!.a_vista).toBe(false);
    const b = await lancar(t, pedidoManual({ itens: [unidades(60)] })); // boleto soma: 60.000 + 60.000 > 100.000
    expect(b.corpo.pendencias).toEqual([expect.objectContaining({ codigo: 'credito_excedido', informado: 120_000 })]);
  });
  it('RN-CAD-06: o preço e o desconto máximo da tabela ficam gravados no item', async () => {
    const t = montar();
    const r = await lancar(t);
    expect(r.corpo.itens[0]).toMatchObject({ preco_tabela_centavos: 1000, desconto_maximo_bp: 500, sequencia: 1 });
    expect(r.corpo.tabela_preco_id).toBe(IDS.tabela);
  });
});

describe('transições (RN-PED-02)', () => {
  const acoes = [
    { nome: 'aprovar', alvo: 'aprovado', corpo: { justificativa: 'ok' } },
    { nome: 'recusar', alvo: 'recusado', corpo: { motivo_codigo: 'preco_divergente' } },
    { nome: 'cancelar', alvo: 'cancelado', corpo: { motivo_codigo: 'erro_lancamento' } },
  ] as const;
  for (const de of Object.keys(TRANSICOES) as (keyof typeof TRANSICOES)[]) {
    for (const a of acoes) {
      const ok = TRANSICOES[de].includes(a.alvo);
      it(`RN-PED-02: ${a.nome} a partir de ${de} ${ok ? 'passa' : 'é 422 com os possíveis'}`, async () => {
        const t = montar();
        const p = await lancar(t);
        t.armazem.pedidos[0]!.status = de;
        t.armazem.pedidos[0]!.pendencias = [];
        t.armazem.aprovacoes.length = 0;
        const r = await t.chamar('POST', `/pedidos/${p.corpo.id}/${a.nome}`, { sessao: gerente, corpo: a.corpo });
        if (ok) expect(r).toMatchObject({ status: 200, corpo: { status: a.alvo } });
        else expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02', detalhes: { possiveis: TRANSICOES[de] } } });
      });
    }
  }
  it('o pedido recusado é terminal: nenhuma ação sai dele, e não há evento novo', async () => {
    const t = montar();
    const p = await emAnalise(t);
    expect((await t.chamar('POST', `/pedidos/${p.id}/recusar`, { sessao: gerente, corpo: { motivo_codigo: 'cliente_bloqueado' } })).status).toBe(200);
    const antes = t.eventos.length;
    const r = await t.chamar('POST', `/pedidos/${p.id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'erro_lancamento' } });
    expect(r).toMatchObject({ status: 422, corpo: { detalhes: { possiveis: [] } } });
    expect(t.eventos).toHaveLength(antes);
  });
});

/** Pedido do FDV em análise por prazo acima do cliente (RN-PED-07, emenda de 24/11), recebido pelo recebedor como o Hub faz. */
const fdvEmAnalise = async (t: Montagem) => {
  prazoDoCliente(t.cadastros, 10);
  const recebedor = criarRecebedorFdv({
    ...t.deps, outbox: new OutboxMemoria(), auditoria: new AuditoriaMemoria(), relogio: new RelogioFixo(new Date('2026-11-21T15:00:00Z')),
    licencas: { ler: async () => [{ modulo: 'pedido', ativo: true, valido_ate: null }] },
  });
  const r = await recebedor.receber({ consultar: async () => [] }, pedidoFdv());
  expect(r).toMatchObject({ resultado: 'criado', status: 'em_analise' });
  return (r as { pedido_id: string }).pedido_id;
};

describe('pedido do FDV em análise por prazo (RN-PED-07, 0056)', () => {
  it('RN-PED-07 e RN-PED-03: aprovar aceita a pendência de prazo: bloqueante=false, justificativa obrigatória e a aceitação em aprovacao', async () => {
    const t = montar();
    const id = await fdvEmAnalise(t);
    expect(await t.chamar('POST', `/pedidos/${id}/aprovar`, { sessao: gerente })).toMatchObject({ status: 400, corpo: { campos: { justificativa: expect.any(String) } } });
    expect(await t.chamar('POST', `/pedidos/${id}/aprovar`, { sessao: faturista, corpo: { justificativa: 'ok' } })).toMatchObject({ status: 403 });
    const r = await t.chamar('POST', `/pedidos/${id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'Cliente novo, prazo combinado com o comercial' } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'aprovado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] } });
    expect(t.armazem.pedidos[0]).toMatchObject({ status: 'aprovado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
    expect(t.armazem.aprovacoes.at(-1)).toMatchObject({ decisao: 'aprovado', automatica: false, justificativa: 'Cliente novo, prazo combinado com o comercial', pendencias_aceitas: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
    expect(t.eventos.at(-1)?.nome).toBe('pedido.pedido.aprovado@1');
  });
  it('RN-PED-07: o pedido do FDV em análise por prazo pode ser recusado, com a pendência de prazo mantida', async () => {
    const t = montar();
    const id = await fdvEmAnalise(t);
    const r = await t.chamar('POST', `/pedidos/${id}/recusar`, { sessao: gerente, corpo: { motivo_codigo: 'cliente_bloqueado' } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'recusado' } });
    expect(t.armazem.pedidos[0]).toMatchObject({ status: 'recusado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: true }] });
    expect(t.eventos.at(-1)?.nome).toBe('pedido.pedido.recusado@1');
  });
  it('RN-PED-07: o pedido do FDV aprovado com a pendência de prazo aceita pode ser cancelado (em_analise não cancela direto, RN-PED-02); o cancelado guarda as pendências', async () => {
    const t = montar();
    const id = await fdvEmAnalise(t);
    expect(await t.chamar('POST', `/pedidos/${id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'erro_lancamento' } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02' } });
    expect((await t.chamar('POST', `/pedidos/${id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'ok' } })).status).toBe(200);
    const r = await t.chamar('POST', `/pedidos/${id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'erro_lancamento' } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'cancelado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] } });
    expect(t.armazem.pedidos[0]).toMatchObject({ status: 'cancelado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
    expect(t.armazem.aprovacoes.at(-1)).toMatchObject({ pendencias_aceitas: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
    expect(t.eventos.at(-1)?.nome).toBe('pedido.pedido.cancelado@1');
  });
});

describe('aprovação humana (RN-PED-03)', () => {
  it('pendência bloqueante impede: 422 RN-PED-03 com os bloqueantes', async () => {
    const t = montar();
    const p = await emAnalise(t, { itens: [{ ...unidades(1), produto_id: IDS.produtoInativo }] });
    const r = await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'preciso' } });
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-03', detalhes: { bloqueantes: ['produto_inativo'] } } });
    expect(t.armazem.pedidos[0]?.status).toBe('em_analise');
  });
  it('pendência não bloqueante sem justificativa é 400; com justificativa aprova e grava as pendências aceitas', async () => {
    const t = montar();
    const p = await emAnalise(t);
    const sem = await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente });
    expect(sem).toMatchObject({ status: 400, corpo: { codigo: 'VALIDACAO', campos: { justificativa: expect.any(String) } } });
    const eventos = t.eventos.length;
    const r = await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'cliente antigo, condição combinada por telefone' } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'aprovado', decisao: { automatica: false, perfil: 'gerente', decidido_por: gerente.usuario_id, pendencias_aceitas: [{ codigo: 'condicao_ausente' }] } } });
    expect(t.eventos.slice(eventos).map((e) => e.nome)).toEqual(['pedido.pedido.aprovado@1']);
    expect(t.eventos.at(-1)?.payload).toMatchObject({ automatica: false, status_anterior: 'em_analise', status: 'aprovado' });
    expect(t.auditoria.at(-1)).toMatchObject({ acao: 'pedido.aprovar', depois: { status: 'aprovado', pendencias_aceitas: ['condicao_ausente'] } });
  });
  it('a aprovação revalida na hora: a pendência que sumiu não pede justificativa', async () => {
    const t = montar();
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 0);
    const p = (await lancar(t)).corpo;
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 1_000_000);
    const r = await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'aprovado', decisao: { pendencias_aceitas: [], justificativa: null } } });
  });
  it('a aprovação e a criação tomam o advisory lock do cliente (travaCliente)', async () => {
    const t = montar();
    const p = await emAnalise(t);
    expect(t.armazem.travas).toHaveLength(1);
    await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: gerente, corpo: { justificativa: 'ok' } });
    expect(t.armazem.travas).toHaveLength(2);
    expect(t.armazem.travas[0]).toBe(t.armazem.travas[1]);
  });
  it('a recusa grava a decisão e o motivo; o texto livre só vai ao evento no motivo "outro"', async () => {
    const t = montar();
    const a = await emAnalise(t);
    expect((await t.chamar('POST', `/pedidos/${a.id}/recusar`, { sessao: gerente, corpo: { motivo_codigo: 'outro' } })).status).toBe(400);
    const r = await t.chamar('POST', `/pedidos/${a.id}/recusar`, { sessao: gerente, corpo: { motivo_codigo: 'cliente_bloqueado', motivo_texto: 'anotação interna' } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'recusado', decisao: { decisao: 'recusado', motivo_codigo: 'cliente_bloqueado' } } });
    expect(t.eventos.at(-1)).toMatchObject({ nome: 'pedido.pedido.recusado@1', payload: { motivo_codigo: 'cliente_bloqueado', motivo_texto: null, status_anterior: 'em_analise' } });
    const b = await emAnalise(t);
    await t.chamar('POST', `/pedidos/${b.id}/recusar`, { sessao: gerente, corpo: { motivo_codigo: 'outro', motivo_texto: MOTIVO_LIVRE } });
    expect(t.eventos.at(-1)?.payload).toMatchObject({ motivo_codigo: 'outro', motivo_texto: MOTIVO_LIVRE });
  });
  it('o cancelamento do pedido aprovado publica cancelado@1; nota em autorização impede (porta F4)', async () => {
    const t = montar();
    const p = (await lancar(t)).corpo;
    const r = await t.chamar('POST', `/pedidos/${p.id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'solicitacao_cliente' } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'cancelado' } });
    expect(t.eventos.at(-1)).toMatchObject({ nome: 'pedido.pedido.cancelado@1', payload: { motivo_codigo: 'solicitacao_cliente', status_anterior: 'aprovado' } });
    expect(t.auditoria.at(-1)).toMatchObject({ acao: 'pedido.cancelar' });

    const n = montar({ notaEmAutorizacao: true });
    const q = (await lancar(n)).corpo;
    expect(await n.chamar('POST', `/pedidos/${q.id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'erro_lancamento' } })).toMatchObject({ status: 422 });
    expect(n.armazem.pedidos[0]?.status).toBe('aprovado');
  });
});

describe('cancelar com nota autorizada (T-0015, RN-PED-02)', () => {
  const NOTA = '00000000-0000-4000-8000-000000000301';
  const cancelar = (t: Montagem, id: string) => t.chamar('POST', `/pedidos/${id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'erro_lancamento' } });
  it('RN-PED-02: nota autorizada ainda não aplicada impede o cancelamento e devolve só os ids pendentes', async () => {
    const t = montar({ notasAutorizadas: [NOTA] });
    const p = (await lancar(t)).corpo;
    const r = await cancelar(t, p.id);
    expect(r).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02', mensagem: 'O pedido tem nota autorizada ainda não registrada: aguarde alguns segundos e tente de novo', detalhes: { notas_pendentes: [NOTA] } } });
    expect(t.armazem.pedidos[0]?.status).toBe('aprovado');
  });
  it('RN-PED-02: com a nota já aplicada o faturado_parcial cancela o saldo', async () => {
    const t = montar({ notasAutorizadas: [NOTA] });
    const p = (await lancar(t)).corpo;
    const g = t.armazem.pedidos[0]!;
    g.status = 'faturado_parcial';
    t.armazem.eventos.push({ pedido_id: g.id, de: 'aprovado', para: 'faturado_parcial', ator_tipo: 'sistema', ator_id: null, motivo_codigo: null, motivo_texto: null, pendencias: null, evento_id: idFaturadoDaNota(NOTA), ocorrido_em: new Date(), id: 'e1' });
    expect(await cancelar(t, p.id)).toMatchObject({ status: 200, corpo: { status: 'cancelado' } });
  });
  it('RN-PED-02: nota em autorização continua impedindo, com a mensagem própria', async () => {
    const t = montar({ notaEmAutorizacao: true });
    const p = (await lancar(t)).corpo;
    expect(await cancelar(t, p.id)).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02', mensagem: 'O pedido tem nota em autorização: aguarde o resultado antes de cancelar' } });
  });
});

describe('revalidação e edição (RF-PED-02 e 03, P7)', () => {
  it('revalidar sem pendência nova aprova pelo sistema (automática); com pendência continua em análise sem evento', async () => {
    const t = montar();
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 0);
    const p = (await lancar(t, pedidoManual())).corpo;
    const eventos = t.eventos.length;
    const igual = await t.chamar('POST', `/pedidos/${p.id}/revalidar`, { sessao: faturista });
    expect(igual).toMatchObject({ status: 200, corpo: { status: 'em_analise' } });
    expect(t.eventos).toHaveLength(eventos);
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 1_000_000);
    const r = await t.chamar('POST', `/pedidos/${p.id}/revalidar`, { sessao: faturista });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'aprovado', decisao: { automatica: true } } });
    expect(t.eventos.at(-1)).toMatchObject({ nome: 'pedido.pedido.aprovado@1', payload: { automatica: true, status_anterior: 'em_analise' } });
    expect(t.armazem.eventos.at(-1)).toMatchObject({ de: 'em_analise', para: 'aprovado', ator_tipo: 'sistema', ator_id: null });
    expect(t.auditoria.map((a) => a.acao)).toEqual(['pedido.lancar', 'pedido.revalidar', 'pedido.revalidar']);
  });
  it('RN-PED-02: editar e revalidar fora de análise trazem a mensagem específica e detalhes.possiveis', async () => {
    const t = montar();
    const p = (await lancar(t)).corpo;
    const rev = await t.chamar('POST', `/pedidos/${p.id}/revalidar`, { sessao: adm });
    expect(rev).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02', mensagem: 'Só o pedido em análise pode ser revalidado', detalhes: { possiveis: ['faturado_parcial', 'faturado', 'cancelado'] } } });
    const edit = await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: adm, corpo: pedidoManual(), cabecalhos: { 'if-match': `"${p.updated_at}"` } });
    expect(edit).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02', mensagem: 'Só o pedido em análise pode ser editado', detalhes: { possiveis: ['faturado_parcial', 'faturado', 'cancelado'] } } });
  });
  it('RN-PED-02: revalidar o pedido que não está em análise é 422 com os possíveis', async () => {
    const t = montar();
    const p = (await lancar(t)).corpo;
    expect(await t.chamar('POST', `/pedidos/${p.id}/revalidar`, { sessao: adm })).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02', detalhes: { possiveis: ['faturado_parcial', 'faturado', 'cancelado'] } } });
  });
  it('editar exige If-Match; token velho é 409; só o manual em análise; revalida e pode aprovar', async () => {
    const t = montar();
    const p = await emAnalise(t);
    const corpo = pedidoManual({ itens: [unidades(2)] });
    expect((await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: faturista, corpo })).status).toBe(400);
    expect((await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: faturista, corpo, cabecalhos: { 'if-match': '2020-01-01T00:00:00.000Z' } })).status).toBe(409);
    // ainda sem condição: continua em análise, com o total novo e o mesmo item
    const r = await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: faturista, corpo: { ...corpo, condicao_pagamento_id: null }, cabecalhos: { 'if-match': `"${p.updated_at}"` } });
    expect(r).toMatchObject({ status: 200, corpo: { status: 'em_analise', total_centavos: 2000 } });
    expect(r.corpo.itens).toHaveLength(1);
    expect(t.auditoria.at(-1)).toMatchObject({ acao: 'pedido.editar' });
    // com a condição, a revalidação aprova sozinha
    const ok = await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: faturista, corpo, cabecalhos: { 'if-match': r.corpo.updated_at } });
    expect(ok).toMatchObject({ status: 200, corpo: { status: 'aprovado', decisao: { automatica: true } } });
    // aprovado não se edita mais
    expect(await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: faturista, corpo, cabecalhos: { 'if-match': ok.corpo.updated_at } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02' } });
  });
  it('editar troca, retira e acrescenta item sem reaproveitar a sequência', async () => {
    const t = montar();
    const p = await emAnalise(t, { itens: [unidades(1), { ...unidades(1), produto_id: IDS.produto2 }] });
    const r = await t.chamar('PUT', `/pedidos/${p.id}`, {
      sessao: adm,
      corpo: pedidoManual({ condicao_pagamento_id: null, itens: [{ ...unidades(3), produto_id: IDS.produto2 }, unidades(1)] }),
      cabecalhos: { 'if-match': p.updated_at },
    });
    expect(r.corpo.itens.map((i: { sequencia: number; produto_id: string; quantidade: number }) => [i.sequencia, i.produto_id, i.quantidade])).toEqual([[1, IDS.produto1, 10_000], [2, IDS.produto2, 30_000]]);
    const novo = await t.chamar('PUT', `/pedidos/${p.id}`, {
      sessao: adm,
      corpo: pedidoManual({ condicao_pagamento_id: null, itens: [unidades(1), { ...unidades(1), produto_id: IDS.produtoInativo }] }),
      cabecalhos: { 'if-match': r.corpo.updated_at },
    });
    expect(novo.corpo.itens.map((i: { sequencia: number }) => i.sequencia)).toEqual([1, 3]);
  });
  it('o pedido do FDV não se edita no ERP (P7)', async () => {
    const t = montar();
    const p = await lancar(t);
    t.armazem.pedidos[0]!.origem = 'fdv';
    t.armazem.pedidos[0]!.external_id = IDS.pedidoFdv;
    expect(await t.chamar('PUT', `/pedidos/${p.corpo.id}`, { sessao: adm, corpo: pedidoManual(), cabecalhos: { 'if-match': p.corpo.updated_at } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-02' } });
  });
  it('RN-PED-01: o external_id de um pedido do FDV não vale como repetido no lançamento manual: é 409 e não devolve o pedido', async () => {
    const t = montar();
    const a = await lancar(t, pedidoManual({ external_id: IDS.pedidoFdv }));
    t.armazem.pedidos[0]!.origem = 'fdv';
    const r = await lancar(t, pedidoManual({ external_id: IDS.pedidoFdv }));
    expect(r.status).toBe(409);
    expect(r.corpo.pedido).toBeUndefined();
    expect(t.armazem.pedidos).toHaveLength(1);
    expect(a.status).toBe(201);
  });
  it('o pedido que some entre a leitura e a trava é 404 (editar, revalidar, aprovar)', async () => {
    const t = montar();
    const p = await emAnalise(t);
    const repo = t.deps.repositorios;
    t.deps.repositorios = (tx) => Object.assign(Object.create(repo(tx)), { obterParaAtualizar: async () => null });
    expect((await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: adm, corpo: pedidoManual(), cabecalhos: { 'if-match': p.updated_at } })).status).toBe(404);
    expect((await t.chamar('POST', `/pedidos/${p.id}/revalidar`, { sessao: adm })).status).toBe(404);
    expect((await t.chamar('POST', `/pedidos/${p.id}/aprovar`, { sessao: adm, corpo: {} })).status).toBe(404);
    expect((await t.chamar('POST', `/pedidos/${p.id}/recusar`, { sessao: adm, corpo: { motivo_codigo: 'preco_divergente' } })).status).toBe(404);
    expect((await t.chamar('POST', `/pedidos/${p.id}/cancelar`, { sessao: adm, corpo: { motivo_codigo: 'erro_lancamento' } })).status).toBe(404);
  });
});

describe('leitura: lista, detalhe e carteira (RF-PED-04)', () => {
  it('o vendedor vê só a própria carteira; o pedido de outro vendedor é 404; sem vínculo, lista vazia', async () => {
    const t = montar();
    const meu = (await lancar(t, pedidoManual({ vendedor_id: IDS.vendedor }))).corpo;
    const alheio = (await lancar(t, pedidoManual({ vendedor_id: IDS.outroVendedor }))).corpo;
    expect((await t.chamar('GET', '/pedidos', { sessao: vendedorA })).corpo.itens.map((i: { id: string }) => i.id)).toEqual([meu.id]);
    expect((await t.chamar('GET', '/pedidos', { sessao: vendedorA, consulta: { vendedor_id: IDS.outroVendedor } })).corpo.itens.map((i: { id: string }) => i.id)).toEqual([meu.id]);
    expect((await t.chamar('GET', `/pedidos/${meu.id}`, { sessao: vendedorA })).status).toBe(200);
    expect(await t.chamar('GET', `/pedidos/${alheio.id}`, { sessao: vendedorA })).toMatchObject({ status: 404, corpo: { codigo: 'NAO_ENCONTRADO' } });
    expect((await t.chamar('GET', '/pedidos', { sessao: sessaoDe('vendedor', '88888888-8888-4888-8888-888888888888') })).corpo).toEqual({ itens: [], proximo_cursor: null });
    expect((await t.chamar('GET', '/pedidos', { sessao: sessaoDe('leitura') })).corpo.itens).toHaveLength(2);
    expect((await t.chamar('GET', '/pedidos', { sessao: vendedorB })).corpo.itens.map((i: { id: string }) => i.id)).toEqual([alheio.id]);
  });
  it('a lista filtra por status e origem, busca por número e pagina por cursor; o JSON nunca leva o documento', async () => {
    const t = montar();
    await lancar(t);
    await lancar(t);
    await emAnalise(t);
    const todas = await t.chamar('GET', '/pedidos', { sessao: adm, consulta: { limite: 2 } });
    expect(todas.corpo.itens).toHaveLength(2);
    expect(todas.corpo.proximo_cursor).toEqual(expect.any(String));
    expect(JSON.stringify(todas.corpo)).not.toContain(CPF_DO_CLIENTE);
    const pag2 = await t.chamar('GET', '/pedidos', { sessao: adm, consulta: { limite: 2, cursor: todas.corpo.proximo_cursor } });
    expect(pag2.corpo).toMatchObject({ itens: [expect.anything()], proximo_cursor: null });
    expect((await t.chamar('GET', '/pedidos', { sessao: adm, consulta: { status: 'em_analise' } })).corpo.itens).toHaveLength(1);
    expect((await t.chamar('GET', '/pedidos', { sessao: adm, consulta: { origem: 'fdv' } })).corpo.itens).toHaveLength(0);
    expect((await t.chamar('GET', '/pedidos', { sessao: adm, consulta: { busca: '2' } })).corpo.itens.map((i: { numero: number }) => i.numero)).toEqual([2]);
    expect((await t.chamar('GET', '/pedidos', { sessao: adm, consulta: { status: 'inexistente' } })).status).toBe(400);
  });
  it('o detalhe traz itens, histórico, decisão e, em análise, as pendências com esperado e informado', async () => {
    const t = montar({ saldo: 10_000_000 });
    const p = (await lancar(t, pedidoManual({ itens: [unidades(150)] }))).corpo;
    const r = await t.chamar('GET', `/pedidos/${p.id}`, { sessao: sessaoDe('leitura') });
    expect(r.corpo).toMatchObject({ status: 'em_analise', cliente_retrato: { razao_social: RAZAO_DO_CLIENTE }, total_centavos: 150_000 });
    expect(r.corpo.pendencias).toEqual([expect.objectContaining({ codigo: 'credito_excedido', esperado: 100_000, informado: 150_000 })]);
    expect(r.corpo.historico).toHaveLength(2);
  });
  it('o detalhe em análise mantém as pendências gravadas e só junta esperado e informado; pendência nova da reavaliação não entra', async () => {
    const t = montar({ saldo: 10_000_000 });
    const p = (await lancar(t, pedidoManual({ itens: [unidades(150)] }))).corpo;
    // o crédito passou a não ser problema depois do lançamento, mas a lista gravada é a que vale
    t.armazem.pedidos[0]!.pendencias = [{ codigo: 'credito_excedido', bloqueante: false, sequencia: null, produto_id: null }, { codigo: 'preco_sem_tabela', bloqueante: false, sequencia: 9, produto_id: IDS.produto1 }];
    const r = await t.chamar('GET', `/pedidos/${p.id}`, { sessao: adm });
    expect(r.corpo.pendencias).toEqual([
      expect.objectContaining({ codigo: 'credito_excedido', esperado: 100_000, informado: 150_000 }),
      expect.objectContaining({ codigo: 'preco_sem_tabela', sequencia: 9, esperado: null, informado: null }),
    ]);
    t.armazem.pedidos[0]!.pendencias = [];
    expect((await t.chamar('GET', `/pedidos/${p.id}`, { sessao: adm })).corpo.pendencias).toEqual([]);
  });
  it('LGPD: o detalhe não devolve o documento do cliente ao vendedor, mas devolve ao gerente', async () => {
    const t = montar();
    const p = (await lancar(t, pedidoManual({ vendedor_id: IDS.vendedor }))).corpo;
    const v = await t.chamar('GET', `/pedidos/${p.id}`, { sessao: vendedorA });
    expect(v.status).toBe(200);
    expect(v.corpo.cliente_retrato).toMatchObject({ documento: null, razao_social: RAZAO_DO_CLIENTE });
    expect(JSON.stringify(v.corpo)).not.toContain(CPF_DO_CLIENTE);
    expect((await t.chamar('GET', `/pedidos/${p.id}`, { sessao: gerente })).corpo.cliente_retrato.documento).toBe(CPF_DO_CLIENTE);
  });
  it('id que não é UUID e id de outro tenant são 404', async () => {
    const t = montar();
    expect((await t.chamar('GET', '/pedidos/abc', { sessao: adm })).status).toBe(404);
    expect((await t.chamar('GET', `/pedidos/${IDS.desconhecido}`, { sessao: adm })).status).toBe(404);
  });
});

describe('CSV (RF-PED-05)', () => {
  it('o gerente recebe o documento do cliente; o vendedor recebe só a própria carteira e sem a coluna do documento', async () => {
    const t = montar();
    await lancar(t, pedidoManual({ vendedor_id: IDS.vendedor }));
    await lancar(t, pedidoManual({ vendedor_id: IDS.outroVendedor }));
    const g = await t.chamar('GET', '/pedidos/exportar', { sessao: gerente });
    expect(g.status).toBe(200);
    expect(g.cabecalhos).toMatchObject({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="pedidos.csv"' });
    expect(g.corpo.startsWith('﻿Número;Origem;Status;Emitido em (UTC);Cliente;Documento do cliente;')).toBe(true);
    expect(g.corpo).toContain(CPF_DO_CLIENTE);
    expect(g.corpo).toContain('10,00');
    expect(g.corpo.trim().split('\r\n')).toHaveLength(3);
    const v = await t.chamar('GET', '/pedidos/exportar', { sessao: vendedorA });
    expect(v.corpo).not.toContain(CPF_DO_CLIENTE);
    expect(v.corpo).not.toContain('Documento');
    expect(v.corpo.trim().split('\r\n')).toHaveLength(2);
  });
});

describe('LGPD: nenhum log das rotas leva dado pessoal (T-0013 §9.1, item 9)', () => {
  it('documento, nome, observação e motivo livre ficam fora do log; o pedido_id e os códigos entram', async () => {
    const t = montar();
    const p = (await lancar(t, pedidoManual({ observacao: OBSERVACAO, condicao_pagamento_id: null }))).corpo;
    await t.chamar('PUT', `/pedidos/${p.id}`, { sessao: adm, corpo: pedidoManual({ observacao: OBSERVACAO, condicao_pagamento_id: null }), cabecalhos: { 'if-match': p.updated_at } });
    await t.chamar('POST', `/pedidos/${p.id}/revalidar`, { sessao: adm });
    await t.chamar('POST', `/pedidos/${p.id}/recusar`, { sessao: gerente, corpo: { motivo_codigo: 'outro', motivo_texto: MOTIVO_LIVRE } });
    const q = (await lancar(t, pedidoManual({ observacao: OBSERVACAO }))).corpo;
    await t.chamar('POST', `/pedidos/${q.id}/cancelar`, { sessao: gerente, corpo: { motivo_codigo: 'outro', motivo_texto: MOTIVO_LIVRE } });
    const tudo = t.log.linhas.join('\n');
    expect(tudo).toContain(p.id);
    expect(tudo).toContain('"modulo":"pedido"');
    expect(tudo).toContain('"motivo_codigo":"outro"');
    for (const proibido of [CPF_DO_CLIENTE, RAZAO_DO_CLIENTE, 'Maria', OBSERVACAO, 'portao', MOTIVO_LIVRE, 'luto', 'Rua das Flores']) expect(tudo).not.toContain(proibido);
  });
});
