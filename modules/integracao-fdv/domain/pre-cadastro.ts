/**
 * Pré-cadastro de cliente do FDV (RN-INT-22, T-0059). Funções puras de adaptação; a regra de validação é do
 * modulo-cadastros (regra 2), aqui não há validador de documento, IE, UF ou IBGE.
 * Contrato do FDV: `aloirr/macuxifdv@79e5c6c` (`cliente-erp.ts`).
 * Premissas:
 * - P1: o reenvio vai para a mesma linha, e a situação fica no cadastros.
 * - P2: `erros` é aditivo e opcional no retorno.
 * - P7: o FDV não manda IBGE; o cadastros resolve o município pela cidade/UF ou pelo CEP (aviso ao modulo-cadastros).
 */
import type { ClienteParaErp, ErroCampoPreCadastro, RetornoCliente } from '../contracts';
import { RETORNO_ERROS_MAX, RETORNO_MOTIVO_MAX } from '../contracts';

/** Entrada do pré-cadastro no cadastros. Sem IBGE: o município vem por cidade/UF ou CEP. */
export type PreCadastroEntrada = {
  documento: string;
  razao_social: string;
  ie?: string;
  email?: string;
  endereco: {
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  };
};

/** Decisão do cadastros: aceito, ou recusado com erros por campo. Única união (RD-1470). */
export type ResultadoPreCadastro = { ok: true } | { ok: false; erros: ErroCampoPreCadastro[] };

/** RN-INT-22: converte o item do `/clientes/pendentes` na entrada do cadastros (sem validar nada). */
export function adaptarParaPreCadastroEntrada(item: ClienteParaErp): PreCadastroEntrada {
  const saida: PreCadastroEntrada = {
    documento: item.documento ?? '',
    razao_social: item.razao_social,
    endereco: {
      logradouro: item.logradouro ?? '',
      numero: item.numero ?? '',
      complemento: item.complemento ?? '',
      bairro: item.bairro ?? '',
      cidade: item.cidade ?? '',
      uf: item.uf ?? '',
      cep: item.cep ?? '',
    },
  };
  if (item.inscricao_estadual != null && item.inscricao_estadual.trim() !== '') saida.ie = item.inscricao_estadual;
  if (item.email != null && item.email.trim() !== '') saida.email = item.email;
  return saida;
}

export type BaseRetornoCliente = { cliente_uuid: string; revisao?: number; ocorrido_em: string };

/**
 * RN-INT-22: monta o `RetornoCliente`. Aceito vira `vinculado` com o `external_id` de `aceito`; recusado vira
 * `rejeitado_erp` com motivo fixo "N campo(s) recusado(s): campo1, campo2…" (só nomes de campo, nunca valor de dado),
 * cortado em 1000 caracteres, e `erros` cortado em 50. A `revisao` é a do item.
 */
export function montarRetornoCliente(
  base: BaseRetornoCliente,
  resultado: ResultadoPreCadastro,
  aceito?: { external_id: string },
): RetornoCliente {
  const comum = {
    versao_contrato: 'v1' as const,
    cliente_uuid: base.cliente_uuid,
    ...(base.revisao !== undefined ? { revisao: base.revisao } : {}),
    ocorrido_em: base.ocorrido_em,
  };
  if (resultado.ok) {
    if (!aceito) throw new Error('montarRetornoCliente: resultado ok exige o external_id de `aceito`');
    return { ...comum, status: 'vinculado', external_id: aceito.external_id };
  }
  const campos = resultado.erros.map((e) => e.campo);
  const texto = `${campos.length} campo(s) recusado(s): ${campos.join(', ')}`;
  const motivo = texto.length > RETORNO_MOTIVO_MAX ? `${texto.slice(0, RETORNO_MOTIVO_MAX - 1)}…` : texto;
  const erros = resultado.erros.slice(0, RETORNO_ERROS_MAX).map((e) => ({ ...e }));
  return { ...comum, status: 'rejeitado_erp', motivo, ...(erros.length > 0 ? { erros } : {}) };
}
