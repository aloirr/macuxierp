/**
 * Recebimento e retorno de pedidos do FDV contra o PostgreSQL real (papel macuxierp_worker, RLS), com dublê do Hub
 * (sem rede, sem FDV). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`). T-0013 §5, §6 e §9.1 (1, 4, 8, 9).
 */
import type { Relogio } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RetornoErp } from '../contracts';
import type { EntidadeChaveErp } from '../contracts';
import { U, admSql, dubleLogAlertas } from './apoio-conector-teste';
import type { ClienteHubPedidos, RecebedorPedidoFdv, ResolvedorChaveErp, RespostaRetorno } from './portas';
import { buscarPedidosPendentes, MAX_TENTATIVAS } from './recebimento-pedidos';
import { criarConsumidorRetornoPedido, enviarRetornosPendentes } from './retorno-pedidos';

const relogio: Relogio = { agora: () => new Date('2026-11-21T18:00:00Z') };
const SEGREDOS = ['Fulano de Tal', '12345678000199', 'observação sigilosa', 'motivo livre sigiloso'];

const dublê = dubleLogAlertas;

describe.skipIf(!PG_DISPONIVEL)('pedidos do FDV no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let A: string;
  let B: string;
  let adm: ReturnType<typeof admSql>;
  const KIT = 'C000123';
  const ids = { cliente: U(), clienteErp: U(), clienteKit: U(), vendedor: U(), produto: U(), filial: U(), filialPedido: U(), prazo: U() };

  /** Dublê da porta do `cadastros/api` (ADR 0010, item 2): chave do Hub (kit ou UUID do ERP) -> UUID do ERP, por entidade. */
  const tabela: Record<EntidadeChaveErp, Map<string, string>> = {
    cliente: new Map(), vendedor: new Map(), filial: new Map(), produto: new Map(), prazo_pagamento: new Map(), cliente_endereco: new Map(),
  };
  // Inativo também resolve (a porta não filtra situação).
  const consultas: Array<[string, readonly string[]]> = [];
  const resolvedor: ResolvedorChaveErp = {
    resolver: async (_tx, entidade, chaves) => {
      consultas.push([entidade, chaves]);
      const t = (tabela as Partial<Record<string, Map<string, string>>>)[entidade] ?? new Map<string, string>();
      return new Map(chaves.filter((c) => t.has(c)).map((c) => [c, t.get(c)!]));
    },
  };
  const pedidoDoHub = (uuid: string, extra: Record<string, unknown> = {}) => ({
    pedido_uuid: uuid, cliente_external_id: ids.cliente, vendedor_external_id: ids.vendedor,
    criado_em: '2026-11-21T14:00:00Z', observacao: 'observação sigilosa', total_cents: 2500, tentativa: 1,
    itens: [{ sequencia: 1, produto_external_id: ids.produto, quantidade: 2.5, preco_unitario_cents: 1000, total_cents: 2500 }],
    ...extra,
  });
  const hubCom = (pedidos: unknown[], respostas: RespostaRetorno[] = [{ status: 200 }]): ClienteHubPedidos & { enviados: Array<{ uuid: string; corpo: RetornoErp }> } => {
    const enviados: Array<{ uuid: string; corpo: RetornoErp }> = [];
    return {
      enviados,
      pendentes: async () => ({ status: 200, pedidos }),
      enviarRetorno: async (uuid, corpo) => {
        enviados.push({ uuid, corpo });
        return respostas[Math.min(enviados.length - 1, respostas.length - 1)]!;
      },
    };
  };
  /** Dublê da porta do pedido: cria uma vez por pedido_uuid e depois responde `repetido` (RN-PED-01, camada 2). */
  const recebedorDuble = () => {
    const criados = new Map<string, string>();
    let chamadas = 0;
    const r: RecebedorPedidoFdv = {
      receber: async (_tx, e) => {
        chamadas++;
        const existente = criados.get(e.pedido_uuid);
        if (existente) return { resultado: 'repetido', pedido_id: existente, numero: 1, status: 'aprovado' };
        const id = U();
        criados.set(e.pedido_uuid, id);
        return { resultado: 'criado', pedido_id: id, numero: 1, status: 'aprovado' };
      },
    };
    return { r, chamadas: () => chamadas };
  };

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 4);
    A = await criarTenant(efemero.admin, 'ped-a', ['integracao-fdv', 'pedido']);
    B = await criarTenant(efemero.admin, 'ped-b', ['integracao-fdv', 'pedido']);
    tabela.cliente.set(ids.cliente, ids.clienteErp).set(KIT, ids.clienteKit);
    tabela.vendedor.set(ids.vendedor, U());
    tabela.produto.set(ids.produto, U());
    tabela.filial.set(ids.filialPedido, U());
    tabela.prazo_pagamento.set(ids.prazo, U());
    for (const t of [A, B]) {
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id) VALUES ($1)', [t]);
      await adm(
        `INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, fonte_ocorrido_em) VALUES ($1, 'filial_padrao', $2, $3)`,
        [t, ids.filial, relogio.agora()],
      );
    }
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-PED-01: o mesmo pedido entregue 3 vezes, em duas buscas concorrentes, gera 1 pedido_recebido e 1 chamada à porta', async () => {
    const uuid = U();
    const d = dublê();
    const rec = recebedorDuble();
    const deps = { banco, hub: hubCom([pedidoDoHub(uuid)]), recebedor: rec.r, resolvedor, relogio, log: d.log, alertar: d.alertar };
    await Promise.all([buscarPedidosPendentes(deps, A), buscarPedidosPendentes(deps, A)]);
    await buscarPedidosPendentes(deps, A);
    const linhas = await adm('SELECT estado, pedido_id FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [A, uuid]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.estado).toBe('entregue');
    expect(linhas[0]!.pedido_id).not.toBeNull();
    expect(rec.chamadas()).toBe(1);
  });

  it('RN-PED-01: conteúdo diferente com o mesmo pedido_uuid vale o primeiro e alerta divergência', async () => {
    const uuid = U();
    const d = dublê();
    const rec = recebedorDuble();
    const mk = (p: unknown) => ({ banco, hub: hubCom([p]), recebedor: rec.r, resolvedor, relogio, log: d.log, alertar: d.alertar });
    await buscarPedidosPendentes(mk(pedidoDoHub(uuid)), A);
    await buscarPedidosPendentes(mk(pedidoDoHub(uuid, { total_cents: 9999 })), A);
    expect(d.alertas.some((a) => a.includes(':pedido_fdv_conteudo_divergente:'))).toBe(true);
    expect(rec.chamadas()).toBe(1);
  });

  it('ADR 0010: chave do kit e UUID do ERP chegam à porta como UUID do ERP; a busca é uma por entidade', async () => {
    const d = dublê();
    const vistos: Array<{ cliente: string; filial: string; condicao: string | null }> = [];
    const recebedor: RecebedorPedidoFdv = {
      receber: async (_tx, e) => {
        vistos.push({ cliente: e.cliente_id, filial: e.filial_id, condicao: e.condicao_pagamento_id });
        return { resultado: 'criado', pedido_id: U(), numero: 1, status: 'aprovado' };
      },
    };
    consultas.length = 0;
    const kit = pedidoDoHub(U(), { cliente_external_id: KIT, filial: { external_id: ids.filialPedido }, pagamento: { prazo_external_id: ids.prazo } });
    await buscarPedidosPendentes({ banco, hub: hubCom([kit, pedidoDoHub(U())]), recebedor, resolvedor, relogio, log: d.log, alertar: d.alertar }, A);
    expect(vistos[0]).toMatchObject({ cliente: ids.clienteKit, filial: tabela.filial.get(ids.filialPedido), condicao: tabela.prazo_pagamento.get(ids.prazo) });
    expect(vistos[1]).toEqual({ cliente: ids.clienteErp, filial: ids.filial, condicao: null }); // sem filial: padrão; sem prazo: null
    expect(consultas.filter(([e]) => e === 'cliente')).toHaveLength(2); // 1 por pedido
    expect(consultas.filter(([e]) => e === 'filial')).toHaveLength(1); // o pedido sem filial não consulta
  });

  it.each([
    ['cliente com chave do kit inexistente', { cliente_external_id: 'C999999' }, 'cliente_inexistente', 'Cliente não cadastrado no ERP'],
    ['condição', { pagamento: { prazo_external_id: 'X-NAO-EXISTE' } }, 'condicao_inexistente', 'Condição de pagamento não cadastrada no ERP'],
  ])('RN-INF-05: chave desconhecida de %s rejeita sem chamar a porta e volta como rejeitado_erp', async (_n, extra, codigo, motivo) => {
    const uuid = U();
    const d = dublê();
    const rec = recebedorDuble();
    const hub = hubCom([pedidoDoHub(uuid, extra)]);
    const r = await buscarPedidosPendentes({ banco, hub, recebedor: rec.r, resolvedor, relogio, log: d.log, alertar: d.alertar }, A);
    expect(r.rejeitados).toBe(1);
    expect(rec.chamadas()).toBe(0);
    const [pr] = await adm('SELECT estado, erro_codigo FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [A, uuid]);
    expect(pr).toMatchObject({ estado: 'rejeitado', erro_codigo: codigo });
    await enviarRetornosPendentes({ banco, hub, relogio, log: d.log, alertar: d.alertar }, A);
    const corpo = hub.enviados.find((e) => e.uuid === uuid)!.corpo;
    expect(corpo).toMatchObject({ status: 'rejeitado_erp', motivo });
    expect(corpo.numero_erp).toBeUndefined();
  });

  it('RN-PED-01: pedido fora do contrato é rejeitado e ao Hub vai só o nome do campo', async () => {
    const uuid = U();
    const d = dublê();
    const hub = hubCom([{ pedido_uuid: uuid, itens: [], observacao: 'observação sigilosa', total_cents: 'zz-marcador-xyz' }]);
    await buscarPedidosPendentes({ banco, hub, recebedor: recebedorDuble().r, resolvedor, relogio, log: d.log, alertar: d.alertar }, A);
    await enviarRetornosPendentes({ banco, hub, relogio, log: d.log, alertar: d.alertar }, A);
    const corpo = hub.enviados.find((e) => e.uuid === uuid)!.corpo;
    expect(corpo.status).toBe('rejeitado_erp');
    expect(corpo.motivo).toContain('itens');
    expect(JSON.stringify(corpo)).not.toContain('sigilosa');
    expect(JSON.stringify(corpo)).not.toContain('zz-marcador-xyz');
  });

  it('RN-PED-01: falha da porta desfaz só a tradução; com 5 tentativas vira rejeitado por falha_interna e alerta, sem dado pessoal no log', async () => {
    const uuid = U();
    const d = dublê();
    const recebedor: RecebedorPedidoFdv = {
      receber: async (tx) => {
        await tx.consultar('SELECT 1 FROM tabela_que_nao_existe'); // erro de banco: a transação do pedido ficaria abortada
        throw new Error('Fulano de Tal 12345678000199 motivo livre sigiloso');
      },
    };
    const deps = { banco, hub: hubCom([pedidoDoHub(uuid)]), recebedor, resolvedor, relogio, log: d.log, alertar: d.alertar };
    for (let i = 1; i < MAX_TENTATIVAS; i++) {
      const r = await buscarPedidosPendentes(deps, A);
      expect(r.pendentes).toBe(1);
      const [l] = await adm('SELECT estado, tentativas FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [A, uuid]);
      expect(l).toMatchObject({ estado: 'recebido', tentativas: i });
    }
    const r = await buscarPedidosPendentes(deps, A);
    expect(r.rejeitados).toBe(1);
    const [l] = await adm('SELECT estado, erro_codigo, tentativas FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [A, uuid]);
    expect(l).toMatchObject({ estado: 'rejeitado', erro_codigo: 'falha_interna', tentativas: MAX_TENTATIVAS });
    expect(d.alertas.some((a) => a.includes(':pedido_fdv_falha_interna:'))).toBe(true);
    for (const s of SEGREDOS) expect(d.logs.join('\n')).not.toContain(s);
  });

  it('RN-PED-01: falha no rejeitar cai no ROLLBACK TO do savepoint e a tentativa é contada', async () => {
    const uuid = U();
    const d = dublê();
    const recebedor: RecebedorPedidoFdv = { receber: async () => ({ resultado: 'recusado', codigo: 'cliente_inexistente' }) };
    let chamadas = 0;
    const quebra: Relogio = { agora: () => { if (++chamadas === 2) throw new Error('falha no rejeitar'); return relogio.agora(); } };
    const mk = (r: Relogio) => ({ banco, hub: hubCom([pedidoDoHub(uuid)]), recebedor, resolvedor, relogio: r, log: d.log, alertar: d.alertar });
    expect((await buscarPedidosPendentes(mk(quebra), A)).pendentes).toBe(1);
    const [l] = await adm('SELECT estado, tentativas FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [A, uuid]);
    expect(l).toMatchObject({ estado: 'recebido', tentativas: 1 });
    expect((await buscarPedidosPendentes(mk(relogio), A)).rejeitados).toBe(1);
  });

  it('RN-PED-01: pedido sem uuid é ignorado e alerta pedido_sem_uuid', async () => {
    const d = dublê();
    await buscarPedidosPendentes({ banco, hub: hubCom([{ cliente_external_id: ids.cliente }]), recebedor: recebedorDuble().r, resolvedor, relogio, log: d.log, alertar: d.alertar }, A);
    expect(d.alertas).toContain(`${A}:pedido_sem_uuid:{}`);
  });

  it('RN-PED-01: linha recebido reprocessada com conteúdo novo traduz o payload guardado (o primeiro)', async () => {
    const uuid = U();
    const d = dublê();
    const vistos: number[] = [];
    let falha = true;
    const recebedor: RecebedorPedidoFdv = {
      receber: async (_tx, e) => {
        vistos.push(e.total_informado_centavos);
        if (falha) throw new Error('falha');
        return { resultado: 'criado', pedido_id: U(), numero: 1, status: 'aprovado' };
      },
    };
    const mk = (p: unknown) => ({ banco, hub: hubCom([p]), recebedor, resolvedor, relogio, log: d.log, alertar: d.alertar });
    await buscarPedidosPendentes(mk(pedidoDoHub(uuid)), A);
    falha = false;
    await buscarPedidosPendentes(mk(pedidoDoHub(uuid, { total_cents: 9999 })), A);
    expect(vistos).toEqual([2500, 2500]);
  });

  it('RN-PED-01: módulo pedido sem licença deixa o pedido recebido, alerta e a própria busca adia a coluna em 1 h (sem posse: incondicional)', async () => {
    const uuid = U();
    const d = dublê();
    await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [B, relogio.agora()]);
    const recebedor: RecebedorPedidoFdv = { receber: async () => ({ resultado: 'recusado', codigo: 'modulo_pedido_inativo' }) };
    const r = await buscarPedidosPendentes({ banco, hub: hubCom([pedidoDoHub(uuid)]), recebedor, resolvedor, relogio, log: d.log, alertar: d.alertar }, B);
    expect(r.proxima).toBe('desligada');
    const [l] = await adm('SELECT estado FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [B, uuid]);
    expect(l!.estado).toBe('recebido');
    const [s] = await adm('SELECT proxima_busca_pedidos_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [B]);
    expect(new Date(s!.proxima_busca_pedidos_em).getTime()).toBe(relogio.agora().getTime() + 3600_000); // nada de NULL: adiada 1 h pela busca
    expect(d.alertas).toContain(`${B}:recebimento_pedidos_desligado:{}`);
  });

  describe('retorno (RN-PED-05)', () => {
    const d = dublê();
    const consumidor = criarConsumidorRetornoPedido({ log: d.log, relogio });
    const evento = (tenant: string, nome: string, pedidoUuid: string | null, payload: Record<string, unknown> = {}) => ({
      id: U(), nome, tenant_id: tenant, agregado_id: U(), versao: 1, ocorrido_em: '2026-11-21T18:00:00.000Z', ator: 'sistema' as const, request_id: 'r',
      payload: { pedido_id: U(), numero: 42, origem: pedidoUuid ? 'fdv' : 'bko', pedido_uuid: pedidoUuid, status: 'aprovado', ...payload },
    });
    const aplicar = (tenant: string, ev: ReturnType<typeof evento>) => banco.comTenant(tenant, (tx) => consumidor.tratar(ev, tx));
    const retornos = (tenant: string, uuid: string) =>
      adm('SELECT status, numero_erp, estado, tentativas FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1 AND pedido_uuid = $2 ORDER BY created_at', [tenant, uuid]);
    async function pedidoEntregue(tenant: string): Promise<string> {
      const uuid = U();
      await adm(`INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado) VALUES ($1, $2, '{}', repeat('b', 64), 'entregue')`, [tenant, uuid]);
      return uuid;
    }

    it('RN-PED-05: recebido@1 grava integrado com numero_erp, e o reenvio do mesmo evento não duplica', async () => {
      const uuid = await pedidoEntregue(A);
      const ev = evento(A, 'pedido.pedido.recebido@1', uuid);
      await aplicar(A, ev);
      await aplicar(A, ev);
      await aplicar(A, evento(A, 'pedido.pedido.recebido@1', uuid)); // outro evento, mesmo efeito
      expect(await retornos(A, uuid)).toEqual([{ status: 'integrado', numero_erp: '42', estado: 'pendente', tentativas: 0 }]);
      const [s] = await adm('SELECT proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [A]);
      expect(s!.proximo_retorno_em).not.toBeNull();
    });

    it('RN-PED-05: cancelado@1 depois do integrado vira cancelado com motivo; recusado@1 não gera retorno', async () => {
      const uuid = await pedidoEntregue(A);
      await aplicar(A, evento(A, 'pedido.pedido.recebido@1', uuid, { status: 'em_analise' }));
      await aplicar(A, evento(A, 'pedido.pedido.recusado@1', uuid, { status: 'recusado', motivo_codigo: 'credito_insuficiente' }));
      await aplicar(A, evento(A, 'pedido.pedido.cancelado@1', uuid, { status: 'cancelado', motivo_codigo: 'sem_estoque' }));
      expect((await retornos(A, uuid)).map((r) => r.status)).toEqual(['integrado', 'cancelado']);
    });

    it('RN-PED-05: tenant B não enxerga retorno do tenant A (RLS)', async () => {
      const uuid = await pedidoEntregue(A);
      await aplicar(A, evento(A, 'pedido.pedido.recebido@1', uuid));
      const outro = await banco.comTenant(B, (tx) => tx.consultar('SELECT id FROM integracao_fdv.retorno_enviado WHERE pedido_uuid = $1', [uuid]));
      expect(outro).toEqual([]);
    });

    it('RN-PED-05: 503 reagenda com a curva e 200 depois marca enviado; a ordem por pedido é mantida', async () => {
      const C = await criarTenant(efemero.admin, 'ped-c', ['integracao-fdv', 'pedido']); // fila própria: o 503 para o laço
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id) VALUES ($1)', [C]);
      const uuid = await pedidoEntregue(C);
      await aplicar(C, evento(C, 'pedido.pedido.recebido@1', uuid));
      await aplicar(C, evento(C, 'pedido.pedido.cancelado@1', uuid, { status: 'cancelado', motivo_codigo: 'sem_estoque' }));
      const dd = dublê();
      const hub = hubCom([], [{ status: 503, retryAfterS: 60 }, { status: 200 }]);
      const r1 = await enviarRetornosPendentes({ banco, hub, relogio, log: dd.log, alertar: dd.alertar }, C);
      expect(r1.reagendados).toBe(1);
      expect(hub.enviados.filter((e) => e.uuid === uuid)).toHaveLength(1); // o cancelado esperou o integrado
      expect(await retornos(C, uuid)).toMatchObject([{ status: 'integrado', tentativas: 1 }, { status: 'cancelado', estado: 'pendente' }]);
      const [s] = await adm('SELECT proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [C]);
      expect(new Date(s!.proximo_retorno_em).getTime()).toBe(relogio.agora().getTime() + 60_000);
      await enviarRetornosPendentes({ banco, hub, relogio, log: dd.log, alertar: dd.alertar }, C);
      expect(hub.enviados.filter((e) => e.uuid === uuid).map((e) => e.corpo.status)).toEqual(['integrado', 'integrado', 'cancelado']);
      expect((await retornos(C, uuid)).map((x) => x.estado)).toEqual(['enviado', 'enviado']);
    });

    it('RN-PED-05: 422 do Hub vira falhou com alerta só com o código; 401 pausa sem contar tentativa', async () => {
      const uuid = await pedidoEntregue(A);
      await aplicar(A, evento(A, 'pedido.pedido.recebido@1', uuid));
      const dd = dublê();
      const pausa = await enviarRetornosPendentes({ banco, hub: hubCom([], [{ status: 401 }]), relogio, log: dd.log, alertar: dd.alertar }, A);
      expect(pausa.motivoPausa).toBe('credencial');
      expect((await retornos(A, uuid))[0]).toMatchObject({ estado: 'pendente', tentativas: 0 });
      const r = await enviarRetornosPendentes({ banco, hub: hubCom([], [{ status: 422, codigo: 'transicao_invalida' }]), relogio, log: dd.log, alertar: dd.alertar }, A);
      expect(r.falhou).toBeGreaterThanOrEqual(1);
      expect((await retornos(A, uuid))[0]!.estado).toBe('falhou');
      expect(dd.alertas).toContain(`${A}:retorno_recusado_pelo_hub:${JSON.stringify({ pedido_uuid: uuid, codigo: 'transicao_invalida' })}`);
    });
  });
});
