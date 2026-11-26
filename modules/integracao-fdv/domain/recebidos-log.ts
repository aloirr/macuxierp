/**
 * Recebidos do FDV no Log do cadastro (RN-INF-09; T-0110). Funções puras: decidem que linhas do pré-cadastro entram no Log e
 * com que texto. LGPD: o documento só sai mascarado e o payload nunca é lido (reaproveita `linhaDaRotaClienteRecebido`).
 */
import {
  MENSAGENS_RECUSA_PRE_CADASTRO_FDV,
  type ClienteRecebidoFdv,
  type EntidadeEnvioFdv,
} from '@macuxierp/platform-sdk';
import { linhaDaRotaClienteRecebido, type LinhaClienteRecebido } from './pre-cadastro-cliente';

/** Só o cadastro de clientes recebe pré-cadastro do FDV. */
export const ENTIDADE_COM_RECEBIDOS_NO_LOG: EntidadeEnvioFdv = 'cliente';

export interface RecebidosDoLog {
  readonly recebidos: ClienteRecebidoFdv[];
  readonly total: number;
}

/**
 * `limite` corta a lista (o resto fica no total). `totalNoBanco` é o total real, quando a consulta o conhece; o total nunca
 * é menor que o que foi devolvido. Fora de `cliente`: vazio e total 0.
 */
export function decidirRecebidosDoLog(p: {
  entidade: EntidadeEnvioFdv;
  linhas: readonly LinhaClienteRecebido[];
  limite: number;
  totalNoBanco?: number;
}): RecebidosDoLog {
  if (p.entidade !== ENTIDADE_COM_RECEBIDOS_NO_LOG) return { recebidos: [], total: 0 };
  const recebidos = p.linhas.slice(0, Math.max(0, p.limite)).map(linhaDaRotaClienteRecebido);
  return { recebidos, total: Math.max(p.totalNoBanco ?? p.linhas.length, p.linhas.length) };
}

const MOTIVO_GENERICO = 'O ERP recusou o cadastro. Fale com o suporte informando o código.';

/** Motivo legível do código de recusa; código desconhecido cai no genérico e nunca ecoa o texto recebido. */
export const motivoDaRecusaCliente = (codigo: string | null | undefined): string =>
  (codigo ? (MENSAGENS_RECUSA_PRE_CADASTRO_FDV as Readonly<Record<string, string>>)[codigo] : undefined) ?? MOTIVO_GENERICO;
