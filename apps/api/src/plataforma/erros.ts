/**
 * SQLSTATE das funções da 0033 → erro HTTP do portal `/config` (ADR 0012 §4). Mensagens fixas: o texto do banco nunca
 * chega ao cliente nem ao log (pode trazer valor de coluna). O resto segue como está (ErroApi do plugin; erro de
 * programação vira 500 no handler global).
 */
import { ErroApi, erros } from '@macuxierp/platform-sdk';

/** SQLSTATE próprio da 0033: sessão de superadmin inválida (revogada, vencida, ociosa, inativa ou troca pendente). */
export const SQLSTATE_SESSAO_INVALIDA = 'MXS01';

export function erroDaPlataforma(e: unknown): unknown {
  if (e instanceof ErroApi) return e;
  switch ((e as { code?: unknown } | null)?.code) {
    case SQLSTATE_SESSAO_INVALIDA:
      return erros.naoAutenticado();
    case 'P0002': // no_data_found: empresa ou administrador inexistente
      return erros.naoEncontrado('Registro');
    case '23505': // unique_violation: empresa que já tem administrador, slug ou e-mail em uso
      return erros.conflito('Conflito com um registro existente');
    case '23514': // check_violation: slug reservado, fuso, situação, motivo, módulos, core desligado, senha que mudou
      return new ErroApi(422, 'REGRA_PLATAFORMA', 'Pedido recusado pelas regras da plataforma');
    default:
      return e;
  }
}
