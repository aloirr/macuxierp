/**
 * Catálogo de mensagens do ERP por código de erro (RN-INF-04). O monitor mostra só estas mensagens, nunca a mensagem crua
 * do Hub (que pode citar valor de dado pessoal). Texto em pt-BR, sem placeholder de valor.
 */
import { classificarResposta } from './resposta';

export const MENSAGENS_ERRO: Readonly<Record<string, string>> = {
  campo_obrigatorio: 'Campo obrigatório vazio no cadastro. Complete o campo indicado e salve de novo.',
  campo_invalido: 'Valor em formato inválido para o FDV. Corrija o campo indicado no cadastro.',
  referencia_ausente: 'Depende de um cadastro que ainda não foi confirmado no FDV. O envio repete sozinho quando ele chegar.',
  filial_codigo_repetido: 'Duas filiais têm a mesma ordem de CNPJ. O FDV identifica a filial por essa ordem; revise as filiais.',
  falha_processamento: 'O FDV não conseguiu processar o registro. Tente de novo; se persistir, fale com o suporte.',
  acima_do_limite: 'O lote passou do limite do FDV. O ERP divide e reenvia.',
  rede: 'Sem resposta do FDV. O envio repete sozinho.',
  limite_de_taxa: 'O FDV pediu para aguardar. O envio repete sozinho.',
};

/** Códigos que causam pausa: o status HTTP típico, para o motivo sair de `classificarResposta` (uma só fonte). */
const STATUS_DO_CODIGO_DE_PAUSA: Readonly<Record<string, number>> = {
  credencial_invalida: 401,
  chave_revogada: 403,
  credencial_revogada: 403,
  modulo_inativo: 403,
  abaixo_da_minima: 426,
  chave_idempotencia_reutilizada: 409,
  entidade_de_outro_conector: 422,
};

export const MENSAGENS_PAUSA: Readonly<Record<string, string>> = {
  credencial: 'Credencial recusada pelo FDV. Troque a chave na tela Integração FDV e use "Tentar de novo".',
  licenca_fdv: 'Módulo de integração inativo no FDV para esta empresa. Peça a ativação e use "Tentar de novo".',
  licenca_erp: 'O módulo Integração FDV não está licenciado no ERP. Nada é enviado.',
  versao: 'O FDV recusou a versão do conector para esta entidade. Fale com o suporte.',
  envelope: 'O FDV recusou o formato do lote. Fale com o suporte e use "Tentar de novo" depois da correção.',
  idempotencia: 'Conflito de idempotência no envio. Fale com o suporte antes de tentar de novo.',
  topologia: 'Outro conector já alimenta esta entidade no FDV. Ajuste no FDV e use "Tentar de novo".',
};

const GENERICA = 'Erro não catalogado. Fale com o suporte informando o código.';

/** Mensagem do catálogo para o código; código desconhecido cai numa mensagem genérica (nunca ecoa texto do Hub). */
export function mensagemDoErro(codigo: string | null | undefined): string {
  if (!codigo) return GENERICA;
  const status = STATUS_DO_CODIGO_DE_PAUSA[codigo];
  if (status !== undefined) {
    const a = classificarResposta({ tipo: 'recusa', status, codigo });
    if (a.acao === 'pausar') return MENSAGENS_PAUSA[a.motivo] ?? GENERICA;
  }
  return MENSAGENS_ERRO[codigo] ?? GENERICA;
}

export function mensagemDaPausa(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MENSAGENS_PAUSA[motivo] ?? GENERICA;
}
