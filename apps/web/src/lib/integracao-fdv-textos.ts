/**
 * Textos da Integração FDV para pessoas (T-0056, ADR 0013): só códigos do SDK viram frases aqui, nunca mensagem do Hub.
 * Usado pelo status do BKO (leitura) e pela aba Integração do /config (superadmin).
 */
import { ACOES_FDV_SO_DO_PORTAL, type AcaoSugeridaFdv, type MotivoFalhaEnvioFdv } from '@macuxierp/platform-sdk';

export const TEXTO_MOTIVO_FDV: Readonly<Record<MotivoFalhaEnvioFdv, string>> = {
  credencial: 'O FDV recusou a credencial do conector.',
  licenca_fdv: 'A licença do FDV não permite o envio.',
  licenca_erp: 'A licença da Integração FDV está vencida ou desligada.',
  versao: 'A versão do conector não é mais aceita.',
  envelope: 'O FDV recusou o formato do envio.',
  idempotencia: 'O FDV recusou um envio repetido.',
  topologia: 'Outro conector já envia este cadastro.',
  lote_recusado: 'O FDV recusou o último envio.',
  lote_falhou: 'O último envio falhou.',
  erros_por_linha: 'Há registros com erro neste cadastro.',
};

const ACAO_TENANT: Partial<Record<AcaoSugeridaFdv, string>> = {
  corrigir_cadastros: 'Corrija os registros com erro no cadastro de origem.',
  aguardar_retentativa: 'Aguarde: o envio tenta de novo sozinho.',
  regularizar_licenca: 'Regularize a licença com a Macuxi.',
};

/** BKO: ação que a empresa pode tomar; as que só o portal resolve viram "Fale com a Macuxi" (sem botão). */
export function acaoNoBko(acao: AcaoSugeridaFdv): string {
  return ACOES_FDV_SO_DO_PORTAL.includes(acao) ? 'Fale com a Macuxi.' : (ACAO_TENANT[acao] ?? 'Fale com a Macuxi.');
}

const ACAO_PORTAL: Record<AcaoSugeridaFdv, string> = {
  corrigir_cadastros: 'Corrija os cadastros de origem com a empresa.',
  aguardar_retentativa: 'Aguarde: o envio tenta de novo sozinho.',
  regularizar_licenca: 'Regularize a licença da empresa.',
  corrigir_credencial: 'Corrija a credencial do conector.',
  atualizar_conector: 'Atualize o conector.',
  retomar: 'Use "Tentar de novo".',
  acionar_suporte: 'Analise o envio recusado com o suporte.',
};
export const acaoNoPortal = (acao: AcaoSugeridaFdv): string => ACAO_PORTAL[acao];
