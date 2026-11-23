/**
 * EPEC (tpEmis 4, evento 110140) no worker (T-0021, lote 4, etapa 3; RN-FAT-05, RN-FAT-08, RN-FAT-09): emissor REAL, A1 gerado em tempo de execução e o `epec` do simulador
 * da SEFAZ (o seletor real recusa filial simulada, RN-FAT-10; aqui o seletor é injetado, como o #284 testa). Repositório em memória que imita os gatilhos da 0013, 0020 e 0032.
 */
import { verificarAssinaturaXml, type SefazTransporteEpec, type SeletorEpec } from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { criarSimuladorDeTeste, destinoDe } from '@macuxierp/sefaz-simulador/teste';
import type { Banco } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { a1DeTeste, CNPJ_EMITENTE, contingenciaFake, depsFake, guardaEpecFake, situacaoAprovadaDeTeste, titulosFake, tx, TENANT, uuid } from './apoio-teste';
import { criarServicoEmissao, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_REJEITADA } from './emissao';
import { criarTransmissor } from './transmissor';

const banco: Banco = { comTenant: async (_id, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };
const SIM = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);
const MOTIVO = 'SEFAZ-AM fora do ar desde as 9h';

async function montar(o: { epec?: 'aberta' | 'nenhuma'; guardaFalha?: boolean; semEpec?: boolean; transporte?: (sim: SefazTransporteEpec) => SefazTransporteEpec } = {}) {
  const f = depsFake({ ambiente: 'homologacao' });
  f.r.estado.relogio = SIM;
  const c = contingenciaFake();
  if (o.epec !== 'nenhuma') await c.repo.abrir(tx, { filial_id: IDS.filial, ambiente: 'homologacao', modalidade: 'epec', motivo: MOTIVO, inicio_em: new Date('2026-11-21T09:00:00Z'), ligada_por: uuid(1) });
  const sim = criarSimuladorDeTeste(destinoDe('normal', IDS.filial), { agora: () => SIM, tMed: 1 });
  const g = guardaEpecFake(f.r, o.guardaFalha ? { falhar: true } : {});
  const lidos: ReturnType<typeof a1DeTeste>[] = [];
  const chamadas: string[] = [];
  const usado = o.transporte ? o.transporte(sim) : sim;
  const seletor: SeletorEpec = (filial, credencial) => {
    chamadas.push(`seletor:${filial.uf}:${filial.ambiente}`);
    expect(credencial.pfx.length).toBeGreaterThan(0);
    return usado;
  };
  const transmissor = criarTransmissor({
    log: () => undefined, banco, notas: f.r.repo, titulos: titulosFake().repo, emissor: f.emissor,
    ambiente: { ambiente: async () => 'homologacao' as const }, situacao: situacaoAprovadaDeTeste,
    lerA1: async () => { const a = a1DeTeste(); lidos.push(a); return a; },
    sefaz: () => {
      throw new Error('a NF-e da EPEC não vai ao autorizador antes do evento');
    },
    ...(o.semEpec ? {} : { epec: { seletor, guarda: g.guarda } }),
    agora: () => SIM,
  });
  const svc = criarServicoEmissao({ ...f.deps, contingencia: c.repo });
  const emitir = async (idem = 'idem-epec-0001') => {
    const r = await svc.emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: idem });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    return r.nota;
  };
  return { ...f, ...f.r, c, sim, g, lidos, chamadas, transmissor, svc, emitir };
}

describe('EPEC no worker: evento 110140 em vez da NF-e', { timeout: 60_000 }, () => {
  it('RN-FAT-05/08: com a EPEC aberta a nota nasce tpEmis 4 (chave, coluna, ide com dhCont e xJust); o worker assina, envia o EVENTO 110140 (não a NF-e) e, com o cStat 136, guarda o procEventoNFe ANTES e leva a nota a emitida_contingencia com epec_protocolo e epec_autorizada_em num UPDATE só', async () => {
    const m = await montar();
    const nota = await m.emitir();
    expect(nota).toMatchObject({ tp_emis: 4, serie: 1, numero: 100, status: 'rascunho' });
    expect(nota.chave_acesso.slice(34, 35)).toBe('4');
    expect(m.recebidas.at(-1)!.ide).toMatchObject({ tpEmis: 4, dhCont: '2026-11-21T09:00:00.000Z', xJust: MOTIVO });

    const r = await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(r).toMatchObject({ resultado: 'epec_registrada', protocolo: expect.stringMatching(/^\d{15}$/) });
    expect(m.chamadas).toEqual(['seletor:AM:homologacao']);
    expect(m.log.slice(-4)).toEqual(['xml:assinado:1', 'status:em_autorizacao', 'xml:evento_epec', 'status:emitida_contingencia']); // regra 7: o evento guardado antes do status
    const final = m.notas.get(nota.id)!;
    expect(final).toMatchObject({ status: 'emitida_contingencia', tp_emis: 4, epec_protocolo: (r as { protocolo: string }).protocolo, epec_autorizada_em: SIM.toISOString() });
    expect(m.dadosStatus.at(-1)).toMatchObject({ para: 'emitida_contingencia', dados: { cStat: '136', epec: { protocolo: final.epec_protocolo, autorizadaEm: SIM.toISOString() } } });
    expect(final.protocolo).toBeNull(); // protocolo da NF-e só na volta (etapa 4)
    // o que foi guardado: evento assinado + retEvento, com a chave da nota
    expect(m.g.guardados).toHaveLength(1);
    const g = m.g.guardados[0]!;
    expect(g).toMatchObject({ nota_id: nota.id, chave_acesso: nota.chave_acesso, protocolo: final.epec_protocolo });
    expect(g.conteudo).toMatch(/^<procEventoNFe /);
    expect(g.conteudo).toContain('<tpEvento>110140</tpEvento>');
    expect(g.conteudo).toContain('<cStat>136</cStat>');
    const evento = /<evento\b[\s\S]*<\/evento>/.exec(g.conteudo)![0];
    expect(verificarAssinaturaXml(evento, { elemento: 'infEvento', cnpjEsperado: CNPJ_EMITENTE, agora: INSTANTE_DE_TESTE })).toMatchObject({ ok: true });
    // EPEC registrada não é nota autorizada: nenhum evento de autorização nem título
    expect(m.eventos.map((e) => e.nome)).toEqual([]);
    expect(m.transmissoes).toEqual([]);
    expect(m.lidos).toHaveLength(1);
    expect([...m.lidos[0]!.credencial.pfx].every((b) => b === 0)).toBe(true);
  });

  it('RN-FAT-08: a EPEC registrada não é reenviada pelo worker (emitida_contingencia é da volta, etapa 4): ignorada', async () => {
    const m = await montar();
    const nota = await m.emitir();
    await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'ignorada', motivo: 'status_nao_transmissivel' });
    expect(m.g.guardados).toHaveLength(1);
  });

  it('RN-FAT-07/08: rejeição do EPEC vira rejeitada com nota.rejeitada@1, sem protocolo e sem guarda; o reenvio mantém o número, o tpEmis 4, o dhCont e o xJust e o worker reenvia o evento', async () => {
    const m = await montar();
    m.sim.teste.rejeitarProximo({ cStat: '252', operacao: 'epec' }); // só o próximo envio; nada é gravado no simulador
    const nota = await m.emitir();
    const r = await m.transmissor.transmitirNota(TENANT, nota.id);
    expect(r).toMatchObject({ resultado: 'rejeitada', codigo: '252' });
    expect(m.g.guardados).toHaveLength(0);
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'rejeitada', epec_protocolo: null });
    expect(m.eventos.map((e) => e.nome)).toEqual([EVENTO_NOTA_REJEITADA]);
    expect(m.eventos[0]!.payload).toMatchObject({ codigo: '252' });

    const re = await m.svc.reenviarNota(tx, m.notas.get(nota.id)!);
    expect(re.ok).toBe(true);
    expect(m.conteudos.get(nota.id)?.contingencia).toEqual({ tpEmis: 4, dhCont: '2026-11-21T09:00:00.000Z', xJust: MOTIVO });
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toMatchObject({ resultado: 'epec_registrada' });
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'emitida_contingencia', numero: 100, chave_acesso: nota.chave_acesso });
    expect(m.assinados.map((a) => a.versao)).toEqual([1, 2]);
  });

  it('RN-FAT-08: lote rejeitado sem retEvento (cStat 225 no envelope) também vira rejeitada', async () => {
    const m = await montar({ transporte: (sim) => ({ destino: sim.destino, epec: async (p) => ({ ...(await sim.epec(p)), cStat: '225', xMotivo: 'Rejeicao: Falha no Schema XML', eventos: [] }) }) });
    const nota = await m.emitir();
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toMatchObject({ resultado: 'rejeitada', codigo: '225' });
  });

  it('RN-FAT-08: duplicidade de evento (573) não rejeita nem muda a nota: segue em_autorizacao (a consulta do evento é da etapa 4)', async () => {
    const m = await montar({ transporte: (sim) => ({ destino: sim.destino, epec: async (p) => { const r = await sim.epec(p); return { ...r, eventos: r.eventos.map((e) => ({ ...e, cStat: '573', xMotivo: 'Rejeicao: Duplicidade de Evento', nProt: null })) }; } }) });
    const nota = await m.emitir();
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toMatchObject({ resultado: 'aguardando', codigo: '573' });
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect(m.eventos).toEqual([]);
  });

  it('regra 7, RN-FAT-03: se a guarda do evento falhar, a nota NÃO vai a emitida_contingencia (a tx desfaz) e segue em_autorizacao para o retry', async () => {
    const m = await montar({ guardaFalha: true });
    const nota = await m.emitir();
    await expect(m.transmissor.transmitirNota(TENANT, nota.id)).rejects.toThrow('falha de armazenamento');
    expect(m.notas.get(nota.id)).toMatchObject({ status: 'em_autorizacao', epec_protocolo: null });
    expect(m.log).not.toContain('status:emitida_contingencia');
  });

  it('RN-FAT-10: seletor da EPEC que recusa (filial simulada, produção sem endereço conferido) deixa a nota em rascunho com o motivo, sem assinar e sem queimar número', async () => {
    const f = await montar();
    const nota = await f.emitir();
    const m2 = criarTransmissor({
      log: () => undefined, banco, notas: f.r.repo, titulos: titulosFake().repo, emissor: f.emissor, ambiente: { ambiente: async () => 'homologacao' as const }, situacao: situacaoAprovadaDeTeste,
      lerA1: async () => a1DeTeste(), sefaz: () => { throw new Error('não'); },
      epec: { seletor: () => { throw new Error('SEFAZ_CONTINGENCIA_SIMULADA'); }, guarda: f.g.guarda }, agora: () => SIM,
    });
    expect(await m2.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'nao_assinada', motivo: 'destino_indisponivel' });
    expect(f.notas.get(nota.id)).toMatchObject({ status: 'rascunho', numero: 100 });
    expect(f.motivos.get(nota.id)).toBe('destino_indisponivel');
    expect(f.assinados).toHaveLength(0);
  });

  it('RN-FAT-08: worker sem a EPEC ligada (sem `epec` nos deps) não transmite a nota EPEC: rascunho com o motivo, sem assinar', async () => {
    const m = await montar({ semEpec: true });
    const nota = await m.emitir();
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toEqual({ resultado: 'nao_assinada', motivo: 'destino_indisponivel' });
    expect(m.assinados).toHaveLength(0);
  });

  it('RN-FAT-08: o retry com a nota já em em_autorizacao reutiliza a nfe_assinada (sem reassinar) e reenvia o evento', async () => {
    let falhas = 1;
    const m = await montar({ transporte: (sim) => ({ destino: sim.destino, epec: async (p) => { if (falhas-- > 0) throw new Error('queda de rede'); return sim.epec(p); } }) });
    const nota = await m.emitir();
    await expect(m.transmissor.transmitirNota(TENANT, nota.id)).rejects.toThrow('queda de rede');
    expect(m.notas.get(nota.id)?.status).toBe('em_autorizacao');
    expect(await m.transmissor.transmitirNota(TENANT, nota.id)).toMatchObject({ resultado: 'epec_registrada' });
    expect(m.assinados).toHaveLength(1);
  });

  it('sem a EPEC aberta a nota é a de sempre (tpEmis 1) e vai ao autorizador normal', async () => {
    const m = await montar({ epec: 'nenhuma' });
    const nota = await m.emitir();
    expect(nota.tp_emis).toBe(1);
    expect(EVENTO_NOTA_AUTORIZADA).toBeTruthy();
  });
});
