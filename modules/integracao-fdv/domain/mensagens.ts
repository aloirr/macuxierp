/**
 * Catálogo de mensagens do ERP por código de erro (RN-INF-04). O monitor mostra só estas mensagens, nunca a mensagem crua
 * do Hub (que pode citar valor de dado pessoal). Texto em pt-BR, sem placeholder de valor.
 */
import { classificarResposta } from './resposta';

/** Causa e ação de um erro por linha: o Monitor junta as duas; o Log mostra separado (uma só frase de cada, sem repetir). */
export interface TextoErro { readonly motivo: string; readonly acao: string }

export const CATALOGO_ERRO: Readonly<Record<string, TextoErro>> = {
  chave_alterada: { motivo: 'O código do cadastro mudou sem a troca controlada.', acao: 'Faça a troca controlada ou volte ao código anterior.' },
  chave_duplicada: { motivo: 'Outro cadastro já usa este código no FDV.', acao: 'Corrija o código repetido.' },
  vinculo_divergente: { motivo: 'O cliente já está vinculado no FDV com outro código.', acao: 'Resolva a divergência do vínculo.' },
  campo_obrigatorio: { motivo: 'Campo obrigatório vazio no cadastro.', acao: 'Complete o campo indicado e salve de novo.' },
  campo_invalido: { motivo: 'Valor em formato inválido para o FDV.', acao: 'Corrija o campo indicado no cadastro.' },
  quantidade_fracionaria: { motivo: 'A quantidade tem casas decimais, e o Macuxi FDV só aceita número inteiro.', acao: 'Ajuste a quantidade para um número inteiro.' },
  prazo_medio_fora_da_faixa: { motivo: 'O prazo médio precisa ficar entre a menor e a maior parcela.', acao: 'Corrija a condição de pagamento no cadastro.' },
  referencia_ausente: { motivo: 'Depende de um cadastro que ainda não foi confirmado no FDV.', acao: 'Aguarde.' },
  filial_codigo_repetido: { motivo: 'Duas filiais têm a mesma ordem de CNPJ. O FDV identifica a filial por essa ordem.', acao: 'Revise as filiais.' },
  falha_processamento: { motivo: 'O FDV não conseguiu processar o registro.', acao: 'Use Reprocessar; se persistir, fale com o suporte.' },
  acima_do_limite: { motivo: 'O lote passou do limite do FDV.', acao: 'Aguarde.' },
  rede: { motivo: 'Sem resposta do FDV.', acao: 'Aguarde.' },
  limite_de_taxa: { motivo: 'O FDV pediu para aguardar.', acao: 'Aguarde.' },
  resposta_grande: { motivo: 'A resposta do FDV passou do limite aceito pelo ERP.', acao: 'Aguarde; se persistir, fale com o suporte.' },
  pedido_invalido: { motivo: 'O ERP montou uma chamada inválida ao FDV (defeito do ERP).', acao: 'Fale com o suporte informando o código.' },
};

/** Códigos que causam pausa: o status HTTP típico, para o motivo sair de `classificarResposta` (uma só fonte). */
const STATUS_DO_CODIGO_DE_PAUSA: Readonly<Record<string, number>> = {
  credencial_invalida: 401,
  chave_revogada: 403,
  credencial_revogada: 403,
  modulo_inativo: 403,
  abaixo_da_minima: 426,
  versao_conector_nao_suportada: 426,
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

const ACAO_GENERICA = 'Fale com o suporte informando o código.';

/** Causa do erro (Log do BKO). Código de pausa mostra o texto do motivo da pausa; desconhecido cai no genérico, nunca ecoa texto do Hub. */
export function motivoDoErro(codigo: string | null | undefined): string {
  if (!codigo) return GENERICA;
  const status = STATUS_DO_CODIGO_DE_PAUSA[codigo];
  if (status !== undefined) {
    const a = classificarResposta({ tipo: 'recusa', status, codigo });
    if (a.acao === 'pausar') return MENSAGENS_PAUSA[a.motivo] ?? GENERICA;
  }
  return CATALOGO_ERRO[codigo]?.motivo ?? GENERICA;
}

/** O que a pessoa faz para resolver o erro por linha (Log do BKO). Nunca texto do Hub. */
export function acaoDoErro(codigo: string | null | undefined): string {
  return (codigo ? CATALOGO_ERRO[codigo]?.acao : undefined) ?? ACAO_GENERICA;
}

/** Mensagem completa (causa e ação) do Monitor. Código de pausa e desconhecido já trazem a ação no próprio texto. */
export function mensagemDoErro(codigo: string | null | undefined): string {
  const t = codigo ? CATALOGO_ERRO[codigo] : undefined;
  return t ? `${t.motivo} ${t.acao}` : motivoDoErro(codigo);
}

export function mensagemDaPausa(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MENSAGENS_PAUSA[motivo] ?? GENERICA;
}
