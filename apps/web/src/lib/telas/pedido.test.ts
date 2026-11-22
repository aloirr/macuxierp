import { describe, expect, it } from 'vitest';
import type { CatalogoMotivos, Pedido } from '@macuxierp/pedido/contracts';
import { telaDaRota, telaFormulario } from '../telas';
import { LISTA_PEDIDOS, NOVO_PEDIDO, vistaDoPedido } from './pedido';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const F = '8a2b6c10-1d3e-4f5a-8b7c-9d0e1f2a3b4c';
const C = 'c4d5e6f7-0a1b-4c2d-9e3f-5a6b7c8d9e0f';
const P = '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8';

const catalogo: CatalogoMotivos = { recusa: [{ codigo: 'outro', texto: 'Outro' }, { codigo: 'cliente_bloqueado', texto: 'Cliente bloqueado' }] as CatalogoMotivos['recusa'], cancelamento: [{ codigo: 'sem_estoque', texto: 'Sem estoque' }] as CatalogoMotivos['cancelamento'] };

const pedido = (status: Pedido['status'], origem: Pedido['origem'], pendencias: { bloqueante: boolean }[] = []) => ({
  id: ID, numero: 7, origem, status, emitido_em: '2026-11-22T02:30:00.000Z', observacao: null, total_centavos: 10000, valor_faturado_centavos: 0,
  cliente_retrato: { razao_social: 'Bar do Zé', documento: null },
  pendencias: pendencias.map((p, i) => ({ codigo: p.bloqueante ? 'credito_excedido' : 'desconto_acima_maximo', bloqueante: p.bloqueante, sequencia: i === 0 ? null : 1, esperado: 100, informado: 200 })),
  itens: [{ sequencia: 1, produto_retrato: { codigo: 'P1', descricao: 'Água', unidade_comercial: 'UN' }, quantidade: 20000, preco_unitario_centavos: 500, desconto_centavos: 0, total_centavos: 10000, quantidade_faturada: 0 }],
  historico: [{ de: null, para: status, ator_tipo: 'usuario', ator_id: null, motivo_codigo: null, motivo_texto: null, ocorrido_em: '2026-11-22T02:30:00.000Z' }],
  decisao: null,
}) as unknown as Pedido;

describe('adaptador do pedido', () => {
  it('registra as três telas pela rota da página e o formulário se acha pela rota', () => {
    expect(telaDaRota('/pedido/pedidos')).toBe(LISTA_PEDIDOS);
    expect(telaDaRota('/pedido/pedidos/:id')?.tipo).toBe('detalhe');
    expect(telaFormulario('/pedido/pedidos/novo')).toBe(NOVO_PEDIDO);
    expect(telaFormulario('/pedido/pedidos')).toBeUndefined();
  });

  it('lista: filtros do descritor com cadastros como fonte, colunas por perfil sem documento, linha em Manaus', () => {
    expect(LISTA_PEDIDOS.filtrosTela.map((f) => f.chave)).toEqual(['status', 'cliente_id', 'vendedor_id', 'filial_id', 'origem', 'de', 'ate']);
    expect(LISTA_PEDIDOS.filtrosTela.filter((f) => f.tipo === 'cadastro').map((f) => f.fonte)).toEqual(['/v1/cadastros/clientes', '/v1/cadastros/vendedores', '/v1/cadastros/filiais']);
    expect(LISTA_PEDIDOS.colunas('vendedor').map((c) => c.id)).not.toContain('cliente_documento');
    const l = LISTA_PEDIDOS.linha({ id: ID, numero: 7, origem: 'bko', status: 'em_analise', filial_id: F, cliente_id: C, cliente_razao_social: 'Bar', vendedor_id: null, emitido_em: '2026-11-22T02:30:00.000Z', total_centavos: 123456, pendencias: 1 }, 'America/Manaus');
    expect(l.emitido_em).toBe('21/11/2026 22:30');
    expect(LISTA_PEDIDOS.rotaDaLinha?.({ id: ID })).toBe(`/pedido/pedidos/${ID}`);
  });

  it('detalhe: gerente vê aprovar com justificativa (pendência aceitável), recusar, revalidar; documento nulo some (LGPD)', () => {
    const v = vistaDoPedido(pedido('em_analise', 'bko', [{ bloqueante: false }]), 'gerente', 'America/Manaus', catalogo);
    expect(v.acoes.map((a) => a.id)).toEqual(['aprovar', 'recusar', 'revalidar']);
    expect(v.acoes[0]).toMatchObject({ entrada: 'justificativa', justificativaObrigatoria: true, caminho: `/v1/pedido/pedidos/${ID}/aprovar` });
    expect(v.cabecalho.map((c) => c.rotulo)).not.toContain('Documento');
    expect(v.pendencias[0]).toMatchObject({ bloqueante: false });
    expect(v.historico?.[0]?.quando).toBe('21/11/2026 22:30');
    expect(v.tabelas[0]?.linhas).toHaveLength(1);
  });

  it('pendência bloqueante deixa o aprovar visível e desabilitado (RN-PED-03)', () => {
    const v = vistaDoPedido(pedido('em_analise', 'bko', [{ bloqueante: true }]), 'administrador', 'America/Manaus', catalogo);
    expect(v.acoes.find((a) => a.id === 'aprovar')?.desabilitada).toBe('corrija a pendência bloqueante e revalide.');
    expect(v.acoes.filter((a) => a.principal).map((a) => a.id)).toEqual(['aprovar']); // uma ação principal por tela
    expect(v.pendencias[0]).toMatchObject({ bloqueante: true, codigoRn: 'RN-PED-03' });
  });

  it('cancelar usa o catálogo de motivos; aviso de LGPD só no "outro"; faturista e vendedor sem decisão', () => {
    const v = vistaDoPedido(pedido('aprovado', 'fdv'), 'gerente', 'America/Manaus', catalogo);
    const c = v.acoes.find((a) => a.id === 'cancelar');
    expect(c?.motivos).toEqual([{ codigo: 'sem_estoque', rotulo: 'Sem estoque' }]);
    expect(c?.aviso).toMatch(/vendedor no Macuxi FDV/);
    expect(vistaDoPedido(pedido('aprovado', 'bko'), 'gerente', 'America/Manaus', catalogo).acoes.find((a) => a.id === 'cancelar')?.aviso).toMatch(/histórico/);
    expect(vistaDoPedido(pedido('em_analise', 'bko'), 'vendedor', 'America/Manaus', catalogo).acoes).toEqual([]);
  });

  it('catálogo de motivos fora do ar: o detalhe abre e recusar/cancelar ficam desabilitados', () => {
    const v = vistaDoPedido(pedido('em_analise', 'bko'), 'gerente', 'America/Manaus', null);
    expect(v.acoes.find((a) => a.id === 'recusar')).toMatchObject({ motivos: [], desabilitada: expect.stringMatching(/catálogo/) });
    expect(v.acoes.find((a) => a.id === 'aprovar')?.desabilitada).toBeUndefined();
  });

  it('formulário: item da tela, total pela regra do SDK e texto para o módulo', () => {
    const it = NOVO_PEDIDO.itens!;
    const vazio = it.novoItem('item-1');
    expect(vazio).toMatchObject({ chave: 'item-1', produtoId: null, quantidade: 0 });
    expect(it.paraTexto(vazio)).toMatchObject({ quantidade: '', preco: '' });
    const linha = { ...vazio, produtoId: P, quantidade: 1.5, precoUnitarioCentavos: 1000, descontoCentavos: 100 };
    expect(it.calcularTotal(linha)).toBe(1400);
    expect(it.paraTexto(linha)).toEqual({ produto_id: P, quantidade: '1,5', preco: '10,00', desconto: '1,00' });
  });

  it('formulário: valida local (obrigatórios, item, desconto) e monta o corpo do contrato', () => {
    expect(NOVO_PEDIDO.validar({}, [{ produto_id: '', quantidade: '', preco: '' }])).toMatchObject({ filial_id: expect.any(String), cliente_id: expect.any(String) });
    const ok = { filial_id: F, cliente_id: C };
    const item = { produto_id: P, quantidade: '2', preco: '5,00', desconto: '' };
    expect(NOVO_PEDIDO.validar(ok, [item])).toEqual({});
    expect(NOVO_PEDIDO.validar(ok, [{ ...item, desconto: '99,00' }])['itens.0.desconto']).toBeDefined();
    expect(NOVO_PEDIDO.montar(ok, [item])).toMatchObject({ filial_id: F, cliente_id: C, itens: [{ produto_id: P, preco_unitario_centavos: 500 }] });
    expect(() => NOVO_PEDIDO.montar({}, [item])).toThrow();
  });

  it('linha com valor fora do inteiro seguro: erro de campo e total 0, sem RangeError', () => {
    const it = NOVO_PEDIDO.itens!;
    const ruim = { ...it.novoItem('item-1'), quantidade: 1, precoUnitarioCentavos: Number.MAX_SAFE_INTEGER * 2 };
    expect(() => it.calcularTotal(ruim)).not.toThrow();
    expect(it.calcularTotal(ruim)).toBe(0);
    expect(it.erroItem?.(ruim)).toMatch(/fora do limite/);
    const enorme = { ...ruim, quantidade: 1e300, precoUnitarioCentavos: 100 };
    expect(it.calcularTotal(enorme)).toBe(0);
    expect(it.erroItem?.(enorme)).not.toBeNull();
    expect(it.erroItem?.({ ...ruim, precoUnitarioCentavos: 100 })).toBeNull();
  });
});
