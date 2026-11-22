import { describe, expect, it } from 'vitest';
import {
  ErroSefaz,
  PedidoAutorizacao,
  PedidoEvento,
  ProtocoloNFe,
  RespostaAutorizacao,
  TAMANHO_MAXIMO_XML_SEFAZ,
  dataHoraSefaz,
  ehDataHoraSefaz,
  validarPedidoSefaz,
} from './index';

const CHAVE = '13261112345678000199550010000000011000000015';
const XML_DE_CLIENTE = '<NFe><infNFe><dest><xNome>Fulano</xNome></dest></infNFe></NFe>';

describe('pedidos da porta', () => {
  it('lote síncrono leva uma NF-e só; assíncrono até 50', () => {
    expect(PedidoAutorizacao.safeParse({ idLote: '1', sincrono: true, nfes: ['<NFe/>'] }).success).toBe(true);
    expect(PedidoAutorizacao.safeParse({ idLote: '1', sincrono: true, nfes: ['<NFe/>', '<NFe/>'] }).success).toBe(false);
    expect(PedidoAutorizacao.safeParse({ idLote: '1', sincrono: false, nfes: Array(50).fill('<NFe/>') }).success).toBe(true);
    expect(PedidoAutorizacao.safeParse({ idLote: '1', sincrono: false, nfes: Array(51).fill('<NFe/>') }).success).toBe(false);
    expect(PedidoAutorizacao.safeParse({ idLote: '1234567890123456', sincrono: false, nfes: ['<NFe/>'] }).success).toBe(false);
  });

  it('cada XML do pedido até 500 KB (o teto da mensagem da SEFAZ)', () => {
    const doTamanho = (n: number) => `<NFe>${' '.repeat(n - 11)}</NFe>`;
    expect(TAMANHO_MAXIMO_XML_SEFAZ).toBe(500_000);
    expect(PedidoAutorizacao.safeParse({ idLote: '1', sincrono: true, nfes: [doTamanho(500_000)] }).success).toBe(true);
    expect(PedidoAutorizacao.safeParse({ idLote: '1', sincrono: true, nfes: [doTamanho(500_001)] }).success).toBe(false);
    expect(PedidoEvento.safeParse({ idLote: '1', eventoAssinado: doTamanho(500_001) }).success).toBe(false);
  });

  it('validarPedidoSefaz lança erro tipado sem copiar o XML do cliente na mensagem', () => {
    let erro: unknown;
    try {
      validarPedidoSefaz(PedidoEvento, { idLote: 'x', eventoAssinado: XML_DE_CLIENTE });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroSefaz);
    expect((erro as ErroSefaz).codigo).toBe('SEFAZ_PEDIDO_INVALIDO');
    expect((erro as ErroSefaz).message).toContain('idLote');
    expect((erro as ErroSefaz).message).not.toContain('Fulano');
  });
});

describe('respostas da porta', () => {
  const protocolo = {
    tpAmb: 2,
    verAplic: 'AM4.00',
    chNFe: CHAVE,
    dhRecbto: '2026-11-21T22:59:00-04:00',
    nProt: '113260000000001',
    digVal: 'q1w2e3r4t5y6u7i8o9p0a1s2d3f=',
    cStat: '100',
    xMotivo: 'Autorizado o uso da NF-e',
    xml: '<protNFe versao="4.00"/>',
  };

  it('protocolo autorizado e rejeitado (sem nProt nem digVal)', () => {
    expect(ProtocoloNFe.safeParse(protocolo).success).toBe(true);
    expect(ProtocoloNFe.safeParse({ ...protocolo, cStat: '225', nProt: null, digVal: null }).success).toBe(true);
    expect(ProtocoloNFe.safeParse({ ...protocolo, tpAmb: 3 }).success).toBe(false);
    expect(ProtocoloNFe.safeParse({ ...protocolo, dhRecbto: '21/11/2026' }).success).toBe(false);
  });

  it('resposta síncrona com protocolo e assíncrona com recibo', () => {
    const base = { tpAmb: 2, verAplic: 'AM4.00', cUF: 13, dhRecbto: protocolo.dhRecbto, xml: '<retEnviNFe/>' };
    expect(
      RespostaAutorizacao.safeParse({ ...base, cStat: '104', xMotivo: 'Lote processado', recibo: null, protocolos: [protocolo] }).success,
    ).toBe(true);
    expect(
      RespostaAutorizacao.safeParse({
        ...base,
        cStat: '103',
        xMotivo: 'Lote recebido com sucesso',
        recibo: { nRec: '132000000000001', tMed: 1 },
        protocolos: [],
      }).success,
    ).toBe(true);
  });
});

describe('dataHoraSefaz', () => {
  it('formata em Manaus (-04:00) e o resultado é aceito pelo contrato', () => {
    const texto = dataHoraSefaz(new Date('2026-11-22T02:59:00Z'));
    expect(texto).toBe('2026-11-21T22:59:00-04:00');
    expect(ehDataHoraSefaz(texto)).toBe(true);
    expect(dataHoraSefaz(new Date('2026-11-22T02:59:00Z'), 0)).toBe('2026-11-22T02:59:00+00:00');
  });
});
