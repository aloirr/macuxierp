/**
 * Detalhe do pedido (RF-PED-04): cabeçalho, itens, pendências com esperado e informado, histórico e decisão, já
 * formatados para a tela (R$, quantidade, data no fuso do tenant, português). Funções puras sobre o contrato `Pedido`.
 */
import { textoMotivo } from '../domain/motivos';
import { MotivoCodigo, type CodigoPendencia, Pedido, PendenciaDetalhada } from '../contracts';
import { formatarCentavos, formatarDataHora, formatarPontosBase, formatarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { ROTULO_ORIGEM, ROTULO_STATUS } from './lista';

export const ROTULO_PENDENCIA: Readonly<Record<CodigoPendencia, string>> = {
  cliente_inativo: 'Cliente inativo',
  produto_inativo: 'Produto inativo',
  filial_nao_emissora: 'Filial não emissora de nota',
  condicao_ausente: 'Sem condição de pagamento',
  condicao_inativa: 'Condição de pagamento inativa',
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
  return c.success ? textoMotivo(c.data, texto) : codigo;
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

export function linhasDeHistorico(p: Pick<Pedido, 'historico'>, fuso: string) {
  return p.historico.map((h) => ({
    quando: formatarDataHora(h.ocorrido_em, fuso),
    de: h.de ? ROTULO_STATUS[h.de] : '',
    para: ROTULO_STATUS[h.para],
    ator: h.ator_tipo === 'sistema' ? 'Sistema' : 'Usuário',
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
    documento: r.documento,
    emitido_em: formatarDataHora(p.emitido_em, fuso),
    observacao: p.observacao ?? '',
    total: formatarCentavos(p.total_centavos),
    faturado: formatarCentavos(p.valor_faturado_centavos),
  };
}

export function resumoDaDecisao(p: Pick<Pedido, 'decisao'>, fuso: string) {
  const d = p.decisao;
  if (!d) return null;
  return {
    decisao: d.decisao === 'aprovado' ? 'Aprovado' : 'Recusado',
    quem: d.automatica ? 'Automática (sem pendência)' : (d.perfil ? (ROTULO_PERFIL[d.perfil] ?? d.perfil) : 'Usuário'),
    quando: formatarDataHora(d.decidido_em, fuso),
    justificativa: d.justificativa ?? '',
    motivo: motivoLegivel(d.motivo_codigo, d.motivo_texto),
    pendencias_aceitas: d.pendencias_aceitas.map((x) => ROTULO_PENDENCIA[x.codigo]),
  };
}
