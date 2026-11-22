/**
 * Eventos fiscais contra o PostgreSQL real (migrações 0013 e 0020): nota_evento, inutilizacao, numero_inutilizado e nota_xml (procEventoNFe e
 * procInutNFe, só INSERT), com a porta `EmissorNFe` de mentira (a ponta a ponta com o emissor real e o simulador está em `eventos-simulador.test.ts`).
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import type { EmissorNFe } from '@macuxierp/nfe-emissor';
import type { ProtocoloEvento } from '@macuxierp/nfe-sefaz';
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { a1DeTeste, depsFake, protocolo, transporteFake, uuid } from './apoio-teste';
import { criarServicoEmissao } from './emissao';
import { criarServicoEventos } from './eventos';
import { criarProcessadorEventos } from './processador-eventos';
import { pedidosAprovadosSql, repositoriosSql } from './sql';
import { criarServicoTitulos } from './titulos';
import { criarTransmissor } from './transmissor';

const PROT = '113260000000888';
const JUST = 'Cliente desistiu da compra do pedido';

describe.skipIf(!PG_DISPONIVEL)('eventos fiscais (PostgreSQL real, migrações 0013 e 0020)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const repos = repositoriosSql({ outbox: new OutboxPg(), agora: () => new Date('2026-11-21T14:30:00Z') });
  const pedido = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
  pedido.pedido.condicao_pagamento_id = uuid(77);
  const f = depsFake({ ambiente: 'homologacao' });
  Object.assign(f.deps, { notas: repos.notas, pedidos: repos.pedidos, ambiente: repos.ambiente });
  const emissao = criarServicoEmissao(f.deps);
  const AUTORIZADA_EM = new Date('2026-11-21T14:31:02Z'); // o dhRecbto do transporte de teste

  const svc = (agora: Date) => criarServicoEventos({ eventos: repos.eventos, cadastros: f.deps.cadastros, ambiente: repos.ambiente, certificado: { temA1Ativo: async () => ({ valido: true, valido_ate: '2027-11-21T00:00:00.000Z', dias_para_vencer: 365 }) }, agora: () => agora });
  const emissor = (cStat = '135') => ({
    ...f.emissor,
    async cancelar(p) {
      return { tpAmb: 2 as const, verAplic: 'S', cStat: '128', xMotivo: 'ok', cOrgao: 13, idLote: '1', xml: '<retEnvEvento/>', eventos: [ev(p.chNFe, '110111', 1, cStat)], assinado: { xml: '<evento versao="1.00"><infEvento Id="ID1"><tpEvento>110111</tpEvento></infEvento></evento>', digVal: 'ZGln' } };
    },
    async cartaCorrecao(p) {
      return { tpAmb: 2 as const, verAplic: 'S', cStat: '128', xMotivo: 'ok', cOrgao: 13, idLote: '1', xml: '<retEnvEvento/>', eventos: [ev(p.chNFe, '110110', p.nSeqEvento, cStat)], assinado: { xml: `<evento versao="1.00"><infEvento Id="ID${p.nSeqEvento}"><tpEvento>110110</tpEvento></infEvento></evento>`, digVal: 'ZGln' } };
    },
    async inutilizar(p) {
      const ok = cStat === '135';
      return { tpAmb: 2 as const, verAplic: 'S', cStat: ok ? '102' : cStat, xMotivo: 'x', cUF: 13, dhRecbto: '2026-11-21T22:40:00-04:00', nProt: ok ? PROT : null, ano: '26', CNPJ: null, mod: null, serie: null, nNFIni: p.nNFIni, nNFFin: p.nNFFin, xml: '<retInutNFe/>', assinado: { xml: '<inutNFe versao="4.00"><infInut Id="ID1"/></inutNFe>', digVal: 'ZGln' } };
    },
  } as EmissorNFe);
  const ev = (chNFe: string, tpEvento: '110111' | '110110', nSeqEvento: number, cStat: string): ProtocoloEvento => ({
    tpAmb: 2, verAplic: 'S', cStat, xMotivo: 'Evento registrado', chNFe, tpEvento, nSeqEvento, dhRegEvento: '2026-11-21T22:40:00-04:00', nProt: cStat === '135' ? PROT : null, xml: '<retEvento versao="1.00"/>',
  });
  const proc = (cStat = '135', log: (e: object) => void = () => undefined) =>
    criarProcessadorEventos({ banco: worker, notas: repos.notas, titulos: repos.titulos, log, eventos: repos.eventos, cadastros: f.deps.cadastros, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), emissor: emissor(cStat), sefaz: () => transporteFake().transporte, agora: () => new Date('2026-11-21T22:40:00Z') });

  let idem = 0;
  /** Emite e autoriza (transporte de teste): devolve a nota autorizada. */
  async function autorizada() {
    const r = await app.comTenant(A, (tx) => emissao.emitirNota(tx, A, { pedido_id: IDS.pedido, idempotencia: `idem-evdb-${++idem}` }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const t = transporteFake();
    const tr = criarTransmissor({ log: () => undefined, banco: worker, notas: repos.notas, titulos: repos.titulos, emissor: f.emissor, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), sefaz: () => t.transporte, agora: () => AUTORIZADA_EM });
    expect((await tr.transmitirNota(A, r.nota.id)).resultado).toBe('autorizada');
    return (await app.comTenant(A, (tx) => repos.notas.obter(tx, r.nota.id)))!;
  }
  const pedirCancelamento = (nota: Awaited<ReturnType<typeof autorizada>>, agora = new Date(AUTORIZADA_EM.getTime() + 3_600_000)) =>
    app.comTenant(A, (tx) => svc(agora).pedirCancelamento(tx, nota, { justificativa: JUST }));

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    A = await criarTenant(efemero.admin, 'fat-eventos', ['faturamento']);
    await app.comTenant(A, (tx) => pedidosAprovadosSql.gravar(tx, pedido));
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-FAT-02: cancelamento: o pedido nasce pendente, o worker guarda o procEventoNFe e o gatilho registra o evento e cancela a nota (cancelada_em = dhRegEvento)', async () => {
    const nota = await autorizada();
    const r = await pedirCancelamento(nota);
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect((await admin('SELECT status FROM faturamento.nota_evento WHERE id = $1', [r.evento.id]))[0]).toMatchObject({ status: 'pendente' });
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'autorizada' });
    expect(await proc().processarEvento(A, r.evento.id)).toMatchObject({ resultado: 'registrado' });
    const [n] = await admin('SELECT status, cancelada_em FROM faturamento.nota WHERE id = $1', [nota.id]);
    expect(n).toMatchObject({ status: 'cancelada' });
    expect(new Date(n?.cancelada_em).toISOString()).toBe('2026-11-22T02:40:00.000Z');
    const [e] = await admin('SELECT status, protocolo FROM faturamento.nota_evento WHERE id = $1', [r.evento.id]);
    expect(e).toMatchObject({ status: 'registrado', protocolo: PROT });
    const [x] = await admin("SELECT tipo, xml FROM faturamento.nota_xml WHERE evento_id = $1", [r.evento.id]);
    expect(x?.tipo).toBe('evento_cancelamento');
    expect(x?.xml).toContain('<procEventoNFe');
    await expect(admin("UPDATE faturamento.nota_xml SET xml = 'x' WHERE evento_id = $1", [r.evento.id])).rejects.toThrow(/imutável/);
    const ev = await admin("SELECT nome, payload FROM plataforma.evento WHERE nome = 'faturamento.nota.cancelada@1' AND agregado_id = $1", [nota.id]);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.payload.payload).toMatchObject({ protocolo_cancelamento: PROT, motivo: JUST });
    expect(await admin("SELECT 1 FROM faturamento.transmissao WHERE evento_id = $1 AND servico = 'evento'", [r.evento.id])).toHaveLength(1);
    // evento registrado não é processado de novo, e a nota cancelada não recebe outro
    expect(await proc().processarEvento(A, r.evento.id)).toEqual({ resultado: 'ignorada', motivo: 'nao_pendente' });
  });

  it('RN-FAT-06: o cancelamento da nota cancela os títulos abertos sem baixa, na mesma tx do evento', async () => {
    const nota = await autorizada();
    expect(await app.comTenant(A, (tx) => repos.titulos.listarDaNota(tx, nota.id))).toHaveLength(2);
    const r = await pedirCancelamento(nota);
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(await proc().processarEvento(A, r.evento.id)).toMatchObject({ resultado: 'registrado', titulos: { cancelados: 2, divergentes: [] } });
    expect((await app.comTenant(A, (tx) => repos.titulos.listarDaNota(tx, nota.id))).map((t) => t.status)).toEqual(['cancelado', 'cancelado']);
  });

  it('RN-FAT-06: com baixa o cancelamento da nota NÃO é bloqueado: a parcela baixada fica como está, é registrada como divergência (log sem dado pessoal) e as outras são canceladas', async () => {
    const nota = await autorizada();
    const [t1, t2] = await app.comTenant(A, (tx) => repos.titulos.listarDaNota(tx, nota.id));
    await app.comTenant(A, (tx) => criarServicoTitulos({ titulos: repos.titulos, notas: repos.notas }).baixar(tx, t1!.id, { valor_centavos: 500, forma: 'pix' }, null));
    const logs: object[] = [];
    const r = await pedirCancelamento(nota);
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(await proc('135', (e) => logs.push(e)).processarEvento(A, r.evento.id)).toMatchObject({ resultado: 'registrado', titulos: { cancelados: 1, divergentes: [{ id: t1!.id, parcela: 1 }] } });
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'cancelada' });
    expect((await admin('SELECT id, status, saldo_centavos::float8 AS saldo FROM faturamento.titulo WHERE nota_id = $1 ORDER BY parcela', [nota.id])).map((t) => [t.status, t.id === t1!.id ? t.saldo : null])).toEqual([['aberto', t1!.valor_centavos - 500], ['cancelado', null]]);
    expect(logs).toEqual([{ evento: 'faturamento.titulo.divergencia_cancelamento', tenant_id: A, nota_id: nota.id, titulos_divergentes: 1 }]);
    expect(t2!.status).toBe('aberto');
    expect(JSON.stringify(logs)).not.toMatch(/cpf|cnpj|nome/i);
  });

  it('RN-FAT-02: cancelamento fora do prazo de 24 h da autorização é recusado (a data vem do banco) e nada é gravado', async () => {
    const nota = await autorizada();
    expect(nota.autorizada_em).toBe(AUTORIZADA_EM.toISOString());
    const r = await pedirCancelamento(nota, new Date(AUTORIZADA_EM.getTime() + 25 * 3_600_000));
    expect(r).toMatchObject({ ok: false, violacoes: [{ campo: 'prazo' }] });
    expect(await admin('SELECT 1 FROM faturamento.nota_evento WHERE nota_id = $1', [nota.id])).toHaveLength(0);
  });

  it('RN-FAT-02: rejeitado volta a pendente com a mesma sequência; a nota segue autorizada', async () => {
    const nota = await autorizada();
    const r = await pedirCancelamento(nota);
    if (!r.ok) throw new Error('esperava ok');
    expect(await proc('501').processarEvento(A, r.evento.id)).toMatchObject({ resultado: 'rejeitado', codigo: '501' });
    expect((await admin('SELECT status, c_stat FROM faturamento.nota_evento WHERE id = $1', [r.evento.id]))[0]).toMatchObject({ status: 'rejeitado', c_stat: 501 });
    const de_novo = await pedirCancelamento(nota);
    expect(de_novo).toMatchObject({ ok: true, evento: { id: r.evento.id, status: 'pendente', n_seq_evento: 1 } });
    expect(await admin('SELECT 1 FROM faturamento.nota_evento WHERE nota_id = $1', [nota.id])).toHaveLength(1);
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'autorizada' });
  });

  it('RN-FAT-02: CC-e em sequência (1, 2), a nota continua autorizada; a 21 é recusada pelo banco (limite de 20) e o salto de sequência também', async () => {
    const nota = await autorizada();
    const dep = svc(new Date(AUTORIZADA_EM.getTime() + 3_600_000));
    for (const s of [1, 2]) {
      const r = await app.comTenant(A, (tx) => dep.pedirCartaCorrecao(tx, nota, { texto: `Endereço de entrega: Rua de Teste, ${s}00` }));
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      expect(r.evento.n_seq_evento).toBe(s);
      expect(await proc().processarEvento(A, r.evento.id)).toMatchObject({ resultado: 'registrado' });
    }
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [nota.id]))[0]).toMatchObject({ status: 'autorizada' });
    expect(await admin("SELECT 1 FROM faturamento.nota_xml WHERE nota_id = $1 AND tipo = 'evento_cce'", [nota.id])).toHaveLength(2);
    await expect(app.comTenant(A, (tx) => repos.eventos.criarEvento(tx, { nota_id: nota.id, tipo: 'cce', n_seq_evento: 5, texto: 'Endereço de entrega: Rua X' }))).rejects.toThrow(/RN-FAT-02.*sequência 3/);
    for (let s = 3; s <= 20; s++) await app.comTenant(A, (tx) => repos.eventos.criarEvento(tx, { nota_id: nota.id, tipo: 'cce', n_seq_evento: s, texto: `Endereço de entrega: Rua ${s}` }));
    await expect(app.comTenant(A, (tx) => repos.eventos.criarEvento(tx, { nota_id: nota.id, tipo: 'cce', n_seq_evento: 21, texto: 'Endereço de entrega: Rua 21' }))).rejects.toThrow();
    expect(await admin("SELECT 1 FROM faturamento.nota_evento WHERE nota_id = $1 AND tipo = 'cce'", [nota.id])).toHaveLength(20);
  });

  it('RN-FAT-03: evento só em nota autorizada (rascunho, rejeitada ou cancelada o banco recusa)', async () => {
    const r = await app.comTenant(A, (tx) => emissao.emitirNota(tx, A, { pedido_id: IDS.pedido, idempotencia: `idem-evdb-nao-aut-${++idem}` }));
    if (!r.ok) throw new Error('esperava ok');
    await expect(app.comTenant(A, (tx) => repos.eventos.criarEvento(tx, { nota_id: r.nota.id, tipo: 'cancelamento', n_seq_evento: 1, texto: JUST }))).rejects.toThrow(/RN-FAT-03.*só em nota autorizada/);
  });

  it('RN-FAT-01: inutilização da faixa: pedido pendente avança a numeração, o worker guarda o procInutNFe, registra, e a nota rejeitada da faixa vira inutilizada', async () => {
    const t = transporteFake({ recibo: (c) => protocolo(c, { cStat: '778', xMotivo: 'Rejeicao: NCM inexistente', nProt: null, digVal: null }) });
    const rej = await app.comTenant(A, (tx) => emissao.emitirNota(tx, A, { pedido_id: IDS.pedido, idempotencia: `idem-evdb-rej-${++idem}` }));
    if (!rej.ok) throw new Error('esperava ok');
    const tr = criarTransmissor({ log: () => undefined, banco: worker, notas: repos.notas, titulos: repos.titulos, emissor: f.emissor, ambiente: repos.ambiente, lerA1: async () => a1DeTeste(), sefaz: () => t.transporte, agora: () => AUTORIZADA_EM });
    expect((await tr.transmitirNota(A, rej.nota.id)).resultado).toBe('rejeitada');
    const n = rej.nota.numero;
    const proximo = ((await admin('SELECT proximo FROM faturamento.serie_numeracao WHERE serie = 1'))[0] as { proximo: number }).proximo;
    const faixa = { filial_id: IDS.filial, numero_inicial: n, numero_final: proximo + 2, justificativa: 'Numeração pulada por falha do sistema' };
    const dep = svc(AUTORIZADA_EM);
    const r = await app.comTenant(A, (tx) => dep.pedirInutilizacao(tx, faixa));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(r.inutilizacao).toMatchObject({ status: 'pendente', serie: 1, ano: 2026 });
    expect((await admin('SELECT proximo FROM faturamento.serie_numeracao WHERE serie = 1'))[0]).toMatchObject({ proximo: proximo + 3 });
    expect(await admin('SELECT faturamento.numero_inutilizado($1, $2, $3, 55::smallint, 1::smallint, $4) AS v', [A, IDS.filial, 'homologacao', n])).toMatchObject([{ v: true }]);
    expect(await proc().processarInutilizacao(A, r.inutilizacao.id)).toEqual({ resultado: 'registrada', protocolo: PROT });
    expect((await admin('SELECT status, protocolo FROM faturamento.inutilizacao WHERE id = $1', [r.inutilizacao.id]))[0]).toMatchObject({ status: 'registrado', protocolo: PROT });
    expect((await admin("SELECT tipo, xml FROM faturamento.nota_xml WHERE inutilizacao_id = $1", [r.inutilizacao.id]))[0]?.xml).toContain('<ProcInutNFe');
    expect((await admin('SELECT status FROM faturamento.nota WHERE id = $1', [rej.nota.id]))[0]).toMatchObject({ status: 'inutilizada' });
  });

  it('RN-FAT-01: faixa sobreposta, final acima de proximo+99 e faixa com nota autorizada são recusadas; a rejeitada pela SEFAZ libera a faixa, mas o 563 (já inutilizada) a mantém reservada e pendente', async () => {
    await autorizada();
    const proximo = ((await admin('SELECT proximo FROM faturamento.serie_numeracao WHERE serie = 1'))[0] as { proximo: number }).proximo;
    const dep = svc(AUTORIZADA_EM);
    const faixa = (ini: number, fim: number) => ({ filial_id: IDS.filial, numero_inicial: ini, numero_final: fim, justificativa: 'Numeração pulada por falha do sistema' });
    const a = await app.comTenant(A, (tx) => dep.pedirInutilizacao(tx, faixa(proximo, proximo + 1)));
    if (!a.ok) throw new Error(JSON.stringify(a.violacoes));
    // sobreposição (a regra da 0013; o domain não conhece as outras inutilizações): recusa do banco, com a RN
    await expect(app.comTenant(A, (tx) => dep.pedirInutilizacao(tx, faixa(proximo + 1, proximo + 3)))).rejects.toThrow(/RN-FAT-01.*sobreposição/);
    expect(await app.comTenant(A, (tx) => dep.pedirInutilizacao(tx, faixa(proximo + 2, proximo + 2 + 100)))).toMatchObject({ ok: false, violacoes: [{ campo: 'numeroFinal' }] });
    expect(await app.comTenant(A, (tx) => dep.pedirInutilizacao(tx, faixa(proximo - 1, proximo - 1)))).toMatchObject({ ok: false, violacoes: [{ campo: 'notasNaFaixa' }] });
    // o banco também recusa o que o domain deixasse passar: faixa de nota autorizada
    await expect(app.comTenant(A, (tx) => repos.eventos.criarInutilizacao(tx, { filial_id: IDS.filial, ambiente: 'homologacao', serie: 1, ano: 2026, numero_inicial: proximo - 1, numero_final: proximo - 1, justificativa: 'Numeração pulada por falha do sistema' }))).rejects.toThrow(/RN-FAT-01.*nota que não está rejeitada/);
    // 563 (a SEFAZ já tem a faixa): NUNCA rejeita; fica pendente com o motivo, a faixa segue reservada e as notas não mudam
    expect(await proc('563').processarInutilizacao(A, a.inutilizacao.id)).toMatchObject({ resultado: 'divergente', codigo: '563' });
    expect((await admin('SELECT status, c_stat, x_motivo FROM faturamento.inutilizacao WHERE id = $1', [a.inutilizacao.id]))[0]).toMatchObject({ status: 'pendente', c_stat: 563, x_motivo: expect.stringContaining('ja_inutilizada_na_sefaz') });
    expect(await admin('SELECT faturamento.numero_inutilizado($1, $2, $3, 55::smallint, 1::smallint, $4) AS v', [A, IDS.filial, 'homologacao', proximo])).toMatchObject([{ v: true }]);
    expect(await admin('SELECT 1 FROM faturamento.nota_xml WHERE inutilizacao_id = $1', [a.inutilizacao.id])).toHaveLength(0);
    // o lease fechou com a resposta e a varredura não insiste na divergência
    expect(await admin(`SELECT 1 FROM faturamento.transmissao WHERE inutilizacao_id = $1 AND respondida_em IS NULL`, [a.inutilizacao.id])).toHaveLength(0);
    expect((await app.comTenant(A, (tx) => repos.eventos.pendentes(tx, 100, 0, 5))).filter((x) => x.id === a.inutilizacao.id)).toEqual([]);
    // a rejeição de verdade (256) libera a faixa para outra inutilização
    const b = await app.comTenant(A, (tx) => dep.pedirInutilizacao(tx, faixa(proximo + 2, proximo + 2)));
    if (!b.ok) throw new Error(JSON.stringify(b.violacoes));
    expect(await proc('256').processarInutilizacao(A, b.inutilizacao.id)).toMatchObject({ resultado: 'rejeitada', codigo: '256' });
    expect(await admin('SELECT faturamento.numero_inutilizado($1, $2, $3, 55::smallint, 1::smallint, $4) AS v', [A, IDS.filial, 'homologacao', proximo + 2])).toMatchObject([{ v: false }]);
  });

  it('RN-FAT-01: o lease de transmissão (transmissao sem respondida_em) barra a 2ª chamada e a varredura; o lease vencido ou fechado libera', async () => {
    await autorizada();
    const proximo = ((await admin('SELECT proximo FROM faturamento.serie_numeracao WHERE serie = 1'))[0] as { proximo: number }).proximo;
    const r = await app.comTenant(A, (tx) => svc(AUTORIZADA_EM).pedirInutilizacao(tx, { filial_id: IDS.filial, numero_inicial: proximo, numero_final: proximo, justificativa: 'Numeração pulada por falha do sistema' }));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const id = r.inutilizacao.id;
    const lease = { servico: 'inutilizacao' as const, inutilizacao_id: id, destino: 'simulador' as const, leaseMin: 5 };
    const l1 = await app.comTenant(A, (tx) => repos.eventos.iniciarTransmissao(tx, lease));
    expect(l1).not.toBeNull();
    expect(await app.comTenant(A, (tx) => repos.eventos.iniciarTransmissao(tx, lease))).toBeNull();
    const naVarredura = async (): Promise<boolean> => (await app.comTenant(A, (tx) => repos.eventos.pendentes(tx, 100, 0, 5))).some((x) => x.id === id);
    expect(await naVarredura()).toBe(false);
    // lease vencido (enviada há mais de 5 min): a varredura retoma
    await admin(`UPDATE faturamento.transmissao SET enviada_em = now() - interval '6 minutes' WHERE id = $1`, [l1!.id]);
    expect(await naVarredura()).toBe(true);
    // fechado com o retorno: uma linha por tentativa
    await app.comTenant(A, (tx) => repos.eventos.concluirTransmissao(tx, l1!.id, { cStat: '102', xMotivo: 'ok', respondida_em: new Date().toISOString(), duracao_ms: 10 }));
    expect((await admin('SELECT tentativa, c_stat FROM faturamento.transmissao WHERE id = $1', [l1!.id]))[0]).toMatchObject({ tentativa: 1, c_stat: 102 });
    expect(await app.comTenant(A, (tx) => repos.eventos.iniciarTransmissao(tx, lease))).not.toBeNull();
  });
});
