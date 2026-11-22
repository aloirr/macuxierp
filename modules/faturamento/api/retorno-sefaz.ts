/**
 * Normaliza as respostas reais da porta `SefazTransporte` (`@macuxierp/nfe-sefaz`) para o `RetornoSefaz` que o domínio
 * interpreta. O resultado da NOTA vem do `cStat` do `protNFe` (o 104 do lote é só "lote processado"); sem protocolo da chave,
 * vale o status do envelope (103 recibo aceito, 105 em processamento, 215/225 lote rejeitado, 217 "não consta").
 */
import type { ProtocoloNFe, RespostaAutorizacao, RespostaConsultaProtocolo, RespostaConsultaRecibo } from '@macuxierp/nfe-sefaz';
import type { RetornoSefaz } from './portas';

type Envelope = { cStat: string; xMotivo: string };

/** Retorno único: o `protNFe` da chave quando existe (o resultado da NOTA); sem ele, o status do envelope. */
const normalizar = (r: Envelope, p: Pick<ProtocoloNFe, 'cStat' | 'xMotivo' | 'nProt' | 'digVal' | 'dhRecbto' | 'xml'> | null | undefined, nRec: string | null = null): RetornoSefaz => ({
  cStat: p?.cStat ?? r.cStat,
  xMotivo: p?.xMotivo ?? r.xMotivo,
  nProt: p?.nProt ?? null,
  digVal: p?.digVal ?? null,
  dhRecbto: p?.dhRecbto ?? null,
  xmlProtocolo: p?.xml ?? null,
  nRec,
});

/** `autorizar`: síncrono já traz o protocolo; assíncrono traz o recibo (103); lote rejeitado traz só o status do envelope. */
export function retornoDaAutorizacao(r: RespostaAutorizacao, chave: string): RetornoSefaz {
  return normalizar(r, r.protocolos.find((x) => x.chNFe === chave), r.recibo?.nRec ?? null);
}

/** `consultarRecibo`: 104 com os protocolos; 105 ainda em processamento. */
export function retornoDoRecibo(r: RespostaConsultaRecibo, chave: string): RetornoSefaz {
  return normalizar(r, r.protocolos.find((x) => x.chNFe === chave), r.nRec);
}

/** `consultarProtocolo`: o `protNFe` da nota quando existe; sem ele, o status da consulta (ex.: 217). */
export function retornoDaConsulta(r: RespostaConsultaProtocolo): RetornoSefaz {
  return normalizar(r, r.protocolo);
}
