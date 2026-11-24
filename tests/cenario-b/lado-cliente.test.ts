/**
 * T-0057 (E1): prova do dublê do banco do cliente e do ciclo de mão dupla (ADR 0014 §13 e §15): o pedido desce uma vez
 * só (procedure idempotente), o status e a nota do cliente sobem no `RetornoErp` do contrato, a nota do ERP desce, o
 * pré-cadastro desce e volta como `vinculado`, e o retorno recusado se repete no ciclo seguinte.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RetornoErp } from '../../modules/integracao-fdv/contracts/index';
import { criarConectorSimulado } from './apoio/conector-simulado';
import { criarEntradaFalsa } from './apoio/entrada-falsa';
import { cicloMaoDupla, criarLadoCliente, listaDePendentes, type PedidoDescido } from './apoio/lado-cliente';
import { montarMassaCenarioB } from './apoio/massa-cenario-b';

const CHAVE = `cb_${randomUUID()}`;
const CONECTOR = 'erp-cenario-b-teste';
let relogio = new Date('2026-11-24T13:00:00.000Z');
const agora = () => relogio;

function montar() {
  const falsa = criarEntradaFalsa({ chave: CHAVE, conectorId: CONECTOR });
  const conector = criarConectorSimulado({
    url: 'https://erp.exemplo.invalid',
    conectorId: CONECTOR,
    chave: CHAVE,
    agora,
    fetch: falsa.fetch,
  });
  return { falsa, conector, lado: criarLadoCliente({ primeiroNumeroPedido: 501 }) };
}

function pedido(): PedidoDescido {
  const m = montarMassaCenarioB().registros;
  return {
    pedido_uuid: randomUUID(),
    cliente_external_id: m.cliente[0]!.external_id,
    vendedor_external_id: m.vendedor[0]!.external_id,
    total_cents: 2 * 1099,
    itens: [
      {
        sequencia: 1,
        produto_external_id: m.produto[0]!.external_id,
        quantidade: 2,
        preco_unitario_cents: 1099,
        total_cents: 2198,
      },
    ],
  };
}

describe('lado do cliente: procedures idempotentes', () => {
  it('sp_macuxi_pedido_inserir grava uma vez e devolve o mesmo número na repetição', () => {
    const lado = criarLadoCliente({ primeiroNumeroPedido: 7 });
    const p = pedido();
    expect(lado.spPedidoInserir(p)).toBe('000007');
    expect(lado.spPedidoInserir(structuredClone(p))).toBe('000007');
    expect(lado.spPedidoInserir(pedido())).toBe('000008');
    expect(lado.gravacoes).toMatchObject({ pedido: 2, item: 2 });
    expect(lado.chamadas.pedido).toBe(3);
  });

  it('nota e pré-cadastro: idempotentes pela chave e pelo cliente_uuid', () => {
    const lado = criarLadoCliente();
    const nota = {
      chave: '1'.repeat(44),
      numero: 1,
      serie: 1,
      emitida_em: '2026-11-24T13:00:00.000Z',
      total_cents: 100,
      itens: [],
    };
    lado.spNotaInserir(nota);
    lado.spNotaInserir({ ...nota });
    const pre = { cliente_uuid: randomUUID(), razao_social: 'Pre Cadastro Ficticio' };
    lado.spClienteInserir(pre);
    lado.spClienteInserir({ ...pre });
    expect(lado.gravacoes).toMatchObject({ nota: 1, cliente: 1 });
    expect(lado.chamadas).toMatchObject({ nota: 2, cliente: 2 });
  });

  it('pedido encerrado não muda; ação sobre pedido que não desceu é erro do cenário', () => {
    const lado = criarLadoCliente();
    const p = pedido();
    lado.spPedidoInserir(p);
    lado.faturar(p.pedido_uuid, 'faturado_total', {
      numero: 1,
      serie: 1,
      chave: '2'.repeat(44),
      emitida_em: '2026-11-24T13:00:00.000Z',
      total_cents: 2198,
    });
    expect(() => lado.cancelar(p.pedido_uuid)).toThrow(/faturado/);
    expect(() =>
      lado.faturar(randomUUID(), 'faturado_parcial', {
        numero: 1,
        serie: 1,
        chave: 'x',
        emitida_em: 'x',
        total_cents: 0,
      }),
    ).toThrow(/não desceu/);
  });

  it('a lista de pendentes é lida como array ou objeto (premissa P-5)', () => {
    expect(listaDePendentes([{ a: 1 }], 'pedidos')).toHaveLength(1);
    expect(listaDePendentes({ pedidos: [{ a: 1 }, { a: 2 }] }, 'pedidos')).toHaveLength(2);
    expect(listaDePendentes({ itens: [{ a: 1 }] }, 'pedidos')).toHaveLength(1);
    expect(listaDePendentes(null, 'pedidos')).toEqual([]);
  });
});

describe('ciclo de mão dupla (ADR 0014 §13)', () => {
  it('o pedido desce, volta integrado; o cliente fatura e o faturado_total sobe com a nota no RetornoErp', async () => {
    const { falsa, conector, lado } = montar();
    const p = pedido();
    falsa.pendentes.pedidos = [p];

    const c1 = await cicloMaoDupla(conector, lado, agora);
    expect(c1.pedidosGravados).toEqual([p.pedido_uuid]);
    expect(c1.retornosAceitos).toEqual([{ recurso: 'pedidos', id: p.pedido_uuid, status: 'integrado' }]);
    expect(falsa.pendentes.pedidos).toHaveLength(0);

    relogio = new Date('2026-11-24T14:00:00.000Z');
    lado.faturar(p.pedido_uuid, 'faturado_total', {
      numero: 123,
      serie: 1,
      chave: '3'.repeat(44),
      emitida_em: '2026-11-24T13:30:00.000Z',
      total_cents: 2198,
    });
    const c2 = await cicloMaoDupla(conector, lado, agora);
    expect(c2.retornosAceitos).toEqual([{ recurso: 'pedidos', id: p.pedido_uuid, status: 'faturado_total' }]);

    const corpos = falsa.retornos.filter((r) => r.recurso === 'pedidos').map((r) => r.corpo);
    expect(corpos.map((x) => x.status)).toEqual(['integrado', 'faturado_total']);
    for (const x of corpos) expect(RetornoErp.safeParse(x).success, JSON.stringify(x)).toBe(true);
    expect(corpos[1]).toMatchObject({ numero_erp: '000501', nota: { numero: 123, total_cents: 2198 } });

    // nada novo: o terceiro ciclo não reenvia nem grava de novo
    const c3 = await cicloMaoDupla(conector, lado, agora);
    expect(c3.retornosAceitos).toEqual([]);
    expect(lado.gravacoes.pedido).toBe(1);
  });

  it('o retorno recusado fica pendente e se repete no ciclo seguinte; o pedido não é gravado duas vezes', async () => {
    const { falsa, conector, lado } = montar();
    const p = pedido();
    falsa.pendentes.pedidos = [p];
    falsa.falharRetornos(1);
    const c1 = await cicloMaoDupla(conector, lado, agora);
    expect(c1.retornosPendentes).toBe(1);
    expect(falsa.pendentes.pedidos).toHaveLength(1); // o ERP ainda o lista
    const c2 = await cicloMaoDupla(conector, lado, agora);
    expect(c2.retornosAceitos.map((x) => x.status)).toEqual(['integrado']);
    expect(lado.chamadas.pedido).toBe(2);
    expect(lado.gravacoes.pedido).toBe(1);
  });

  it('a nota emitida pelo ERP desce uma vez (faturamento ligado, §15)', async () => {
    const { falsa, conector, lado } = montar();
    const chave = '4'.repeat(44);
    falsa.pendentes.notas = [
      { chave, numero: 10, serie: 1, emitida_em: '2026-11-24T13:00:00.000Z', total_cents: 5000, itens: [] },
    ];
    falsa.falharRetornos(1);
    await cicloMaoDupla(conector, lado, agora);
    await cicloMaoDupla(conector, lado, agora);
    expect(lado.nota(chave)).toMatchObject({ numero: 10 });
    expect(lado.chamadas.nota).toBe(2);
    expect(lado.gravacoes.nota).toBe(1);
    expect(falsa.pendentes.notas).toHaveLength(0);
    expect(JSON.stringify(falsa.retornos)).not.toMatch(/xml/i);
  });

  it('o pré-cadastro desce, o cliente cria o cadastro e o vínculo volta com o external_id dele (v0.3.12)', async () => {
    const { falsa, conector, lado } = montar();
    const uuid = randomUUID();
    falsa.pendentes.clientes = [{ cliente_uuid: uuid, razao_social: 'Pre Cadastro Ficticio' }];
    const c1 = await cicloMaoDupla(conector, lado, agora);
    expect(c1.preCadastrosGravados).toEqual([uuid]);
    expect(c1.retornosAceitos).toEqual([]);

    const cadastro = { ...montarMassaCenarioB().registros.cliente[1]!, external_id: 'CB-CLI-0777' };
    lado.criarClienteDoPreCadastro(uuid, cadastro);
    expect(lado.view('cliente').map((r) => r.external_id)).toEqual(['CB-CLI-0777']);
    const c2 = await cicloMaoDupla(conector, lado, agora);
    expect(c2.retornosAceitos).toEqual([{ recurso: 'clientes', id: uuid, status: 'vinculado' }]);
    expect(falsa.retornos.at(-1)!.corpo).toMatchObject({ cliente_uuid: uuid, external_id: 'CB-CLI-0777' });
    expect(lado.gravacoes.cliente).toBe(1);
    expect(lado.vinculosPendentes()).toEqual([]);
  });
});
