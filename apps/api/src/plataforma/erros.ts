/**
 * SQLSTATE das funções da 0033, da 0038 e das cargas do portal (T-0058) → erro HTTP do portal `/config` (ADR 0012 §4, ADR 0013 §2). Mensagens fixas: o texto do banco nunca
 * chega ao cliente nem ao log (pode trazer valor de coluna). O resto segue como está (ErroApi do plugin; erro de
 * programação vira 500 no handler global).
 */
import {
  CODIGO_SEM_ACESSO_CONFIG,
  CODIGO_TROCAR_SENHA,
  CODIGOS_ESTADO_MUDOU_ZERAR,
  ErroApi,
  erros,
  MENSAGEM_SEM_ACESSO_CONFIG,
  MENSAGEM_SEM_CREDENCIAL_FDV,
  MENSAGENS_CARGA_PORTAL,
  SQLSTATES_CARGA_PORTAL,
} from '@macuxierp/platform-sdk';
import { MSG_SEM_LICENCA } from '@macuxierp/integracao-fdv/contracts';

/** SQLSTATE próprio da 0033: sessão de superadmin inválida (revogada, vencida, ociosa, inativa ou troca pendente). */
export const SQLSTATE_SESSAO_INVALIDA = 'MXS01';
/** SQLSTATE próprios da 0038 (ADR 0013 §2, "Erros novos das funções"): sem credencial ativa, troca otimista, estado mudou. */
const SQLSTATE_SEM_CREDENCIAL_FDV = 'MXI01';
const SQLSTATE_CREDENCIAL_MUDOU = 'MXI02';
const SQLSTATE_ESTADO_MUDOU = 'MXI03';
/** SQLSTATE da 0039: escrita do portal em empresa fora de `ativo` ou sem o módulo `integracao-fdv` (ADR 0013 §2, emenda). */
const SQLSTATE_SEM_LICENCA_FDV = 'MXI04';

/**
 * SQLSTATE próprios da 0076 (45 A, ADR 0012 §1-A), da `superadmin_abrir_sessao_pelo_bko`: o usuário do BKO com troca de
 * senha pendente e o usuário sem um superadmin válido com o mesmo e-mail.
 */
const SQLSTATE_BKO_TROCA_PENDENTE = 'MXS11';
const SQLSTATE_SEM_ACESSO_CONFIG = 'MXS12';

/** Os dois SQLSTATE da 0076 → 403 com mensagem fixa; `null` para qualquer outro erro (segue como está). */
export function erroEntrarPeloBko(e: unknown): ErroApi | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === SQLSTATE_BKO_TROCA_PENDENTE) return new ErroApi(403, CODIGO_TROCAR_SENHA, MENSAGEM_TROCAR_SENHA_BKO);
  if (code === SQLSTATE_SEM_ACESSO_CONFIG) return new ErroApi(403, CODIGO_SEM_ACESSO_CONFIG, MENSAGEM_SEM_ACESSO_CONFIG);
  return null;
}

const MENSAGEM_TROCAR_SENHA_BKO = 'Troque a sua senha antes de abrir a Configuração.';
const MENSAGEM_CREDENCIAL_MUDOU = 'A credencial mudou; recarregue a página.';
const MENSAGEM_ESTADO_MUDOU = 'O estado mudou; recarregue a página.';
/** Texto do bloqueio por motivo (36 A, RD-2324): sem motivo conhecido, vale o da licença do ERP, do catálogo da integração (RD-2340). */
const MENSAGEM_EMPRESA_INATIVA_FDV = 'A empresa precisa estar ativa.';

/**
 * O DETAIL do `MXI03` traz o código do domain (`portal_carga_completa` e `portal_retomar` da 0038; o zerar: `lote_em_voo`).
 * Só estes passam a `detalhes.codigo`; qualquer outro texto do banco fica de fora.
 */
const CODIGOS_ESTADO_MUDOU: ReadonlySet<string> = new Set(['entidade_desabilitada', 'lote_em_voo', 'sem_pausa']);
/**
 * O DETAIL do `MXI04` (0039) e do `MXC04` (`cadastros.portal_carga_iniciar`, T-0058) traz o motivo; só estes dois passam
 * a `detalhes.codigo`.
 */
const CODIGOS_SEM_LICENCA: ReadonlySet<string> = new Set(['empresa_inativa', 'modulo_desligado']);

/**
 * `MXC03` do "Zerar dados" (`cadastros.portal_zerar`, 0043, RN-CAD-10): o estado mudou entre o plano e o efeito. O DETAIL
 * passa a `detalhes.codigo` só pela lista fechada do SDK (`CODIGOS_ESTADO_MUDOU_ZERAR`); outro texto do banco fica de fora.
 */
const SQLSTATE_ZERAR_ESTADO_MUDOU = 'MXC03';
const CODIGOS_ZERAR_ESTADO_MUDOU: ReadonlySet<string> = new Set(CODIGOS_ESTADO_MUDOU_ZERAR);

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
    case SQLSTATE_SEM_LICENCA_FDV: {
      const motivo = codigoDoDetalhe(e, CODIGOS_SEM_LICENCA);
      const texto = motivo?.codigo === 'empresa_inativa' ? MENSAGEM_EMPRESA_INATIVA_FDV : MSG_SEM_LICENCA;
      return new ErroApi(422, 'RN-CORE-02', texto, undefined, motivo);
    }
    // Cargas do portal (T-0058, ADR 0013, adendo de 23/11/2026). MXC01: código fixo do contrato
    // (`CODIGOS_DETALHE_CARGA_PORTAL`), nunca o DETAIL do banco; MXC04: o DETAIL só pela lista fechada, como o MXI04.
    case SQLSTATES_CARGA_PORTAL.cargaEmAndamento:
      return new ErroApi(409, 'CONFLITO', MENSAGENS_CARGA_PORTAL.cargaEmAndamento, undefined, { codigo: 'carga_em_andamento' });
    case SQLSTATE_ZERAR_ESTADO_MUDOU:
      return new ErroApi(409, 'CONFLITO', MENSAGENS_CARGA_PORTAL.estadoMudouZerar, undefined, codigoDoDetalhe(e, CODIGOS_ZERAR_ESTADO_MUDOU));
    case SQLSTATES_CARGA_PORTAL.semLicenca:
      return new ErroApi(422, 'RN-CORE-02', MENSAGENS_CARGA_PORTAL.semLicenca, undefined, codigoDoDetalhe(e, CODIGOS_SEM_LICENCA));
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
