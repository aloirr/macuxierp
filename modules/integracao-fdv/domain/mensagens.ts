/**
 * Catálogo de mensagens do ERP por código de erro (RN-INF-04). O monitor mostra só estas mensagens, nunca a mensagem crua
 * do Hub (que pode citar valor de dado pessoal). Texto em pt-BR, sem placeholder de valor.
 */
import { REFERENCIAS_HUB } from './mapeamento';
import { classificarResposta } from './resposta';

/** Causa e ação de um erro por linha: o Monitor junta as duas; o Log mostra separado (uma só frase de cada, sem repetir). */
export interface TextoErro { readonly motivo: string; readonly acao: string }

export const CATALOGO_ERRO: Readonly<Record<string, TextoErro>> = {
  chave_alterada: { motivo: 'O código do cadastro mudou sem a troca controlada.', acao: 'Faça a troca controlada ou volte ao código anterior.' },
  chave_duplicada: { motivo: 'Outro cadastro já usa este código no FDV.', acao: 'Corrija o código repetido.' },
  vinculo_divergente: { motivo: 'O cliente já está vinculado no FDV com outro código.', acao: 'Resolva a divergência do vínculo.' },
  campo_obrigatorio: { motivo: 'Campo obrigatório vazio no cadastro.', acao: 'Complete o campo indicado e salve de novo.' },
  campo_invalido: { motivo: 'Valor em formato inválido para o FDV.', acao: 'Corrija o campo indicado no cadastro.' },
  quantidade_fracionaria: { motivo: 'Esta unidade não aceita fração; só KG e M, até 4 casas.', acao: 'Use número inteiro ou mude a unidade para KG ou M.' },
  prazo_medio_fora_da_faixa: { motivo: 'O prazo médio precisa ficar entre a menor e a maior parcela.', acao: 'Corrija a condição de pagamento no cadastro.' },
  referencia_ausente: { motivo: 'Aguardando um cadastro de que este depende ser confirmado no FDV.', acao: 'Nada a fazer: aguarde.' },
  filial_codigo_repetido: { motivo: 'Duas filiais têm a mesma ordem de CNPJ. O FDV identifica a filial por essa ordem.', acao: 'Revise as filiais.' },
  falha_processamento: { motivo: 'O FDV não conseguiu processar o registro.', acao: 'Use Reprocessar; se persistir, fale com o suporte.' },
  acima_do_limite: { motivo: 'O lote passou do limite do FDV.', acao: 'Aguarde.' },
  rede: { motivo: 'Sem resposta do FDV.', acao: 'Aguarde.' },
  limite_de_taxa: { motivo: 'O FDV pediu para aguardar.', acao: 'Aguarde.' },
  resposta_grande: { motivo: 'A resposta do FDV passou do limite aceito pelo ERP.', acao: 'Aguarde; se persistir, fale com o suporte.' },
  pedido_invalido: { motivo: 'O ERP montou uma chamada inválida ao FDV (defeito do ERP).', acao: 'Fale com a Macuxi.' },
};

const NOME_DO_ALVO: Readonly<Record<string, string>> = {
  filial: 'filial', forma_pagamento: 'forma de pagamento', produto: 'produto', vendedor: 'vendedor', cliente: 'cliente',
};

/** Campo da referência → nome do cadastro aguardado: o alvo vem de `REFERENCIAS_HUB`; a tabela de preço é o campo composto do preço. */
const NOME_DO_CAMPO: Readonly<Record<string, string>> = {
  tabela_external_id: 'tabela de preço',
  ...Object.fromEntries(Object.values(REFERENCIAS_HUB).flat().map(([campo, alvo]) => [campo, NOME_DO_ALVO[alvo] ?? alvo])),
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

/** Texto único de "sem licença" (ERP e FDV): a API usa o mesmo. */
export const MSG_SEM_LICENCA = 'Integração FDV sem licença nesta empresa. Ligue o módulo na aba Empresa.';

export const MENSAGENS_PAUSA: Readonly<Record<string, string>> = {
  credencial: 'O FDV recusou a chave do conector. Use "Trocar chave".',
  licenca_fdv: MSG_SEM_LICENCA,
  licenca_erp: MSG_SEM_LICENCA,
  versao: 'O FDV não aceita mais esta versão do conector. Fale com a Macuxi.',
  envelope: 'O FDV recusou o formato do envio. Fale com a Macuxi.',
  idempotencia: 'O FDV recusou um envio repetido. Fale com a Macuxi.',
  topologia: 'Outro conector já envia este cadastro ao FDV. Fale com a Macuxi.',
};

const GENERICA = 'Erro desconhecido. Fale com a Macuxi.';

const ACAO_GENERICA = 'Fale com a Macuxi.';

/** Causa do erro (Log do BKO). Código de pausa mostra o texto do motivo da pausa; desconhecido cai no genérico, nunca ecoa texto do Hub. */
export function motivoDoErro(codigo: string | null | undefined, campo?: string | null): string {
  if (!codigo) return GENERICA;
  const aguardado = codigo === 'referencia_ausente' && campo ? NOME_DO_CAMPO[campo] : undefined;
  if (aguardado) return `Aguardando ${aguardado} ser confirmada no FDV.`;
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
export function mensagemDoErro(codigo: string | null | undefined, campo?: string | null): string {
  const t = codigo ? CATALOGO_ERRO[codigo] : undefined;
  return t ? `${motivoDoErro(codigo, campo)} ${t.acao}` : motivoDoErro(codigo);
}

export function mensagemDaPausa(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MENSAGENS_PAUSA[motivo] ?? GENERICA;
}
