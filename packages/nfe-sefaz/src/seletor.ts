/**
 * Seletor de transporte: o ÚNICO jeito de o faturamento (via worker) obter um `SefazTransporte` para uma filial.
 * O worker monta o seletor uma vez, com as fábricas, e pede o transporte por filial. Desenho T-0045, seção 3.1.
 */
import type { DestinoSefazReal, DestinoSimulador, FilialEmissoraSefaz, TransporteHomologacao } from './destino';
import { escolherDestinoSefaz, garantirDestinoSimulador } from './destino';
import { ErroSefaz } from './erros';
import type { SefazTransporte } from './porta';

/**
 * A1 decifrado na memória do worker (ADR 0005): usado na assinatura e no mTLS e descartado em seguida.
 * Nunca é logado, serializado, gravado em disco nem posto em recado.
 */
export interface CredencialA1EmMemoria {
  readonly pfx: Uint8Array;
  readonly senha: string;
}

/** Fábrica do transporte SOAP real com mTLS (dona: T-0018/T-0021, pacote do emissor). */
export type FabricaTransporteSefaz = (destino: DestinoSefazReal, credencial: CredencialA1EmMemoria) => SefazTransporte;
/** Fábrica do simulador (`criarSimuladorSefaz` do `@macuxierp/sefaz-simulador`). */
export type FabricaTransporteSimulador = (destino: DestinoSimulador) => SefazTransporte;

export interface OpcoesSeletorTransporte {
  /** Para onde vai a filial em homologação. Filial em produção com `simulador` lança `SimuladorEmProducaoErro`. */
  transporte: TransporteHomologacao;
  sefaz?: FabricaTransporteSefaz;
  simulador?: FabricaTransporteSimulador;
}

export type SeletorTransporte = (filial: FilialEmissoraSefaz, credencial: CredencialA1EmMemoria) => SefazTransporte;

export function criarSeletorTransporte(o: OpcoesSeletorTransporte): SeletorTransporte {
  return (filial, credencial) => {
    const destino = escolherDestinoSefaz(filial, { transporte: o.transporte });
    if (destino.tipo === 'simulador') {
      if (!o.simulador) throw new ErroSefaz('SEFAZ_TRANSPORTE_NAO_CONFIGURADO', 'Simulador da SEFAZ não configurado no worker');
      return o.simulador(garantirDestinoSimulador(destino));
    }
    if (!o.sefaz) throw new ErroSefaz('SEFAZ_TRANSPORTE_NAO_CONFIGURADO', 'Transporte real da SEFAZ não configurado no worker');
    return o.sefaz(destino, credencial);
  };
}
