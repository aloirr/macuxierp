import type { FonteLicencas, Licenca } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { CPF_DO_CLIENTE, IDS, OBSERVACAO, RAZAO_DO_CLIENTE, pedidoFdv, prazoDoCliente, prazoMedioDaCondicao, prepararCadastros } from './fixtures-teste';
import { dependenciasEmMemoria, TENANT_MEMORIA } from './memoria';
import { criarRecebedorFdv } from './recebedor';

const tx = { consultar: async () => [] };

function montar(o: { licenciado?: boolean } = {}) {
  const m = dependenciasEmMemoria();
  prepararCadastros(m.cadastros);
  const outbox = new OutboxMemoria();
  const auditoria = new AuditoriaMemoria();
  const consultas: string[] = [];
  const licencas: FonteLicencas = {
    async ler(_tx, tenantId): Promise<Licenca[]> {
      consultas.push(tenantId);
      return o.licenciado === false ? [] : [{ modulo: 'pedido', ativo: true, valido_ate: null }];
    },
  };
  const recebedor = criarRecebedorFdv({ ...m.deps, licencas, outbox, auditoria, relogio: new RelogioFixo(new Date('2026-11-21T15:00:00Z')) });
  return { ...m, outbox, auditoria, consultas, recebedor };
}

describe('criarRecebedorFdv (T-0013 §5.3)', () => {
  it('RN-PED-01: o pedido do FDV entra aprovado: recebido@1 com pendencias [] e aprovado@1 automática, sem linha de aprovação, mais a auditoria do sistema', async () => {
    const t = montar();
    const r = await t.recebedor.receber(tx, pedidoFdv());
    expect(r).toMatchObject({ resultado: 'criado', numero: 1, status: 'aprovado' });
    expect(t.outbox.eventos.map((e) => [e.nome, e.ator, e.tenant_id])).toEqual([
      ['pedido.pedido.recebido@1', 'sistema', TENANT_MEMORIA],
      ['pedido.pedido.aprovado@1', 'sistema', TENANT_MEMORIA],
    ]);
    expect(t.outbox.eventos[0]?.payload).toMatchObject({ pendencias: [], status: 'aprovado', status_anterior: null, origem: 'fdv', pedido_uuid: IDS.pedidoFdv });
    expect(t.outbox.eventos[1]?.payload).toMatchObject({ automatica: true, status_anterior: 'recebido' });
    // T-0013 §2 e §7, ADR 0007: o FDV decidiu na origem; o ERP não grava aprovação.
    expect(t.armazem.aprovacoes).toEqual([]);
    expect(t.armazem.eventos.map((e) => [e.de, e.para, e.ator_tipo, e.ator_id])).toEqual([[null, 'recebido', 'sistema', null], ['recebido', 'aprovado', 'sistema', null]]);
    expect(t.auditoria.registros).toEqual([expect.objectContaining({ acao: 'pedido.receber', usuario_id: null, tenant_id: TENANT_MEMORIA })]);
    expect(t.armazem.pedidos[0]).toMatchObject({ origem: 'fdv', external_id: IDS.pedidoFdv, total_centavos: 2000, total_informado_centavos: 2000, criado_por: null, vendedor_id: IDS.vendedor });
    expect(t.armazem.pedidos[0]?.itens[0]).toMatchObject({ sequencia: 1, unidade_venda: 'UN', total_informado_centavos: 2000, produto_retrato: { codigo: 'P1' } });
    expect(JSON.stringify(t.armazem.pedidos[0]?.itens[0]?.produto_retrato)).not.toContain('custo');
  });
  it('RN-PED-01: 3 entregas do mesmo pedido_uuid viram 1 pedido e 2 eventos, e as repetidas devolvem o mesmo pedido', async () => {
    const t = montar();
    const a = await t.recebedor.receber(tx, pedidoFdv());
    const b = await t.recebedor.receber(tx, pedidoFdv());
    const c = await t.recebedor.receber(tx, pedidoFdv({ pedido_uuid: IDS.pedidoFdv.toUpperCase() }));
    expect(a.resultado).toBe('criado');
    expect(b).toMatchObject({ resultado: 'repetido', status: 'aprovado' });
    expect(c).toMatchObject({ resultado: 'repetido' });
    expect(b).toMatchObject({ pedido_id: (a as { pedido_id: string }).pedido_id, numero: 1 });
    expect(t.armazem.pedidos).toHaveLength(1);
    expect(t.outbox.eventos).toHaveLength(2);
    expect(t.auditoria.registros).toHaveLength(1);
  });
  it('RN-PED-01: a repetição devolve o status atual do pedido (por exemplo, cancelado depois)', async () => {
    const t = montar();
    await t.recebedor.receber(tx, pedidoFdv());
    t.armazem.pedidos[0]!.status = 'cancelado';
    expect(await t.recebedor.receber(tx, pedidoFdv())).toMatchObject({ resultado: 'repetido', status: 'cancelado' });
  });
  it('RN-PED-01: pedido manual com o mesmo external_id não vira "repetido": o conflito estoura como erro 409 e nada é gravado', async () => {
    const t = montar();
    await t.recebedor.receber(tx, pedidoFdv());
    t.armazem.pedidos[0]!.origem = 'bko';
    const eventos = t.outbox.eventos.length;
    await expect(t.recebedor.receber(tx, pedidoFdv())).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO' });
    expect(t.armazem.pedidos).toHaveLength(1);
    expect(t.outbox.eventos).toHaveLength(eventos);
  });
  it('sem a licença do módulo pedido, recusa com modulo_pedido_inativo antes de ler cadastro ou gravar', async () => {
    const t = montar({ licenciado: false });
    expect(await t.recebedor.receber(tx, pedidoFdv())).toEqual({ resultado: 'recusado', codigo: 'modulo_pedido_inativo' });
    expect(t.consultas).toEqual([TENANT_MEMORIA]);
    expect(t.cadastros.consultas).toBe(0);
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(t.outbox.eventos).toHaveLength(0);
  });
  const recusas: [string, Parameters<typeof pedidoFdv>[0], string, (t: ReturnType<typeof montar>) => void][] = [
    ['cliente inexistente', { cliente_id: IDS.desconhecido }, 'cliente_inexistente', () => undefined],
    ['cliente inativo', { cliente_id: IDS.clienteInativo }, 'cliente_inativo', () => undefined],
    ['filial inexistente', { filial_id: IDS.desconhecido }, 'filial_inexistente', () => undefined],
    ['filial sem emissão', { filial_id: IDS.filialSemEmissao }, 'filial_nao_emissora', () => undefined],
    ['condição inexistente', { condicao_pagamento_id: IDS.desconhecido }, 'condicao_inexistente', () => undefined],
    ['condição inativa', { condicao_pagamento_id: IDS.condicaoInativa }, 'condicao_inativa', () => undefined],
    ['produto inexistente', { itens: [{ ...pedidoFdv().itens[0]!, produto_id: IDS.desconhecido }] }, 'produto_inexistente', () => undefined],
    ['produto inativo', { itens: [{ ...pedidoFdv().itens[0]!, produto_id: IDS.produtoInativo }] }, 'produto_inativo', () => undefined],
    ['desconto maior que o item', { itens: [{ ...pedidoFdv().itens[0]!, desconto_centavos: 20_001 }] }, 'item_incoerente', () => undefined],
    ['sequência repetida', { itens: [pedidoFdv().itens[0]!, pedidoFdv().itens[0]!] }, 'item_incoerente', () => undefined],
  ];
  for (const [nome, sobre, codigo] of recusas) {
    it(`problema de cadastro recusa o recebimento (${nome} → ${codigo}) sem criar pedido nem evento`, async () => {
      const t = montar();
      expect(await t.recebedor.receber(tx, pedidoFdv(sobre))).toEqual({ resultado: 'recusado', codigo });
      expect(t.armazem.pedidos).toHaveLength(0);
      expect(t.outbox.eventos).toHaveLength(0);
    });
  }
  it('RN-CAD-17 e RN-PED-01: fração em produto UN é recusada (item_incoerente) com o motivo da regra, sem pedido nem evento', async () => {
    const t = montar();
    const fracionado = pedidoFdv({ itens: [{ ...pedidoFdv().itens[0]!, quantidade: 15_000, quantidade_venda: 15_000, total_informado_centavos: 1500 }], total_informado_centavos: 1500 });
    expect(await t.recebedor.receber(tx, fracionado)).toEqual({ resultado: 'recusado', codigo: 'item_incoerente', motivo: expect.stringContaining('RN-CAD-17') });
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(t.outbox.eventos).toHaveLength(0);
  });
  it('o pedido do FDV não passa pela análise: crédito estourado e estoque zerado não o seguram, e entra no compromisso dos outros', async () => {
    const t = montar({});
    t.cadastros.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 0);
    const r = await t.recebedor.receber(tx, pedidoFdv({ itens: [{ ...pedidoFdv().itens[0]!, quantidade: 5_000_000, total_informado_centavos: 500_000 }] }));
    expect(r).toMatchObject({ resultado: 'criado', status: 'aprovado' });
    expect(t.armazem.pedidos[0]).toMatchObject({ pendencias: [], status: 'aprovado', total_centavos: 500_000 });
    expect(await t.deps.repositorios(tx).compromissoCredito(IDS.cliente, null)).toBe(500_000);
    expect(t.armazem.pedidos[0]!.a_vista).toBe(false); // boleto: dentro do crédito
  });
  it('RN-PED-04: o pedido do FDV no cartão (03) grava a_vista = true e não entra no compromisso (decisões de 22/11, 01h10 e 01h12)', async () => {
    const t = montar({});
    const r = await t.recebedor.receber(tx, pedidoFdv({ condicao_pagamento_id: IDS.condicaoCartao }));
    expect(r).toMatchObject({ resultado: 'criado', status: 'aprovado' });
    expect(t.armazem.pedidos[0]!.a_vista).toBe(true);
    expect(await t.deps.repositorios(tx).compromissoCredito(IDS.cliente, null)).toBe(0);
  });
  it('RN-PED-07: o pedido do FDV com prazo médio acima do cliente não é recusado: entra em análise com a pendência bloqueante, recebido@1 sem aprovado@1', async () => {
    const t = montar();
    prazoDoCliente(t.cadastros, 10);
    const r = await t.recebedor.receber(tx, pedidoFdv());
    expect(r).toMatchObject({ resultado: 'criado', numero: 1, status: 'em_analise' });
    expect(t.armazem.pedidos[0]).toMatchObject({ status: 'em_analise', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: true }] });
    expect(t.outbox.eventos.map((e) => e.nome)).toEqual(['pedido.pedido.recebido@1']);
    expect(t.outbox.eventos[0]?.payload).toMatchObject({ status: 'em_analise', pendencias: ['prazo_acima_do_cliente'] });
    expect(t.armazem.eventos.map((e) => [e.de, e.para])).toEqual([[null, 'recebido'], ['recebido', 'em_analise']]);
    expect(await t.deps.repositorios(tx).compromissoCredito(IDS.cliente, null)).toBe(0); // em análise não compromete
    expect(await t.recebedor.receber(tx, pedidoFdv())).toMatchObject({ resultado: 'repetido', status: 'em_analise' });
  });
  it('RN-PED-07: o pedido do FDV com prazo incompleto entra em análise com prazo_incompleto', async () => {
    const t = montar();
    prazoMedioDaCondicao(t.cadastros, IDS.condicao30, null);
    expect(await t.recebedor.receber(tx, pedidoFdv())).toMatchObject({ resultado: 'criado', status: 'em_analise' });
    expect(t.armazem.pedidos[0]?.pendencias.map((p) => p.codigo)).toEqual(['prazo_incompleto']);
  });
  it('RN-PED-04: o pedido do FDV sem condição de pagamento é recusado por condicao_ausente (lote 1c)', async () => {
    const t = montar();
    expect(await t.recebedor.receber(tx, pedidoFdv({ condicao_pagamento_id: null }))).toMatchObject({ resultado: 'recusado', codigo: 'condicao_ausente' });
  });
  it('LGPD: o log do recebimento leva só o código e o pedido_id, nunca documento, nome nem observação', async () => {
    const t = montar();
    await t.recebedor.receber(tx, pedidoFdv());
    await t.recebedor.receber(tx, pedidoFdv({ pedido_uuid: '12345678-1234-4234-8234-123456789013', cliente_id: IDS.desconhecido }));
    const tudo = t.log.linhas.join('\n');
    expect(tudo).toContain('cliente_inexistente');
    for (const proibido of [CPF_DO_CLIENTE, RAZAO_DO_CLIENTE, OBSERVACAO, 'Rua das Flores']) expect(tudo).not.toContain(proibido);
  });
});
