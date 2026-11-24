/**
 * Pré-cadastro de cliente do FDV (RN-INT-22, T-0059). Funções puras de adaptação; a regra de validação é do
 * modulo-cadastros (regra 2), aqui não há validador de documento, IE, UF ou IBGE.
 * Premissas (aguardam as perguntas ao PO do FDV):
 * - P1: o reenvio vai para a mesma linha, e a situação fica no cadastros.
 * - P2: `erros` é aditivo e opcional no retorno; `motivo` continua obrigatório.
 * - P6: mesmo status com outro motivo devolve 200 (é da P2, a porta HTTP).
 */
import type { ClienteParaErp, ErroCampoPreCadastro, RetornoCliente } from '../contracts';

/** Entrada do pré-cadastro no cadastros (tipos espelham o contrato do cadastros até o PR dele entrar). */
export type PreCadastroEntrada = {
  documento: string;
  razao_social: string;
  ie?: string;
  email?: string;
  endereco: { uf: string; municipio_ibge: string; cep: string };
};

/** Decisão do cadastros: aceito com o `external_id` do cliente criado, ou recusado com erros por campo. */
export type ResultadoPreCadastro =
  | { ok: true; external_id: string }
  | { ok: false; erros: readonly ErroCampoPreCadastro[] };

/** RN-INT-22: converte o item do `/clientes/pendentes` na entrada do cadastros (sem validar nada). */
export function adaptarParaPreCadastroEntrada(item: ClienteParaErp): PreCadastroEntrada {
  const saida: PreCadastroEntrada = {
    documento: item.documento,
    razao_social: item.razao_social ?? '',
    endereco: { uf: item.uf ?? '', municipio_ibge: item.municipio_ibge ?? '', cep: item.cep ?? '' },
  };
  if (item.inscricao_estadual != null && item.inscricao_estadual.trim() !== '') saida.ie = item.inscricao_estadual;
  if (item.email != null && item.email.trim() !== '') saida.email = item.email;
  return saida;
}

const LIMITE_MOTIVO = 300;

/**
 * RN-INT-22: monta o `RetornoCliente`. Aceito vira `vinculado`; recusado vira `rejeitado_erp` com motivo fixo
 * "N campo(s) recusado(s): campo1, campo2…" (só nomes de campo, nunca valor de dado), cortado em 300 caracteres.
 */
export function montarRetornoCliente(r: ResultadoPreCadastro): RetornoCliente {
  if (r.ok) return { status: 'vinculado', external_id: r.external_id };
  const campos = r.erros.map((e) => e.campo);
  const texto = `${campos.length} campo(s) recusado(s): ${campos.join(', ')}`;
  const motivo = texto.length > LIMITE_MOTIVO ? `${texto.slice(0, LIMITE_MOTIVO - 1)}…` : texto;
  return { status: 'rejeitado_erp', motivo, erros: r.erros.map((e) => ({ ...e })) };
}
