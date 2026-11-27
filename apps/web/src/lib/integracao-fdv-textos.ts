/**
 * Textos da Integração FDV para pessoas (T-0056, ADR 0013): só códigos do SDK viram frases aqui, nunca mensagem do Hub.
 * Usado pelo status do BKO (leitura) e pela aba Integração do /config (superadmin).
 */
import { ACOES_FDV_SO_DO_PORTAL, type AcaoSugeridaFdv, type MotivoFalhaEnvioFdv } from '@macuxierp/platform-sdk';
import { MSG_SEM_LICENCA } from '@macuxierp/integracao-fdv/contracts';
import { ROTULOS_FDV } from './config/operacao-fdv';

/** Faixa da aba Integração do /config sem licença: mesmo texto da API (`MSG_SEM_LICENCA`, #758). O motivo da linha (`licenca_erp`) só diz o fato; a ação fica aqui. */
export const TEXTO_SEM_LICENCA_FDV = MSG_SEM_LICENCA;

export const TEXTO_MOTIVO_FDV: Readonly<Record<MotivoFalhaEnvioFdv, string>> = {
  credencial: 'O FDV recusou a chave do conector.',
  licenca_fdv: 'A licença do FDV não permite o envio.',
  licenca_erp: 'Sem licença da Integração FDV.',
  versao: 'O FDV não aceita mais esta versão do conector.',
  envelope: 'O FDV recusou o formato do envio.',
  idempotencia: 'O FDV recusou um envio repetido.',
  topologia: 'Outro conector já envia este cadastro ao FDV.',
  lote_recusado: 'O FDV recusou o último envio.',
  lote_falhou: 'O último envio falhou.',
  erros_por_linha: 'Há registros com erro neste cadastro.',
};

const AGUARDAR = 'Aguarde: o envio se repete sozinho.';

const ACAO_TENANT: Partial<Record<AcaoSugeridaFdv, string>> = {
  corrigir_cadastros: 'Corrija os registros com erro no cadastro de origem.',
  aguardar_retentativa: AGUARDAR,
  regularizar_licenca: 'Regularize a licença com a Macuxi.',
};

/** BKO: ação que a empresa pode tomar; as que só o portal resolve viram "Fale com a Macuxi" (sem botão). */
export function acaoNoBko(acao: AcaoSugeridaFdv): string {
  return ACOES_FDV_SO_DO_PORTAL.includes(acao) ? 'Fale com a Macuxi.' : (ACAO_TENANT[acao] ?? 'Fale com a Macuxi.');
}

const ACAO_PORTAL: Record<AcaoSugeridaFdv, string> = {
  corrigir_cadastros: 'Corrija os cadastros de origem com a empresa.',
  aguardar_retentativa: AGUARDAR,
  regularizar_licenca: 'Regularize a licença da empresa.',
  corrigir_credencial: `Use "${ROTULOS_FDV.trocarChave}".`,
  atualizar_conector: 'Atualize o conector.',
  retomar: '', // a célula Falha mostra só o motivo; "Tentar de novo" já é o botão da linha (RD-2320)
  acionar_suporte: 'Analise o envio recusado com o suporte.',
};
export const acaoNoPortal = (acao: AcaoSugeridaFdv): string => ACAO_PORTAL[acao];
