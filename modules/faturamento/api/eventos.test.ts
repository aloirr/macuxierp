/**
 * Eventos fiscais (cancelamento, CC-e, inutilização) e consulta, com repositório em memória que imita os gatilhos da 0013 e uma porta `EmissorNFe`
 * de mentira (o emissor real e o simulador ficam em `eventos-simulador.test.ts`). Confere a ORDEM da T-0018 §8: pedido pendente → porta FORA da tx →
 * XML guardado → status → evento publicado.
 */
import type { EmissorNFe, PedidoCancelamento, PedidoCartaCorrecao } from '@macuxierp/nfe-emissor';
import type { ProtocoloEvento, RespostaConsultaProtocolo, SefazTransporte } from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import type { Banco } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { a1DeTeste, depsFake, titulosFake, NPROT, transporteFake, tx, TENANT } from './apoio-teste';
import { criarServicoEmissao } from './emissao';
import { criarServicoEventos } from './eventos';
import { criarProcessadorEventos } from './processador-eventos';

const PROT_EVENTO = '113260000000777';
const AUTORIZADA_EM = INSTANTE_DE_TESTE.toISOString();
const AGORA = new Date(INSTANTE_DE_TESTE.getTime() + 3_600_000);

async function montar(opc: { agora?: Date; agoraWorker?: Date; semA1Api?: boolean; semA1Worker?: boolean } = {}) {
  const f = depsFake({ ambiente: 'homologacao' });
  const emitida = await criarServicoEmissao(f.deps).emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-ev-00001' });
  if (!emitida.ok) throw new Error(JSON.stringify(emitida.violacoes));
  const nota = emitida.nota;
  f.r.notas.set(nota.id, { ...nota, status: 'autorizada', protocolo: NPROT, autorizada_em: AUTORIZADA_EM });
  f.r.log.length = 0;

  const estado = { dentro: 0, chamadasForaDaTx: [] as boolean[], pedidos: [] as unknown[], pfxZerado: [] as boolean[] };
  const banco: Banco = {
    comTenant: async (_id, fn) => {
      estado.dentro++;
      try {
        return await fn(tx);
      } finally {
        estado.dentro--;
      }
    },
    semTenant: async (fn) => fn(tx),
    ping: async () => true,
  };
  const roteiro = { cStat: '135', falhar: false, duplicado: false, consultaEventos: [] as ProtocoloEvento[], consultaCStat: '100', consultaXml: '<retConsSitNFe/>' };
  const evento = (p: { chNFe: string; nSeqEvento: number }, tp: '110111' | '110110', cStat: string): ProtocoloEvento => ({
    tpAmb: 2, verAplic: 'SIMULADOR', cStat, xMotivo: cStat === '135' ? 'Evento registrado e vinculado a NF-e' : `Rejeicao ${cStat}`, chNFe: p.chNFe, tpEvento: tp, nSeqEvento: p.nSeqEvento,
    dhRegEvento: '2026-11-21T22:40:00-04:00', nProt: cStat === '135' || cStat === '155' ? PROT_EVENTO : null, xml: `<retEvento versao="1.00"><infEvento><cStat>${cStat}</cStat></infEvento></retEvento>`,
  });
  const resposta = (p: { chNFe: string; nSeqEvento: number }, tp: '110111' | '110110') => ({
    tpAmb: 2 as const, verAplic: 'SIMULADOR', cStat: '128', xMotivo: 'Lote de Evento Processado', cOrgao: 13, idLote: '1', xml: '<retEnvEvento/>',
    eventos: [evento(p, tp, roteiro.cStat)],
    assinado: { xml: `<evento versao="1.00"><infEvento Id="ID${tp}"><tpEvento>${tp}</tpEvento></infEvento></evento>`, digVal: 'ZGln' },
  });
  const emissor = {
    ...f.emissor,
    async cancelar(p: PedidoCancelamento) {
      estado.chamadasForaDaTx.push(estado.dentro === 0);
      estado.pedidos.push(p);
      if (roteiro.falhar) throw new Error('SEFAZ_INDISPONIVEL');
      return resposta({ chNFe: p.chNFe, nSeqEvento: 1 }, '110111');
    },
    async cartaCorrecao(p: PedidoCartaCorrecao) {
      estado.chamadasForaDaTx.push(estado.dentro === 0);
      estado.pedidos.push(p);
      return resposta({ chNFe: p.chNFe, nSeqEvento: p.nSeqEvento }, '110110');
    },
    async inutilizar(p) {
      estado.chamadasForaDaTx.push(estado.dentro === 0);
      estado.pedidos.push(p);
      const ok = roteiro.cStat === '135';
      return {
        tpAmb: 2 as const, verAplic: 'SIMULADOR', cStat: ok ? '102' : roteiro.cStat, xMotivo: ok ? 'Inutilizacao de numero homologado' : 'Rejeicao', cUF: 13, dhRecbto: '2026-11-21T22:41:00-04:00',
        nProt: ok ? PROT_EVENTO : null, ano: '26', CNPJ: null, mod: null, serie: null, nNFIni: null, nNFFin: null, xml: '<retInutNFe/>',
        assinado: { xml: '<inutNFe versao="4.00"><infInut Id="ID1"/></inutNFe>', digVal: 'ZGln' },
      };
    },
  } as EmissorNFe;
  const transp = transporteFake();
  const base = transp.transporte;
  const consulta: SefazTransporte = {
    ...base,
    async consultarProtocolo(p): Promise<RespostaConsultaProtocolo> {
      return {
        tpAmb: 2, verAplic: 'S', cStat: roteiro.consultaCStat, xMotivo: 'consulta', cUF: 13, chNFe: p.chNFe, dhRecbto: '2026-11-21T22:41:00-04:00', protocolo: null, eventos: roteiro.consultaEventos, xml: roteiro.consultaXml,
      };
    },
  };
  const proc = criarProcessadorEventos({
    banco,
    notas: f.r.repo, titulos: titulosFake().repo, log: () => undefined,
    eventos: f.ev.repo,
    cadastros: f.deps.cadastros,
    ambiente: { ambiente: async () => 'homologacao' },
    lerA1: async () => {
      if (opc.semA1Worker) return null;
      const a = a1DeTeste();
      estado.pfxZerado.push(false);
      pfxs.push(a.credencial.pfx);
      return a;
    },
    emissor,
    sefaz: () => consulta,
    agora: () => opc.agoraWorker ?? AGORA,
  });
  const pfxs: Uint8Array[] = [];
  const svc = criarServicoEventos({ eventos: f.ev.repo, cadastros: f.deps.cadastros, ambiente: { ambiente: async () => 'homologacao' }, certificado: { temA1Ativo: async () => (opc.semA1Api ? { valido: false, motivo: 'sem_certificado', mensagem: 'Filial sem certificado A1 ativo.' } : { valido: true, valido_ate: '2027-11-21T00:00:00.000Z', dias_para_vencer: 365 }) }, agora: () => opc.agora ?? AGORA });
  return { ...f, nota, svc, proc, estado, roteiro, pfxs, evento, notaAtual: () => f.r.notas.get(nota.id)! };
}
const JUST = 'Cliente desistiu da compra do pedido';

describe('cancelamento (RN-FAT-02)', () => {
  it('RN-FAT-02: a API só grava o pedido pendente (sem A1 decifrado e sem SEFAZ) e a repetição devolve o MESMO pedido', async () => {
    const m = await montar();
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(r.evento).toMatchObject({ tipo: 'cancelamento', n_seq_evento: 1, status: 'pendente', texto: JUST });
    expect(m.estado.pedidos).toHaveLength(0);
    expect(m.r.log).toEqual(['evento:pendente:cancelamento']);
    const de_novo = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    expect(de_novo).toMatchObject({ ok: true, repetido: true });
    expect([...m.ev.eventos.values()]).toHaveLength(1);
  });

  it('RN-FAT-02: fora do prazo de 24 h é recusado (violação do domain traduzida em ok:false); filial sem A1 ativo também (RN-CORE-06)', async () => {
    const foraDoPrazo = await montar({ agora: new Date(INSTANTE_DE_TESTE.getTime() + 25 * 3_600_000) });
    expect(await foraDoPrazo.svc.pedirCancelamento(tx, foraDoPrazo.notaAtual(), { justificativa: JUST })).toMatchObject({ ok: false, violacoes: [{ campo: 'prazo' }] });
    const semA1 = await montar({ semA1Api: true });
    expect(await semA1.svc.pedirCancelamento(tx, semA1.notaAtual(), { justificativa: JUST })).toMatchObject({ ok: false, violacoes: [{ rn: 'RN-CORE-06' }] });
    expect(semA1.ev.eventos.size).toBe(0);
  });

  it('RN-FAT-02: o worker reconfere o prazo de 24 h; vencido entre o pedido e o envio, o pedido vira rejeitado local, sem chamar a SEFAZ', async () => {
    const m = await montar({ agoraWorker: new Date(INSTANTE_DE_TESTE.getTime() + 25 * 3_600_000) });
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toMatchObject({ resultado: 'rejeitado', codigo: '501' });
    expect(m.estado.pedidos).toHaveLength(0);
    expect(m.ev.eventos.get(r.evento.id)).toMatchObject({ status: 'rejeitado', c_stat: 501 });
    expect(m.notaAtual().status).toBe('autorizada');
  });

  it('RN-FAT-03: com tentativa anterior (timeout) e o prazo vencido, o worker transmite e a SEFAZ responde (o 135 é guardado), em vez do 501 local', async () => {
    const m = await montar({ agoraWorker: new Date(INSTANTE_DE_TESTE.getTime() + 25 * 3_600_000) });
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    const l = await m.ev.repo.iniciarTransmissao(tx, { servico: 'evento', evento_id: r.evento.id, nota_id: m.nota.id, destino: 'simulador', leaseMin: 5 });
    await m.ev.repo.concluirTransmissao(tx, (l as { id: string }).id, { cStat: null, xMotivo: 'falha: TimeoutError', respondida_em: INSTANTE_DE_TESTE.toISOString(), duracao_ms: 0 });
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toMatchObject({ resultado: 'registrado' });
    expect(m.estado.pedidos).toHaveLength(1);
    expect(m.notaAtual().status).toBe('cancelada');
  });

  it('RN-FAT-03: com lease ativo de outro worker e o prazo vencido, devolve em_processamento: não grava o 501 local nem chama a SEFAZ', async () => {
    const m = await montar({ agoraWorker: new Date(INSTANTE_DE_TESTE.getTime() + 25 * 3_600_000) });
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    await m.ev.repo.iniciarTransmissao(tx, { servico: 'evento', evento_id: r.evento.id, nota_id: m.nota.id, destino: 'simulador', leaseMin: 5 });
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toEqual({ resultado: 'ignorada', motivo: 'em_processamento' });
    expect(m.ev.eventos.get(r.evento.id)).toMatchObject({ status: 'pendente' });
    expect(m.estado.pedidos).toHaveLength(0);
  });

  it('RN-FAT-03: o worker chama a porta FORA da tx com o pedido guardado; guarda o procEventoNFe ANTES do status; só então publica cancelada@1 com as quantidades', async () => {
    const m = await montar();
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error('esperava ok');
    const res = await m.proc.processarEvento(TENANT, r.evento.id);
    expect(res.resultado).toBe('registrado');
    expect(m.estado.chamadasForaDaTx).toEqual([true]);
    expect(m.estado.pedidos[0]).toMatchObject({ chNFe: m.nota.chave_acesso, nProt: NPROT, xJust: JUST, tpAmb: 2, fusoMinutos: -240 });
    expect(m.r.log).toEqual(['evento:pendente:cancelamento', 'xml:evento_cancelamento', 'status:cancelada', 'evento:faturamento.nota.cancelada@1']);
    expect(m.ev.xmls[0]?.conteudo).toMatch(/^<procEventoNFe .*<evento .*<retEvento .*<\/procEventoNFe>$/s);
    expect(m.notaAtual().status).toBe('cancelada');
    const payload = m.r.eventos[0]?.payload as { protocolo_cancelamento: string; motivo: string; itens: { sequencia: number; quantidade: number }[]; nota: { protocolo: string } };
    expect(payload).toMatchObject({ protocolo_cancelamento: PROT_EVENTO, motivo: JUST, nota: { protocolo: NPROT } });
    expect(payload.itens.map((i) => i.sequencia)).toEqual([1, 2]);
    expect(m.ev.transmissoes).toMatchObject([{ servico: 'evento', cStat: '128' }]);
    expect(m.pfxs.every((p) => p.every((b) => b === 0))).toBe(true);
  });

  it('RN-FAT-02: rejeição (501) marca o pedido rejeitado, a nota segue autorizada, nada é guardado nem publicado; o reenvio reabre com a MESMA sequência', async () => {
    const m = await montar();
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error('esperava ok');
    m.roteiro.cStat = '501';
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toMatchObject({ resultado: 'rejeitado', codigo: '501' });
    expect(m.notaAtual().status).toBe('autorizada');
    expect(m.ev.xmls).toHaveLength(0);
    expect(m.r.eventos).toHaveLength(0);
    expect(m.ev.eventos.get(r.evento.id)).toMatchObject({ status: 'rejeitado', c_stat: 501 });
    m.roteiro.cStat = '135';
    const outra = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: `${JUST} (corrigido)` });
    if (!outra.ok) throw new Error('esperava ok');
    expect(outra.evento).toMatchObject({ id: r.evento.id, status: 'pendente', n_seq_evento: 1 });
    expect((await m.proc.processarEvento(TENANT, r.evento.id)).resultado).toBe('registrado');
  });

  it('RN-FAT-02: a API chama a validação do domain: CC-e com cancelamento pendente é recusada e nada é gravado', async () => {
    const m = await montar();
    const c = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!c.ok) throw new Error('esperava ok');
    const r = await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: 'Corrigir o endereço de entrega da nota' });
    expect(r).toMatchObject({ ok: false, violacoes: [{ rn: 'RN-FAT-02', campo: 'status' }] });
    expect([...m.ev.eventos.values()].filter((e) => e.tipo === 'cce')).toHaveLength(0);
  });

  it('RN-FAT-03: a retentativa depois de falha de transporte reenvia o MESMO pedido (dhEvento e idLote guardados)', async () => {
    const m = await montar();
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error('esperava ok');
    m.roteiro.falhar = true;
    await expect(m.proc.processarEvento(TENANT, r.evento.id)).rejects.toThrow('SEFAZ_INDISPONIVEL');
    m.roteiro.falhar = false;
    await m.proc.processarEvento(TENANT, r.evento.id);
    const [a, b] = m.estado.pedidos as PedidoCancelamento[];
    expect(b).toEqual(a);
    expect(m.pfxs.every((p) => p.every((x) => x === 0))).toBe(true); // zerado também na falha
  });

  it('RN-FAT-03: 573 (evento já na SEFAZ) só vira registrado se a consulta de protocolo o confirma; senão, rejeitado', async () => {
    const m = await montar();
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error('esperava ok');
    m.roteiro.cStat = '573';
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toMatchObject({ resultado: 'rejeitado', codigo: '573' });
    const o = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!o.ok) throw new Error('esperava ok');
    m.roteiro.consultaEventos = [m.evento({ chNFe: m.nota.chave_acesso, nSeqEvento: 1 }, '110111', '135')];
    expect((await m.proc.processarEvento(TENANT, r.evento.id)).resultado).toBe('registrado');
    expect(m.ev.xmls[0]?.protocolo).toBe(PROT_EVENTO);
  });

  it('RN-CORE-06: sem A1 no worker nada é enviado e o pedido continua pendente', async () => {
    const m = await montar({ semA1Worker: true });
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error('esperava ok');
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toEqual({ resultado: 'sem_certificado' });
    expect(m.estado.pedidos).toHaveLength(0);
    expect(m.ev.eventos.get(r.evento.id)?.status).toBe('pendente');
  });

  it('RN-FAT-03: evento já registrado não é processado de novo (idempotente)', async () => {
    const m = await montar();
    const r = await m.svc.pedirCancelamento(tx, m.notaAtual(), { justificativa: JUST });
    if (!r.ok) throw new Error('esperava ok');
    await m.proc.processarEvento(TENANT, r.evento.id);
    expect(await m.proc.processarEvento(TENANT, r.evento.id)).toEqual({ resultado: 'ignorada', motivo: 'nao_pendente' });
    expect(m.estado.pedidos).toHaveLength(1);
  });
});

describe('carta de correção (RN-FAT-02)', () => {
  const TEXTO = 'Endereço de entrega: Rua de Teste, 100';
  it('RN-FAT-02: CC-e na nota autorizada; a nota continua autorizada e a próxima é a sequência 2', async () => {
    const m = await montar();
    const a = await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: TEXTO });
    if (!a.ok) throw new Error(JSON.stringify(a.violacoes));
    expect(a.evento).toMatchObject({ tipo: 'cce', n_seq_evento: 1 });
    expect((await m.proc.processarEvento(TENANT, a.evento.id)).resultado).toBe('registrado');
    expect(m.notaAtual().status).toBe('autorizada');
    expect(m.r.log).toEqual(['evento:pendente:cce', 'xml:evento_cce']);
    expect(m.r.eventos).toHaveLength(0);
    const b = await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: `${TEXTO} 2` });
    if (!b.ok) throw new Error('esperava ok');
    expect(b.evento.n_seq_evento).toBe(2);
    expect(m.estado.pedidos[0]).toMatchObject({ nSeqEvento: 1, xCorrecao: TEXTO });
  });

  it('RN-FAT-02: o aviso por palavra-chave orienta e não bloqueia', async () => {
    const m = await montar();
    const r = await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: 'Corrigir o valor total da nota fiscal' });
    expect(r).toMatchObject({ ok: true, avisos: [{ grupo: 'valor' }] });
  });

  it('RN-FAT-02: CC-e pendente com texto diferente é recusada; com o mesmo texto devolve a pendente', async () => {
    const m = await montar();
    await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: TEXTO });
    expect(await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: TEXTO })).toMatchObject({ ok: true, repetido: true });
    expect(await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: `${TEXTO} outro` })).toMatchObject({ ok: false });
  });

  it('RN-FAT-02: a CC-e 21 é recusada (limite de 20 por nota)', async () => {
    const m = await montar();
    for (let s = 1; s <= 20; s++) {
      const x = await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: `${TEXTO} ${s}` });
      if (!x.ok) throw new Error(`falhou na ${s}`);
      await m.proc.processarEvento(TENANT, x.evento.id);
    }
    expect(await m.svc.pedirCartaCorrecao(tx, m.notaAtual(), { texto: `${TEXTO} 21` })).toMatchObject({ ok: false, violacoes: [{ campo: 'nSeqEvento' }] });
  });
});

describe('inutilização (RN-FAT-01)', () => {
  const faixa = (ini: number, fim: number) => ({ filial_id: IDS.filial, numero_inicial: ini, numero_final: fim, justificativa: 'Numeração pulada por falha do sistema' });
  it('RN-FAT-01: faixa a partir do próximo número: pedido pendente, worker registra (102) com o procInutNFe guardado e a numeração avança', async () => {
    const m = await montar(); // a nota 100 foi emitida: o próximo é o 101
    const r = await m.svc.pedirInutilizacao(tx, faixa(101, 103));
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    expect(r.inutilizacao).toMatchObject({ status: 'pendente', serie: 1, ano: 2026, ambiente: 'homologacao' });
    expect(m.r.estado.proximo).toBe(103);
    const res = await m.proc.processarInutilizacao(TENANT, r.inutilizacao.id);
    expect(res).toEqual({ resultado: 'registrada', protocolo: PROT_EVENTO });
    expect(m.r.log).toEqual(['inutilizacao:pendente', 'xml:inutilizacao']);
    expect(m.ev.xmls[0]?.conteudo).toMatch(/^<ProcInutNFe .*<inutNFe .*<retInutNFe\/><\/ProcInutNFe>$/s);
    expect(m.estado.pedidos[0]).toMatchObject({ cUF: 13, tpAmb: 2, ano: '26', serie: 1, nNFIni: 101, nNFFin: 103 });
    expect(m.estado.chamadasForaDaTx).toEqual([true]);
  });

  it('RN-FAT-01: o final passa de proximo+99 é recusado (violação do domain traduzida em ok:false)', async () => {
    const m = await montar();
    expect(await m.svc.pedirInutilizacao(tx, faixa(101, 201))).toMatchObject({ ok: false, violacoes: [{ campo: 'numeroFinal' }] });
    expect(m.ev.inutilizacoes.size).toBe(0);
  });

  it('RN-FAT-01: faixa sobreposta a outra não rejeitada é recusada pelo banco (traduzido em RN-FAT-01)', async () => {
    const m = await montar();
    await m.svc.pedirInutilizacao(tx, faixa(101, 103));
    await expect(m.svc.pedirInutilizacao(tx, faixa(102, 104))).rejects.toThrow(/RN-FAT-01.*sobreposição/);
  });

  it('RN-FAT-01: a SEFAZ devolve 563 (faixa já inutilizada): NUNCA rejeita; fica pendente com o motivo, a faixa segue reservada e sem ProcInut as notas não mudam', async () => {
    const m = await montar();
    const r = await m.svc.pedirInutilizacao(tx, faixa(101, 101));
    if (!r.ok) throw new Error('esperava ok');
    m.roteiro.cStat = '563';
    expect(await m.proc.processarInutilizacao(TENANT, r.inutilizacao.id)).toMatchObject({ resultado: 'divergente', codigo: '563', motivo: 'ja_inutilizada_na_sefaz' });
    expect(m.ev.xmls).toHaveLength(0);
    expect(m.ev.inutilizacoes.get(r.inutilizacao.id)).toMatchObject({ status: 'pendente', c_stat: 563, x_motivo: expect.stringContaining('ja_inutilizada_na_sefaz') });
    expect(m.r.log).not.toContain('inutilizacao:rejeitada');
    // a varredura não insiste: é divergência do suporte
    expect(await m.proc.processarPendentes(TENANT)).toEqual([]);
  });

  it('RN-FAT-01: a SEFAZ rejeita a inutilização (256): o pedido vira rejeitado, sem XML guardado', async () => {
    const m = await montar();
    const r = await m.svc.pedirInutilizacao(tx, faixa(101, 101));
    if (!r.ok) throw new Error('esperava ok');
    m.roteiro.cStat = '256';
    expect(await m.proc.processarInutilizacao(TENANT, r.inutilizacao.id)).toMatchObject({ resultado: 'rejeitada', codigo: '256' });
    expect(m.ev.xmls).toHaveLength(0);
    expect(m.ev.inutilizacoes.get(r.inutilizacao.id)).toMatchObject({ status: 'rejeitado', c_stat: 256 });
  });

  it('RN-FAT-01: o pedido com lease de transmissão em curso não é transmitido de novo (fila e varredura não correm juntas) e a varredura só o retoma com o lease vencido', async () => {
    const m = await montar();
    const r = await m.svc.pedirInutilizacao(tx, faixa(101, 101));
    if (!r.ok) throw new Error('esperava ok');
    await m.ev.repo.iniciarTransmissao(tx, { servico: 'inutilizacao', inutilizacao_id: r.inutilizacao.id, destino: 'simulador', leaseMin: 5 });
    expect(await m.proc.processarInutilizacao(TENANT, r.inutilizacao.id)).toEqual({ resultado: 'ignorada', motivo: 'em_processamento' });
    expect(m.ev.transmissoes).toHaveLength(0);
    expect(await m.proc.processarPendentes(TENANT)).toEqual([]);
    m.ev.vencerLeases();
    expect(await m.proc.processarPendentes(TENANT)).toEqual([{ tipo: 'inutilizacao', id: r.inutilizacao.id, resultado: 'registrada' }]);
  });

  it('RN-FAT-01: o ano da inutilização é gravado uma vez no pedido; o retry depois da virada de ano reenvia o MESMO ano, sem recalcular', async () => {
    const m = await montar({ agora: new Date('2026-12-31T23:59:00-04:00') });
    const r = await m.svc.pedirInutilizacao(tx, faixa(101, 101));
    if (!r.ok) throw new Error('esperava ok');
    expect(r.inutilizacao.ano).toBe(2026);
    // a varredura de 2027 (o worker roda depois da virada): o ano do XML sai do pedido guardado
    const depois = await montar({ agora: new Date('2027-01-01T00:05:00-04:00') });
    depois.ev.inutilizacoes.set(r.inutilizacao.id, { ...r.inutilizacao });
    await depois.proc.processarInutilizacao(TENANT, r.inutilizacao.id);
    expect(depois.estado.pedidos[0]).toMatchObject({ ano: '26', nNFIni: 101, nNFFin: 101 });
  });

  it('RN-FAT-01: a inutilização registrada leva rascunho e rejeitada da faixa a inutilizada, e a faixa já feita não é refeita', async () => {
    const m = await montar();
    const r = await m.svc.pedirInutilizacao(tx, faixa(101, 101));
    if (!r.ok) throw new Error('esperava ok');
    await m.proc.processarInutilizacao(TENANT, r.inutilizacao.id);
    expect(await m.proc.processarInutilizacao(TENANT, r.inutilizacao.id)).toEqual({ resultado: 'ignorada', motivo: 'nao_pendente' });
    expect(m.estado.pedidos).toHaveLength(1);
  });
});

describe('consulta de protocolo (RN-FAT-02, RN-FAT-03)', () => {
  const PROC = `<procEventoNFe versao="1.00"><evento versao="1.00"><infEvento Id="ID1101114"><tpEvento>110111</tpEvento><detEvento><xJust>${JUST}</xJust></detEvento></infEvento></evento><retEvento versao="1.00"/></procEventoNFe>`;
  it('RN-FAT-02: 100 na SEFAZ e nota autorizada: nada muda (nota autorizada nunca é editada)', async () => {
    const m = await montar();
    const r = await m.proc.consultarNota(TENANT, m.nota.id);
    expect(r).toMatchObject({ resultado: 'consultada', acao: 'nenhuma', status: 'autorizada' });
    expect(m.r.log).toEqual([]);
  });

  it('RN-FAT-02: cancelada na SEFAZ por evento (101): guarda o procEventoNFe da consulta ANTES de cancelar e publica cancelada@1', async () => {
    const m = await montar();
    m.roteiro.consultaCStat = '101';
    m.roteiro.consultaEventos = [m.evento({ chNFe: m.nota.chave_acesso, nSeqEvento: 1 }, '110111', '135')];
    m.roteiro.consultaXml = `<retConsSitNFe>${PROC}</retConsSitNFe>`;
    const r = await m.proc.consultarNota(TENANT, m.nota.id);
    expect(r).toMatchObject({ resultado: 'consultada', acao: 'marcar_cancelada', status: 'cancelada' });
    expect(m.r.log).toEqual(['evento:pendente:cancelamento', 'xml:evento_cancelamento', 'status:cancelada', 'evento:faturamento.nota.cancelada@1']);
    expect(m.ev.xmls[0]?.conteudo).toContain('<xJust>');
  });

  it('RN-FAT-02: SEFAZ não conhece a chave (217) numa nota autorizada vira divergência, sem mudar a nota', async () => {
    const m = await montar();
    m.roteiro.consultaCStat = '217';
    expect(await m.proc.consultarNota(TENANT, m.nota.id)).toMatchObject({ acao: 'divergencia', status: 'autorizada' });
    expect(m.notaAtual().status).toBe('autorizada');
  });

  it('RN-FAT-02: cancelada na SEFAZ sem o evento completo na consulta vira divergência', async () => {
    const m = await montar();
    m.roteiro.consultaCStat = '101';
    expect(await m.proc.consultarNota(TENANT, m.nota.id)).toMatchObject({ acao: 'divergencia', status: 'autorizada' });
  });
});
