/**
 * T-0057 (E4): mão dupla do Conector (ADR 0014 §13 e §15): o pedido aprovado no ERP desce e volta `integrado`, o status
 * e a nota do cliente sobem (faturamento desligado), a nota do ERP desce (faturamento ligado) e o retorno da nota é
 * idempotente pela chave (P-6). A lista de pendentes é lida de forma tolerante, num ponto só (`listaDePendentes`, P-5 em
 * aberto: array ou `{ pedidos: [...] }`).
 *
 * O alvo é o `alvoEntrada()` (hoje a `/entrada/v1` falsa; `MACUXI_CENARIO_B_ALVO=real` = API real). O lado do cliente é o
 * `lado-cliente.ts`. Os casos `it.skipIf(!API_REAL)` só fazem sentido com a API real; cada um diz o PR que o libera.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { RetornoErp } from '../../modules/integracao-fdv/contracts/index';
import { API_REAL, PENDENTE_API_REAL, PR_LIBERA, alvoEntrada, type AlvoEntrada, type OpcoesAlvo } from './apoio/alvo-entrada';
import { cicloMaoDupla, criarLadoCliente, type NotaDescida, type PedidoDescido } from './apoio/lado-cliente';
import { montarMassaCenarioB } from './apoio/massa-cenario-b';

const massa = montarMassaCenarioB().registros;
let relogio = new Date('2026-11-24T14:00:00.000Z');
const agora = () => relogio;
const abertos: AlvoEntrada[] = [];

async function montar(o: OpcoesAlvo = {}) {
  const alvo = await alvoEntrada({ agora, ...o });
  abertos.push(alvo);
  return { alvo, conector: alvo.conector('a'), lado: criarLadoCliente({ primeiroNumeroPedido: 901 }) };
}
afterEach(async () => {
  while (abertos.length) await abertos.pop()!.fechar();
});

function pedido(): PedidoDescido {
  return {
    pedido_uuid: randomUUID(),
    cliente_external_id: massa.cliente[0]!.external_id,
    vendedor_external_id: massa.vendedor[0]!.external_id,
    total_cents: 3 * 1250,
    itens: [
      { sequencia: 1, produto_external_id: massa.produto[0]!.external_id, quantidade: 3, preco_unitario_cents: 1250, total_cents: 3750 },
    ],
  };
}

function nota(n = 77): NotaDescida {
  return {
    chave: `1326${String(n).padStart(40, '0')}`,
    numero: n,
    serie: 1,
    emitida_em: '2026-11-24T13:30:00.000Z',
    total_cents: 3750,
    itens: [{ sequencia: 1, produto_external_id: massa.produto[0]!.external_id, quantidade: 3, valor_cents: 3750 }],
  };
}

describe('E4-1: o pedido aprovado no ERP desce (§13)', () => {
  it.each(['objeto', 'array'] as const)(
    'lista de pendentes como %s (P-5): gravado uma vez, retorno integrado com o número do cliente, sai da fila',
    async (formaPendentes) => {
      const { alvo, conector, lado } = await montar({ formaPendentes });
      const p = pedido();
      await alvo.semearPedido('a', p);
      expect(await alvo.pendentesNaFila('a', 'pedidos')).toBe(1);

      const c = await cicloMaoDupla(conector, lado, agora);
      expect(c.pedidosGravados).toEqual([p.pedido_uuid]);
      expect(c.retornosAceitos).toEqual([{ recurso: 'pedidos', id: p.pedido_uuid, status: 'integrado' }]);
      expect(lado.pedido(p.pedido_uuid)).toMatchObject({ numero: '000901', status: 'integrado' });
      expect(await alvo.pendentesNaFila('a', 'pedidos')).toBe(0);
      const [ret] = await alvo.retornosVistos('a', 'pedidos');
      expect(ret!.corpo).toMatchObject({ pedido_uuid: p.pedido_uuid, status: 'integrado', numero_erp: '000901' });
      expect(RetornoErp.safeParse(ret!.corpo).success).toBe(true);
    },
  );

  it('o pedido sai da fila só com o retorno aceito: a falha se repete no ciclo seguinte sem gravar duas vezes (E4-4)', async () => {
    const { alvo, conector, lado } = await montar();
    const p = pedido();
    await alvo.semearPedido('a', p);
    alvo.falharRetornos(1);
    const c1 = await cicloMaoDupla(conector, lado, agora);
    expect(c1.retornosPendentes).toBe(1);
    expect(await alvo.pendentesNaFila('a', 'pedidos')).toBe(1);
    const c2 = await cicloMaoDupla(conector, lado, agora);
    expect(c2.retornosAceitos.map((x) => x.status)).toEqual(['integrado']);
    expect(lado.chamadas.pedido).toBe(2);
    expect(lado.gravacoes.pedido).toBe(1);
    expect(await alvo.pendentesNaFila('a', 'pedidos')).toBe(0);
  });

  it('o pedido do tenant A não desce para o conector do B', async () => {
    const { alvo, lado } = await montar();
    await alvo.semearPedido('a', pedido());
    const c = await cicloMaoDupla(alvo.conector('b'), lado, agora);
    expect(c.pedidosGravados).toEqual([]);
    expect(await alvo.pendentesNaFila('a', 'pedidos')).toBe(1);
  });
});

describe('E4-2: faturamento desligado, o status e a nota do cliente sobem (§13, §15)', () => {
  it('faturado_parcial e faturado_total sobem com a nota como referência, no RetornoErp, sem XML', async () => {
    const { alvo, conector, lado } = await montar();
    const p = pedido();
    await alvo.semearPedido('a', p);
    await cicloMaoDupla(conector, lado, agora);

    relogio = new Date('2026-11-24T15:00:00.000Z');
    lado.faturar(p.pedido_uuid, 'faturado_parcial', { numero: 501, serie: 2, chave: '5'.repeat(44), emitida_em: '2026-11-24T14:40:00.000Z', total_cents: 1250 });
    expect((await cicloMaoDupla(conector, lado, agora)).retornosAceitos.map((x) => x.status)).toEqual(['faturado_parcial']);
    lado.faturar(p.pedido_uuid, 'faturado_total', { numero: 502, serie: 2, chave: '6'.repeat(44), emitida_em: '2026-11-24T14:50:00.000Z', total_cents: 2500 });
    expect((await cicloMaoDupla(conector, lado, agora)).retornosAceitos.map((x) => x.status)).toEqual(['faturado_total']);

    const corpos = (await alvo.retornosVistos('a', 'pedidos')).map((r) => r.corpo);
    expect(corpos.map((x) => x.status)).toEqual(['integrado', 'faturado_parcial', 'faturado_total']);
    for (const x of corpos) expect(RetornoErp.safeParse(x).success, JSON.stringify(x)).toBe(true);
    expect(corpos[2]).toMatchObject({ nota: { numero: 502, serie: 2, emitida_em: '2026-11-24T14:50:00.000Z', total_cents: 2500 } });
    expect(JSON.stringify(corpos)).not.toMatch(/xml/i);
  });

  it('o cancelamento no cliente sobe como cancelado', async () => {
    const { alvo, conector, lado } = await montar();
    const p = pedido();
    await alvo.semearPedido('a', p);
    await cicloMaoDupla(conector, lado, agora);
    lado.cancelar(p.pedido_uuid);
    expect((await cicloMaoDupla(conector, lado, agora)).retornosAceitos.map((x) => x.status)).toEqual(['cancelado']);
  });

  it.skipIf(!API_REAL)(`o retorno faturado_* chega ao dublê do Hub e o ERP não numera nota (${PR_LIBERA.IFDV} e ${PR_LIBERA.FAT})`, () => {
    PENDENTE_API_REAL.rotasNoHub();
  });
});

describe('E4-3: faturamento ligado, a nota do ERP desce (§13, §15; regra 7)', () => {
  it('a nota autorizada desce sem XML, é gravada uma vez e o retorno gravada a tira da fila (P-6)', async () => {
    const { alvo, conector, lado } = await montar();
    const n = nota();
    await alvo.semearNota('a', n);
    const r = await conector.pendentes('notas');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.corpo)).not.toMatch(/xml/i);

    const c = await cicloMaoDupla(conector, lado, agora);
    expect(c.notasGravadas).toEqual([n.chave]);
    expect(c.retornosAceitos).toEqual([{ recurso: 'notas', id: n.chave, status: 'gravada' }]);
    expect(lado.nota(n.chave)).toMatchObject({ numero: 77, total_cents: 3750 });
    expect(await alvo.pendentesNaFila('a', 'notas')).toBe(0);
    expect((await alvo.retornosVistos('a', 'notas')).map((x) => x.corpo)).toEqual([{ situacao: 'gravada' }]);
  });

  it.skipIf(!API_REAL)(`a nota só desce depois de o XML autorizado estar guardado (${PR_LIBERA.FAT})`, () => {
    PENDENTE_API_REAL.notaAntesDoXml();
  });
});

describe('E4-4: o retorno da nota é idempotente pela chave (P-6)', () => {
  it('o mesmo retorno duas vezes: 200 nas duas e um efeito só', async () => {
    const { alvo, conector } = await montar();
    const n = nota(78);
    await alvo.semearNota('a', n);
    const a = await conector.retorno('notas', n.chave, { situacao: 'gravada' });
    const b = await conector.retorno('notas', n.chave, { situacao: 'gravada' });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await alvo.retornosVistos('a', 'notas')).toHaveLength(1);
    expect(await alvo.pendentesNaFila('a', 'notas')).toBe(0);
  });

  it('a falha no retorno se repete no ciclo seguinte e a nota não é gravada duas vezes no cliente', async () => {
    const { alvo, conector, lado } = await montar();
    const n = nota(79);
    await alvo.semearNota('a', n);
    alvo.falharRetornos(1);
    expect((await cicloMaoDupla(conector, lado, agora)).retornosPendentes).toBe(1);
    expect(await alvo.pendentesNaFila('a', 'notas')).toBe(1);
    expect((await cicloMaoDupla(conector, lado, agora)).retornosAceitos).toEqual([{ recurso: 'notas', id: n.chave, status: 'gravada' }]);
    expect(lado.chamadas.nota).toBe(2);
    expect(lado.gravacoes.nota).toBe(1);
    expect(await alvo.pendentesNaFila('a', 'notas')).toBe(0);
  });

  it('rejeitada com codigo é aceita (200); situacao fora de gravada|rejeitada é recusada', async () => {
    const { alvo, conector } = await montar();
    const n = nota(80);
    await alvo.semearNota('a', n);
    const ruim = await conector.retorno('notas', n.chave, { situacao: 'perdida' });
    expect(ruim.status).toBeGreaterThanOrEqual(400);
    expect(ruim.status).toBeLessThan(500);
    expect(await alvo.pendentesNaFila('a', 'notas')).toBe(1);
    const ok = await conector.retorno('notas', n.chave, { situacao: 'rejeitada', codigo: 'produto_sem_cadastro' });
    expect(ok.status).toBe(200);
    expect(await alvo.retornosVistos('a', 'notas')).toHaveLength(1);
  });
});

describe('E4-5: o faturamento desligado exige o conector com pedidos (§15)', () => {
  it.skipIf(!API_REAL)(`sem a credencial "via Conector" ativa com pedidos, o /config não deixa desligar (${PR_LIBERA.FAT} e ${PR_LIBERA.APPS})`, () => {
    PENDENTE_API_REAL.desligarFaturamento();
  });
});
