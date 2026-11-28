/**
 * Ações do detalhe do pedido por perfil e status (T-0013 §2 e §4; RN-PED-02). Só esconde ou desabilita o botão:
 * a API revalida tudo e responde 403 ou 422 (RN-CORE-02).
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { possiveis } from '../domain/transicao';
import { errosPorCampo } from './erros';
import { AprovarEntrada, CancelarEntrada, RecusarEntrada, type CatalogoMotivos, type OrigemPedido, type PendenciaDetalhada, type StatusPedido } from '../contracts';

export interface PedidoParaAcao {
  status: StatusPedido;
  origem: OrigemPedido;
  pendencias: readonly Pick<PendenciaDetalhada, 'bloqueante'>[];
}

export interface AcoesDoPedido {
  /** Pedido bko em análise; só adm e gerente. */
  aprovar: boolean;
  /** `aprovar` com pendência bloqueante: o botão aparece desabilitado, pois a API devolve 422 RN-PED-03. */
  aprovarBloqueado: boolean;
  /** Há pendência não bloqueante: a aprovação pede a justificativa (sem ela a API devolve 400). */
  aprovarExigeJustificativa: boolean;
  recusar: boolean;
  /** `aprovado` ou `faturado_parcial`, nas duas origens; só adm e gerente. */
  cancelar: boolean;
  /** Pedido bko em análise; adm, gerente e faturista. */
  revalidar: boolean;
  /** Sempre `false` até a tela "Editar pedido" existir no BKO (decisão do PO, v0.3.30); o PUT `/pedidos/:id` continua na API. */
  editar: boolean;
}

export function acoesDoPedido(perfil: Perfil, p: PedidoParaAcao): AcoesDoPedido {
  const destinos = possiveis(p.status);
  const bkoEmAnalise = p.origem === 'bko' && destinos.includes('aprovado') && destinos.includes('recusado');
  const aprova = bkoEmAnalise && pode(perfil, 'pedido.pedido.aprovar');
  const lanca = bkoEmAnalise && pode(perfil, 'pedido.pedido.lancar');
  return {
    aprovar: aprova,
    aprovarBloqueado: aprova && p.pendencias.some((x) => x.bloqueante),
    aprovarExigeJustificativa: aprova && p.pendencias.some((x) => !x.bloqueante),
    recusar: aprova,
    cancelar: possiveis(p.status).includes('cancelado') && pode(perfil, 'pedido.pedido.cancelar'),
    revalidar: lanca,
    editar: false,
  };
}

/** Quem pode abrir "Novo pedido" (botão da lista). */
export const podeLancar = (perfil: Perfil): boolean => pode(perfil, 'pedido.pedido.lancar');

/** Aviso de LGPD sob o campo de texto livre: o texto de "outro" vai ao histórico e, no pedido do FDV, ao vendedor. */
export const AVISO_MOTIVO_FDV = 'Este texto vai ao vendedor no Macuxi FDV; não escreva dados pessoais.';
export const AVISO_MOTIVO_HISTORICO = 'Este texto fica no histórico do pedido; não escreva dados pessoais.';

export type DecisaoComMotivo = 'recusar' | 'cancelar';

/** O aviso aparece em todo motivo "outro" (recusa e cancelamento); o trecho do FDV só quando o pedido é do FDV. */
export const avisoDoMotivo = (origem: OrigemPedido, motivoCodigo: string): string | null => (motivoCodigo !== 'outro' ? null : origem === 'fdv' ? AVISO_MOTIVO_FDV : AVISO_MOTIVO_HISTORICO);

/** Motivos do seletor, do catálogo `GET /motivos`, na ordem da API. */
export const motivosDaDecisao = (c: CatalogoMotivos, decisao: DecisaoComMotivo) => (decisao === 'recusar' ? c.recusa : c.cancelamento);

export interface FormularioMotivo {
  motivo_codigo: string;
  motivo_texto: string;
}

export type ResultadoDecisao<T> = { ok: true; corpo: T } | { ok: false; erros: Record<string, string> };

const ESPECIFICAS_MOTIVO = { motivo_codigo: 'Motivo obrigatório. Escolha o motivo.', motivo_texto: 'Motivo obrigatório. Descreva o motivo.' };

/** Valida o motivo antes de enviar com o schema do contrato (a API revalida); o texto só segue em "outro". */
export function validarMotivo(decisao: DecisaoComMotivo, f: FormularioMotivo): ResultadoDecisao<RecusarEntrada | CancelarEntrada> {
  const schema = decisao === 'recusar' ? RecusarEntrada : CancelarEntrada;
  const texto = f.motivo_codigo === 'outro' ? f.motivo_texto.trim() : '';
  const r = schema.safeParse({ motivo_codigo: f.motivo_codigo, motivo_texto: texto || null });
  if (r.success) return { ok: true, corpo: r.data };
  return { ok: false, erros: errosPorCampo(r.error.issues, {}, ESPECIFICAS_MOTIVO) };
}

/** Valida a justificativa da aprovação: obrigatória na tela quando há pendência não bloqueante; o limite é o do contrato. */
export function validarAprovacao(exigeJustificativa: boolean, justificativa: string): ResultadoDecisao<AprovarEntrada> {
  const t = justificativa.trim();
  if (exigeJustificativa && !t) return { ok: false, erros: { justificativa: 'Justificativa obrigatória. Explique por que aprova com pendência.' } };
  const r = AprovarEntrada.safeParse(t ? { justificativa: t } : {});
  return r.success ? { ok: true, corpo: r.data } : { ok: false, erros: errosPorCampo(r.error.issues) };
}
