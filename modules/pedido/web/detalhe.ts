/**
 * Detalhe do pedido (RF-PED-04): cabeçalho, itens, pendências com esperado e informado, histórico e decisão, já
 * formatados para a tela (R$, quantidade, data no fuso do tenant, português). Funções puras sobre o contrato `Pedido`.
 */
import { textoMotivo, textoMotivoSistema } from '../domain/motivos';
import { MotivoCodigo, type CodigoPendencia, type HistoricoPedido, Pedido, PendenciaDetalhada } from '../contracts';
import { formatarCentavos, formatarDataHora, formatarDocumento, formatarPontosBase, formatarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { ROTULO_ORIGEM, ROTULO_STATUS } from './lista';

export const ROTULO_PENDENCIA: Readonly<Record<CodigoPendencia, string>> = {
  cliente_inativo: 'Cliente inativo',
  produto_inativo: 'Produto inativo',
  filial_nao_emissora: 'Filial não emissora de nota',
  condicao_ausente: 'Sem condição de pagamento',
  condicao_inativa: 'Condição de pagamento inativa',
  prazo_incompleto: 'Prazo de pagamento incompleto (RN-PED-07)',
  prazo_acima_do_cliente: 'Prazo acima do prazo médio do cliente (RN-PED-07)',
  preco_sem_tabela: 'Produto sem preço na tabela',
  desconto_acima_maximo: 'Desconto acima do máximo',
  credito_sem_limite: 'Cliente sem limite de crédito',
  credito_excedido: 'Limite de crédito excedido',
  estoque_insuficiente: 'Estoque insuficiente',
};

/** Rótulo do perfil que decidiu (o contrato traz o código). */
export const ROTULO_PERFIL: Readonly<Record<string, string>> = { administrador: 'Administrador', gerente: 'Gerente', faturista: 'Faturista', fiscal: 'Fiscal', vendedor: 'Vendedor', leitura: 'Leitura' };

/** Texto do motivo (regra do domain); código fora do catálogo aparece como veio. */
function motivoLegivel(codigo: string | null, texto: string | null): string {
  if (!codigo) return '';
  const c = MotivoCodigo.safeParse(codigo);
  return c.success ? textoMotivo(c.data, texto) : (textoMotivoSistema(codigo) ?? codigo);
}

/** Unidade do esperado/informado por código (contratos: `PendenciaDetalhada`). */
function valorDaPendencia(codigo: CodigoPendencia, v: number | null): string {
  if (v === null) return '';
  if (codigo === 'desconto_acima_maximo') return formatarPontosBase(v);
  if (codigo === 'credito_sem_limite' || codigo === 'credito_excedido') return formatarCentavos(v);
  if (codigo === 'estoque_insuficiente') return formatarQuantidade(v);
  return String(v);
}

export interface LinhaPendencia {
  texto: string;
  /** `Bloqueia` impede a aprovação (RN-PED-03); `Atenção` aprova com justificativa. */
  gravidade: 'Bloqueia' | 'Atenção';
  item: number | null;
  esperado: string;
  informado: string;
}

export function linhasDePendencias(pendencias: readonly PendenciaDetalhada[]): LinhaPendencia[] {
  return pendencias.map((p) => ({
    texto: ROTULO_PENDENCIA[p.codigo],
    gravidade: p.bloqueante ? 'Bloqueia' : 'Atenção',
    item: p.sequencia,
    esperado: valorDaPendencia(p.codigo, p.esperado),
    informado: valorDaPendencia(p.codigo, p.informado),
  }));
}

export function linhasDeItens(p: Pick<Pedido, 'itens'>) {
  return p.itens.map((i) => ({
    sequencia: i.sequencia,
    codigo: i.produto_retrato.codigo,
    descricao: i.produto_retrato.descricao,
    unidade: i.produto_retrato.unidade_comercial,
    quantidade: formatarQuantidade(i.quantidade),
    preco: formatarCentavos(i.preco_unitario_centavos),
    desconto: formatarCentavos(i.desconto_centavos),
    total: formatarCentavos(i.total_centavos),
    faturado: formatarQuantidade(i.quantidade_faturada),
  }));
}

/** Termo único do ator (Histórico e Decisão): "Sistema", o rótulo do perfil, ou "Usuário" quando o perfil não é conhecido. */
const rotuloDoPerfil = (perfil: string | null | undefined): string => (perfil ? (ROTULO_PERFIL[perfil] ?? perfil) : 'Usuário');

/** O contrato do histórico traz só o `ator_id`; o perfil é conhecido quando o ator é quem decidiu (`decisao.decidido_por`). */
function rotuloDoAtor(h: HistoricoPedido, decisao: Pedido['decisao'] | undefined): string {
  if (h.ator_tipo === 'sistema') return 'Sistema';
  return rotuloDoPerfil(decisao && h.ator_id && h.ator_id === decisao.decidido_por ? decisao.perfil : null);
}

export function linhasDeHistorico(p: Pick<Pedido, 'historico'> & Partial<Pick<Pedido, 'decisao'>>, fuso: string) {
  return p.historico.map((h) => ({
    quando: formatarDataHora(h.ocorrido_em, fuso),
    de: h.de ? ROTULO_STATUS[h.de] : '',
    para: ROTULO_STATUS[h.para],
    ator: rotuloDoAtor(h, p.decisao),
    motivo: motivoLegivel(h.motivo_codigo, h.motivo_texto),
  }));
}

export function cabecalhoDoPedido(p: Pedido, fuso: string) {
  const r = p.cliente_retrato;
  return {
    titulo: `Pedido ${p.numero}`,
    /** Selo ao lado do h1; o shell desenha. */
    selo: { rotulo: ROTULO_STATUS[p.status] },
    origem: ROTULO_ORIGEM[p.origem],
    cliente: r.razao_social,
    /** Nulo para o vendedor (LGPD): a tela não mostra o campo. */
    documento: r.documento ? formatarDocumento(r.documento) : null,
    emitido_em: formatarDataHora(p.emitido_em, fuso),
    observacao: p.observacao ?? '',
    total: formatarCentavos(p.total_centavos),
    faturado: formatarCentavos(p.valor_faturado_centavos),
  };
}

/**
 * Decisão vigente: reflete o status final. Cancelado mostra "Cancelado · motivo · quando" a partir do último evento de
 * cancelamento do histórico (a aprovação original fica só no histórico); recusado e aprovado seguem a linha de `aprovacao`.
 */
export function resumoDaDecisao(p: Pick<Pedido, 'decisao'> & Partial<Pick<Pedido, 'origem' | 'aprovado_origem_em' | 'status' | 'historico'>>, fuso: string) {
  const d = p.decisao;
  const cancelamento = p.status === 'cancelado' ? [...(p.historico ?? [])].reverse().find((h) => h.para === 'cancelado') : undefined;
  if (cancelamento) {
    const quando = formatarDataHora(cancelamento.ocorrido_em, fuso);
    const motivo = motivoLegivel(cancelamento.motivo_codigo, cancelamento.motivo_texto);
    return {
      decisao: 'Cancelado',
      quem: rotuloDoAtor(cancelamento, d),
      quando,
      justificativa: '',
      motivo,
      pendencias_aceitas: [] as string[],
      texto: ['Cancelado', motivo, quando].filter(Boolean).join(' · '),
    };
  }
  if (!d && p.origem === 'fdv') {
    // Pedido do FDV: aprovado na origem, sem linha em `aprovacao` (ADR 0007).
    const quando = p.aprovado_origem_em ? formatarDataHora(p.aprovado_origem_em, fuso) : '';
    return { decisao: quando ? `Aprovado no Macuxi FDV em ${quando}` : 'Aprovado no Macuxi FDV', quem: 'Macuxi FDV', quando, justificativa: '', motivo: '', pendencias_aceitas: [] as string[], texto: quando ? `Aprovado no Macuxi FDV em ${quando}` : 'Aprovado no Macuxi FDV' };
  }
  if (!d) return null;
  const rotulo = d.decisao === 'aprovado' ? 'Aprovado' : 'Recusado';
  const quando = formatarDataHora(d.decidido_em, fuso);
  const motivo = motivoLegivel(d.motivo_codigo, d.motivo_texto);
  return {
    decisao: rotulo,
    quem: d.automatica ? 'Automática (sem pendência)' : rotuloDoPerfil(d.perfil),
    quando,
    justificativa: d.justificativa ?? '',
    motivo,
    pendencias_aceitas: d.pendencias_aceitas.map((x) => ROTULO_PENDENCIA[x.codigo]),
    texto: [rotulo, motivo, quando].filter(Boolean).join(' · '),
  };
}
