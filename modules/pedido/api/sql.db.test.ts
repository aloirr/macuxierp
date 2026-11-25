/**
 * Teste do adaptador SQL do pedido contra o PostgreSQL real (migração 0012, papéis macuxierp_app e macuxierp_worker, RLS por
 * tenant). Banco efêmero de `@macuxierp/platform-sdk/pg-testes`; sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 * Local: `bash db/scripts/pg-local.sh`. Cada `comTenant` é uma transação real (FOR UPDATE e advisory lock valem).
 */
import { auditar, criarEvento, ErroApi, type Transacao } from '@macuxierp/platform-sdk';
import { AuditoriaPg, LicencasPg, OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { exportadorPedido, TABELAS_EXPORTADAS } from './exportador';
import { SituacaoPedidoParaFaturar } from '../contracts';
import { criarConsultaParaFaturar } from './faturar';
import { IDS, pedidoFdv, pedidoManual, prazoDoCliente, prepararCadastros, unidadeDoProduto } from './fixtures-teste';
import { criarPluginPedido, dependenciasDeProducao } from './index';
import { CadastrosMemoria } from './memoria';
import type { Dependencias } from './portas';
import { criarRecebedorFdv } from './recebedor';
import { criarServico, type Efeitos } from './servico';
import { idFaturadoDaNota } from './eventos';
import { consumidoresDoPedido } from './consumidor-nota';
import { repositorioSql } from './sql';
import { RecuoRecusadoPeloBanco } from './util';

const AGORA = new Date('2026-11-21T15:00:00Z');
const USUARIO = '22222222-2222-4222-8222-222222222222';

function barreira(n: number): () => Promise<void> {
  let chegaram = 0;
  let liberar!: () => void;
  const livre = new Promise<void>((r) => (liberar = r));
  return async () => {
    if (++chegaram >= n) liberar();
    await livre;
  };
}

describe.skipIf(!PG_DISPONIVEL)('adaptador SQL do pedido (PostgreSQL real)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
  let B: string;
  let SEM_LICENCA: string;
  const cad = new CadastrosMemoria();
  const deps: Dependencias = dependenciasDeProducao(cad);
  const servico = criarServico(deps);
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** Efeitos reais: outbox e auditoria do SDK na própria transação, como a API faz. */
  const efeitos = (tx: Transacao, tenant: string): Efeitos => ({
    tenant_id: tenant,
    ator: { tipo: 'usuario', id: USUARIO, perfil: 'administrador' },
    agora: AGORA,
    publicar: async (e) => {
      const ev = criarEvento({ nome: e.nome, tenant_id: tenant, agregado_id: e.agregado_id, ator: USUARIO, request_id: 'req-db', payload: e.payload }, AGORA);
      await new OutboxPg().gravar(tx, ev);
      return ev.id;
    },
    auditar: async (d) => void (await auditar(new AuditoriaPg(), tx, { tenant_id: tenant, usuario_id: USUARIO, request_id: 'req-db' }, d, AGORA)),
  });
  const lancar = (tenant: string, corpo = pedidoManual(), sv = servico) => app.comTenant(tenant, (tx) => sv.lancar(tx, efeitos(tx, tenant), corpo));
  /** Serviço cujo advisory lock só é pedido depois que as duas transações chegaram: força a corrida (T-0013 §9.1, item 7). */
  const comBarreira = (esperar: () => Promise<void>) =>
    criarServico({
      ...deps,
      repositorios: (tx) => {
        const r = repositorioSql(tx);
        const travar = r.travarCliente.bind(r);
        r.travarCliente = async (k) => {
          await esperar();
          await travar(k);
        };
        return r;
      },
    });

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'empresa-a', ['pedido']);
    B = await criarTenant(efemero.admin, 'empresa-b', ['pedido']);
    SEM_LICENCA = await criarTenant(efemero.admin, 'empresa-sem', ['cadastros']);
    prepararCadastros(cad, { saldo: 1_000_000_000 });
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('fluxo real: lançar grava pedido, itens, 2 históricos, a aprovação, 2 eventos na outbox e a auditoria; o detalhe volta íntegro', async () => {
    const r = await lancar(A, pedidoManual({ observacao: 'obs', endereco_entrega_id: IDS.endereco }));
    expect(r.http).toBe(201);
    expect(r.pedido).toMatchObject({ numero: 1, status: 'aprovado', total_centavos: 1000, decisao: { automatica: true }, observacao: 'obs', pendencias: [] });
    expect(await admin('SELECT automatica FROM pedido.aprovacao WHERE pedido_id = $1', [r.pedido.id])).toEqual([{ automatica: true }]);
    expect(r.pedido.cliente_retrato).toMatchObject({ razao_social: 'Maria da Silva Exemplo', endereco: { cep: '69000000' } });
    expect(r.pedido.itens[0]).toMatchObject({ sequencia: 1, quantidade: 10_000, preco_tabela_centavos: 1000, desconto_maximo_bp: 500, quantidade_faturada: 0 });
    expect(r.pedido.historico.map((h) => [h.de, h.para])).toEqual([[null, 'recebido'], ['recebido', 'aprovado']]);
    const id = r.pedido.id;
    expect((await admin('SELECT status, origem, pendencias, external_id FROM pedido.pedido WHERE id = $1', [id]))[0]).toMatchObject({ status: 'aprovado', origem: 'bko', pendencias: [], external_id: null });
    expect(await admin('SELECT nome, versao FROM plataforma.evento WHERE agregado_id = $1 ORDER BY versao', [id])).toEqual([{ nome: 'pedido.pedido.recebido@1', versao: '1' }, { nome: 'pedido.pedido.aprovado@1', versao: '2' }]);
    expect((await admin('SELECT count(*)::int AS n FROM pedido.pedido_evento WHERE pedido_id = $1 AND evento_id IS NOT NULL', [id]))[0]?.n).toBe(2);
    expect((await admin('SELECT acao FROM plataforma.auditoria WHERE entidade_id = $1', [id]))).toEqual([{ acao: 'pedido.lancar' }]);
  });

  it('T-0013 §9.1, item 2: o número começa em 1 em cada tenant e cresce de 1 em 1', async () => {
    expect((await lancar(B)).pedido.numero).toBe(1);
    expect((await lancar(A)).pedido.numero).toBe(2);
    expect((await lancar(B)).pedido.numero).toBe(2);
  });

  it('T-0013 §9.1, item 2: pedido, itens, histórico, aprovação e numeração do tenant A não aparecem para o B, em nenhum papel; o :id de outro tenant é 404', async () => {
    const idA = (await lancar(A)).pedido.id;
    for (const banco of [app, worker]) {
      for (const t of TABELAS_EXPORTADAS) {
        const linhas = await banco.comTenant(B, (tx) => tx.consultar<{ tenant_id: string }>(`SELECT tenant_id FROM pedido.${t}`));
        expect(linhas.length, t).toBeGreaterThan(0);
        expect(linhas.every((l) => l.tenant_id === B), t).toBe(true);
      }
      expect(await banco.comTenant(B, (tx) => tx.consultar('SELECT 1 FROM pedido.pedido WHERE id = $1', [idA]))).toEqual([]);
    }
    await app.comTenant(B, async (tx) => {
      const repo = repositorioSql(tx);
      expect(await repo.obter(idA)).toBeNull();
      expect((await repo.listar({ limite: 200 })).itens.every((i) => i.id !== idA)).toBe(true);
    });
    const plugin = criarPluginPedido(deps);
    await app.comTenant(B, async (tx) => {
      expect((await criarAmbiente(plugin, AGORA, tx).chamar('GET', `/pedidos/${idA}`, { sessao: sessaoDe('administrador') })).status).toBe(404);
      expect((await criarAmbiente(plugin, AGORA, tx).chamar('POST', `/pedidos/${idA}/cancelar`, { sessao: sessaoDe('gerente'), corpo: { motivo_codigo: 'erro_lancamento' } })).status).toBe(404);
    });
  });

  it('RN-PED-01: o external_id repetido não cria outro pedido; duas criações simultâneas viram uma', async () => {
    const corpo = pedidoManual({ external_id: 'EXT-DB-1' });
    const [x, y] = await Promise.all([lancar(A, corpo), lancar(A, corpo)]);
    expect([x.http, y.http].sort()).toEqual([200, 201]);
    expect(x.pedido.id).toBe(y.pedido.id);
    expect((await admin("SELECT count(*)::int AS n FROM pedido.pedido WHERE external_id = 'EXT-DB-1'"))[0]?.n).toBe(1);
    expect((await lancar(A, pedidoManual({ external_id: 'EXT-DB-1', observacao: 'outro' }))).http).toBe(409);
  });

  it('T-0013 §9.1, item 7: dois pedidos do mesmo cliente que somados passam do limite, lançados em paralelo: só um fica aprovado sem pendência', async () => {
    const T = await criarTenant(efemero.admin, 'concorrencia-lancar', ['pedido']);
    const corpo = pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 600_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }); // 60.000 de 100.000
    const sv = comBarreira(barreira(2));
    const [a, b] = await Promise.all([lancar(T, corpo, sv), lancar(T, corpo, sv)]);
    const status = [a.pedido.status, b.pedido.status].sort();
    expect(status).toEqual(['aprovado', 'em_analise']);
    const analise = [a.pedido, b.pedido].find((p) => p.status === 'em_analise');
    expect(analise?.pendencias).toEqual([expect.objectContaining({ codigo: 'credito_excedido', esperado: 100_000, informado: 120_000 })]);
  });

  it('T-0013 §9.1, item 7: dois pedidos em análise revalidados em paralelo: só um é aprovado sem pendência', async () => {
    const T = await criarTenant(efemero.admin, 'concorrencia-revalidar', ['pedido']);
    cad.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 0);
    const corpo = pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 600_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] });
    const p1 = (await lancar(T, corpo)).pedido;
    const p2 = (await lancar(T, corpo)).pedido;
    expect([p1.status, p2.status]).toEqual(['em_analise', 'em_analise']);
    cad.saldosPor.set(`${IDS.filial}:${IDS.produto1}`, 1_000_000_000);
    const sv = comBarreira(barreira(2));
    const rev = (id: string) => app.comTenant(T, (tx) => sv.revalidar(tx, efeitos(tx, T), id));
    const [a, b] = await Promise.all([rev(p1.id), rev(p2.id)]);
    expect([a.status, b.status].sort()).toEqual(['aprovado', 'em_analise']);
    expect((await admin("SELECT count(*)::int AS n FROM pedido.aprovacao a JOIN pedido.pedido p ON p.id = a.pedido_id WHERE p.tenant_id = $1", [T]))[0]?.n).toBe(1);
  });

  it('RN-PED-02: o gatilho do banco recusa transição fora da tabela (SQLSTATE MXP02), e o adaptador a traduz em 422 com os possíveis', async () => {
    const p = (await lancar(A, pedidoManual({ condicao_pagamento_id: null }))).pedido;
    expect(p.status).toBe('em_analise');
    const cru = await app.comTenant(A, (tx) => tx.consultar("UPDATE pedido.pedido SET status = 'faturado' WHERE id = $1", [p.id])).catch((e: unknown) => e);
    expect(cru).toMatchObject({ code: 'MXP02', detail: 'possiveis=aprovado,recusado' });
    const erro = await app
      .comTenant(A, (tx) => repositorioSql(tx).atualizarStatus(p.id, 'faturado', [], null))
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({ status: 422, codigo: 'RN-PED-02', detalhes: { possiveis: ['aprovado', 'recusado'] } });
    expect(JSON.stringify(erro)).not.toContain('detail');
    const criacao = await app.comTenant(A, (tx) => tx.consultar("INSERT INTO pedido.pedido (tenant_id, numero, origem, status, filial_id, cliente_id, cliente_retrato, emitido_em, total_centavos) VALUES (plataforma.tenant_atual(), 999, 'bko', 'aprovado', $1, $1, '{}', $2, 0)", [IDS.filial, AGORA])).catch((e: unknown) => e);
    expect(criacao).toMatchObject({ code: 'MXP02', detail: 'possiveis=recebido' });
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [p.id]))[0]?.status).toBe('em_analise');
  });

  it('pelo serviço: recusar duas vezes e cancelar o recusado dão 422 RN-PED-02; a recusa grava a decisão e o histórico', async () => {
    const p = (await lancar(A, pedidoManual({ condicao_pagamento_id: null }))).pedido;
    const recusado = await app.comTenant(A, (tx) => servico.recusar(tx, efeitos(tx, A), p.id, { motivo_codigo: 'cliente_bloqueado', motivo_texto: null }));
    expect(recusado).toMatchObject({ status: 'recusado', decisao: { decisao: 'recusado', motivo_codigo: 'cliente_bloqueado' } });
    const de = await app.comTenant(A, (tx) => servico.cancelar(tx, efeitos(tx, A), p.id, { motivo_codigo: 'erro_lancamento', motivo_texto: null })).catch((e: unknown) => e);
    expect(de).toMatchObject({ status: 422, codigo: 'RN-PED-02', detalhes: { possiveis: [] } });
    expect((await admin('SELECT de, para FROM pedido.pedido_evento WHERE pedido_id = $1 ORDER BY ocorrido_em, created_at, de NULLS FIRST', [p.id])).map((e) => [e.de, e.para])).toEqual([[null, 'recebido'], ['recebido', 'em_analise'], ['em_analise', 'recusado']]);
  });

  it('T-0014: pedido_evento e aprovacao só aceitam INSERT; ninguém apaga linha do pedido', async () => {
    const p = (await lancar(A)).pedido;
    for (const sql of [
      "UPDATE pedido.pedido_evento SET motivo_texto = 'x' WHERE pedido_id = $1",
      "UPDATE pedido.aprovacao SET justificativa = 'x' WHERE pedido_id = $1",
      'DELETE FROM pedido.pedido WHERE id = $1',
      'DELETE FROM pedido.pedido_item WHERE pedido_id = $1',
    ]) {
      for (const banco of [app, worker]) {
        await expect(banco.comTenant(A, (tx) => tx.consultar(sql, [p.id])), sql).rejects.toThrow();
      }
    }
    // o worker pode lançar o faturado; o app não
    await expect(app.comTenant(A, (tx) => tx.consultar('UPDATE pedido.pedido SET valor_faturado_centavos = 1 WHERE id = $1', [p.id]))).rejects.toThrow();
    await worker.comTenant(A, (tx) => tx.consultar('UPDATE pedido.pedido SET valor_faturado_centavos = 0 WHERE id = $1', [p.id]));
  });

  it('o compromisso de crédito e de estoque sai do próprio pedido: aprovado e faturado_parcial contam, em_analise não, e o fora do crédito (a_vista gravado) é filtrado', async () => {
    const T = await criarTenant(efemero.admin, 'compromisso', ['pedido']);
    const item = (q: number) => ({ produto_id: IDS.produto2, quantidade: q * 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 });
    const a = (await lancar(T, pedidoManual({ itens: [item(10)] }))).pedido; // 10.000, aprovado
    const v = (await lancar(T, pedidoManual({ condicao_pagamento_id: IDS.condicaoAVista, itens: [item(5)] }))).pedido; // 5.000 à vista, aprovado
    const c = (await lancar(T, pedidoManual({ condicao_pagamento_id: IDS.condicaoCartao, itens: [item(2)] }))).pedido; // 2.000 cartão, aprovado
    const gravado = Object.fromEntries((await admin('SELECT id, a_vista FROM pedido.pedido WHERE tenant_id = $1', [T])).map((l) => [l.id, l.a_vista]));
    expect(gravado).toMatchObject({ [a.id]: false, [v.id]: true, [c.id]: true }); // boleto false; à vista e cartão true
    await lancar(T, pedidoManual({ condicao_pagamento_id: null, itens: [item(3)] })); // em análise
    await app.comTenant(T, async (tx) => {
      const repo = repositorioSql(tx);
      expect(await repo.compromissoCredito(IDS.cliente, null)).toBe(10_000); // só o boleto
      expect(await repo.compromissoCredito(IDS.cliente, a.id)).toBe(0);
      expect(await repo.compromissoEstoque(IDS.filial, [IDS.produto2], null)).toEqual([{ produto_id: IDS.produto2, quantidade: 170_000 }]); // o estoque conta tudo
      expect(await repo.compromissoEstoque(IDS.filial, [IDS.produto2], v.id)).toEqual([{ produto_id: IDS.produto2, quantidade: 120_000 }]);
    });
    // o faturado reduz o compromisso (F4 grava pelo worker)
    await worker.comTenant(T, (tx) => tx.consultar('UPDATE pedido.pedido_item SET quantidade_faturada = 40000 WHERE pedido_id = $1', [a.id]));
    await worker.comTenant(T, (tx) => tx.consultar("UPDATE pedido.pedido SET valor_faturado_centavos = 4000, status = 'faturado_parcial' WHERE id = $1", [a.id]));
    await app.comTenant(T, async (tx) => {
      const repo = repositorioSql(tx);
      expect(await repo.compromissoCredito(IDS.cliente, v.id)).toBe(6_000);
      expect(await repo.compromissoEstoque(IDS.filial, [IDS.produto2], v.id)).toEqual([{ produto_id: IDS.produto2, quantidade: 80_000 }]);
    });
  });

  it('as rotas no SQL real: lista com filtros e cursor, busca, carteira do vendedor, CSV, edição com If-Match e retirada de item', async () => {
    const T = await criarTenant(efemero.admin, 'rotas', ['pedido']);
    const plugin = criarPluginPedido(deps);
    await app.comTenant(T, async (tx) => {
      const amb = criarAmbiente(plugin, AGORA, tx);
      const adm = sessaoDe('administrador');
      const cabecalhos = (n: number) => ({ 'idempotency-key': `chave-db-rotas-${n}-abc` });
      const ids: string[] = [];
      for (let n = 0; n < 3; n++) {
        amb.relogio.agora = new Date(AGORA.getTime() + n * 60_000);
        const r = await amb.chamar('POST', '/pedidos', { sessao: adm, corpo: pedidoManual({ vendedor_id: n === 2 ? IDS.outroVendedor : IDS.vendedor, ...(n === 1 ? { condicao_pagamento_id: null } : {}) }), cabecalhos: cabecalhos(n) });
        expect(r.status).toBe(201);
        ids.push(r.corpo.id);
      }
      const l1 = await amb.chamar('GET', '/pedidos', { sessao: adm, consulta: { limite: 2 } });
      expect(l1.corpo.itens.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[1]]); // emitido_em DESC
      const l2 = await amb.chamar('GET', '/pedidos', { sessao: adm, consulta: { limite: 2, cursor: l1.corpo.proximo_cursor } });
      expect(l2.corpo).toMatchObject({ itens: [{ id: ids[0] }], proximo_cursor: null });
      expect(l1.corpo.itens[0]).toMatchObject({ cliente_razao_social: 'Maria da Silva Exemplo', pendencias: 0 });
      expect(l1.corpo.itens[1]).toMatchObject({ status: 'em_analise', pendencias: 1 });
      const filtrado = async (q: Record<string, unknown>) => (await amb.chamar('GET', '/pedidos', { sessao: adm, consulta: q })).corpo.itens.map((i: { id: string }) => i.id);
      expect(await filtrado({ status: 'em_analise' })).toEqual([ids[1]]);
      expect(await filtrado({ busca: '3' })).toEqual([ids[2]]);
      expect(await filtrado({ busca: 'silva' })).toHaveLength(3);
      expect(await filtrado({ de: '2026-11-21', ate: '2026-11-21' })).toHaveLength(3);
      expect(await filtrado({ de: '2026-11-22' })).toEqual([]);
      expect(await filtrado({ ate: '2026-11-20' })).toEqual([]);
      const vend = await amb.chamar('GET', '/pedidos', { sessao: sessaoDe('vendedor', IDS.usuarioVendedor) });
      expect(vend.corpo.itens.map((i: { id: string }) => i.id)).toEqual([ids[1], ids[0]]);
      expect((await amb.chamar('GET', `/pedidos/${ids[2]}`, { sessao: sessaoDe('vendedor', IDS.usuarioVendedor) })).status).toBe(404);
      const csv = await amb.chamar('GET', '/pedidos/exportar', { sessao: adm });
      expect(csv.corpo).toContain('52998224725');
      expect((await amb.chamar('GET', '/pedidos/exportar', { sessao: sessaoDe('vendedor', IDS.usuarioVendedor) })).corpo).not.toContain('52998224725');

      // edição do que está em análise: troca o item 1 e acrescenta outro; retira depois (a sequência não se reaproveita)
      const det = (await amb.chamar('GET', `/pedidos/${ids[1]}`, { sessao: adm })).corpo;
      const ed1 = await amb.chamar('PUT', `/pedidos/${ids[1]}`, {
        sessao: adm,
        corpo: pedidoManual({ condicao_pagamento_id: null, itens: [{ produto_id: IDS.produto1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }, { produto_id: IDS.produto2, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }),
        cabecalhos: { 'if-match': det.updated_at },
      });
      expect(ed1).toMatchObject({ status: 200, corpo: { total_centavos: 3000, status: 'em_analise' } });
      expect(ed1.corpo.itens.map((i: { sequencia: number }) => i.sequencia)).toEqual([1, 2]);
      expect((await amb.chamar('PUT', `/pedidos/${ids[1]}`, { sessao: adm, corpo: pedidoManual({ condicao_pagamento_id: null }), cabecalhos: { 'if-match': det.updated_at } })).status).toBe(409);
      const ed2 = await amb.chamar('PUT', `/pedidos/${ids[1]}`, { sessao: adm, corpo: pedidoManual({ condicao_pagamento_id: null, itens: [{ produto_id: IDS.produto2, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }, { produto_id: IDS.produtoInativo, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }), cabecalhos: { 'if-match': ed1.corpo.updated_at } });
      expect(ed2.corpo.itens.map((i: { sequencia: number; produto_id: string }) => [i.sequencia, i.produto_id])).toEqual([[2, IDS.produto2], [3, IDS.produtoInativo]]);
      // aprovar com bloqueante (produto inativo): 422; recusar; cancelar o aprovado
      expect(await amb.chamar('POST', `/pedidos/${ids[1]}/aprovar`, { sessao: adm, corpo: { justificativa: 'x' } })).toMatchObject({ status: 422, corpo: { codigo: 'RN-PED-03' } });
      expect((await amb.chamar('POST', `/pedidos/${ids[1]}/recusar`, { sessao: adm, corpo: { motivo_codigo: 'preco_divergente' } })).corpo.status).toBe('recusado');
      expect((await amb.chamar('POST', `/pedidos/${ids[0]}/cancelar`, { sessao: adm, corpo: { motivo_codigo: 'erro_lancamento' } })).corpo.status).toBe('cancelado');
    });
    expect((await admin('SELECT count(*)::int AS n FROM pedido.pedido_item WHERE tenant_id = $1 AND deleted_at IS NOT NULL', [T]))[0]?.n).toBe(1);
  });

  it('T-0013 §9.1, item 1 (RN-PED-01): 3 entregas do mesmo pedido do FDV, uma delas em paralelo, viram 1 pedido, 1 recebido@1 e 1 aprovado@1', async () => {
    const T = await criarTenant(efemero.admin, 'fdv', ['pedido']);
    const recebedor = criarRecebedorFdv({ ...deps, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
    const receber = (tenant: string, entrada = pedidoFdv()) => worker.comTenant(tenant, (tx) => recebedor.receber(tx, entrada));
    const [a, b, c] = await Promise.all([receber(T), receber(T), receber(T)]);
    const resultados = [a, b, c].map((r) => r.resultado).sort();
    expect(resultados).toEqual(['criado', 'repetido', 'repetido']);
    const d = await receber(T);
    expect(d).toMatchObject({ resultado: 'repetido', status: 'aprovado', numero: 1 });
    const linhas = await admin("SELECT id, status, origem, external_id, numero::int AS numero FROM pedido.pedido WHERE tenant_id = $1", [T]);
    expect(linhas).toEqual([expect.objectContaining({ status: 'aprovado', origem: 'fdv', external_id: IDS.pedidoFdv, numero: 1 })]);
    expect(await admin('SELECT nome FROM plataforma.evento WHERE tenant_id = $1 ORDER BY versao', [T])).toEqual([{ nome: 'pedido.pedido.recebido@1' }, { nome: 'pedido.pedido.aprovado@1' }]);
    expect((await admin("SELECT ator, payload->>'request_id' AS rid FROM (SELECT payload->>'ator' AS ator, payload FROM plataforma.evento WHERE tenant_id = $1) x LIMIT 1", [T]))[0]).toMatchObject({ ator: 'sistema' });
    // T-0013 §2 e §7, ADR 0007: pedido do FDV entra aprovado na origem, sem linha em pedido.aprovacao.
    expect(await admin('SELECT 1 FROM pedido.aprovacao WHERE tenant_id = $1', [T])).toHaveLength(0);
    expect((await admin('SELECT acao, usuario_id FROM plataforma.auditoria WHERE tenant_id = $1', [T]))).toEqual([{ acao: 'pedido.receber', usuario_id: null }]);
    // o número do segundo pedido do FDV é 2: a repetição não gastou número
    const outro = await receber(T, pedidoFdv({ pedido_uuid: '12345678-1234-4234-8234-123456789099' }));
    expect(outro).toMatchObject({ resultado: 'criado', numero: 2 });
    // o external_id do FDV em maiúsculas vira o mesmo pedido
    expect(await receber(T, pedidoFdv({ pedido_uuid: IDS.pedidoFdv.toUpperCase() }))).toMatchObject({ resultado: 'repetido', numero: 1 });
    // sem a licença do pedido: recusa e nada é gravado
    expect(await receber(SEM_LICENCA)).toEqual({ resultado: 'recusado', codigo: 'modulo_pedido_inativo' });
    expect((await admin('SELECT count(*)::int AS n FROM pedido.pedido WHERE tenant_id = $1', [SEM_LICENCA]))[0]?.n).toBe(0);
  });

  it('o pedido do FDV recusado por cadastro não deixa linha nem número gasto', async () => {
    const T = await criarTenant(efemero.admin, 'fdv-recusa', ['pedido']);
    const recebedor = criarRecebedorFdv({ ...deps, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
    const r = await worker.comTenant(T, (tx) => recebedor.receber(tx, pedidoFdv({ cliente_id: IDS.desconhecido })));
    expect(r).toEqual({ resultado: 'recusado', codigo: 'cliente_inexistente' });
    expect((await admin('SELECT count(*)::int AS n FROM pedido.numeracao WHERE tenant_id = $1', [T]))[0]?.n).toBe(0);
  });

  const fdvPorPrazo = async (nome: string) => {
    const T = await criarTenant(efemero.admin, nome, ['pedido']);
    const recebedor = criarRecebedorFdv({ ...deps, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
    const r = await worker.comTenant(T, (tx) => recebedor.receber(tx, pedidoFdv()));
    expect(r).toMatchObject({ resultado: 'criado', status: 'em_analise' });
    return { T, id: (r as { pedido_id: string }).pedido_id };
  };
  const lerPedido = async (id: string) => (await admin('SELECT status, pendencias FROM pedido.pedido WHERE id = $1', [id]))[0];

  it('RN-CAD-17: fração em UN é recusada no SQL real (FDV: item_incoerente com motivo, manual: 422) sem gravar; em KG grava a quantidade fracionada', async () => {
    const T = await criarTenant(efemero.admin, 'fracao-rn-cad-17', ['pedido']);
    const recebedor = criarRecebedorFdv({ ...deps, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
    const item = { ...pedidoFdv().itens[0]!, quantidade: 15_000, quantidade_venda: 15_000, total_informado_centavos: 1500 };
    const fdv = pedidoFdv({ itens: [item], total_informado_centavos: 1500 });
    const manual = pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 15_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] });
    const contar = async () => Number((await admin('SELECT count(*) AS n FROM pedido.pedido WHERE tenant_id = $1', [T]))[0]!.n);
    expect(await worker.comTenant(T, (tx) => recebedor.receber(tx, fdv))).toMatchObject({ resultado: 'recusado', codigo: 'item_incoerente', motivo: expect.stringContaining('RN-CAD-17') });
    await expect(app.comTenant(T, (tx) => servico.lancar(tx, efeitos(tx, T), manual))).rejects.toMatchObject({ status: 422, codigo: 'RN-CAD-17' });
    expect(await contar()).toBe(0);
    unidadeDoProduto(cad, IDS.produto1, 'KG');
    try {
      const r = await worker.comTenant(T, (tx) => recebedor.receber(tx, fdv));
      expect(r).toMatchObject({ resultado: 'criado', status: 'aprovado' });
      expect((await admin('SELECT quantidade::text AS q FROM pedido.pedido_item WHERE pedido_id = $1', [(r as { pedido_id: string }).pedido_id]))[0]!.q).toBe('15000');
    } finally {
      unidadeDoProduto(cad, IDS.produto1, 'UN');
    }
  });

  it('RN-PED-07 e RN-PED-03: FDV em análise por prazo aprovado no SQL real: a pendência de prazo fica bloqueante=false e a aceitação (justificativa) em pedido.aprovacao', async () => {
    prazoDoCliente(cad, 10);
    try {
      const { T, id } = await fdvPorPrazo('fdv-prazo-aprova');
      await expect(app.comTenant(T, (tx) => servico.aprovar(tx, efeitos(tx, T), id, {}))).rejects.toMatchObject({ status: 400 });
      await app.comTenant(T, (tx) => servico.aprovar(tx, efeitos(tx, T), id, { justificativa: 'Prazo combinado com o comercial' }));
      expect(await lerPedido(id)).toMatchObject({ status: 'aprovado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
      expect((await admin('SELECT decisao, automatica, justificativa, pendencias_aceitas FROM pedido.aprovacao WHERE pedido_id = $1', [id]))[0])
        .toMatchObject({ decisao: 'aprovado', automatica: false, justificativa: 'Prazo combinado com o comercial', pendencias_aceitas: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
      expect((await admin('SELECT nome FROM plataforma.evento WHERE tenant_id = $1 ORDER BY ocorrido_em, versao', [T])).map((l) => l.nome).sort()).toEqual(['pedido.pedido.aprovado@1', 'pedido.pedido.recebido@1']);
      // aprovado com a pendência aceita cancela (RN-PED-02): o cancelado do FDV guarda as pendências
      await app.comTenant(T, (tx) => servico.cancelar(tx, efeitos(tx, T), id, { motivo_codigo: 'erro_lancamento', motivo_texto: null }));
      expect(await lerPedido(id)).toMatchObject({ status: 'cancelado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
    } finally {
      prazoDoCliente(cad, null);
    }
  });

  it('RN-PED-07: FDV em análise por prazo recusado no SQL real: a pendência de prazo segue gravada e o motivo fica em pedido.aprovacao', async () => {
    prazoDoCliente(cad, 10);
    try {
      const { T, id } = await fdvPorPrazo('fdv-prazo-recusa');
      await app.comTenant(T, (tx) => servico.recusar(tx, efeitos(tx, T), id, { motivo_codigo: 'cliente_bloqueado', motivo_texto: null }));
      expect(await lerPedido(id)).toMatchObject({ status: 'recusado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: true }] });
      expect((await admin('SELECT decisao, motivo_codigo FROM pedido.aprovacao WHERE pedido_id = $1', [id]))[0]).toMatchObject({ decisao: 'recusado', motivo_codigo: 'cliente_bloqueado' });
    } finally {
      prazoDoCliente(cad, null);
    }
  });

  it('RN-PED-07 e RN-PED-02: FDV em análise por prazo não cancela direto (422); aprovado com a pendência aceita cancela no SQL real, guardando as pendências', async () => {
    prazoDoCliente(cad, 10);
    try {
      const { T, id } = await fdvPorPrazo('fdv-prazo-cancela');
      await expect(app.comTenant(T, (tx) => servico.cancelar(tx, efeitos(tx, T), id, { motivo_codigo: 'erro_lancamento', motivo_texto: null }))).rejects.toMatchObject({ status: 422, codigo: 'RN-PED-02' });
      await app.comTenant(T, (tx) => servico.aprovar(tx, efeitos(tx, T), id, { justificativa: 'ok' }));
      await app.comTenant(T, (tx) => servico.cancelar(tx, efeitos(tx, T), id, { motivo_codigo: 'erro_lancamento', motivo_texto: null }));
      expect(await lerPedido(id)).toMatchObject({ status: 'cancelado', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: false }] });
    } finally {
      prazoDoCliente(cad, null);
    }
  });

  it('RN-PED-07: o pedido do FDV com prazo acima do cliente entra em análise no SQL real, com a pendência gravada e só recebido@1 na outbox', async () => {
    const T = await criarTenant(efemero.admin, 'fdv-prazo', ['pedido']);
    prazoDoCliente(cad, 10);
    try {
      const recebedor = criarRecebedorFdv({ ...deps, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: new RelogioFixo(AGORA) });
      const r = await worker.comTenant(T, (tx) => recebedor.receber(tx, pedidoFdv()));
      expect(r).toMatchObject({ resultado: 'criado', status: 'em_analise' });
      const id = (r as { pedido_id: string }).pedido_id;
      expect((await admin('SELECT status, pendencias FROM pedido.pedido WHERE id = $1', [id]))[0]).toMatchObject({ status: 'em_analise', pendencias: [{ codigo: 'prazo_acima_do_cliente', bloqueante: true }] });
      expect((await admin("SELECT nome FROM plataforma.evento WHERE tenant_id = $1 ORDER BY ocorrido_em, versao", [T])).map((l) => l.nome)).toEqual(['pedido.pedido.recebido@1']);
    } finally {
      prazoDoCliente(cad, null);
    }
  });

  it('criarConsultaParaFaturar: situação com os itens, FOR SHARE segura a transição concorrente, e outro tenant não enxerga', async () => {
    const T = await criarTenant(efemero.admin, 'faturar', ['pedido']);
    const p = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 30_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    const consulta = criarConsultaParaFaturar();
    expect(await app.comTenant(T, (tx) => consulta.situacao(tx, p.id))).toEqual({ status: 'aprovado', itens: [{ sequencia: 1, quantidade: 30_000, quantidade_faturada: 0 }] });
    expect(SituacaoPedidoParaFaturar.safeParse(await app.comTenant(T, (tx) => consulta.situacao(tx, p.id))).success).toBe(true);
    expect(await app.comTenant(A, (tx) => consulta.situacao(tx, p.id))).toBeNull();
    expect(await app.comTenant(T, (tx) => consulta.situacao(tx, IDS.desconhecido))).toBeNull();
    const segurou = barreira(2);
    const faturando = app.comTenant(T, async (tx) => {
      await consulta.situacao(tx, p.id);
      await segurou();
      await new Promise((r) => setTimeout(r, 400));
    });
    const cancelando = app.comTenant(T, async (tx) => {
      await segurou();
      await tx.consultar("SET LOCAL lock_timeout = '150ms'");
      return repositorioSql(tx).obterParaAtualizar(p.id);
    }).catch((e: unknown) => e);
    const [, r] = await Promise.all([faturando, cancelando]);
    expect(r).toMatchObject({ code: '55P03' });
  });

  it('T-0015: nota parcial e depois total leva a faturado; reprocessar não duplica; faturado@1 copia conta_como_real; o worker tem o GRANT e o app não', async () => {
    const T = await criarTenant(efemero.admin, 'nota-autorizada', ['pedido']);
    const p = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 30_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    const alertas: string[] = [];
    const [consumidor] = consumidoresDoPedido({ outbox: new OutboxPg(), relogio: new RelogioFixo(AGORA), alertar: (_t, codigo) => void alertas.push(codigo) });
    const nota = (n: number, quantidade: number, extra: Record<string, unknown> = {}) => criarEvento({
      nome: 'faturamento.nota.autorizada@1', tenant_id: T, agregado_id: `00000000-0000-4000-8000-00000000010${n}`, ator: 'sistema', request_id: 'req-nota',
      payload: {
        pedido_id: p.id, ambiente: 'homologacao', conta_como_real: true,
        nota: { id: `00000000-0000-4000-8000-00000000010${n}`, numero: n, serie: 1, chave_acesso: '2'.repeat(44), emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: quantidade / 10 },
        itens: [{ sequencia: 1, quantidade, valor_centavos: quantidade / 10 }], ...extra,
      },
    }, AGORA);
    const aplicar = (e: ReturnType<typeof nota>) => worker.comTenant(T, (tx) => consumidor!.tratar(e, tx));
    const parcial = nota(1, 10_000);
    await aplicar(parcial);
    await aplicar(parcial); // reprocesso: mesmo evento, nada muda
    expect((await admin('SELECT status, valor_faturado_centavos::int AS v FROM pedido.pedido WHERE id = $1', [p.id]))[0]).toEqual({ status: 'faturado_parcial', v: 1000 });
    await aplicar(nota(2, 20_000, { conta_como_real: false }));
    expect((await admin('SELECT status, valor_faturado_centavos::int AS v FROM pedido.pedido WHERE id = $1', [p.id]))[0]).toEqual({ status: 'faturado', v: 3000 });
    expect((await admin('SELECT quantidade_faturada::int AS q FROM pedido.pedido_item WHERE pedido_id = $1', [p.id]))).toEqual([{ q: 30_000 }]);
    expect(await admin('SELECT de, para, ator_tipo, ator_id FROM pedido.pedido_evento WHERE pedido_id = $1 AND para = ANY($2::pedido.status[]) ORDER BY ocorrido_em, created_at', [p.id, ['faturado_parcial', 'faturado']]))
      .toEqual([{ de: 'aprovado', para: 'faturado_parcial', ator_tipo: 'sistema', ator_id: null }, { de: 'faturado_parcial', para: 'faturado', ator_tipo: 'sistema', ator_id: null }]);
    const faturados = await admin("SELECT id, payload->'payload' AS p FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'pedido.pedido.faturado@1' ORDER BY versao", [p.id]);
    expect(faturados.map((f) => [f.id, f.p.status, f.p.ambiente, f.p.conta_como_real])).toEqual([
      [idFaturadoDaNota('00000000-0000-4000-8000-000000000101'), 'faturado_parcial', 'homologacao', true],
      [idFaturadoDaNota('00000000-0000-4000-8000-000000000102'), 'faturado', 'homologacao', false],
    ]);
    // saldo esgotado (já faturado): outra nota é recusada, alerta, NÃO lança e não grava nada
    const antes = (await admin('SELECT count(*)::int AS n FROM pedido.pedido_evento WHERE pedido_id = $1', [p.id]))[0]?.n;
    await aplicar(nota(3, 10_000));
    expect(alertas).toEqual(['status_invalido']);
    expect((await admin('SELECT count(*)::int AS n FROM pedido.pedido_evento WHERE pedido_id = $1', [p.id]))[0]?.n).toBe(antes);
    // GRANT: o worker atualiza as colunas do faturado; o app não
    await expect(app.comTenant(T, (tx) => tx.consultar('UPDATE pedido.pedido_item SET quantidade_faturada = 0 WHERE pedido_id = $1', [p.id]))).rejects.toMatchObject({ code: '42501' });
    await expect(app.comTenant(T, (tx) => tx.consultar('UPDATE pedido.pedido SET valor_faturado_centavos = 0 WHERE id = $1', [p.id]))).rejects.toMatchObject({ code: '42501' });
    // pedido de outro tenant não é tocado pela nota (RLS): ignorada
    await worker.comTenant(B, (tx) => consumidor!.tratar(nota(4, 10_000), tx));
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [p.id]))[0]?.status).toBe('faturado');
  });

  it('T-0015: consumidor completo com o papel worker (FOR UPDATE, gatilho validar_status, GRANT); pedido cancelado recusa, alerta e não lança', async () => {
    const T = await criarTenant(efemero.admin, 'nota-recusa', ['pedido']);
    const p = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 20_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    const alertas: { codigo: string; contexto?: Record<string, string> }[] = [];
    const [consumidor] = consumidoresDoPedido({ outbox: new OutboxPg(), relogio: new RelogioFixo(AGORA), alertar: (_t, codigo, contexto) => void alertas.push({ codigo, ...(contexto ? { contexto } : {}) }) });
    const nota = (n: number, quantidade: number) => criarEvento({
      nome: 'faturamento.nota.autorizada@1', tenant_id: T, agregado_id: `00000000-0000-4000-8000-00000000020${n}`, ator: 'sistema', request_id: 'req-nota',
      payload: {
        pedido_id: p.id, ambiente: 'producao', conta_como_real: true,
        nota: { id: `00000000-0000-4000-8000-00000000020${n}`, numero: n, serie: 1, chave_acesso: '3'.repeat(44), emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: quantidade / 10 },
        itens: [{ sequencia: 1, quantidade, valor_centavos: quantidade / 10 }],
      },
    }, AGORA);
    const aplicar = (e: ReturnType<typeof nota>) => worker.comTenant(T, (tx) => consumidor!.tratar(e, tx));
    await aplicar(nota(1, 10_000));
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [p.id]))[0]?.status).toBe('faturado_parcial');
    await aplicar(nota(2, 10_000));
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [p.id]))[0]?.status).toBe('faturado');
    expect(alertas).toEqual([]);
    // pedido cancelado (outro pedido, ainda aprovado): a nota é recusada sem lançar
    const q = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    await app.comTenant(T, (tx) => servico.cancelar(tx, efeitos(tx, T), q.id, { motivo_codigo: 'erro_lancamento', motivo_texto: null }));
    const recusada = criarEvento({ ...nota(3, 10_000), nome: 'faturamento.nota.autorizada@1', tenant_id: T, agregado_id: q.id, ator: 'sistema', request_id: 'req-nota', payload: { ...(nota(3, 10_000).payload as Record<string, unknown>), pedido_id: q.id } }, AGORA);
    await expect(aplicar(recusada)).resolves.toBeUndefined();
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ codigo: 'status_invalido', contexto: { pedido_id: q.id } });
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [q.id]))[0]?.status).toBe('cancelado');
    expect((await admin("SELECT count(*)::int AS n FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'pedido.pedido.faturado@1'", [q.id]))[0]?.n).toBe(0);
  });

  it('T-0015 RN-PED-02: cancelar com nota autorizada ainda não aplicada dá 422; aplicada pelo consumidor, cancela o saldo', async () => {
    const T = await criarTenant(efemero.admin, 'nota-cancelar', ['pedido']);
    const p = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 30_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    const N1 = '00000000-0000-4000-8000-000000000401';
    const N2 = '00000000-0000-4000-8000-000000000402';
    let autorizadas = [N1, N2];
    const comPorta = criarServico({ ...deps, notas: { temNotaEmAutorizacao: async () => false, notasAutorizadas: async () => autorizadas } });
    const cancelar = () => app.comTenant(T, (tx) => comPorta.cancelar(tx, efeitos(tx, T), p.id, { motivo_codigo: 'erro_lancamento', motivo_texto: null }));
    const [consumidor] = consumidoresDoPedido({ outbox: new OutboxPg(), relogio: new RelogioFixo(AGORA), alertar: () => undefined });
    const nota = criarEvento({
      nome: 'faturamento.nota.autorizada@1', tenant_id: T, agregado_id: N1, ator: 'sistema', request_id: 'req-nota',
      payload: {
        pedido_id: p.id, ambiente: 'homologacao', conta_como_real: true,
        nota: { id: N1, numero: 1, serie: 1, chave_acesso: '4'.repeat(44), emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 1000 },
        itens: [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1000 }],
      },
    }, AGORA);
    await worker.comTenant(T, (tx) => consumidor!.tratar(nota, tx));
    // N1 aplicada, N2 não: só N2 é pendente
    await expect(cancelar()).rejects.toMatchObject({ status: 422, codigo: 'RN-PED-02', detalhes: { notas_pendentes: [N2] } });
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [p.id]))[0]?.status).toBe('faturado_parcial');
    autorizadas = [N1];
    await expect(cancelar()).resolves.toMatchObject({ status: 'cancelado' });
  });

  it('T-0015 (0027): nota cancelada recua o pedido com o papel worker, sem publicar evento; reprocesso não duplica; o app não recua', async () => {
    const T = await criarTenant(efemero.admin, 'nota-cancelada', ['pedido']);
    const p = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 30_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }, { produto_id: IDS.produto2, quantidade: 10_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    const alertas: { codigo: string; contexto?: Record<string, string> }[] = [];
    const [autorizada, cancelada] = consumidoresDoPedido({ outbox: new OutboxPg(), relogio: new RelogioFixo(AGORA), alertar: (_t, codigo, contexto) => void alertas.push({ codigo, ...(contexto ? { contexto } : {}) }) });
    const nid = (n: number) => `00000000-0000-4000-8000-00000000030${n}`;
    const itensDe = (seq: number, quantidade: number) => [{ sequencia: seq, quantidade, valor_centavos: quantidade / 10 }];
    const evento = (nome: string, n: number, itens: unknown, id?: string) => criarEvento({
      nome, tenant_id: T, agregado_id: nid(n), ator: 'sistema', request_id: 'req-nota',
      payload: { pedido_id: p.id, ambiente: 'homologacao', nota: { id: nid(n), numero: n, serie: 1, chave_acesso: '4'.repeat(44), emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 1 }, itens },
    }, AGORA, id);
    const tratar = (c: typeof autorizada, e: ReturnType<typeof evento>) => worker.comTenant(T, (tx) => c!.tratar(e, tx));
    const estado = async () => (await admin('SELECT status, valor_faturado_centavos::int AS v, (SELECT string_agg(quantidade_faturada::int::text, \',\' ORDER BY sequencia) FROM pedido.pedido_item WHERE pedido_id = $1) AS q FROM pedido.pedido WHERE id = $1', [p.id]))[0];
    const faturados = () => admin("SELECT count(*)::int AS n FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'pedido.pedido.faturado@1'", [p.id]);
    // cancelada antes de qualquer autorizada: alerta e não mexe
    await tratar(cancelada, evento('faturamento.nota.cancelada@1', 1, itensDe(1, 30_000)));
    expect(alertas.map((a) => a.codigo)).toEqual(['nota_cancelada_sem_aplicacao']);
    expect((await estado())?.status).toBe('aprovado');
    // duas notas autorizadas levam a faturado
    await tratar(autorizada, evento('faturamento.nota.autorizada@1', 1, itensDe(1, 30_000)));
    await tratar(autorizada, evento('faturamento.nota.autorizada@1', 2, itensDe(2, 10_000)));
    expect(await estado()).toEqual({ status: 'faturado', v: 4000, q: '30000,10000' });
    const antes = (await faturados())[0]?.n;
    // faturado → faturado_parcial → aprovado, por duas canceladas
    const c1 = evento('faturamento.nota.cancelada@1', 1, itensDe(1, 30_000));
    await tratar(cancelada, c1);
    await tratar(cancelada, evento('faturamento.nota.cancelada@1', 1, itensDe(1, 30_000))); // reprocesso: outro evento da mesma nota
    expect(await estado()).toEqual({ status: 'faturado_parcial', v: 1000, q: '0,10000' });
    await tratar(cancelada, evento('faturamento.nota.cancelada@1', 2, itensDe(2, 10_000)));
    expect(await estado()).toEqual({ status: 'aprovado', v: 0, q: '0,0' });
    expect(alertas.map((a) => a.codigo)).toEqual(['nota_cancelada_sem_aplicacao']);
    // histórico: ator sistema, motivo nota_cancelada, uma linha por nota; nenhum faturado@1 novo
    expect(await admin("SELECT de, para, ator_tipo, motivo_codigo FROM pedido.pedido_evento WHERE pedido_id = $1 AND motivo_codigo = 'nota_cancelada' ORDER BY ocorrido_em, created_at", [p.id]))
      .toEqual([{ de: 'faturado', para: 'faturado_parcial', ator_tipo: 'sistema', motivo_codigo: 'nota_cancelada' }, { de: 'faturado_parcial', para: 'aprovado', ator_tipo: 'sistema', motivo_codigo: 'nota_cancelada' }]);
    expect((await faturados())[0]?.n).toBe(antes);
    expect((await admin("SELECT current_setting('macuxierp.recuo_nota', true) AS g"))[0]?.g ?? '').not.toBe('on');
    // faturado_parcial → aprovado direto: nota 3 fatura parte, nota 3 cancelada
    const q = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 30_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    const sobre = (nome: string, n: number) => criarEvento({
      nome, tenant_id: T, agregado_id: nid(n), ator: 'sistema', request_id: 'req-nota',
      payload: { pedido_id: q.id, ambiente: 'homologacao', nota: { id: nid(n), numero: n, serie: 1, chave_acesso: '5'.repeat(44), emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 1 }, itens: itensDe(1, 10_000) },
    }, AGORA);
    await tratar(autorizada, sobre('faturamento.nota.autorizada@1', 7));
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [q.id]))[0]?.status).toBe('faturado_parcial');
    // o app (sem o papel de worker) não recua, nem com o GUC ligado: com o estado coerente para aprovado, o gatilho recusa (MXP02)
    await admin('UPDATE pedido.pedido_item SET quantidade_faturada = 0 WHERE pedido_id = $1', [q.id]);
    await admin('UPDATE pedido.pedido SET valor_faturado_centavos = 0 WHERE id = $1', [q.id]);
    await expect(app.comTenant(T, async (tx) => {
      await tx.consultar("SELECT set_config('macuxierp.recuo_nota', 'on', true)");
      await tx.consultar("UPDATE pedido.pedido SET status = 'aprovado' WHERE id = $1", [q.id]);
    })).rejects.toMatchObject({ code: 'MXP02' });
    expect((await admin('SELECT status FROM pedido.pedido WHERE id = $1', [q.id]))[0]?.status).toBe('faturado_parcial');
    await admin('UPDATE pedido.pedido_item SET quantidade_faturada = 10000 WHERE pedido_id = $1', [q.id]);
    await admin('UPDATE pedido.pedido SET valor_faturado_centavos = 1000 WHERE id = $1', [q.id]);
    await tratar(cancelada, sobre('faturamento.nota.cancelada@1', 7));
    expect((await admin('SELECT status, valor_faturado_centavos::int AS v FROM pedido.pedido WHERE id = $1', [q.id]))[0]).toEqual({ status: 'aprovado', v: 0 });
    // repo direto com valor incoerente (aprovado com faturado > 0): o gatilho recusa, o savepoint é desfeito e a mesma transação segue utilizável
    const r = (await lancar(T, pedidoManual({ itens: [{ produto_id: IDS.produto1, quantidade: 30_000, preco_unitario_centavos: 1000, desconto_centavos: 0 }] }))).pedido;
    await tratar(autorizada, { ...sobre('faturamento.nota.autorizada@1', 8), payload: { ...(sobre('faturamento.nota.autorizada@1', 8).payload as Record<string, unknown>), pedido_id: r.id } } as ReturnType<typeof evento>);
    await worker.comTenant(T, async (tx) => {
      await expect(repositorioSql(tx).aplicarRecuo(r.id, [{ sequencia: 1, quantidade_faturada: 10_000 }], 1000, 'aprovado')).rejects.toBeInstanceOf(RecuoRecusadoPeloBanco);
      const guc = (await tx.consultar<{ g: string | null }>("SELECT current_setting('macuxierp.recuo_nota', true) AS g"))[0]?.g ?? '';
      expect(['', 'off']).toContain(guc);
      expect((await tx.consultar<{ status: string }>('SELECT status FROM pedido.pedido WHERE id = $1', [r.id]))[0]?.status).toBe('faturado_parcial');
    });
  });

  it('RN-CORE-07: a exportação LGPD traz as 5 tabelas do schema pedido, só do tenant, com o item retirado e o retrato do cliente', async () => {
    const saida = await worker.comTenant(A, (tx) => exportadorPedido.exportar(tx));
    expect(Object.keys(saida)).toEqual(['numeracao', 'pedido', 'pedido_item', 'pedido_evento', 'aprovacao']);
    for (const [t, linhas] of Object.entries(saida)) {
      expect(linhas.length, t).toBeGreaterThan(0);
      expect((linhas as { tenant_id: string }[]).every((l) => l.tenant_id === A), t).toBe(true);
    }
    expect((saida.pedido as { cliente_retrato: { documento: string } }[])[0]?.cliente_retrato.documento).toBe('52998224725');
    expect(exportadorPedido.modulo).toBe('pedido');
  });
});
