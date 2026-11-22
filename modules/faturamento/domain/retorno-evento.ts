/** Interpretação do retorno da SEFAZ para eventos (cancelamento, CC-e) e inutilização (RN-FAT-01, RN-FAT-02, RN-FAT-03). Função pura. */

export type SituacaoEvento = 'registrado' | 'duplicado' | 'rejeitado';
export type SituacaoInutilizacao = 'registrada' | 'rejeitada' | 'ja_inutilizada';

/** 135 registrado e vinculado, 136 registrado sem vincular (CC-e), 155 cancelamento homologado fora do prazo. */
const EVENTO_REGISTRADO: ReadonlySet<string> = new Set(['135', '136', '155']);

/**
 * `573` (duplicidade de evento) quer dizer que a SEFAZ já tem o evento: a resposta anterior se perdeu. O chamador confirma pela consulta de
 * protocolo e só então registra; sem confirmação, vira rejeição.
 */
export function interpretarRetornoEvento(cStat: string): SituacaoEvento {
  if (EVENTO_REGISTRADO.has(cStat)) return 'registrado';
  return cStat === '573' ? 'duplicado' : 'rejeitado';
}

/**
 * `102` inutilização homologada. `563` (faixa já inutilizada) NUNCA rejeita: a resposta do envio anterior se perdeu, a SEFAZ tem a faixa e o banco não tem o
 * ProcInut; rejeitar soltaria a faixa como buraco sem protocolo. Os outros (256 cruza outra, 241 número usado) rejeitam.
 */
export function interpretarRetornoInutilizacao(cStat: string): SituacaoInutilizacao {
  if (cStat === '102') return 'registrada';
  return cStat === '563' ? 'ja_inutilizada' : 'rejeitada';
}
