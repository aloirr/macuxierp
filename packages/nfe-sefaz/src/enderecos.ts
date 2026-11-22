/**
 * Endereços dos webservices da NF-e 4.00 usados pelo ERP: autorizador do AM e as contingências SVC-RS e SVC-AN.
 *
 * TODOS "A CONFERIR": vieram do mapa do sped-nfe (storage/wsnfe_4.00_mod55.xml, opção MIT, ADR 0002) porque a sessão
 * da nuvem não alcança os portais do governo. A T-0046 confere no Portal Nacional e no portal da SEFAZ-AM e troca
 * `conferido` para `true` aqui, com a data. Enquanto `conferido` for `false`, o seletor recusa produção
 * (`escolherDestinoSefaz`, erro `SEFAZ_ENDERECO_NAO_CONFERIDO`). Desenho: docs/desenho/T-0045.md, seção 2.3.
 */
import { z } from 'zod';
import type { AmbienteFiscal, ModoEmissao, Uf } from './ambiente';

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

/** SEFAZ Virtual de contingência de cada UF (a conferir na T-0046; o sped-nfe mapeia o AM para a SVC-RS). */
export const SVC_DA_UF: Readonly<Partial<Record<Uf, Exclude<ModoEmissao, 'normal'>>>> = Object.freeze({ AM: 'svc-rs' });
