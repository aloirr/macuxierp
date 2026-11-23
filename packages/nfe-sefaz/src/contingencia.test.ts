/**
 * Contingência da NF-e (T-0021, ADR 0011; RN-FAT-05, 08 a 10): modalidades por UF, `tpEmis` aceito por modo, destino
 * da EPEC no Ambiente Nacional, a trava da RN-FAT-10 (filial simulada não entra em contingência) e os dados da EPEC.
 */
import { describe, expect, it, vi } from 'vitest';
import * as puro from './contingencia';
import {
  AUTORIZADOR_DA_UF,
  C_ORGAO_AN,
  EPEC_DA_UF,
  PRAZO_TRANSMISSAO_EPEC_HORAS,
  SVC_DA_UF,
  Uf,
  ENDERECOS_EPEC,
  ErroSefaz,
  ModalidadeContingencia,
  SimuladorEmProducaoErro,
  TP_EMIS,
  TP_EMIS_CONTINGENCIA,
  TpEmis,
  criarSeletorEpec,
  criarSeletorTransporte,
  dadosEpecDaNFe,
  dadosEpecDoEvento,
  divergenciasEpec,
  escolherDestinoEpec,
  escolherDestinoSefaz,
  garantirTpEmisDoDestino,
  modalidadesContingencia,
  montarEnvEvento,
  tpEmisAceito,
  tpEmisDaNFe,
  validarXsd,
  type DestinoEpec,
  type SefazTransporteEpec,
} from './index';
import { INSTANTE_DE_TESTE, assinarXmlDeTeste, gerarA1DeTeste, montarEpecDeTeste, montarNFeDeTeste } from './teste';

const FILIAL = '7f1c2a50-3b8e-4c1d-9a2f-0e6b5d4c3a21';
const homologacao = { filial_id: FILIAL, ambiente: 'homologacao', uf: 'AM' } as const;
const producao = { filial_id: FILIAL, ambiente: 'producao', uf: 'AM' } as const;
const credencial = { pfx: new Uint8Array([1]), senha: 'falsa-de-teste' };

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroSefaz ? e.codigo : 'ERRO_NAO_TIPADO';
  }
  return undefined;
}

describe('modalidades e tpEmis (Manual 4.00; ADR 0011)', () => {
  it('tpEmis: 4 EPEC, 6 SVC-AN, 7 SVC-RS; FS-DA (5) fora da v1', () => {
    expect(TP_EMIS_CONTINGENCIA).toEqual({ 'svc-an': 6, 'svc-rs': 7, epec: 4 });
    expect(ModalidadeContingencia.options).toEqual(['svc-an', 'svc-rs', 'epec']);
    for (const t of [1, 4, 6, 7]) expect(TpEmis.safeParse(t).success).toBe(true);
    for (const t of [2, 3, 5, 8, 9]) expect(TpEmis.safeParse(t).success).toBe(false);
  });

  it('o AM sugere a SVC-RS e a EPEC; UF sem autorizador no ERP não tem contingência', () => {
    expect(modalidadesContingencia('AM')).toEqual(['svc-rs', 'epec']);
    expect(modalidadesContingencia('SP')).toEqual([]);
  });

  // Situação e fonte da tabela: ver `SVC_DA_UF` (ADR 0011). Este teste quebra de propósito se alguém acrescentar UF sem
  // a fonte oficial.
  it('SVC_DA_UF (fonte única UF → SVC): só o AM → SVC-RS até a conferência das fontes oficiais', () => {
    expect(SVC_DA_UF).toEqual({ AM: 'svc-rs' });
  });

  it('EPEC (Ambiente Nacional, NT 2013.004): nenhuma UF à mão, só as que têm autorizador no ERP; fora do SVC, só EPEC', () => {
    expect(Object.keys(EPEC_DA_UF).sort()).toEqual(Object.keys(AUTORIZADOR_DA_UF).sort());
    for (const uf of Uf.options) {
      const m = modalidadesContingencia(uf);
      if (!SVC_DA_UF[uf]) expect(m).toEqual(AUTORIZADOR_DA_UF[uf] ? ['epec'] : []);
    }
  });

  it('o subcaminho puro "/contingencia" expõe a mesma fonte (prazo 168 h da autorização do EPEC, Ajuste SINIEF 07/05)', () => {
    expect(puro.PRAZO_TRANSMISSAO_EPEC_HORAS).toBe(168);
    expect(puro.PRAZO_TRANSMISSAO_EPEC_HORAS).toBe(PRAZO_TRANSMISSAO_EPEC_HORAS);
    expect(puro.SVC_DA_UF).toBe(SVC_DA_UF);
    expect(puro.TP_EMIS_CONTINGENCIA).toBe(TP_EMIS_CONTINGENCIA);
    expect(puro.C_ORGAO_AN).toBe(91);
  });

  it('o autorizador normal aceita 1 e 4 (EPEC na volta); a SVC só a própria', () => {
    expect([1, 4, 6, 7].filter((t) => tpEmisAceito('normal', t))).toEqual([1, 4]);
    expect([1, 4, 6, 7].filter((t) => tpEmisAceito('svc-rs', t))).toEqual([7]);
    expect([1, 4, 6, 7].filter((t) => tpEmisAceito('svc-an', t))).toEqual([6]);
    expect(codigo(() => garantirTpEmisDoDestino('normal', 7, 'NF-e'))).toBe('SEFAZ_CONTINGENCIA_INVALIDA');
    expect(codigo(() => garantirTpEmisDoDestino('svc-rs', 7, 'NF-e'))).toBeUndefined();
  });
});

describe('RN-FAT-10: filial com NF-e simulada não entra em contingência', () => {
  it('SVC com transporte "simulador" é recusada; com "sefaz" (homologação real) passa', () => {
    expect(codigo(() => escolherDestinoSefaz({ ...homologacao, modo: 'svc-rs' }, { transporte: 'simulador' }))).toBe(
      'SEFAZ_CONTINGENCIA_SIMULADA',
    );
    expect(escolherDestinoSefaz({ ...homologacao, modo: 'svc-rs' }, { transporte: 'sefaz' })).toMatchObject({
      tipo: 'sefaz',
      tpEmis: TP_EMIS['svc-rs'],
    });
  });

  it('o seletor da autorização nunca chama a fábrica do simulador em contingência', () => {
    const simulador = vi.fn();
    const seletor = criarSeletorTransporte({ transporte: 'simulador', simulador });
    expect(codigo(() => seletor({ ...homologacao, modo: 'svc-rs' }, credencial))).toBe('SEFAZ_CONTINGENCIA_SIMULADA');
    expect(simulador).not.toHaveBeenCalled();
  });

  it('EPEC com transporte "simulador": recusada (e produção continua com a trava da regra 7)', () => {
    expect(codigo(() => escolherDestinoEpec(homologacao, { transporte: 'simulador' }))).toBe('SEFAZ_CONTINGENCIA_SIMULADA');
    expect(() => escolherDestinoEpec(producao, { transporte: 'simulador' })).toThrow(SimuladorEmProducaoErro);
  });
});

describe('destino da EPEC (Ambiente Nacional, cOrgao 91)', () => {
  it('homologação real: AN, tpEmis 4, URL de homologação "a conferir"', () => {
    const d = escolherDestinoEpec(homologacao, { transporte: 'sefaz' });
    expect(d).toEqual({
      tipo: 'epec',
      filial_id: FILIAL,
      uf: 'AM',
      cUF: 13,
      ambiente: 'homologacao',
      tpAmb: 2,
      tpEmis: 4,
      cOrgao: C_ORGAO_AN,
      autorizador: 'AN',
      url: ENDERECOS_EPEC.homologacao.url,
      conferido: false,
    });
    expect(Object.isFrozen(d)).toBe(true);
    expect(new URL(d.url).protocol).toBe('https:');
  });

  it('produção com endereço "a conferir" é bloqueada; UF sem EPEC e filial fora do contrato também', () => {
    expect(codigo(() => escolherDestinoEpec(producao, { transporte: 'sefaz' }))).toBe('SEFAZ_ENDERECO_NAO_CONFERIDO');
    expect(codigo(() => escolherDestinoEpec({ ...homologacao, uf: 'SP' }, { transporte: 'sefaz' }))).toBe(
      'SEFAZ_CONTINGENCIA_INVALIDA',
    );
    expect(codigo(() => escolherDestinoEpec({ ...homologacao, modo: 'normal' } as never, { transporte: 'sefaz' }))).toBe(
      'SEFAZ_FILIAL_INVALIDA',
    );
    expect(codigo(() => escolherDestinoEpec(homologacao, { transporte: 'outro' as never }))).toBe(
      'SEFAZ_TRANSPORTE_NAO_CONFIGURADO',
    );
  });

  it('o seletor da EPEC entrega o destino à fábrica real; sem fábrica, erro de configuração', () => {
    const falso = (destino: DestinoEpec) => ({ destino }) as unknown as SefazTransporteEpec;
    const sefaz = vi.fn(falso);
    const t = criarSeletorEpec({ transporte: 'sefaz', sefaz })(homologacao, credencial);
    expect(t.destino).toMatchObject({ tipo: 'epec', cOrgao: 91 });
    expect(sefaz).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'epec' }), credencial);
    expect(codigo(() => criarSeletorEpec({ transporte: 'sefaz' })(homologacao, credencial))).toBe(
      'SEFAZ_TRANSPORTE_NAO_CONFIGURADO',
    );
  });
});

describe('dados da EPEC: a NF-e e o evento resumem o mesmo', () => {
  const nfe = montarNFeDeTeste({ nNF: 10, dhEmi: INSTANTE_DE_TESTE, tpEmis: 4 });

  it('a NF-e de teste com tpEmis 4 leva dhCont e xJust e a chave com o 4', async () => {
    expect(tpEmisDaNFe(nfe.xml)).toBe(4);
    expect(nfe.chave.charAt(34)).toBe('4');
    expect(nfe.xml).toMatch(/<verProc>[^<]+<\/verProc><dhCont>[^<]+<\/dhCont><xJust>[^<]{15,256}<\/xJust><\/ide>/);
    expect(tpEmisDaNFe('<x/>')).toBe(0);
  });

  it('o evento montado da NF-e confere (sem divergência) e passa no XSD da EPEC assinado', async () => {
    const evento = montarEpecDeTeste(nfe.xml, { dhEvento: INSTANTE_DE_TESTE });
    const daNfe = dadosEpecDaNFe(nfe.xml)!;
    const doEvento = dadosEpecDoEvento(evento)!;
    expect(daNfe).toMatchObject({ chNFe: nfe.chave, tpAmb: '2', cOrgaoAutor: '13', tpNF: '1', dest: { UF: 'AM' } });
    expect(divergenciasEpec(daNfe, doEvento)).toEqual([]);
    const assinado = assinarXmlDeTeste(evento, { elemento: 'infEvento', a1: gerarA1DeTeste() });
    expect((await validarXsd(montarEnvEvento('1', assinado), 'envEPEC')).erros).toEqual([]);
  });

  it('divergência cita só o nome do campo, nunca o valor', () => {
    const daNfe = dadosEpecDaNFe(nfe.xml)!;
    const outro = { ...daNfe, vNF: '1.00', dest: { ...daNfe.dest, documento: { tag: 'CPF' as const, valor: '12345678909' } } };
    expect(divergenciasEpec(daNfe, outro)).toEqual(['dest.documento', 'vNF']);
  });

  it('XML que não é NF-e nem EPEC dá null', () => {
    expect(dadosEpecDaNFe('<x/>')).toBeNull();
    expect(dadosEpecDoEvento(montarEnvEvento('1', '<x/>'))).toBeNull();
  });
});
