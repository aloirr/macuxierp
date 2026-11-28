/**
 * Adaptador do pedido: transforma os descritores de `@macuxierp/pedido/web` (lista, detalhe, ações e formulário) nos tipos do
 * renderizador genérico. Nenhuma regra de negócio aqui: pendências, ações por perfil, motivos e validação vêm do módulo.
 */
import { formatarCentavos, interpretarCentavos, interpretarQuantidade } from '@macuxierp/platform-sdk/formatar';
import {
  FILTROS_TELA, ITEM_VAZIO, ROTULO_BUSCA, ROTULO_STATUS, acoesDoPedido, avisoDoMotivo, cabecalhoDoPedido, edicaoDoPedido, falhaDaEdicao, rotaDeEdicao, calcularTotal as totalDoModulo, colunasDaTela, linhaDaTela, linhasDeHistorico, linhasDeItens,
  linhasDePendencias, motivosDaDecisao, totalDoFormulario, novaChaveDoFormulario, paginaPedidos, resumoDaDecisao, textoCentavos, tituloDaColuna, validarAprovacao, validarFormulario, validarMotivo,
  type DecisaoComMotivo, type ItemListaPedido,
} from '@macuxierp/pedido/web';
import { CatalogoMotivos, Pedido, type StatusPedido } from '@macuxierp/pedido/contracts';
import type { ItemLinha } from '@macuxierp/ui';
import { primeiroErro } from '../descritor/formulario';
import type { AcaoDaLinha, AcaoVista, DetalheVista, EntradaAcao, ItemFormulario, ResultadoAcao, TelaDescrita, TelaDetalhe, TelaFormulario, SeloVista, TelaLista, ValoresFormulario } from '../descritor/tipos';

const BASE = '/v1/pedido/pedidos';
const [LISTA, NOVO, DETALHE, EDITAR] = ['/pedido/pedidos', '/pedido/pedidos/novo', '/pedido/pedidos/:id', '/pedido/pedidos/:id/editar'] as const;

const TOM: Readonly<Record<StatusPedido, 'ok' | 'aviso' | 'erro' | 'neutro'>> = {
  recebido: 'neutro', em_analise: 'aviso', aprovado: 'ok', recusado: 'erro', faturado_parcial: 'ok', faturado: 'ok', cancelado: 'neutro',
};

/** Colunas numéricas da lista: à direita, com algarismos tabulares (ColunaLista ainda não traz o tipo). */
const TIPO_DA_COLUNA: Readonly<Record<string, 'numero' | 'dinheiro' | 'data'>> = { numero: 'numero', total_centavos: 'dinheiro', pendencias: 'numero', emitido_em: 'data' };

/** "Editar" é só navegação para a tela de edição; quem pode (perfil, status e origem) é do módulo (`acoesDoPedido().editar`, RN-PED-02). */
const acaoEditar = (id: string, quem: Parameters<typeof acoesDoPedido>[0], p: { status: StatusPedido; origem: Pedido['origem'] }): AcaoVista | null =>
  acoesDoPedido(quem, { ...p, pendencias: [] }).editar
    ? { id: 'editar', rotulo: 'Editar', metodo: 'PUT', caminho: `${BASE}/${id}`, entrada: 'nenhum', rota: rotaDeEdicao(id) }
    : null;

/** Coluna "Ações" da lista: só o link Editar (sem escrita nenhuma neste executor). */
const EDITAR_NA_LINHA: AcaoDaLinha = {
  acao: (l, perfil) => acaoEditar(String(l.id), perfil, { status: l.status as StatusPedido, origem: l.origem as Pedido['origem'] }),
  validarAcao: () => ({ ok: true }),
  escritas: [],
  novaChave: novaChaveDoFormulario,
};

export const LISTA_PEDIDOS: TelaLista = {
  tipo: 'lista',
  pagina: paginaPedidos as unknown as TelaLista['pagina'],
  rotuloBusca: ROTULO_BUSCA,
  filtrosTela: FILTROS_TELA.map((f) => (f.tipo === 'cadastro' ? { chave: f.chave, rotulo: f.rotulo, tipo: 'cadastro', fonte: f.fonte } : f.tipo === 'selecao' ? { chave: f.chave, rotulo: f.rotulo, tipo: 'selecao', opcoes: f.opcoes } : { chave: f.chave, rotulo: f.rotulo, tipo: 'data' })),
  colunas: (perfil) => colunasDaTela(perfil).map((c) => ({ id: c.id, rotulo: tituloDaColuna(c), ...(TIPO_DA_COLUNA[c.id] ? { tipo: TIPO_DA_COLUNA[c.id] } : {}) })),
  linha: (item, fuso) => linhaDaTela(item as unknown as ItemListaPedido, fuso),
  /** Status da lista em selo, com o mesmo tom e o mesmo texto do detalhe (o texto vem do módulo). */
  selos: (item): Readonly<Record<string, readonly SeloVista[]>> => {
    const status = item.status as StatusPedido;
    return TOM[status] ? { status: [{ texto: ROTULO_STATUS[status], tom: TOM[status] }] } : {};
  },
  novo: { rota: NOVO, rotulo: 'Novo pedido', criar: 'pedido.pedido.lancar' },
  acaoDaLinha: EDITAR_NA_LINHA,
  rotaDaLinha: (l) => `/pedido/pedidos/${String(l.id)}`,
  rotuloDaLinha: (l) => `Abrir pedido ${String(l.numero)}`,
};

/** Motivos do catálogo da API para o diálogo (rótulo do catálogo; a regra do "outro" é do módulo em `validarMotivo`). */
function motivos(c: CatalogoMotivos, decisao: DecisaoComMotivo) {
  return motivosDaDecisao(c, decisao).map((m) => ({ codigo: m.codigo, rotulo: m.texto }));
}

const VERBOS = ['aprovar', 'recusar', 'cancelar', 'revalidar'] as const;
const ESCRITAS = VERBOS.map((v) => ({ metodo: 'POST' as const, caminho: `${BASE}/:id/${v}` }));

const SEM_CATALOGO = 'o catálogo de motivos não carregou; recarregue a página.';

export function vistaDoPedido(p: Pedido, perfil: Parameters<typeof acoesDoPedido>[0], fuso: string, catalogoBruto: unknown): DetalheVista {
  const c = cabecalhoDoPedido(p, fuso);
  const a = acoesDoPedido(perfil, { status: p.status, origem: p.origem, pendencias: p.pendencias });
  const catalogo = CatalogoMotivos.safeParse(catalogoBruto);
  const caminho = (verbo: (typeof VERBOS)[number]) => `${BASE}/${p.id}/${verbo}`;
  // O aviso de LGPD é do texto livre do "outro"; fica no diálogo inteiro (o diálogo da ui recebe um aviso fixo).
  const aviso = avisoDoMotivo(p.origem, 'outro') ?? undefined;
  const decisaoComMotivo = (id: DecisaoComMotivo, rotulo: string): AcaoVista => ({
    id, rotulo, metodo: 'POST', caminho: caminho(id), entrada: 'motivo', aviso,
    ...(catalogo.success ? { motivos: motivos(catalogo.data, id) } : { motivos: [], desabilitada: SEM_CATALOGO }),
  });
  const acoes: AcaoVista[] = [];
  if (a.aprovar) {
    acoes.push({
      id: 'aprovar', rotulo: 'Aprovar', metodo: 'POST', caminho: caminho('aprovar'), principal: true,
      entrada: a.aprovarExigeJustificativa ? 'justificativa' : 'nenhum', justificativaObrigatoria: a.aprovarExigeJustificativa,
      desabilitada: a.aprovarBloqueado ? 'corrija a pendência bloqueante e revalide.' : undefined,
    });
  }
  if (a.recusar) acoes.push(decisaoComMotivo('recusar', 'Recusar'));
  if (a.cancelar) acoes.push(decisaoComMotivo('cancelar', 'Cancelar pedido'));
  if (a.revalidar) acoes.push({ id: 'revalidar', rotulo: 'Revalidar', metodo: 'POST', caminho: caminho('revalidar'), entrada: 'nenhum' });
  const editar = a.editar ? acaoEditar(p.id, perfil, p) : null;
  if (editar) acoes.push(editar);

  const decisao = resumoDaDecisao(p, fuso);
  return {
    titulo: c.titulo,
    selo: { texto: c.selo.rotulo, tom: TOM[p.status] },
    cabecalho: [
      { rotulo: 'Origem', valor: c.origem }, { rotulo: 'Cliente', valor: c.cliente },
      ...(c.documento ? [{ rotulo: 'Documento', valor: c.documento }] : []),
      { rotulo: 'Emitido em', valor: c.emitido_em }, { rotulo: 'Total', valor: c.total }, { rotulo: 'Faturado', valor: c.faturado },
      ...(c.observacao ? [{ rotulo: 'Observação', valor: c.observacao }] : []),
    ],
    pendencias: linhasDePendencias(p.pendencias).map((l) => ({
      texto: `${l.texto}${l.item ? ` (item ${l.item})` : ''}${l.esperado || l.informado ? `. Esperado: ${l.esperado || '—'}; informado: ${l.informado || '—'}.` : ''}`,
      bloqueante: l.gravidade === 'Bloqueia',
      codigoRn: 'RN-PED-03',
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

/** Validação do diálogo pela regra do módulo; o corpo enviado é o que o módulo devolveu. */
export function validarAcao(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  const r = a.id === 'aprovar' ? validarAprovacao(Boolean(a.justificativaObrigatoria), e.texto)
    : a.id === 'recusar' || a.id === 'cancelar' ? validarMotivo(a.id, { motivo_codigo: e.motivo ?? '', motivo_texto: e.texto })
    : null;
  if (r === null) return { ok: true };
  return r.ok ? { ok: true, corpo: r.corpo } : { ok: false, erro: primeiroErro(r.erros) };
}

export const DETALHE_PEDIDO: TelaDetalhe = {
  tipo: 'detalhe',
  api: (id) => `${BASE}/${encodeURIComponent(id)}`,
  ler: (corpo) => Pedido.parse(corpo),
  motivosApi: '/v1/pedido/motivos',
  montar: (dados, perfil, fuso, motivosBruto) => vistaDoPedido(dados as Pedido, perfil, fuso, motivosBruto),
  voltar: LISTA,
  validarAcao,
  escritas: ESCRITAS,
  novaChave: novaChaveDoFormulario,
};

/** Linha vazia da tela, a partir do item vazio do módulo (texto vazio = 0). */
const novoItem = (chave: string): ItemLinha => ({ chave, produtoId: ITEM_VAZIO.produto_id || null, quantidade: 0, precoUnitarioCentavos: 0, descontoCentavos: 0 });
/** Qtd4 da linha (quantidade × 10^4). */
const qtd4 = (i: ItemLinha): number => Math.round(i.quantidade * 10_000);
/** Só inteiros seguros entram no cálculo do módulo; fora disso a linha mostra erro de campo. */
const erroItem = (i: ItemLinha): string | null =>
  Number.isSafeInteger(qtd4(i)) && Number.isSafeInteger(i.precoUnitarioCentavos) && Number.isSafeInteger(i.descontoCentavos)
    ? null
    : 'Valor fora do limite. Confira quantidade, preço e desconto.';
/** Total da linha pelo `calcularTotal` do módulo (RN-PED-03); desconto acima do valor (EntradaIncoerente) mostra 0 e a API revalida. */
const calcularTotal = (i: ItemLinha): number => {
  if (erroItem(i)) return 0;
  try {
    return totalDoModulo([{ quantidade: qtd4(i), preco_unitario_centavos: i.precoUnitarioCentavos, desconto_centavos: i.descontoCentavos }]).total;
  } catch {
    return 0;
  }
};
/** Inverso de `paraTexto` (abre a edição): quantidade em unidades e preço e desconto em centavos, lidos pelo SDK; texto ilegível vira 0 e a validação do módulo acusa. */
const daTexto = (i: ItemFormulario, chave: string): ItemLinha => ({
  chave, produtoId: i.produto_id || null,
  quantidade: (interpretarQuantidade(i.quantidade) ?? 0) / 10_000,
  precoUnitarioCentavos: interpretarCentavos(i.preco) ?? 0,
  descontoCentavos: i.desconto ? (interpretarCentavos(i.desconto) ?? 0) : 0,
});
/** Texto que o módulo valida: "1,5" e "12,50" (o módulo interpreta; 0 vira texto e falha na validação do módulo). */
const paraTexto = (i: ItemLinha): ItemFormulario => ({
  produto_id: i.produtoId ?? '',
  quantidade: i.quantidade ? String(i.quantidade).replace('.', ',') : '',
  preco: i.precoUnitarioCentavos ? textoCentavos(i.precoUnitarioCentavos) : '',
  desconto: i.descontoCentavos ? textoCentavos(i.descontoCentavos) : '',
});

const itens = (linhas: readonly ItemFormulario[]) => linhas.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco: i.preco, desconto: i.desconto ?? '' }));
const formulario = (v: ValoresFormulario, linhas: readonly ItemFormulario[]) => ({
  filial_id: v.filial_id ?? '', cliente_id: v.cliente_id ?? '', condicao_pagamento_id: v.condicao_pagamento_id ?? '', endereco_entrega_id: v.endereco_entrega_id ?? '', observacao: v.observacao ?? '', itens: itens(linhas),
});

export const NOVO_PEDIDO: TelaFormulario = {
  tipo: 'formulario',
  campos: [
    { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais', obrigatorio: true },
    { nome: 'cliente_id', rotulo: 'Cliente', tipo: 'cadastro', fonte: '/v1/cadastros/clientes', obrigatorio: true },
    { nome: 'condicao_pagamento_id', rotulo: 'Condição de pagamento', tipo: 'cadastro', fonte: '/v1/cadastros/condicoes-pagamento' },
    { nome: 'observacao', rotulo: 'Observação', tipo: 'area' },
  ],
  itens: { fonte: '/v1/cadastros/produtos', rotuloProduto: 'Produto', novoItem, calcularTotal, erroItem, paraTexto, daTexto, formatarCentavos, totalTexto: (linhas) => totalDoFormulario(linhas.map((l) => ({ ...l, desconto: l.desconto ?? '' }))).texto },
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
  novaChave: novaChaveDoFormulario,
};

/**
 * Editar pedido (T-0126, RF-PED-02): o mesmo formulário do "Novo", aberto com o pedido (GET), itens preenchidos e `PUT /pedidos/:id`
 * com `If-Match` = `updated_at`. Versão velha (412 ou 409) e pedido fora de análise (422 RN-PED-02) pedem recarregar; o texto é do módulo.
 */
export const EDITAR_PEDIDO: TelaFormulario = {
  ...NOVO_PEDIDO,
  edicao: {
    metodo: 'PUT',
    ler: (id) => `${BASE}/${encodeURIComponent(id)}`,
    abrir: (corpo) => {
      const p = Pedido.parse(corpo);
      const { formulario: f, versao } = edicaoDoPedido(p);
      return {
        valores: { filial_id: f.filial_id, cliente_id: f.cliente_id, condicao_pagamento_id: f.condicao_pagamento_id, endereco_entrega_id: f.endereco_entrega_id, observacao: f.observacao },
        original: p, versao, itens: f.itens,
      };
    },
    montarPatch: () => null, // PUT: o corpo inteiro vem de `montar`
    voltarPara: (id) => `/pedido/pedidos/${id}`,
    rotuloRecarregar: 'Recarregar pedido',
    falha: (r) => falhaDaEdicao({ status: r.status ?? (r.desatualizado ? 412 : 0), codigo: r.codigo ?? '', message: r.mensagem }),
  },
  enviar: 'Salvar alterações',
};

export const TELAS_PEDIDO: Readonly<Record<string, TelaDescrita>> = { [LISTA]: LISTA_PEDIDOS, [NOVO]: NOVO_PEDIDO, [EDITAR]: EDITAR_PEDIDO, [DETALHE]: DETALHE_PEDIDO };
