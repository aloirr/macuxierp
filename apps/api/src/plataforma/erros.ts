/**
 * SQLSTATE das funções da 0033 e da 0038 → erro HTTP do portal `/config` (ADR 0012 §4, ADR 0013 §2). Mensagens fixas: o texto do banco nunca
 * chega ao cliente nem ao log (pode trazer valor de coluna). O resto segue como está (ErroApi do plugin; erro de
 * programação vira 500 no handler global).
 */
import { ErroApi, erros, MENSAGEM_SEM_CREDENCIAL_FDV } from '@macuxierp/platform-sdk';

/** SQLSTATE próprio da 0033: sessão de superadmin inválida (revogada, vencida, ociosa, inativa ou troca pendente). */
export const SQLSTATE_SESSAO_INVALIDA = 'MXS01';
/** SQLSTATE próprios da 0038 (ADR 0013 §2, "Erros novos das funções"): sem credencial ativa, troca otimista, estado mudou. */
const SQLSTATE_SEM_CREDENCIAL_FDV = 'MXI01';
const SQLSTATE_CREDENCIAL_MUDOU = 'MXI02';
const SQLSTATE_ESTADO_MUDOU = 'MXI03';
/** SQLSTATE da 0039: escrita do portal em empresa fora de `ativo` ou sem o módulo `integracao-fdv` (ADR 0013 §2, emenda). */
const SQLSTATE_SEM_LICENCA_FDV = 'MXI04';

const MENSAGEM_CREDENCIAL_MUDOU = 'A credencial mudou; recarregue a página.';
const MENSAGEM_ESTADO_MUDOU = 'O estado mudou; recarregue a página.';
const MENSAGEM_SEM_LICENCA_FDV = 'A empresa precisa estar ativa e com o módulo Integração FDV licenciado.';

/**
 * O DETAIL do `MXI03` traz o código do domain (`portal_carga_completa` e `portal_retomar` da 0038). Só estes três passam a
 * `detalhes.codigo`; qualquer outro texto do banco fica de fora.
 */
const CODIGOS_ESTADO_MUDOU: ReadonlySet<string> = new Set(['entidade_desabilitada', 'lote_em_voo', 'sem_pausa']);
/** O DETAIL do `MXI04` (0039) traz o motivo; só estes dois passam a `detalhes.codigo`. */
const CODIGOS_SEM_LICENCA_FDV: ReadonlySet<string> = new Set(['empresa_inativa', 'modulo_desligado']);

function codigoDoDetalhe(e: unknown, permitidos: ReadonlySet<string>): { codigo: string } | undefined {
  const detalhe = (e as { detail?: unknown }).detail;
  return typeof detalhe === 'string' && permitidos.has(detalhe) ? { codigo: detalhe } : undefined;
}

export function erroDaPlataforma(e: unknown): unknown {
  if (e instanceof ErroApi) return e;
  switch ((e as { code?: unknown } | null)?.code) {
    case SQLSTATE_SESSAO_INVALIDA:
      return erros.naoAutenticado();
    case SQLSTATE_SEM_CREDENCIAL_FDV:
      return erros.conflito(MENSAGEM_SEM_CREDENCIAL_FDV);
    case SQLSTATE_CREDENCIAL_MUDOU:
      return erros.conflito(MENSAGEM_CREDENCIAL_MUDOU);
    case SQLSTATE_ESTADO_MUDOU:
      return new ErroApi(409, 'CONFLITO', MENSAGEM_ESTADO_MUDOU, undefined, codigoDoDetalhe(e, CODIGOS_ESTADO_MUDOU));
    case SQLSTATE_SEM_LICENCA_FDV:
      return new ErroApi(422, 'RN-CORE-02', MENSAGEM_SEM_LICENCA_FDV, undefined, codigoDoDetalhe(e, CODIGOS_SEM_LICENCA_FDV));
    case 'P0002': // no_data_found: empresa ou administrador inexistente
      return erros.naoEncontrado('Registro');
    case '23505': // unique_violation: empresa que já tem administrador, slug ou e-mail em uso
      return erros.conflito('Conflito com um registro existente');
    // check_violation: slug reservado, fuso, situação, motivo, módulos, core desligado, senha que mudou (0033); na 0038,
    // cadastro fora da F2 ou repetido, limite fora de 1 a 5.000, chave cifrada ausente e evento de carga inicial fora do
    // formato (empresa fora de `ativo` e módulo desligado saem como MXI04 desde a 0039).
    case '23514':
      return new ErroApi(422, 'REGRA_PLATAFORMA', 'Pedido recusado pelas regras da plataforma');
    default:
      return e;
  }
}
