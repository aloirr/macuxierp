/**
 * Apoio de teste `@macuxierp/sefaz-simulador/teste` (pedido do testes para a N05 da T-0022): `rejeitarProximo` vale
 * só para o próximo envio da operação, não grava nada no simulador e recusa `cStat` fora da tabela `MOTIVO` ou de sucesso.
 */
import { RespostaAutorizacao, RespostaConsultaRecibo, RespostaEvento, RespostaInutilizacao } from '@macuxierp/nfe-sefaz';
import { beforeAll, describe, expect, it } from 'vitest';
import { INICIO, a1DeTeste, autorizarUma, cancelamentoAssinado, cceAssinada, criarRelogio, destinoDe, epecAssinada, inutilizacaoAssinada, nfeAssinada } from '../apoio-teste';
import { criarFabricaSimulador, criarRegistroSimulador } from '../index';
import { CSTAT_DE_SUCESSO, apoioDeTesteSimulador, criarSimuladorDeTeste } from './index';

const novo = () => {
  const relogio = criarRelogio();
  return { s: criarSimuladorDeTeste(destinoDe(), { agora: relogio.agora, tMed: 0 }), relogio };
};
const ev = (chave: string) => ({ chave, dhEvento: new Date(INICIO.getTime() + 60_000) });

beforeAll(() => {
  a1DeTeste();
});

describe('rejeitarProximo (apoio de teste)', () => {
  it('autorizar (padrão): rejeita só o próximo envio, sem protocolo nem número gasto; o reenvio com o mesmo número autoriza', async () => {
    const { s } = novo();
    const n = nfeAssinada({ nNF: 5 });
    s.teste.rejeitarProximo({ cStat: '225' });
    const r = RespostaAutorizacao.parse(await s.autorizar({ idLote: '1', sincrono: true, nfes: [n.xml] }));
    expect(r.cStat).toBe('104');
    expect(r.protocolos[0]).toMatchObject({ chNFe: n.chave, cStat: '225', nProt: null, xMotivo: 'Rejeicao: Falha no Schema XML do lote de NFe' });
    const p = await autorizarUma(s, n.xml, '2');
    expect(p).toMatchObject({ chNFe: n.chave, cStat: '100' });
    expect(p.nProt).toMatch(/^9\d{14}$/);
    const outra = await autorizarUma(s, nfeAssinada({ nNF: 6 }).xml, '3');
    expect(outra.cStat).toBe('100');
  });

  it('consultarRecibo: rejeita só a próxima consulta; a seguinte devolve o lote processado', async () => {
    const { s } = novo();
    const lote = await s.autorizar({ idLote: '1', sincrono: false, nfes: [nfeAssinada({ nNF: 7 }).xml] });
    const nRec = lote.recibo!.nRec;
    s.teste.rejeitarProximo({ cStat: '106', operacao: 'consultarRecibo' });
    expect(RespostaConsultaRecibo.parse(await s.consultarRecibo({ nRec })).cStat).toBe('106');
    const ok = await s.consultarRecibo({ nRec });
    expect(ok.cStat).toBe('104');
    expect(ok.protocolos[0]?.cStat).toBe('100');
  });

  it('cancelar e cartaCorrecao: o retEvento sai rejeitado e o evento não é registrado; o próximo registra', async () => {
    const { s } = novo();
    const n = nfeAssinada({ nNF: 8 });
    const p = await autorizarUma(s, n.xml);
    s.teste.rejeitarProximo({ cStat: '501', operacao: 'cancelar' });
    s.teste.rejeitarProximo({ cStat: '573', operacao: 'cartaCorrecao' });
    const cce = RespostaEvento.parse(await s.cartaCorrecao({ idLote: '2', eventoAssinado: cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }) }));
    expect(cce).toMatchObject({ cStat: '128', eventos: [{ cStat: '573', nProt: null }] });
    expect((await s.cartaCorrecao({ idLote: '3', eventoAssinado: cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }) })).eventos[0]?.cStat).toBe('135');
    const canc = { idLote: '4', eventoAssinado: cancelamentoAssinado({ ...ev(n.chave), nProt: p.nProt! }) };
    expect((await s.cancelar(canc)).eventos[0]).toMatchObject({ cStat: '501', nProt: null });
    expect((await s.cancelar(canc)).eventos[0]?.cStat).toBe('135');
  });

  it('inutilizar: rejeita só a próxima, sem protocolo; a mesma faixa depois homologa (102)', async () => {
    const { s } = novo();
    const inut = { inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 9, nNFFin: 10 }) };
    s.teste.rejeitarProximo({ cStat: '241', operacao: 'inutilizar' });
    expect(RespostaInutilizacao.parse(await s.inutilizar(inut))).toMatchObject({ cStat: '241', nProt: null });
    expect((await s.inutilizar(inut)).cStat).toBe('102');
  });

  it('epec (ADR 0011): o retEvento sai rejeitado e a EPEC não é registrada; a próxima registra (136)', async () => {
    const { s } = novo();
    const epec = { idLote: '1', eventoAssinado: epecAssinada(nfeAssinada({ nNF: 13, tpEmis: 4 }).xml) };
    s.teste.rejeitarProximo({ cStat: '573', operacao: 'epec' });
    expect(RespostaEvento.parse(await s.epec(epec))).toMatchObject({ cStat: '128', cOrgao: 91, eventos: [{ cStat: '573', nProt: null }] });
    expect((await s.epec(epec)).eventos[0]?.cStat).toBe('136');
  });

  it('vale por operação: a rejeição de outra operação não afeta a autorização', async () => {
    const { s } = novo();
    s.teste.rejeitarProximo({ cStat: '241', operacao: 'inutilizar' });
    expect((await autorizarUma(s, nfeAssinada({ nNF: 11 }).xml)).cStat).toBe('100');
  });

  it('cStat fora da tabela MOTIVO (ou operação desconhecida) lança erro e não arma nada', async () => {
    const { s } = novo();
    expect(() => s.teste.rejeitarProximo({ cStat: '999' })).toThrow(RangeError);
    expect(() => s.teste.rejeitarProximo({ cStat: 'toString' })).toThrow(RangeError);
    expect(() => s.teste.rejeitarProximo({ cStat: '225', operacao: 'statusServico' as never })).toThrow(RangeError);
    expect((await autorizarUma(s, nfeAssinada({ nNF: 12 }).xml)).cStat).toBe('100');
  });

  it('cStat de sucesso (CSTAT_DE_SUCESSO) não é rejeição: RangeError e nada armado', async () => {
    const { s } = novo();
    const sucessos = ['100', '101', '102', '103', '104', '105', '107', '124', '128', '135', '136', '150', '151', '155'];
    expect([...CSTAT_DE_SUCESSO].sort()).toEqual(sucessos);
    for (const cStat of sucessos) {
      expect(() => s.teste.rejeitarProximo({ cStat }), cStat).toThrow(RangeError);
      expect(() => s.teste.rejeitarProximo({ cStat, operacao: 'cancelar' }), cStat).toThrow(/de sucesso/);
    }
    expect((await autorizarUma(s, nfeAssinada({ nNF: 15 }).xml)).cStat).toBe('100');
  });

  it('sem global: dois simuladores de teste não se enxergam; com a fábrica, vale o registro compartilhado', async () => {
    const a = novo().s;
    const b = novo().s;
    a.teste.rejeitarProximo({ cStat: '297' });
    expect((await autorizarUma(b, nfeAssinada({ nNF: 13 }).xml)).cStat).toBe('100');

    const registro = criarRegistroSimulador();
    const relogio = criarRelogio();
    const fabrica = criarFabricaSimulador({ registro, agora: relogio.agora });
    apoioDeTesteSimulador(registro, destinoDe()).rejeitarProximo({ cStat: '297' });
    const r = await fabrica(destinoDe()).autorizar({ idLote: '1', sincrono: true, nfes: [nfeAssinada({ nNF: 14 }).xml] });
    expect(r.protocolos[0]?.cStat).toBe('297');
    const de_novo = await fabrica(destinoDe()).autorizar({ idLote: '2', sincrono: true, nfes: [nfeAssinada({ nNF: 14 }).xml] });
    expect(de_novo.protocolos[0]?.cStat).toBe('100');
  });
});
