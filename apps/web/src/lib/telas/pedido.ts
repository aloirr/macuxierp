/**
 * Adaptador do pedido: transforma os descritores de `@macuxierp/pedido/web` (lista, detalhe, ações e formulário) nos tipos do
 * renderizador genérico. Nenhuma regra de negócio aqui: pendências, ações por perfil, motivos e validação vêm do módulo.
 */
import {
  FILTROS_TELA, ROTULO_BUSCA, acoesDoPedido, avisoDoMotivo, cabecalhoDoPedido, colunasDaTela, linhaDaTela, linhasDeHistorico, linhasDeItens,
  linhasDePendencias, motivosDaDecisao, paginaPedidos, resumoDaDecisao, tituloDaColuna, validarFormulario, type ItemListaPedido,
} from '@macuxierp/pedido/web';
import { CatalogoMotivos, Pedido, type StatusPedido } from '@macuxierp/pedido/contracts';
import type { AcaoVista, DetalheVista, ItemFormulario, TelaDescrita, TelaDetalhe, TelaFormulario, TelaLista, ValoresFormulario } from '../descritor/tipos';

const BASE = '/v1/pedido/pedidos';
const [LISTA, NOVO, DETALHE] = ['/pedido/pedidos', '/pedido/pedidos/novo', '/pedido/pedidos/:id'] as const;

const TOM: Readonly<Record<StatusPedido, 'ok' | 'aviso' | 'erro' | 'neutro'>> = {
  recebido: 'neutro', em_analise: 'aviso', aprovado: 'ok', recusado: 'erro', faturado_parcial: 'ok', faturado: 'ok', cancelado: 'neutro',
};

export const LISTA_PEDIDOS: TelaLista = {
  tipo: 'lista',
  pagina: paginaPedidos as unknown as TelaLista['pagina'],
  rotuloBusca: ROTULO_BUSCA,
  filtrosTela: FILTROS_TELA.map((f) => (f.tipo === 'cadastro' ? { chave: f.chave, rotulo: f.rotulo, tipo: 'cadastro', fonte: f.fonte } : f.tipo === 'selecao' ? { chave: f.chave, rotulo: f.rotulo, tipo: 'selecao', opcoes: f.opcoes } : { chave: f.chave, rotulo: f.rotulo, tipo: 'data' })),
  colunas: (perfil) => colunasDaTela(perfil).map((c) => ({ id: c.id, rotulo: tituloDaColuna(c) })),
  linha: (item, fuso) => linhaDaTela(item as unknown as ItemListaPedido, fuso),
  novo: { rota: NOVO, rotulo: 'Novo pedido', criar: 'pedido.pedido.lancar' },
  rotaDaLinha: (l) => `/pedido/pedidos/${String(l.id)}`,
};

/** Motivos do catálogo da API para o diálogo; só "outro" pede texto (RN-PED, contrato `RecusarEntrada`). */
function motivos(c: CatalogoMotivos, decisao: 'recusar' | 'cancelar') {
  return motivosDaDecisao(c, decisao).map((m) => ({ codigo: m.codigo, rotulo: m.texto, exigeTexto: m.codigo === 'outro' }));
}

export function vistaDoPedido(p: Pedido, perfil: Parameters<typeof acoesDoPedido>[0], fuso: string, catalogo: CatalogoMotivos): DetalheVista {
  const c = cabecalhoDoPedido(p, fuso);
  const a = acoesDoPedido(perfil, { status: p.status, origem: p.origem, pendencias: p.pendencias });
  const caminho = (verbo: string) => `${BASE}/${p.id}/${verbo}`;
  const aviso = avisoDoMotivo(p.origem, 'outro');
  const acoes: AcaoVista[] = [];
  if (a.aprovar) {
    acoes.push({
      id: 'aprovar', rotulo: 'Aprovar', metodo: 'POST', caminho: caminho('aprovar'),
      entrada: a.aprovarExigeJustificativa ? 'justificativa' : 'nenhum', justificativaObrigatoria: a.aprovarExigeJustificativa,
      aviso: a.aprovarExigeJustificativa ? 'Há pendência aceitável: explique por que aprova.' : undefined,
      desabilitada: a.aprovarBloqueado ? 'há pendência bloqueante (RN-PED-03); corrija o pedido e revalide.' : undefined,
    });
  }
  if (a.recusar) acoes.push({ id: 'recusar', rotulo: 'Recusar', metodo: 'POST', caminho: caminho('recusar'), entrada: 'motivo', motivos: motivos(catalogo, 'recusar'), ...(aviso ? { avisoPorMotivo: { outro: aviso } } : {}), perigosa: true });
  if (a.cancelar) acoes.push({ id: 'cancelar', rotulo: 'Cancelar pedido', metodo: 'POST', caminho: caminho('cancelar'), entrada: 'motivo', motivos: motivos(catalogo, 'cancelar'), ...(aviso ? { avisoPorMotivo: { outro: aviso } } : {}), perigosa: true });
  if (a.revalidar) acoes.push({ id: 'revalidar', rotulo: 'Revalidar', metodo: 'POST', caminho: caminho('revalidar'), entrada: 'nenhum' });

  const decisao = resumoDaDecisao(p, fuso);
  return {
    titulo: c.titulo,
    selo: { texto: c.status, tom: TOM[p.status] },
    cabecalho: [
      { rotulo: 'Origem', valor: c.origem }, { rotulo: 'Cliente', valor: c.cliente },
      ...(c.documento ? [{ rotulo: 'Documento', valor: c.documento }] : []),
      { rotulo: 'Emitido em', valor: c.emitido_em }, { rotulo: 'Total', valor: c.total }, { rotulo: 'Faturado', valor: c.faturado },
      ...(c.observacao ? [{ rotulo: 'Observação', valor: c.observacao }] : []),
    ],
    pendencias: linhasDePendencias(p.pendencias).map((l) => ({
      texto: `${l.texto}${l.item ? ` (item ${l.item})` : ''}`,
      bloqueante: l.gravidade === 'Bloqueante',
      ...(l.esperado || l.informado ? { detalhe: `Esperado: ${l.esperado || '—'}; informado: ${l.informado || '—'}.` } : {}),
    })),
    acoes,
    tabelas: [{
      titulo: 'Itens',
      colunas: [
        { id: 'sequencia', rotulo: '#', numerica: true }, { id: 'codigo', rotulo: 'Código' }, { id: 'descricao', rotulo: 'Descrição' }, { id: 'unidade', rotulo: 'Un.' },
        { id: 'quantidade', rotulo: 'Quantidade', numerica: true }, { id: 'preco', rotulo: 'Preço unit.', numerica: true }, { id: 'desconto', rotulo: 'Desconto', numerica: true },
        { id: 'total', rotulo: 'Total', numerica: true }, { id: 'faturado', rotulo: 'Faturado', numerica: true },
      ],
      linhas: linhasDeItens(p).map((i) => ({ ...i, sequencia: String(i.sequencia) })),
    }],
    decisao: decisao
      ? [
          { rotulo: 'Decisão', valor: decisao.decisao }, { rotulo: 'Por', valor: decisao.quem }, { rotulo: 'Quando', valor: decisao.quando },
          ...(decisao.justificativa ? [{ rotulo: 'Justificativa', valor: decisao.justificativa }] : []),
          ...(decisao.motivo ? [{ rotulo: 'Motivo', valor: decisao.motivo }] : []),
          ...(decisao.pendencias_aceitas.length ? [{ rotulo: 'Pendências aceitas', valor: decisao.pendencias_aceitas.join('; ') }] : []),
        ]
      : undefined,
    historico: linhasDeHistorico(p, fuso).map((h) => ({ quando: h.quando, texto: `${h.de ? `${h.de} → ` : ''}${h.para} · ${h.ator}${h.motivo ? ` · ${h.motivo}` : ''}` })),
  };
}

export const DETALHE_PEDIDO: TelaDetalhe = {
  tipo: 'detalhe',
  api: (id) => `${BASE}/${encodeURIComponent(id)}`,
  ler: (corpo) => Pedido.parse(corpo),
  motivosApi: '/v1/pedido/motivos',
  montar: (dados, perfil, fuso, motivosBruto) => vistaDoPedido(dados as Pedido, perfil, fuso, CatalogoMotivos.parse(motivosBruto)),
  voltar: LISTA,
};

const itens = (linhas: readonly ItemFormulario[]) => linhas.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco: i.preco, desconto: i.desconto ?? '' }));
const formulario = (v: ValoresFormulario, linhas: readonly ItemFormulario[]) => ({
  filial_id: v.filial_id ?? '', cliente_id: v.cliente_id ?? '', condicao_pagamento_id: v.condicao_pagamento_id ?? '', endereco_entrega_id: '', observacao: v.observacao ?? '', itens: itens(linhas),
});

export const NOVO_PEDIDO: TelaFormulario = {
  tipo: 'formulario',
  campos: [
    { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais', obrigatorio: true },
    { nome: 'cliente_id', rotulo: 'Cliente', tipo: 'cadastro', fonte: '/v1/cadastros/clientes', obrigatorio: true },
    { nome: 'condicao_pagamento_id', rotulo: 'Condição de pagamento', tipo: 'cadastro', fonte: '/v1/cadastros/condicoes-pagamento' },
    { nome: 'observacao', rotulo: 'Observação', tipo: 'area' },
  ],
  itens: { fonte: '/v1/cadastros/produtos', rotuloProduto: 'Produto' },
  validar: (v, linhas) => {
    const r = validarFormulario(formulario(v, linhas));
    return r.ok ? {} : r.erros;
  },
  montar: (v, linhas) => {
    const r = validarFormulario(formulario(v, linhas));
    if (!r.ok) throw new Error('formulário inválido');
    return r.entrada;
  },
  api: BASE,
  depois: (id) => `/pedido/pedidos/${id}`,
  voltar: LISTA,
  enviar: 'Lançar pedido',
};


export const TELAS_PEDIDO: Readonly<Record<string, TelaDescrita>> = { [LISTA]: LISTA_PEDIDOS, [NOVO]: NOVO_PEDIDO, [DETALHE]: DETALHE_PEDIDO };
