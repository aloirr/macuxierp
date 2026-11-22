/**
 * Ponta a ponta dos eventos do lote 2 com o emissor REAL (`criarEmissorNFe`), um A1 gerado em tempo de execução e o simulador da SEFAZ-AM (T-0045):
 * autoriza → cancela (135); autoriza → CC-e (135); inutiliza a faixa (102); inutiliza a repetida (563). O evento assinado é conferido no XSD e na
 * assinatura. Repositório em memória que imita os gatilhos da 0013 e da 0020.
 */
import { criarSeletorTransporte, montarEnvEvento, validarXsd, verificarAssinaturaXml } from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { criarFabricaSimulador } from '@macuxierp/sefaz-simulador';
import type { Banco } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { IDS } from '../domain/fixtures';
import { a1DeTeste, CNPJ_EMITENTE, depsFake, tx, TENANT } from './apoio-teste';
import { criarServicoEmissao } from './emissao';
import { criarServicoEventos } from './eventos';
import { criarProcessadorEventos } from './processador-eventos';
import { criarTransmissor } from './transmissor';

const banco: Banco = { comTenant: async (_id, fn) => fn(tx), semTenant: async (fn) => fn(tx), ping: async () => true };
const SIM = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);

async function montar() {
  const f = depsFake({ ambiente: 'homologacao' });
  f.r.estado.relogio = SIM; // o `dhEvento` do pedido guardado fica depois da emissão da nota e não passa da hora do simulador
  const sefaz = criarSeletorTransporte({ transporte: 'simulador', simulador: criarFabricaSimulador({ agora: () => SIM, tMed: 1 }) });
  const ambiente = { ambiente: async () => 'homologacao' as const };
  const transmissor = criarTransmissor({ banco, notas: f.r.repo, emissor: f.emissor, ambiente, lerA1: async () => a1DeTeste(), sefaz, agora: () => INSTANTE_DE_TESTE });
  const proc = criarProcessadorEventos({ banco, notas: f.r.repo, eventos: f.ev.repo, cadastros: f.deps.cadastros, ambiente, lerA1: async () => a1DeTeste(), emissor: f.emissor, sefaz, agora: () => SIM });
  const svc = criarServicoEventos({ eventos: f.ev.repo, cadastros: f.deps.cadastros, ambiente, certificado: { temA1Ativo: async () => ({ valido: true, valido_ate: '2027-11-21T00:00:00.000Z', dias_para_vencer: 365 }) }, agora: () => SIM });
  const emitirEAutorizar = async (idem: string) => {
    const e = await criarServicoEmissao(f.deps).emitirNota(tx, TENANT, { pedido_id: IDS.pedido, idempotencia: idem });
    if (!e.ok) throw new Error(JSON.stringify(e.violacoes));
    expect((await transmissor.transmitirNota(TENANT, e.nota.id)).resultado).toBe('autorizada');
    return f.r.notas.get(e.nota.id)!;
  };
  return { ...f, sefaz, ambiente, proc, svc, emitirEAutorizar };
}

describe('ponta a ponta dos eventos: emissor real + A1 gerado + simulador', () => {
  it('RN-FAT-02: autoriza → cancela (135): o procEventoNFe é guardado antes, a nota passa a cancelada e cancelada@1 sai', async () => {
    const m = await montar();
    const nota = await m.emitirEAutorizar('idem-e2e-cancela');
    const r = await m.svc.pedirCancelamento(tx, nota, { justificativa: 'Cliente desistiu da compra do pedido' });
    if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
    m.r.log.length = 0;
    const res = await m.proc.processarEvento(TENANT, r.evento.id);
    expect(res).toMatchObject({ resultado: 'registrado', nota: { status: 'cancelada' } });
    expect(m.r.log).toEqual(['xml:evento_cancelamento', 'status:cancelada', 'evento:faturamento.nota.cancelada@1']);
    expect(m.ev.eventos.get(r.evento.id)).toMatchObject({ status: 'registrado', protocolo: expect.stringMatching(/^\d{15}$/) });
    const proc = m.ev.xmls[0]!.conteudo;
    expect(proc).toContain('<tpEvento>110111</tpEvento>');
    expect(proc).toContain('<cStat>135</cStat>');
    const evento = /<evento\b[\s\S]*<\/evento>/.exec(proc)![0];
    expect((await validarXsd(montarEnvEvento('1', evento), 'envEventoCancNFe')).erros).toEqual([]);
    expect(verificarAssinaturaXml(evento, { elemento: 'infEvento', cnpjEsperado: CNPJ_EMITENTE, agora: INSTANTE_DE_TESTE })).toMatchObject({ ok: true });
    expect(m.r.eventos.map((e) => e.nome).slice(-1)).toEqual(['faturamento.nota.cancelada@1']);
    // a consulta confirma e não muda mais nada
    expect(await m.proc.consultarNota(TENANT, nota.id)).toMatchObject({ acao: 'nenhuma', status: 'cancelada' });
    // cancelar duas vezes: a API recusa antes da SEFAZ
    expect(await m.svc.pedirCancelamento(tx, m.r.notas.get(nota.id)!, { justificativa: 'Cliente desistiu da compra do pedido' })).toMatchObject({ ok: false });
  });

  it('RN-FAT-02: autoriza → CC-e (135): a nota continua autorizada, o evento fica registrado e a sequência 2 sai', async () => {
    const m = await montar();
    const nota = await m.emitirEAutorizar('idem-e2e-cce');
    for (const [seq, texto] of [[1, 'Endereço de entrega: Rua de Teste, 100'], [2, 'Endereço de entrega: Rua de Teste, 200']] as const) {
      const r = await m.svc.pedirCartaCorrecao(tx, m.r.notas.get(nota.id)!, { texto });
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      expect(r.evento.n_seq_evento).toBe(seq);
      expect((await m.proc.processarEvento(TENANT, r.evento.id)).resultado).toBe('registrado');
    }
    expect(m.r.notas.get(nota.id)?.status).toBe('autorizada');
    expect(m.ev.xmls.map((x) => x.tipo)).toEqual(['evento_cce', 'evento_cce']);
    expect(m.ev.xmls[0]!.conteudo).toContain('<tpEvento>110110</tpEvento>');
  });

  it('RN-FAT-01: inutiliza a faixa (102) e a repetida na SEFAZ (563) fica pendente com o motivo (nunca rejeitada), sem XML guardado', async () => {
    const m = await montar();
    await m.emitirEAutorizar('idem-e2e-inut'); // nota 100; o próximo é o 101
    const faixa = (ini: number, fim: number) => ({ filial_id: IDS.filial, numero_inicial: ini, numero_final: fim, justificativa: 'Numeração pulada por falha do sistema' });
    const a = await m.svc.pedirInutilizacao(tx, faixa(101, 102));
    if (!a.ok) throw new Error(JSON.stringify(a.violacoes));
    const ra = await m.proc.processarInutilizacao(TENANT, a.inutilizacao.id);
    expect(ra).toMatchObject({ resultado: 'registrada', protocolo: expect.stringMatching(/^\d{15}$/) });
    expect(m.ev.xmls.map((x) => x.tipo)).toEqual(['inutilizacao']);
    expect(m.ev.xmls[0]!.conteudo).toContain('<cStat>102</cStat>');
    expect(m.ev.inutilizacoes.get(a.inutilizacao.id)?.status).toBe('registrado');

    // A SEFAZ já tem a faixa 103 (pedido anterior com a resposta perdida): o ERP não sabe, pede de novo e recebe 563.
    const t = m.sefaz({ filial_id: IDS.filial, ambiente: 'homologacao', uf: 'AM', modo: 'normal' }, a1DeTeste().credencial);
    const antes = await m.emissor.inutilizar({ cUF: 13, tpAmb: 2, ano: '26', cnpj: CNPJ_EMITENTE, serie: 1, nNFIni: 103, nNFFin: 103, xJust: 'Numeração pulada por falha do sistema' }, a1DeTeste().certificado, t);
    expect(antes.cStat).toBe('102');
    const b = await m.svc.pedirInutilizacao(tx, faixa(103, 103));
    if (!b.ok) throw new Error(JSON.stringify(b.violacoes));
    expect(await m.proc.processarInutilizacao(TENANT, b.inutilizacao.id)).toMatchObject({ resultado: 'divergente', codigo: '563', motivo: 'ja_inutilizada_na_sefaz' });
    expect(m.ev.inutilizacoes.get(b.inutilizacao.id)).toMatchObject({ status: 'pendente', c_stat: 563 });
    expect(m.ev.xmls).toHaveLength(1);
  });
});
