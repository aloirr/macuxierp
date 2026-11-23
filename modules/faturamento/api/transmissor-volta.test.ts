/**
 * Volta da EPEC (T-0021, lote 4, etapa 4; RN-FAT-08, RN-FAT-09, ADR 0011): a nota tpEmis 4 `emitida_contingencia` com `epec_protocolo` é transmitida ao autorizador NORMAL com a MESMA
 * nfe_assinada (sem remontar, sem reassinar; mesma chave). Emissor real, A1 gerado em tempo de execução, o simulador da SEFAZ (o mesmo que registrou o evento) e o repositório em memória.
 */
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { criarSimuladorDeTeste, destinoDe } from '@macuxierp/sefaz-simulador/teste';
import type { Banco } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { a1DeTeste, contingenciaFake, depsFake, guardaEpecFake, situacaoAprovadaDeTeste, titulosFake, tx, TENANT, uuid } from './apoio-teste';
import { criarServicoEmissao, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_EMITIDA_CONTINGENCIA, EVENTO_NOTA_REJEITADA } from './emissao';
import { criarTransmissor } from './transmissor';

const banco: Banco = { comTenant: async (_id, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };
const SIM = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);
const MOTIVO = 'SEFAZ-AM fora do ar desde as 9h';

async function montar(o: { seletorRecusa?: boolean; agoraVolta?: Date } = {}) {
  const f = depsFake({ ambiente: 'homologacao' });
  f.r.estado.relogio = SIM;
  const c = contingenciaFake();
  await c.repo.abrir(tx, { filial_id: IDS.filial, ambiente: 'homologacao', modalidade: 'epec', motivo: MOTIVO, inicio_em: new Date('2026-11-21T09:00:00Z'), ligada_por: uuid(1) });
  const sim = criarSimuladorDeTeste(destinoDe('normal', IDS.filial), { agora: () => SIM, tMed: 1 });
  const g = guardaEpecFake(f.r);
  const modos: string[] = [];
  const logs: { evento: string; motivo?: string; nota_id?: string }[] = [];
  let agora = SIM;
  const transmissor = criarTransmissor({
    log: (e) => void logs.push(e), banco, notas: f.r.repo, titulos: titulosFake().repo, emissor: f.emissor,
    ambiente: { ambiente: async () => 'homologacao' as const }, situacao: situacaoAprovadaDeTeste,
    lerA1: async () => a1DeTeste(),
    sefaz: (filial) => {
      modos.push(filial.modo ?? 'normal');
      if (o.seletorRecusa) throw new Error('SEFAZ normal indisponível');
      return sim;
    },
    epec: { seletor: () => sim, guarda: g.guarda },
    agora: () => agora,
  });
  const svc = criarServicoEmissao({ ...f.deps, contingencia: c.repo });
  const emitirEEpec = async () => {
    const r = await svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-volta-0001' });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    await transmissor.transmitirNota(TENANT, r.nota.id);
    return r.nota;
  };
  return { ...f, ...f.r, svc, c, sim, g, modos, logs, transmissor, emitirEEpec, depoisDe: (h: number) => { agora = new Date(SIM.getTime() + h * 3_600_000); } };
}

describe('volta da EPEC: transmissão posterior com a mesma nfe_assinada (RN-FAT-09)', { timeout: 60_000 }, () => {
  it('RN-FAT-09: a EPEC registrada vai a em_autorizacao e a MESMA nfe_assinada (sem reassinar, mesma chave) é transmitida no modo normal; a nfe_autorizada é guardada antes do status e nota.autorizada@1 sai', async () => {
    const m = await montar();
    const nota = await m.emitirEEpec();
    expect(m.notas.get(nota.id)?.status).toBe('emitida_contingencia');
    const assinadoAntes = m.assinados.map((a) => a.versao);
    const eventosAntes = m.eventos.length;
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_EMITIDA_CONTINGENCIA]); // a EPEC registrada não publica nota.autorizada@1

    const r = await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(r).toMatchObject({ resultado: 'autorizada' });
    expect(m.modos).toEqual(['normal']);
    expect(m.assinados.map((a) => a.versao)).toEqual(assinadoAntes); // nada reassinado
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'autorizada', numero: 100, chave_acesso: nota.chave_acesso, tp_emis: 4 });
    expect(m.log.lastIndexOf('xml:autorizado')).toBeGreaterThan(m.log.lastIndexOf('status:em_autorizacao')); // regra 7: XML autorizado guardado antes de autorizar e publicar
    expect(m.log.indexOf('xml:autorizado')).toBeLessThan(m.log.indexOf('evento:faturamento.nota.autorizada@1'));
    expect(m.eventos.slice(eventosAntes).map((e) => e.nome)).toContain(EVENTO_NOTA_AUTORIZADA);
    // RN-FAT-09: a chave é a mesma nos dois eventos (a idempotência é do consumidor, pela chave da nota)
    expect(m.eventos.filter((e) => e.nome !== 'faturamento.titulo.gerado@1').map((e) => (e.payload as { nota: { chave_acesso: string } }).nota.chave_acesso)).toEqual([nota.chave_acesso, nota.chave_acesso]);
    expect(m.notas.get(nota.id)?.epec_protocolo).toMatch(/^\d{15}$/); // o protocolo do evento fica
  });

  it('RN-FAT-09: o transmissor da volta recusa SVC (tpEmis 6/7: o autorizador normal os recusa) e EPEC sem o evento', async () => {
    const m = await montar();
    const nota = await m.emitirEEpec();
    m.notas.set(nota.id, { ...m.notas.get(nota.id)!, tp_emis: 7 });
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'ignorada', motivo: 'status_nao_transmissivel' });
    m.notas.set(nota.id, { ...m.notas.get(nota.id)!, tp_emis: 4, epec_protocolo: null });
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'ignorada', motivo: 'status_nao_transmissivel' });
    expect(m.modos).toEqual([]);
  });

  it('RN-FAT-09/07: rejeição na volta vira rejeitada com nota.rejeitada@1, mantém número, chave e protocolo do evento; o reenvio é o da RN-FAT-07', async () => {
    const m = await montar();
    const nota = await m.emitirEEpec();
    m.sim.teste.rejeitarProximo({ cStat: '252', operacao: 'autorizar' });
    const r = await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(r).toMatchObject({ resultado: 'rejeitada', codigo: '252' });
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'rejeitada', numero: 100, chave_acesso: nota.chave_acesso });
    expect(m.notas.get(nota.id)?.epec_protocolo).toMatch(/^\d{15}$/);
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_EMITIDA_CONTINGENCIA, EVENTO_NOTA_REJEITADA]);
  });

  it('RN-FAT-09: seletor do autorizador normal indisponível: a nota segue emitida_contingencia (nada se perde) e nada é enviado', async () => {
    const m = await montar({ seletorRecusa: true });
    const nota = await m.emitirEEpec();
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'nao_assinada', motivo: 'destino_indisponivel' });
    expect(m.notas.get(nota.id)?.status).toBe('emitida_contingencia');
  });

  it('RN-FAT-09: passadas as 168 h do evento a transmissão ainda sai (quem decide é a SEFAZ), com o sinal no log sem dado pessoal', async () => {
    const m = await montar();
    const nota = await m.emitirEEpec();
    m.depoisDe(169);
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toMatchObject({ resultado: 'autorizada' });
    const l = m.logs.find((x) => x.evento === 'faturamento.epec.prazo_vencido');
    expect(l).toMatchObject({ nota_id: nota.id });
    expect(JSON.stringify(l)).not.toMatch(/\d{14}/); // nada de CNPJ/chave no log
  });

  it('RN-FAT-08/09: duplicidade (573) do evento ou lote sem retEvento deixa a nota em em_autorizacao e registra o motivo no log (a consulta de evento não existe no pacote)', async () => {
    const m = await montar();
    const r0 = await m.svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: 'idem-volta-0002' });
    if (!r0.ok) throw new Error('emissão');
    const sim = m.sim;
    const transmissor573 = criarTransmissor({
      log: (e) => void m.logs.push(e), banco, notas: m.repo, titulos: titulosFake().repo, emissor: m.emissor, ambiente: { ambiente: async () => 'homologacao' as const }, situacao: situacaoAprovadaDeTeste,
      lerA1: async () => a1DeTeste(), sefaz: () => sim,
      epec: { seletor: () => ({ destino: sim.destino, epec: async (p) => { const r = await sim.epec(p); return { ...r, eventos: r.eventos.map((e) => ({ ...e, cStat: '573', xMotivo: 'Rejeicao: Duplicidade de Evento', nProt: null })) }; } }), guarda: m.g.guarda }, agora: () => SIM,
    });
    expect(await transmissor573.transmitirNota(TENANT, r0.nota.id)).toMatchObject({ resultado: 'aguardando', codigo: '573' });
    expect(m.notas.get(r0.nota.id)?.status).toBe('em_autorizacao');
    expect(m.logs.find((x) => x.evento === 'faturamento.epec.evento_sem_retorno')).toMatchObject({ nota_id: r0.nota.id });
  });
});
