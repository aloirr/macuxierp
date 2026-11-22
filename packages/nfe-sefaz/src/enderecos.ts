/**
 * Endereços dos webservices da NF-e 4.00 usados pelo ERP: autorizador do AM e as contingências SVC-RS e SVC-AN.
 *
 * TODOS "A CONFERIR": vieram do mapa do sped-nfe (storage/wsnfe_4.00_mod55.xml, opção MIT, ADR 0002) porque a sessão
 * da nuvem não alcança os portais do governo. A T-0046 confere no Portal Nacional e no portal da SEFAZ-AM e troca
 * `conferido` para `true` aqui, com a data. Enquanto `conferido` for `false`, o seletor recusa produção
 * (`escolherDestinoSefaz`, erro `SEFAZ_ENDERECO_NAO_CONFERIDO`). Desenho: docs/desenho/T-0045.md, seção 2.3.
 */
import { z } from 'zod';
import type { AmbienteFiscal, ModalidadeContingencia, ModoEmissao, Uf } from './ambiente';

/** Serviços da NF-e 4.00 que o transporte chama. */
export const ServicoSefaz = z.enum([
  'autorizacao',
  'retAutorizacao',
  'consultaProtocolo',
  'statusServico',
  'recepcaoEvento',
  'inutilizacao',
]);
export type ServicoSefaz = z.infer<typeof ServicoSefaz>;

export const Autorizador = z.enum(['AM', 'SVC-RS', 'SVC-AN']);
export type Autorizador = z.infer<typeof Autorizador>;

/** URL por serviço; `null` quando o autorizador não oferece o serviço (a SVC não faz inutilização). */
export type UrlsSefaz = Readonly<Record<ServicoSefaz, string | null>>;

export interface EnderecosAutorizador {
  readonly urls: UrlsSefaz;
  /** `true` só depois de a T-0046 conferir no portal oficial (com a data no comentário da linha). */
  readonly conferido: boolean;
}

const FONTE_A_CONFERIR = false;

function am(host: string): EnderecosAutorizador {
  const base = `https://${host}/services2/services`;
  return {
    conferido: FONTE_A_CONFERIR,
    urls: {
      autorizacao: `${base}/NfeAutorizacao4`,
      retAutorizacao: `${base}/NfeRetAutorizacao4`,
      consultaProtocolo: `${base}/NfeConsulta4`,
      statusServico: `${base}/NfeStatusServico4`,
      recepcaoEvento: `${base}/RecepcaoEvento4`,
      inutilizacao: `${base}/NfeInutilizacao4`,
    },
  };
}

function svcRs(host: string): EnderecosAutorizador {
  const base = `https://${host}/ws`;
  return {
    conferido: FONTE_A_CONFERIR,
    urls: {
      autorizacao: `${base}/NfeAutorizacao/NFeAutorizacao4.asmx`,
      retAutorizacao: `${base}/NfeRetAutorizacao/NFeRetAutorizacao4.asmx`,
      consultaProtocolo: `${base}/NfeConsulta/NfeConsulta4.asmx`,
      statusServico: `${base}/NfeStatusServico/NfeStatusServico4.asmx`,
      recepcaoEvento: `${base}/recepcaoevento/recepcaoevento4.asmx`,
      inutilizacao: null,
    },
  };
}

function svcAn(host: string): EnderecosAutorizador {
  const base = `https://${host}`;
  return {
    conferido: FONTE_A_CONFERIR,
    urls: {
      autorizacao: `${base}/NFeAutorizacao4/NFeAutorizacao4.asmx`,
      retAutorizacao: `${base}/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx`,
      consultaProtocolo: `${base}/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx`,
      statusServico: `${base}/NFeStatusServico4/NFeStatusServico4.asmx`,
      recepcaoEvento: `${base}/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx`,
      inutilizacao: null,
    },
  };
}

function congelar<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) congelar(v);
    Object.freeze(o);
  }
  return o;
}

/** Tabela de endereços (a conferir na T-0046). */
export const ENDERECOS_SEFAZ: Readonly<Record<Autorizador, Readonly<Record<AmbienteFiscal, EnderecosAutorizador>>>> = congelar({
  AM: { homologacao: am('homnfe.sefaz.am.gov.br'), producao: am('nfe.sefaz.am.gov.br') },
  'SVC-RS': { homologacao: svcRs('nfe-homologacao.svrs.rs.gov.br'), producao: svcRs('nfe.svrs.rs.gov.br') },
  'SVC-AN': { homologacao: svcAn('hom.svc.fazenda.gov.br'), producao: svcAn('www.svc.fazenda.gov.br') },
});

/** Autorizador do modo normal por UF. A v1 emite só no AM; outra UF entra aqui com a conferência no portal. */
export const AUTORIZADOR_DA_UF: Readonly<Partial<Record<Uf, Autorizador>>> = Object.freeze({ AM: 'AM' });

/**
 * SEFAZ Virtual de contingência de cada UF. FONTE ÚNICA da tabela UF → SVC no ERP (ADR 0011): o faturamento não guarda
 * cópia, recebe esta tabela por parâmetro. Só o AM → SVC-RS, "A CONFERIR (fiscal), SEM CONFIRMAÇÃO NAS FONTES OFICIAIS
 * EM 22/11/2026": a fonte é o mapa do sped-nfe (`storage/wsnfe_4.00_mod55.xml`, commit 4596b89); o modulo-fiscal não
 * chegou aos portais na conferência de 22/11/2026, 07h12. As outras UFs ficam FORA até a conferência (nelas, só a EPEC,
 * quando o ERP tiver o autorizador da UF). Não acrescente UF sem a fonte oficial e a data neste comentário.
 */
export const SVC_DA_UF: Readonly<Partial<Record<Uf, Exclude<ModoEmissao, 'normal'>>>> = Object.freeze({ AM: 'svc-rs' });

/**
 * Recepção do evento EPEC (110140) no Ambiente Nacional (cOrgao 91), por ambiente. A CONFERIR (fiscal, T-0046): veio
 * do mapa do sped-nfe (`RecepcaoEPEC` da sigla AN, WSDL `RecepcaoEvento`, commit 4596b89); o Portal Nacional pode ter
 * migrado a EPEC para o `NFeRecepcaoEvento4`. Enquanto `conferido` for `false`, o seletor recusa produção (ADR 0011).
 */
export interface EnderecoEpec {
  readonly url: string;
  readonly conferido: boolean;
}

export const ENDERECOS_EPEC: Readonly<Record<AmbienteFiscal, EnderecoEpec>> = congelar({
  homologacao: { url: 'https://hom.nfe.fazenda.gov.br/RecepcaoEvento/RecepcaoEvento.asmx', conferido: FONTE_A_CONFERIR },
  producao: { url: 'https://www.nfe.fazenda.gov.br/RecepcaoEvento/RecepcaoEvento.asmx', conferido: FONTE_A_CONFERIR },
});

/**
 * UFs em que o ERP oferece a EPEC. A EPEC vai sempre ao Ambiente Nacional (evento 110140; ver `C_ORGAO_AN`), então
 * não há tabela própria por UF: vale para a UF que tem autorizador normal no ERP
 * (`AUTORIZADOR_DA_UF`, na v1 só o AM), porque a nota EPEC precisa ser transmitida a ele na volta (RN-FAT-09). Nenhuma
 * UF é acrescentada aqui à mão.
 */
export const EPEC_DA_UF: Readonly<Partial<Record<Uf, true>>> = Object.freeze(
  Object.fromEntries(Object.keys(AUTORIZADOR_DA_UF).map((uf) => [uf, true] as const)),
);

/**
 * Modalidades de contingência que a UF admite, na ordem de sugestão (a SVC primeiro: a nota sai autorizada na hora).
 * UF fora do `SVC_DA_UF` com autorizador no ERP: só a EPEC. UF sem autorizador no ERP: vazio. Quem decide entre elas
 * é o operador (RN-FAT-05); o sistema só sugere.
 */
export function modalidadesContingencia(uf: Uf): readonly ModalidadeContingencia[] {
  const svc = SVC_DA_UF[uf];
  return Object.freeze([...(svc ? [svc] : []), ...(EPEC_DA_UF[uf] ? (['epec'] as const) : [])]);
}
