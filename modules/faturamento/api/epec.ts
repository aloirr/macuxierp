/**
 * Retorno do evento EPEC (110140) do Ambiente Nacional, aplicado à nota (RN-FAT-05, RN-FAT-08, regra 7).
 * Só o cStat 136 (evento registrado, NF-e ainda não transmitida) conta: com ele, o `procEventoNFe` (evento assinado + retEvento) é guardado ANTES de qualquer
 * outra coisa e a nota vai, num ÚNICO UPDATE, de `em_autorizacao` a `emitida_contingencia` com `epec_protocolo` e `epec_autorizada_em` (gatilho B da 0032).
 * Rejeição vira `rejeitada` (nota.rejeitada@1; o reenvio segue a RN-FAT-07). Duplicidade (573) e lote sem protocolo do evento não mudam nada: a consulta é da etapa 4.
 * A nota EPEC NÃO publica `nota.autorizada@1` aqui: ela só é autorizada quando a NF-e for transmitida na volta (RN-FAT-09).
 */
import type { RespostaEvento } from '@macuxierp/nfe-sefaz';
import { TIPO_EVENTO } from '@macuxierp/nfe-sefaz';
import type { Transacao } from '@macuxierp/platform-sdk';
import { interpretarRetorno } from '../domain';
import { NotaRejeitadaPayload } from '../contracts';
import { EVENTO_NOTA_REJEITADA, mudarNota } from './emissao';
import { baseEventoDaNota } from './eventos';
import type { GuardaEpec, NotaRegistro, RepositorioNotas } from './portas';
import { montarProcEvento } from './xml-proc-eventos';

export type ResultadoEpec =
  | { resultado: 'epec_registrada'; nota: NotaRegistro; protocolo: string }
  | { resultado: 'rejeitada'; nota: NotaRegistro; codigo: string; mensagem: string; acao: string }
  /** Duplicidade (573) ou lote sem o protocolo do evento: nada muda, nenhum evento (a nota segue em `em_autorizacao`). */
  | { resultado: 'aguardando'; nota: NotaRegistro; codigo: string; mensagem: string }
  | { resultado: 'ja_processada'; nota: NotaRegistro };

/** cStat do evento EPEC registrado (Manual: 136 = evento registrado, mas não vinculado à NF-e). */
export const CSTAT_EPEC_REGISTRADA = '136';

export function criarProcessadorEpec(notas: RepositorioNotas, guarda: GuardaEpec) {
  /** `eventoAssinado`: o `<evento>` que o emissor assinou e enviou (o mesmo que fica guardado). Roda na tx do chamador, com a nota já travada. */
  return async function processarRetornoEpec(tx: Transacao, nota: NotaRegistro, resposta: RespostaEvento, eventoAssinado: string): Promise<ResultadoEpec> {
    if (nota.status !== 'em_autorizacao') return { resultado: 'ja_processada', nota };
    const registro = resposta.eventos.find((e) => e.chNFe === nota.chave_acesso && e.tpEvento === TIPO_EVENTO.epec && e.nSeqEvento === 1);
    const cStat = registro?.cStat ?? resposta.cStat;
    const xMotivo = registro?.xMotivo ?? resposta.xMotivo;

    if (cStat === CSTAT_EPEC_REGISTRADA && registro?.nProt) {
      const autorizadaEm = new Date(registro.dhRegEvento).toISOString();
      // Regra 7: o XML do evento é guardado ANTES de a nota mudar. Se a guarda lançar, a tx desfaz e a nota segue em_autorizacao (retry).
      await guarda.guardarXmlEpec(tx, nota, { conteudo: montarProcEvento(eventoAssinado, registro.xml), protocolo: registro.nProt, dhRegistro: autorizadaEm });
      const registrada = await mudarNota(notas, tx, nota, 'emitida_contingencia', { cStat, xMotivo, epec: { protocolo: registro.nProt, autorizadaEm } }, { epec_protocolo: registro.nProt, epec_autorizada_em: autorizadaEm });
      return { resultado: 'epec_registrada', nota: registrada, protocolo: registro.nProt };
    }

    // 573: a SEFAZ já tem o evento e a resposta se perdeu; 128 sem o protocolo do evento: resposta incompleta. Não rejeita (a consulta do evento é da etapa 4).
    if (cStat === '573' || (cStat === '128' && !registro)) return { resultado: 'aguardando', nota, codigo: cStat, mensagem: xMotivo };

    const r = interpretarRetorno(cStat, xMotivo);
    const acao = r.situacao === 'rejeitada' ? r.acao : 'Evento EPEC não registrado: confira a mensagem da SEFAZ, corrija e reenvie com o mesmo número (RN-FAT-07).';
    const rejeitada = await mudarNota(notas, tx, nota, 'rejeitada', { cStat, xMotivo });
    const payload = NotaRejeitadaPayload.parse({ ...baseEventoDaNota(rejeitada, null), codigo: cStat.padStart(3, '0').slice(0, 3), mensagem: xMotivo.slice(0, 1000), acao_sugerida: acao.slice(0, 500) });
    await notas.publicarEvento(tx, { nome: EVENTO_NOTA_REJEITADA, agregado_id: rejeitada.id, payload });
    return { resultado: 'rejeitada', nota: rejeitada, codigo: cStat, mensagem: xMotivo, acao };
  };
}
