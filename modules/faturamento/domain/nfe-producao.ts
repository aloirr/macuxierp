import type { StatusNota } from '../contracts';

/**
 * RN-CORE-16 (na dúvida, bloqueia): status de nota em produção que travam a troca do CNPJ da empresa.
 * - `autorizada`, `autorizada_guarda_pendente`: o CNPJ já foi usado na SEFAZ.
 * - `cancelada`: só se cancela nota autorizada (RN-FAT-02; CHECK `nota_protocolada`).
 * - `emitida_contingencia`: o DANFE e o XML já saíram assinados com o CNPJ atual e a nota ainda será autorizada.
 * - `em_autorizacao`: a SEFAZ pode devolver "autorizada" logo depois da troca.
 * Não travam: homologação (qualquer status), rascunho, rejeitada, denegada e inutilizada.
 * Fonte única: a consulta SQL do `api` recebe esta lista como parâmetro (`ambiente = 'producao'` fica na SQL).
 */
export const STATUS_NFE_QUE_TRAVA_TROCA_CNPJ: readonly StatusNota[] = [
  'autorizada_guarda_pendente',
  'autorizada',
  'cancelada',
  'em_autorizacao',
  'emitida_contingencia',
];

