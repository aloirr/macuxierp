import { describe, expect, it } from 'vitest';
import { PERFIS, type Perfil } from '@macuxierp/platform-sdk';
import { paraCsv } from '@macuxierp/platform-sdk/listas';
import { manifest } from '../manifest';
import type { Pedido } from '../contracts';
import { acoesDoPedido, avisoDoMotivo, validarAprovacao, validarMotivo } from './acoes';
import { criarClientePedido, ErroPedido } from './cliente';
import { cabecalhoDoPedido, linhasDeHistorico, linhasDeItens, linhasDePendencias, resumoDaDecisao } from './detalhe';
import { formatarCentavos, formatarDataHora, formatarPontosBase, formatarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { calcularTotal } from './total';
import { formularioVazio, novaChaveDoFormulario, retornoDoLancamento, formularioDoPedido, validarFormulario, type Formulario } from './formulario';
import { colunasDaTela, colunasDoCsv, FILTROS_TELA, linhaDaTela } from './lista';
import { caminhoDaConsulta, caminhoDosEnderecos, FONTE_CLIENTE, FONTE_PRODUTO, opcoesDeEndereco } from './fontes';
import { PAGINAS_PEDIDO, paginaPedidos, type ItemListaPedido } from './paginas';

const U1 = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const U2 = '8a2b6c10-1d3e-4f5a-8b7c-9d0e1f2a3b4c';
const U3 = 'c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f';

const item: ItemListaPedido = {
  id: U1, numero: 7, origem: 'bko', status: 'em_analise', filial_id: U2, cliente_id: U3, cliente_razao_social: 'Bar do Zé', vendedor_id: null,
  emitido_em: '2026-11-22T02:30:00.000Z', total_centavos: 123456, pendencias: 2, cliente_documento: '12345678000190',
};

describe('páginas do BKO do pedido', () => {
  it('toda página está no menu do manifesto, tem rota própria e ação de ver', () => {
    const menus = new Set<string>(manifest.web?.menus);
    for (const p of PAGINAS_PEDIDO) expect(menus.has(p.menu), p.id).toBe(true);
    expect(new Set(PAGINAS_PEDIDO.map((p) => p.rota)).size).toBe(PAGINAS_PEDIDO.length);
    // O fixo `/novo` vem antes de `/:id`.
    const rotas = PAGINAS_PEDIDO.map((p) => p.rota);
    expect(rotas.indexOf('/pedido/pedidos/novo')).toBeLessThan(rotas.indexOf('/pedido/pedidos/:id'));
  });

  it('detalhe e novo existem pela rota, sem item próprio no menu; a lista fica no menu', () => {
    const oculta = (id: string) => PAGINAS_PEDIDO.find((p) => p.id === id)?.ocultaNoMenu;
    expect(oculta('detalhe')).toBe(true);
    expect(oculta('novo')).toBe(true);
    expect(oculta('editar')).toBe(true);
    expect(oculta('pedidos')).toBeUndefined();
  });

  it('a lista vem do descritor: filtros do RF-PED-05, busca por número e CSV', () => {
    expect(Object.keys(paginaPedidos.filtros).sort()).toEqual(['ate', 'cliente_id', 'de', 'filial_id', 'origem', 'status', 'vendedor_id']);
    expect(paginaPedidos.busca).toBe(true);
    expect(paginaPedidos.csv).toEqual({ arquivo: 'pedidos.csv' });
    expect(FILTROS_TELA.map((f) => f.chave).sort()).toEqual(Object.keys(paginaPedidos.filtros).sort());
  });

  it('LGPD: colunas por perfil: vendedor não tem o documento do cliente no CSV; os demais têm; a tela nunca o mostra', () => {
    expect(colunasDoCsv('vendedor').map((c) => c.id)).not.toContain('cliente_documento');
    for (const perfil of PERFIS.filter((p) => p !== 'vendedor')) expect(colunasDoCsv(perfil).map((c) => c.id), perfil).toContain('cliente_documento');
    for (const perfil of PERFIS) expect(colunasDaTela(perfil).map((c) => c.id), perfil).not.toContain('cliente_documento');
    const csv = paraCsv(colunasDoCsv('vendedor'), [item]);
    expect(csv).not.toContain('12345678000190');
    expect(paraCsv(colunasDoCsv('gerente'), [item])).toContain('12345678000190');
  });

  it('CSV: total em reais com milhar e sinal, também negativo', () => {
    expect(paraCsv(colunasDoCsv('gerente'), [item])).toContain('R$ 1.234,56');
    expect(paraCsv(colunasDoCsv('gerente'), [{ ...item, total_centavos: -100050 }])).toContain('-R$ 1.000,50');
  });

  it('linha da tela: R$, data no fuso do tenant (Manaus) e rótulos em português', () => {
    const l = linhaDaTela(item, 'America/Manaus');
    expect(l.total_centavos).toBe('R$ 1.234,56');
    expect(l.emitido_em).toBe('21/11/2026 22:30');
    expect(l.status).toBe('Em análise');
    expect(l.origem).toBe('ERP');
    expect(Object.keys(l)).toEqual(colunasDaTela('gerente').map((c) => c.id));
  });
});

describe('formatação', () => {
  it('centavos em R$, Qtd4 em quantidade, bp em %', () => {
    expect(formatarCentavos(5)).toBe('R$ 0,05');
    expect(formatarCentavos(-100050)).toBe('-R$ 1.000,50');
    expect(formatarQuantidade(125000)).toBe('12,5');
    expect(formatarQuantidade(10000)).toBe('1');
    expect(formatarPontosBase(1250)).toBe('12,5%');
    expect(formatarPontosBase(500)).toBe('5%');
    expect(formatarDataHora('2026-11-21T23:05:00Z', 'America/Manaus')).toBe('21/11/2026 19:05');
  });
});

const pedido = (status: Pedido['status'], origem: Pedido['origem'], bloqueante: boolean[] = []) => ({ status, origem, pendencias: bloqueante.map((b) => ({ bloqueante: b })) });

describe('ações do detalhe por status e perfil (RN-PED-02)', () => {
  it('gerente e administrador aprovam e recusam o bko em análise; faturista só revalida e edita; vendedor e leitura nada', () => {
    const p = pedido('em_analise', 'bko', [false]);
    for (const perfil of ['administrador', 'gerente'] as Perfil[]) expect(acoesDoPedido(perfil, p), perfil).toMatchObject({ aprovar: true, recusar: true, revalidar: true, editar: true, cancelar: false });
    expect(acoesDoPedido('faturista', p)).toMatchObject({ aprovar: false, recusar: false, revalidar: true, editar: true });
    for (const perfil of ['vendedor', 'leitura'] as Perfil[]) expect(acoesDoPedido(perfil, p), perfil).toMatchObject({ aprovar: false, recusar: false, revalidar: false, editar: false, cancelar: false });
  });
  it('pendência não bloqueante pede justificativa; bloqueante desabilita o aprovar (RN-PED-03)', () => {
    expect(acoesDoPedido('gerente', pedido('em_analise', 'bko', [false]))).toMatchObject({ aprovarExigeJustificativa: true, aprovarBloqueado: false });
    expect(acoesDoPedido('gerente', pedido('em_analise', 'bko', [false, true]))).toMatchObject({ aprovarBloqueado: true });
    expect(acoesDoPedido('gerente', pedido('em_analise', 'bko', []))).toMatchObject({ aprovarExigeJustificativa: false, aprovarBloqueado: false });
  });
  it('pedido do FDV nunca aprova, recusa, edita nem revalida; cancela só aprovado ou faturado parcial, nas duas origens', () => {
    expect(acoesDoPedido('gerente', pedido('aprovado', 'fdv'))).toMatchObject({ aprovar: false, recusar: false, editar: false, revalidar: false, cancelar: true });
    expect(acoesDoPedido('gerente', pedido('aprovado', 'bko')).cancelar).toBe(true);
    expect(acoesDoPedido('gerente', pedido('faturado_parcial', 'fdv')).cancelar).toBe(true);
    expect(acoesDoPedido('faturista', pedido('aprovado', 'bko')).cancelar).toBe(false);
  });
  it('status finais não têm ação nenhuma', () => {
    for (const s of ['recusado', 'faturado', 'cancelado'] as const) expect(Object.values(acoesDoPedido('administrador', pedido(s, 'bko'))).some(Boolean), s).toBe(false);
  });
});

describe('motivos e justificativa (§4.3)', () => {
  it('"outro" exige o texto; os demais não mandam texto; código fora do catálogo é recusado', () => {
    expect(validarMotivo('recusar', { motivo_codigo: 'outro', motivo_texto: '  ' })).toEqual({ ok: false, erros: { motivo_texto: 'Descreva o motivo' } });
    expect(validarMotivo('recusar', { motivo_codigo: 'outro', motivo_texto: ' sem acordo ' })).toEqual({ ok: true, corpo: { motivo_codigo: 'outro', motivo_texto: 'sem acordo' } });
    expect(validarMotivo('cancelar', { motivo_codigo: 'sem_estoque', motivo_texto: 'ignorado' })).toEqual({ ok: true, corpo: { motivo_codigo: 'sem_estoque', motivo_texto: null } });
    expect(validarMotivo('cancelar', { motivo_codigo: 'credito_insuficiente', motivo_texto: '' }).ok).toBe(false);
    expect(validarMotivo('recusar', { motivo_codigo: 'erro_lancamento', motivo_texto: '' }).ok).toBe(false);
    expect(validarMotivo('recusar', { motivo_codigo: '', motivo_texto: '' }).ok).toBe(false);
    expect(validarMotivo('cancelar', { motivo_codigo: 'outro', motivo_texto: 'x'.repeat(301) }).ok).toBe(false);
  });
  it('LGPD: o aviso aparece em todo motivo "outro"; o trecho do FDV só no pedido do FDV', () => {
    expect(avisoDoMotivo('fdv', 'outro')).toBe('Este texto vai ao vendedor no Macuxi FDV; não escreva dados pessoais.');
    expect(avisoDoMotivo('bko', 'outro')).toBe('Este texto fica no histórico do pedido; não escreva dados pessoais.');
    expect(avisoDoMotivo('fdv', 'sem_estoque')).toBeNull();
  });
  it('o limite do texto vem do contrato, em português', () => {
    expect(validarMotivo('cancelar', { motivo_codigo: 'outro', motivo_texto: 'x'.repeat(301) })).toEqual({ ok: false, erros: { motivo_texto: 'No máximo 300 caracteres' } });
    expect(validarAprovacao(false, 'x'.repeat(501))).toEqual({ ok: false, erros: { justificativa: 'No máximo 500 caracteres' } });
  });
  it('a justificativa é obrigatória só com pendência não bloqueante', () => {
    expect(validarAprovacao(true, ' ').ok).toBe(false);
    expect(validarAprovacao(true, ' limite combinado ')).toEqual({ ok: true, corpo: { justificativa: 'limite combinado' } });
    expect(validarAprovacao(false, '')).toEqual({ ok: true, corpo: {} });
  });
});

describe('detalhe', () => {
  it('cabeçalho: título "Pedido <número>" e selo do status para o h1', () => {
    const c = cabecalhoDoPedido({ numero: 101, status: 'em_analise', origem: 'bko', cliente_retrato: { razao_social: 'X', documento: null }, emitido_em: '2026-11-21T12:00:00.000Z', observacao: null, total_centavos: 0, valor_faturado_centavos: 0 } as unknown as Pedido, 'America/Manaus');
    expect(c.titulo).toBe('Pedido 101');
    expect(c.selo).toEqual({ rotulo: 'Em análise' });
  });
  it('pendências mostram esperado e informado na unidade do código', () => {
    const l = linhasDePendencias([
      { codigo: 'desconto_acima_maximo', bloqueante: false, sequencia: 1, produto_id: U1, esperado: 500, informado: 1250 },
      { codigo: 'credito_excedido', bloqueante: false, sequencia: null, produto_id: null, esperado: 100000, informado: 150050 },
      { codigo: 'estoque_insuficiente', bloqueante: true, sequencia: 2, produto_id: U2, esperado: 20000, informado: 50000 },
      { codigo: 'cliente_inativo', bloqueante: true, sequencia: null, produto_id: null, esperado: null, informado: null },
    ]);
    expect(l.map((x) => [x.texto, x.gravidade, x.esperado, x.informado])).toEqual([
      ['Desconto acima do máximo', 'Atenção', '5%', '12,5%'],
      ['Limite de crédito excedido', 'Atenção', 'R$ 1.000,00', 'R$ 1.500,50'],
      ['Estoque insuficiente', 'Bloqueia', '2', '5'],
      ['Cliente inativo', 'Bloqueia', '', ''],
    ]);
  });
  it('itens, histórico e decisão saem formatados', () => {
    const itens = linhasDeItens({
      itens: [{ sequencia: 1, produto_id: U1, produto_retrato: { codigo: 'P1', descricao: 'Água', unidade_comercial: 'UN', ean: null, ncm: '22021000', origem: '0' }, quantidade: 25000, preco_unitario_centavos: 450, desconto_centavos: 0, total_centavos: 1125, unidade_venda: null, preco_tabela_centavos: 450, desconto_maximo_bp: null, total_informado_centavos: null, quantidade_faturada: 0, aplicacao: null }],
    } as unknown as Pedido);
    expect(itens[0]).toMatchObject({ quantidade: '2,5', preco: 'R$ 4,50', total: 'R$ 11,25', faturado: '0' });
    const h = linhasDeHistorico(
      { historico: [{ de: 'em_analise', para: 'recusado', ator_tipo: 'usuario', ator_id: U1, motivo_codigo: 'cliente_bloqueado', motivo_texto: null, ocorrido_em: '2026-11-21T12:00:00.000Z' }] },
      'America/Manaus',
    );
    expect(h[0]).toEqual({ quando: '21/11/2026 08:00', de: 'Em análise', para: 'Recusado', ator: 'Usuário', motivo: 'Cliente bloqueado' });
    expect(resumoDaDecisao({ decisao: null }, 'America/Manaus')).toBeNull();
    expect(resumoDaDecisao({ decisao: null, origem: 'fdv', aprovado_origem_em: '2026-11-21T23:05:00.000Z' }, 'America/Manaus')).toMatchObject({ decisao: 'Aprovado no Macuxi FDV em 21/11/2026 19:05' });
    expect(resumoDaDecisao({ decisao: null, origem: 'fdv', aprovado_origem_em: null }, 'America/Manaus')).toMatchObject({ decisao: 'Aprovado no Macuxi FDV' });
    expect(resumoDaDecisao({ decisao: { decisao: 'aprovado', automatica: true, decidido_por: null, perfil: null, pendencias_aceitas: [], justificativa: null, motivo_codigo: null, motivo_texto: null, decidido_em: '2026-11-21T12:00:00.000Z' } }, 'America/Manaus')).toMatchObject({ decisao: 'Aprovado', quem: 'Automática (sem pendência)' });
  });
});

const valido = (): Formulario => ({
  ...formularioVazio(), filial_id: U1, cliente_id: U2, condicao_pagamento_id: U3, observacao: ' entregar de manhã ',
  itens: [{ produto_id: U1, quantidade: '2,5', preco: '1.234,56', desconto: '10' }],
});

describe('formulário do pedido manual', () => {
  it('converte o texto em centavos e Qtd4 no contrato PedidoManualEntrada', () => {
    const r = validarFormulario(valido());
    expect(r.ok && r.entrada).toMatchObject({
      filial_id: U1, cliente_id: U2, condicao_pagamento_id: U3, endereco_entrega_id: null, observacao: 'entregar de manhã',
      itens: [{ produto_id: U1, quantidade: 25000, preco_unitario_centavos: 123456, desconto_centavos: 1000 }],
    });
  });
  it('exige filial, cliente e ao menos um item completo, com erro por campo', () => {
    const r = validarFormulario(formularioVazio());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['cliente_id', 'filial_id', 'itens.0.preco', 'itens.0.produto_id', 'itens.0.quantidade']);
    const semItens = validarFormulario({ ...valido(), itens: [] });
    expect(!semItens.ok && semItens.erros.itens).toBe('Inclua ao menos um item');
  });
  it('quantidade zero, preço malformado e desconto acima do valor do item são recusados', () => {
    const com = (i: Partial<Formulario['itens'][0]>) => validarFormulario({ ...valido(), itens: [{ ...(valido().itens[0] as Formulario['itens'][0]), ...i }] });
    expect(com({ quantidade: '0' }).ok).toBe(false);
    expect(com({ preco: '12.5' }).ok).toBe(false);
    expect(com({ desconto: '5.000,00' }).ok).toBe(false);
    expect(com({ quantidade: '1', preco: '10,00', desconto: '10,00' }).ok).toBe(true);
    expect(com({ quantidade: '1', preco: '10,00', desconto: '10,01' }).ok).toBe(false);
    expect(com({ desconto: '' }).ok).toBe(true);
  });
  it('a Idempotency-Key é gerada uma vez por formulário e vai no POST; o reenvio reusa a mesma', async () => {
    const chave = novaChaveDoFormulario();
    expect(chave).toMatch(/^[0-9a-f-]{36}$/);
    expect(novaChaveDoFormulario()).not.toBe(chave);
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    const cliente = criarClientePedido({
      baseUrl: 'http://api', token: () => 't',
      fetch: async (url, init) => {
        chamadas.push({ url, headers: init.headers });
        return { status: 422, ok: false, headers: { get: () => 'application/json' }, json: async () => ({ codigo: 'RN-PED-03', mensagem: 'Pendência bloqueante' }) };
      },
    });
    const r = validarFormulario(valido());
    if (!r.ok) throw new Error('inválido');
    for (let i = 0; i < 2; i++) await expect(cliente.lancar(r.entrada, chave)).rejects.toBeInstanceOf(ErroPedido);
    expect(chamadas.map((c) => c.url)).toEqual(['http://api/v1/pedido/pedidos', 'http://api/v1/pedido/pedidos']);
    expect(chamadas.map((c) => c.headers['Idempotency-Key'])).toEqual([chave, chave]);
  });
  it('a edição preenche o formulário e o resultado volta ao mesmo contrato', () => {
    const f = formularioDoPedido({
      filial_id: U1, cliente_id: U2, condicao_pagamento_id: null, endereco_entrega: null, observacao: null,
      itens: [{ produto_id: U1, quantidade: 25000, preco_unitario_centavos: 123456, desconto_centavos: 1000 }],
    } as unknown as Pedido);
    expect(f.itens[0]).toEqual({ produto_id: U1, quantidade: '2,5', preco: '1.234,56', desconto: '10,00' });
    const r = validarFormulario(f);
    expect(r.ok && r.entrada.itens[0]).toMatchObject({ quantidade: 25000, preco_unitario_centavos: 123456, desconto_centavos: 1000 });
  });
  it('limite do contrato vira mensagem em português por campo', () => {
    const r = validarFormulario({ ...valido(), observacao: 'x'.repeat(501) });
    expect(!r.ok && r.erros.observacao).toBe('No máximo 500 caracteres');
  });
  it('resposta 5xx que não é JSON vira ErroPedido; o id vai codificado na URL', async () => {
    const urls: string[] = [];
    const cliente = criarClientePedido({
      baseUrl: 'http://api', token: () => 't',
      fetch: async (url) => {
        urls.push(url);
        return { status: 502, ok: false, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('html'); } };
      },
    });
    await expect(cliente.pedido('a/b')).rejects.toMatchObject({ name: 'ErroPedido', status: 502 });
    expect(urls[0]).toBe('http://api/v1/pedido/pedidos/a%2Fb');
  });
  it('retorno: aprovado direto, ou em análise com as pendências', () => {
    expect(retornoDoLancamento({ numero: 9, status: 'aprovado', pendencias: [] })).toEqual({ status: 'aprovado', titulo: 'Pedido 9 aprovado', pendencias: [] });
    const r = retornoDoLancamento({ numero: 10, status: 'em_analise', pendencias: [{ codigo: 'credito_sem_limite', bloqueante: false, sequencia: null, produto_id: null, esperado: 0, informado: 5000 }] });
    expect(r.status).toBe('em_analise');
    expect(r.pendencias[0]).toMatchObject({ texto: 'Cliente sem limite de crédito', esperado: 'R$ 0,00', informado: 'R$ 50,00' });
  });
});

describe('edição, endereço de entrega e fontes dos seletores (T-0015, lote 3b)', () => {
  it('a página de edição exige lançar pedido e vale só para o pedido bko em análise', () => {
    const e = PAGINAS_PEDIDO.find((p) => p.id === 'editar');
    expect(e).toMatchObject({ tipo: 'editar', rota: '/pedido/pedidos/:id/editar', ver: 'pedido.pedido.lancar' });
  });
  it('o PUT da edição leva o If-Match com o updated_at carregado', async () => {
    const chamadas: { url: string; method: string; headers: Record<string, string> }[] = [];
    const cliente = criarClientePedido({
      baseUrl: 'http://api', token: () => 't',
      fetch: async (url, init) => {
        chamadas.push({ url, method: init.method, headers: init.headers });
        return { status: 409, ok: false, headers: { get: () => 'application/json' }, json: async () => ({ codigo: 'CONFLITO', mensagem: 'Outra edição' }) };
      },
    });
    const r = validarFormulario(valido());
    if (!r.ok) throw new Error('inválido');
    await expect(cliente.editar(U1, r.entrada, '2026-11-22T00:00:00.000Z')).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO' });
    expect(chamadas[0]).toMatchObject({ url: `http://api/v1/pedido/pedidos/${U1}`, method: 'PUT', headers: { 'If-Match': '2026-11-22T00:00:00.000Z' } });
  });
  it('o endereço de entrega é opcional: vazio vira null; escolhido vai no contrato; id inválido é recusado', () => {
    expect(formularioVazio().endereco_entrega_id).toBe('');
    const sem = validarFormulario(valido());
    expect(sem.ok && sem.entrada.endereco_entrega_id).toBeNull();
    const com = validarFormulario({ ...valido(), endereco_entrega_id: U3 });
    expect(com.ok && com.entrada.endereco_entrega_id).toBe(U3);
    const ruim = validarFormulario({ ...valido(), endereco_entrega_id: 'x' });
    expect(!ruim.ok && ruim.erros.endereco_entrega_id).toBe('Endereço inválido');
    const f = formularioDoPedido({ filial_id: U1, cliente_id: U2, condicao_pagamento_id: null, endereco_entrega: { endereco_id: U3 }, observacao: null, itens: [] } as unknown as Pedido);
    expect(f.endereco_entrega_id).toBe(U3);
  });
  it('as opções de endereço trazem logradouro, número, bairro e município/UF; o principal é marcado', () => {
    const base = { logradouro: 'Rua A', numero: '10', bairro: 'Centro', uf: 'AM' } as const;
    expect(opcoesDeEndereco([{ ...base, id: U1, tipo: 'principal', municipio_nome: 'Manaus' }, { ...base, id: U2, tipo: 'entrega' }])).toEqual([
      { valor: U1, rotulo: 'Rua A, 10, Centro, Manaus/AM (principal)' },
      { valor: U2, rotulo: 'Rua A, 10, Centro, AM' },
    ]);
    expect(caminhoDosEnderecos(U1)).toBe(`/v1/cadastros/clientes/${U1}/enderecos`);
  });
  it('cliente e produto buscam no servidor (?busca=, mínimo 2, limite 20, corte em 80); lista fechada fica em texto', () => {
    expect(caminhoDaConsulta(FONTE_CLIENTE, '  ba ')).toBe('/v1/cadastros/clientes?limite=20&busca=ba');
    expect(caminhoDaConsulta(FONTE_PRODUTO, 'b')).toBe('/v1/cadastros/produtos?limite=20');
    expect(caminhoDaConsulta(FONTE_PRODUTO)).toBe('/v1/cadastros/produtos?limite=20');
    expect(caminhoDaConsulta(FONTE_PRODUTO, 'x'.repeat(200))).toBe(`/v1/cadastros/produtos?limite=20&busca=${'x'.repeat(80)}`);
    expect(caminhoDaConsulta(FONTE_PRODUTO, `${'a'.repeat(79)}😀😀`)).toBe(`/v1/cadastros/produtos?limite=20&busca=${'a'.repeat(79)}%F0%9F%98%80`);
    expect(caminhoDaConsulta('/v1/cadastros/filiais', 'qualquer')).toBe('/v1/cadastros/filiais');
  });
});

describe('calcularTotal (RN-PED-03: valor do item menos desconto)', () => {
  it('RN-PED-03: total por linha e do pedido em centavos', () => {
    const r = calcularTotal([
      { quantidade: 25_000, preco_unitario_centavos: 1000, desconto_centavos: 500 },
      { quantidade: 10_000, preco_unitario_centavos: 333, desconto_centavos: 0 },
    ]);
    expect(r).toEqual({ itens: [2000, 333], total: 2333 });
  });
  it('RN-PED-03: desconto acima do valor é incoerente', () => {
    expect(() => calcularTotal([{ quantidade: 10_000, preco_unitario_centavos: 100, desconto_centavos: 200 }])).toThrow();
  });
});
