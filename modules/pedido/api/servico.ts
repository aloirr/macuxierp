/**
 * Serviço do pedido: lançar, editar, revalidar, aprovar, recusar, cancelar e receber o pedido do FDV (T-0013 §2 a §5).
 * Roda na transação do tenant do chamador. Toda transição toma `FOR UPDATE` no pedido; a criação e a aprovação tomam
 * antes o advisory lock do cliente (RN-PED-04). Na mesma transação: `pedido_evento`, `aprovacao`, outbox e auditoria.
 * A regra mora no `domain` (funções puras); aqui só se lê, orquestra e grava. Sem dado pessoal em log (regra 8).
 */
import { randomUUID } from 'node:crypto';
import { erros, type DadosAuditoria, type Perfil, type Transacao } from '@macuxierp/platform-sdk';
import type { CondicaoPagamento } from '@macuxierp/cadastros/contracts';
import {
  ClienteRetrato, Pedido, ProdutoRetrato,
  type AprovarEntrada, type CancelarEntrada, type ClienteParaPedido, type EnderecoEntrega, type MotivoCodigo, type PedidoFdvEntrada,
  type PedidoManualEntrada, type Pendencia, type PendenciaDetalhada, type ProdutoParaPedido, type RecusarEntrada, type ResultadoRecebimentoFdv,
  type StatusPedido,
} from '../contracts';
import {
  avaliarPedidoDetalhado, compromissoDeCredito as somarCompromissoCredito, decidirAprovacao, decidirRecebimentoFdv, decisaoAutomatica, possiveis, totalItem, totalPedido, travaCliente,
  validarTransicao, verificarItens, violacao, type Violacao,
} from '../domain';
import { eventoAprovado, eventoCancelado, eventoRecebido, eventoRecusado, type CondicaoDoEvento, type EventoPronto } from './eventos';
import type { Dependencias, NovoItem, NovoPedido, PedidoGravado, RepoPedidos } from './portas';
import { dataNoFuso, exigir } from './util';

type Ator = { tipo: 'usuario'; id: string; perfil: Perfil } | { tipo: 'sistema' };

/** O que o serviço precisa do contexto: a rota o monta do `ContextoRota`; o recebedor, da outbox e da auditoria do SDK. */
export interface Efeitos {
  tenant_id: string;
  ator: Ator;
  agora: Date;
  /** Grava na outbox da transação e devolve o `id` do envelope (vai para `pedido_evento.evento_id`). */
  publicar(e: EventoPronto): Promise<string>;
  auditar(d: DadosAuditoria): Promise<void>;
}

/** Resposta de criação: 201 novo, 200 repetido do mesmo conteúdo, 409 o mesmo `external_id` com outro conteúdo (RN-PED-01). */
export type ResultadoLancamento = { http: 201 | 200 | 409; pedido: Pedido };

const semValores = (d: readonly PendenciaDetalhada[]): Pendencia[] => d.map(({ esperado: _e, informado: _i, ...p }) => p);

const retratoDoCliente = (c: ClienteParaPedido) => {
  const endereco = c.enderecos.find((e) => e.tipo === 'principal') ?? c.enderecos[0];
  return ClienteRetrato.parse({
    tipo_pessoa: c.tipo_pessoa,
    documento: c.documento,
    razao_social: c.razao_social,
    nome_fantasia: c.nome_fantasia,
    ie: c.ie,
    ind_ie_dest: c.ind_ie_dest,
    endereco,
  });
};
const retratoDoProduto = (p: ProdutoParaPedido) =>
  ProdutoRetrato.parse({ codigo: p.codigo, descricao: p.descricao, unidade_comercial: p.unidade_comercial, ean: p.ean, ncm: p.ncm, origem: p.origem });

interface Cadastros {
  cliente: ClienteParaPedido | null;
  filial: { id: string; emissora: boolean; padrao: boolean; inativo: boolean } | null;
  condicao: CondicaoPagamento | null;
  produtos: Map<string, ProdutoParaPedido>;
}

interface ItemParaAvaliar {
  sequencia: number;
  produto_id: string;
  quantidade: number;
  preco_unitario_centavos: number;
  desconto_centavos: number;
}

export function criarServico(deps: Dependencias) {
  const { cadastros, titulos, notas } = deps;
  const log = (fx: Efeitos, dados: Record<string, unknown>, mensagem: string) =>
    deps.log?.info({ modulo: 'pedido', tenant_id: fx.tenant_id, ...dados }, mensagem);

  const carregar = async (tx: Transacao, d: { cliente_id: string; filial_id: string; condicao_pagamento_id: string | null; produto_ids: readonly string[] }): Promise<Cadastros> => {
    const ids = [...new Set(d.produto_ids)];
    const [cliente, filial, condicao, produtos] = await Promise.all([
      cadastros.cliente(tx, d.cliente_id),
      cadastros.filial(tx, d.filial_id),
      d.condicao_pagamento_id ? cadastros.condicao(tx, d.condicao_pagamento_id) : Promise.resolve(null),
      cadastros.produtos(tx, ids),
    ]);
    return { cliente, filial, condicao, produtos: new Map(produtos.map((p) => [p.id, p])) };
  };

  /** Referências do pedido manual: o que não existe no cadastro é 400 (`REF`); inativo é pendência, não erro. */
  const violacoesDeReferencia = (cad: Cadastros, d: { condicao_pagamento_id: string | null; itens: readonly { produto_id: string }[] }): Violacao[] => {
    const v: Violacao[] = [];
    if (!cad.cliente) v.push(violacao('REF', 'cliente_id', 'Cliente inexistente'));
    if (!cad.filial) v.push(violacao('REF', 'filial_id', 'Filial inexistente'));
    if (d.condicao_pagamento_id && !cad.condicao) v.push(violacao('REF', 'condicao_pagamento_id', 'Condição de pagamento inexistente'));
    d.itens.forEach((i, n) => {
      if (!cad.produtos.has(i.produto_id)) v.push(violacao('REF', `itens[${n}].produto_id`, 'Produto inexistente'));
    });
    return v;
  };

  /** Lê as linhas e as condições; a soma sem os pedidos à vista (premissa f) é do domain. */
  const compromissoDeCredito = async (tx: Transacao, repo: RepoPedidos, clienteId: string, exceto: string | null): Promise<number> => {
    const linhas = await repo.compromissoCredito(clienteId, exceto);
    const ids = [...new Set(linhas.flatMap((l) => (l.condicao_pagamento_id === null ? [] : [l.condicao_pagamento_id])))];
    const condicoes = new Map(await Promise.all(ids.map(async (id) => [id, await cadastros.condicao(tx, id)] as const)));
    return somarCompromissoCredito(linhas, condicoes);
  };

  const avaliar = async (
    tx: Transacao,
    repo: RepoPedidos,
    cad: Cadastros & { cliente: ClienteParaPedido; filial: NonNullable<Cadastros['filial']> },
    d: { pedido_id: string | null; emitido_em: string; filial_id: string; cliente_id: string; condicao_pagamento_id: string | null; itens: readonly ItemParaAvaliar[] },
  ) => {
    const data = dataNoFuso(d.emitido_em);
    const tabela = cad.cliente.tabela_preco_id ?? (await cadastros.tabelaPadrao(tx, data));
    const produtoIds = [...new Set(d.itens.map((i) => i.produto_id))];
    const precos = tabela ? await cadastros.precosVigentes(tx, { tabela_preco_id: tabela, filial_id: d.filial_id, produto_ids: produtoIds, data }) : [];
    const [saldos, estoque, credito, abertos] = await Promise.all([
      cadastros.saldos(tx, d.filial_id, produtoIds),
      repo.compromissoEstoque(d.filial_id, produtoIds, d.pedido_id),
      compromissoDeCredito(tx, repo, d.cliente_id, d.pedido_id),
      titulos.saldoAbertoCliente(tx, d.cliente_id),
    ]);
    const detalhadas = avaliarPedidoDetalhado({
      cliente: { inativo: cad.cliente.inativo, limite_credito_centavos: cad.cliente.limite_credito_centavos },
      filial: cad.filial,
      condicao_pagamento_id: d.condicao_pagamento_id,
      condicao: cad.condicao,
      itens: d.itens,
      produtos: [...cad.produtos.values()].map((p) => ({ id: p.id, inativo: p.inativo })),
      precos,
      saldos,
      compromisso_estoque: estoque,
      titulos_abertos_centavos: abertos,
      compromisso_credito_centavos: credito,
    });
    return { detalhadas, condicao: cad.condicao, tabela_preco_id: tabela, precos: new Map(precos.map((p) => [p.produto_id, p])) };
  };

  /** Reavalia um pedido gravado (aprovar, revalidar e a tela de detalhe). Nulo = o cadastro não responde mais. */
  const reavaliar = async (tx: Transacao, repo: RepoPedidos, p: PedidoGravado) => {
    const cad = await carregar(tx, { cliente_id: p.cliente_id, filial_id: p.filial_id, condicao_pagamento_id: p.condicao_pagamento_id, produto_ids: p.itens.map((i) => i.produto_id) });
    if (!cad.cliente || !cad.filial) return null;
    return avaliar(tx, repo, { ...cad, cliente: cad.cliente, filial: cad.filial }, { ...p, pedido_id: p.id, itens: p.itens.map((i) => ({ ...i })) });
  };

  const erroTransicao = (de: StatusPedido, para: StatusPedido, mensagem?: string) => {
    const r = validarTransicao(de, para);
    const lista = possiveis(de).join(',');
    return erros.regra('RN-PED-02', mensagem ?? (r.ok ? 'Transição não permitida' : r.mensagem), { possiveis: lista });
  };
  const exigirTransicao = (de: StatusPedido, para: StatusPedido): void => {
    if (!validarTransicao(de, para).ok) throw erroTransicao(de, para);
  };

  const rotuloAtor = (fx: Efeitos) => ({ ator_tipo: fx.ator.tipo, ator_id: fx.ator.tipo === 'usuario' ? fx.ator.id : null });
  const sistema = { ator_tipo: 'sistema' as const, ator_id: null };

  const resumo = (p: PedidoGravado) => ({
    numero: p.numero, origem: p.origem, status: p.status, filial_id: p.filial_id, cliente_id: p.cliente_id, total_centavos: p.total_centavos, itens: p.itens.length,
  });

  const detalhar = async (tx: Transacao, repo: RepoPedidos, p: PedidoGravado): Promise<Pedido> => {
    const [historico, decisao] = await Promise.all([repo.historico(p.id), repo.decisao(p.id)]);
    // Os valores esperado e informado não são gravados: no pedido em análise, a tela os recebe da avaliação de agora,
    // casando por (codigo, sequencia, produto_id). A lista continua a gravada: pendência nova da reavaliação não entra.
    const viva = p.status === 'em_analise' ? await reavaliar(tx, repo, p) : null;
    const chavePendencia = (x: Pendencia) => `${x.codigo}|${x.sequencia ?? ''}|${x.produto_id ?? ''}`;
    const valores = new Map((viva?.detalhadas ?? []).map((x) => [chavePendencia(x), x] as const));
    const pendencias: PendenciaDetalhada[] = p.pendencias.map((x) => {
      const v = valores.get(chavePendencia(x));
      return { ...x, esperado: v?.esperado ?? null, informado: v?.informado ?? null };
    });
    return Pedido.parse({
      ...p,
      pedido_uuid: p.origem === 'fdv' ? p.external_id : null,
      itens: p.itens,
      pendencias,
      historico,
      decisao,
    });
  };

  const aprovacaoAutomatica = (repo: RepoPedidos, fx: Efeitos, pedidoId: string): Promise<void> =>
    repo.registrarAprovacao({ pedido_id: pedidoId, decisao: 'aprovado', automatica: true, decidido_por: null, perfil: null, pendencias_aceitas: [], justificativa: null, motivo_codigo: null, motivo_texto: null, decidido_em: fx.agora });

  /** Criação: `recebido` dura só a transação; a decisão automática leva ao status final (P8). */
  const registrarCriacao = async (
    repo: RepoPedidos,
    fx: Efeitos,
    p: PedidoGravado,
    decisao: { status: 'aprovado' | 'em_analise'; pendencias: Pendencia[]; validado: boolean },
    condicao: CondicaoDoEvento,
  ): Promise<void> => {
    const final: PedidoGravado = { ...p, status: decisao.status, pendencias: decisao.pendencias };
    const idRecebido = await fx.publicar(eventoRecebido(final));
    await repo.registrarEvento({ pedido_id: p.id, de: null, para: 'recebido', ...rotuloAtor(fx), motivo_codigo: null, motivo_texto: null, pendencias: null, evento_id: idRecebido, ocorrido_em: fx.agora });
    await repo.atualizarStatus(p.id, decisao.status, decisao.pendencias, decisao.validado ? fx.agora : null);
    let idAprovado: string | null = null;
    if (decisao.status === 'aprovado') {
      idAprovado = await fx.publicar(eventoAprovado(final, 'recebido', true, condicao));
      await aprovacaoAutomatica(repo, fx, p.id);
    }
    await repo.registrarEvento({ pedido_id: p.id, de: 'recebido', para: decisao.status, ...sistema, motivo_codigo: null, motivo_texto: null, pendencias: decisao.pendencias, evento_id: idAprovado ?? idRecebido, ocorrido_em: fx.agora });
  };

  /** em_analise → aprovado pelo sistema (revalidação ou edição sem pendência). */
  const aprovarSozinho = async (repo: RepoPedidos, fx: Efeitos, p: PedidoGravado, condicao: CondicaoDoEvento): Promise<void> => {
    const final: PedidoGravado = { ...p, status: 'aprovado', pendencias: [] };
    await repo.atualizarStatus(p.id, 'aprovado', [], fx.agora);
    const idEvento = await fx.publicar(eventoAprovado(final, 'em_analise', true, condicao));
    await aprovacaoAutomatica(repo, fx, p.id);
    await repo.registrarEvento({ pedido_id: p.id, de: 'em_analise', para: 'aprovado', ...sistema, motivo_codigo: null, motivo_texto: null, pendencias: [], evento_id: idEvento, ocorrido_em: fx.agora });
  };

  /** Preço de tabela e desconto máximo da avaliação de agora, por item gravado. */
  const gravarPrecosDeTabela = (repo: RepoPedidos, p: PedidoGravado, precos: ReadonlyMap<string, { preco_centavos: number; desconto_maximo_bp: number }>): Promise<void> =>
    repo.atualizarPrecosDeTabela(p.id, p.itens.map((i) => ({ sequencia: i.sequencia, preco_tabela_centavos: precos.get(i.produto_id)?.preco_centavos ?? null, desconto_maximo_bp: precos.get(i.produto_id)?.desconto_maximo_bp ?? null })));

  const obterOu404 = async (repo: RepoPedidos, id: string): Promise<PedidoGravado> => {
    const p = await repo.obter(id);
    if (!p) throw erros.naoEncontrado('Pedido');
    return p;
  };

  /** `FOR UPDATE` do pedido; se ele sumiu entre a leitura e a trava, 404. */
  const travarOu404 = async (repo: RepoPedidos, id: string): Promise<PedidoGravado> => {
    const p = await repo.obterParaAtualizar(id);
    if (!p) throw erros.naoEncontrado('Pedido');
    return p;
  };

  /** Pedido manual: os itens do corpo, numerados, com preço de tabela e desconto máximo da avaliação. */
  const itensManuais = (
    entrada: PedidoManualEntrada,
    cad: Cadastros,
    precos: ReadonlyMap<string, { preco_centavos: number; desconto_maximo_bp: number }>,
  ): NovoItem[] =>
    entrada.itens.map((i, n) => {
      const preco = precos.get(i.produto_id);
      return {
        sequencia: n + 1,
        produto_id: i.produto_id,
        produto_retrato: retratoDoProduto(cad.produtos.get(i.produto_id) as ProdutoParaPedido),
        quantidade: i.quantidade,
        unidade_venda: null,
        fator_venda: null,
        quantidade_venda: null,
        preco_unitario_centavos: i.preco_unitario_centavos,
        preco_tabela_centavos: preco?.preco_centavos ?? null,
        desconto_maximo_bp: preco?.desconto_maximo_bp ?? null,
        desconto_centavos: i.desconto_centavos,
        total_centavos: totalItem(i.quantidade, i.preco_unitario_centavos, i.desconto_centavos, n),
        total_informado_centavos: null,
        aplicacao: null,
      };
    });

  const enderecoDeEntrega = (cliente: ClienteParaPedido, enderecoId: string | null): { entrega: EnderecoEntrega | null; v: Violacao[] } => {
    if (enderecoId === null) return { entrega: null, v: [] };
    const e = cliente.enderecos.find((x) => x.id === enderecoId);
    if (!e) return { entrega: null, v: [violacao('REF', 'endereco_entrega_id', 'Endereço do cliente inexistente')] };
    const { id: _id, ...resto } = e;
    return { entrega: { endereco_id: enderecoId, retrato: { ...resto, municipio_nome: e.municipio_nome ?? null } }, v: [] };
  };

  const mesmoConteudo = (g: PedidoGravado, e: PedidoManualEntrada): boolean =>
    g.filial_id === e.filial_id &&
    g.cliente_id === e.cliente_id &&
    (e.vendedor_id === null || e.vendedor_id === g.vendedor_id) &&
    g.condicao_pagamento_id === e.condicao_pagamento_id &&
    g.observacao === e.observacao &&
    g.itens.length === e.itens.length &&
    g.itens.every((i, n) => {
      const x = e.itens[n];
      return x !== undefined && i.produto_id === x.produto_id && i.quantidade === x.quantidade && i.preco_unitario_centavos === x.preco_unitario_centavos && i.desconto_centavos === x.desconto_centavos;
    });

  /** Passo comum do lançamento e da edição: carrega o cadastro, valida referências, itens e endereço (400/422). */
  const prepararManual = async (tx: Transacao, entrada: PedidoManualEntrada) => {
    const itens = entrada.itens.map((i, n) => ({ sequencia: n + 1, ...i }));
    const carregado = await carregar(tx, { cliente_id: entrada.cliente_id, filial_id: entrada.filial_id, condicao_pagamento_id: entrada.condicao_pagamento_id, produto_ids: itens.map((i) => i.produto_id) });
    exigir(violacoesDeReferencia(carregado, { condicao_pagamento_id: entrada.condicao_pagamento_id, itens }));
    const cad = carregado as Cadastros & { cliente: ClienteParaPedido; filial: NonNullable<Cadastros['filial']> };
    exigir(verificarItens(itens));
    const entrega = enderecoDeEntrega(cad.cliente, entrada.endereco_entrega_id);
    exigir(entrega.v);
    return { itens, cad, entrega: entrega.entrega };
  };

  const repetido = async (tx: Transacao, repo: RepoPedidos, g: PedidoGravado, e: PedidoManualEntrada): Promise<ResultadoLancamento> => ({
    http: mesmoConteudo(g, e) ? 200 : 409,
    pedido: await detalhar(tx, repo, g),
  });

  // ---- Lançamento manual (RF-PED-02) ----
  async function lancar(tx: Transacao, fx: Efeitos, entrada: PedidoManualEntrada): Promise<ResultadoLancamento> {
    const repo = deps.repositorios(tx);
    if (fx.ator.tipo !== 'usuario') throw new RangeError('lançamento manual exige usuário');
    if (entrada.external_id) {
      const existente = await repo.porExternalId(entrada.external_id);
      if (existente?.origem === 'bko') return repetido(tx, repo, existente, entrada);
      if (existente) throw erros.conflito('O external_id já pertence a um pedido do FDV');
    }
    const { itens, cad, entrega } = await prepararManual(tx, entrada);
    const { cliente } = cad;

    await repo.travarCliente(travaCliente(fx.tenant_id, entrada.cliente_id));
    if (entrada.external_id) {
      const aposTrava = await repo.porExternalId(entrada.external_id);
      if (aposTrava?.origem === 'bko') return repetido(tx, repo, aposTrava, entrada);
      if (aposTrava) throw erros.conflito('O external_id já pertence a um pedido do FDV');
    }
    const emitido = fx.agora.toISOString();
    const av = await avaliar(tx, repo, cad, { pedido_id: null, emitido_em: emitido, filial_id: entrada.filial_id, cliente_id: entrada.cliente_id, condicao_pagamento_id: entrada.condicao_pagamento_id, itens });
    const id = randomUUID();
    const numero = await repo.proximoNumero();
    const novo: NovoPedido = {
      id,
      origem: 'bko',
      external_id: entrada.external_id ?? null,
      filial_id: entrada.filial_id,
      cliente_id: entrada.cliente_id,
      vendedor_id: entrada.vendedor_id ?? cliente.vendedor_id,
      condicao_pagamento_id: entrada.condicao_pagamento_id,
      tabela_preco_id: av.tabela_preco_id,
      cliente_retrato: retratoDoCliente(cliente),
      endereco_entrega: entrega,
      frete: null,
      emitido_em: emitido,
      aprovado_origem_em: null,
      observacao: entrada.observacao,
      total_centavos: totalPedido(itens),
      total_informado_centavos: null,
      pendencias: [],
      validado_em: null,
      criado_por: fx.ator.id,
      itens: itensManuais(entrada, cad, av.precos),
    };
    if (!(await repo.inserir(id, numero, novo))) {
      // Corrida no índice único do external_id (RN-PED-01): o outro lançamento confirmou primeiro.
      const outro = await repo.porExternalId(entrada.external_id as string);
      if (outro?.origem !== 'bko') throw erros.conflito('Não foi possível lançar o pedido: tente de novo');
      return repetido(tx, repo, outro, entrada);
    }
    const criado = await obterOu404(repo, id);
    const pendencias = semValores(av.detalhadas);
    await registrarCriacao(repo, fx, criado, { status: decisaoAutomatica(pendencias), pendencias, validado: true }, av.condicao);
    const final = await obterOu404(repo, id);
    await fx.auditar({ acao: 'pedido.lancar', entidade: 'pedido', entidade_id: id, antes: null, depois: resumo(final) });
    log(fx, { pedido_id: id, acao: 'lancar', status: final.status, pendencias: pendencias.map((x) => x.codigo) }, 'pedido lançado');
    return { http: 201, pedido: await detalhar(tx, repo, final) };
  }

  // ---- Edição do pedido manual em análise (RF-PED-02, P7) ----
  async function editar(tx: Transacao, fx: Efeitos, id: string, entrada: PedidoManualEntrada, ifMatch: string): Promise<Pedido> {
    const repo = deps.repositorios(tx);
    const previo = await obterOu404(repo, id);
    if (previo.origem !== 'bko') throw erros.regra('RN-PED-02', 'O pedido do FDV não se edita no ERP');
    // Cliente antigo e novo, em ordem fixa, para duas edições cruzadas não se travarem.
    const chaves = [...new Set([previo.cliente_id, entrada.cliente_id])].map((c) => travaCliente(fx.tenant_id, c)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of chaves) await repo.travarCliente(k);
    const p = await travarOu404(repo, id);
    if (p.updated_at !== ifMatch) throw erros.conflito('O pedido foi alterado por outra pessoa: recarregue e tente de novo');
    if (p.status !== 'em_analise') throw erroTransicao(p.status, p.status, 'Só o pedido em análise pode ser editado');

    const { itens, cad, entrega } = await prepararManual(tx, entrada);
    const { cliente } = cad;

    const av = await avaliar(tx, repo, cad, { pedido_id: id, emitido_em: p.emitido_em, filial_id: entrada.filial_id, cliente_id: entrada.cliente_id, condicao_pagamento_id: entrada.condicao_pagamento_id, itens });
    await repo.atualizarCabecalho(id, {
      filial_id: entrada.filial_id,
      cliente_id: entrada.cliente_id,
      vendedor_id: entrada.vendedor_id ?? cliente.vendedor_id,
      condicao_pagamento_id: entrada.condicao_pagamento_id,
      tabela_preco_id: av.tabela_preco_id,
      cliente_retrato: retratoDoCliente(cliente),
      endereco_entrega: entrega,
      observacao: entrada.observacao,
      total_centavos: totalPedido(itens),
    });
    await repo.substituirItens(id, itensManuais(entrada, cad, av.precos));
    const pendencias = semValores(av.detalhadas);
    const atual = await obterOu404(repo, id);
    if (pendencias.length === 0) await aprovarSozinho(repo, fx, atual, av.condicao);
    else await repo.atualizarPendencias(id, pendencias, fx.agora);
    const final = await obterOu404(repo, id);
    await fx.auditar({ acao: 'pedido.editar', entidade: 'pedido', entidade_id: id, antes: resumo(p), depois: resumo(final) });
    log(fx, { pedido_id: id, acao: 'editar', status: final.status, pendencias: pendencias.map((x) => x.codigo) }, 'pedido editado');
    return detalhar(tx, repo, final);
  }

  // ---- Revalidação (RF-PED-03) ----
  async function revalidar(tx: Transacao, fx: Efeitos, id: string): Promise<Pedido> {
    const repo = deps.repositorios(tx);
    const previo = await obterOu404(repo, id);
    await repo.travarCliente(travaCliente(fx.tenant_id, previo.cliente_id));
    const p = await travarOu404(repo, id);
    if (p.status !== 'em_analise') throw erroTransicao(p.status, p.status, 'Só o pedido em análise pode ser revalidado');
    const av = await reavaliar(tx, repo, p);
    if (!av) throw erros.validacao({ cliente_id: 'Cadastro do pedido não encontrado' });
    const pendencias = semValores(av.detalhadas);
    await gravarPrecosDeTabela(repo, p, av.precos);
    if (pendencias.length === 0) await aprovarSozinho(repo, fx, p, av.condicao);
    else await repo.atualizarPendencias(id, pendencias, fx.agora);
    const final = await obterOu404(repo, id);
    await fx.auditar({ acao: 'pedido.revalidar', entidade: 'pedido', entidade_id: id, antes: { status: p.status, pendencias: p.pendencias.map((x) => x.codigo) }, depois: { status: final.status, pendencias: pendencias.map((x) => x.codigo) } });
    log(fx, { pedido_id: id, acao: 'revalidar', status: final.status, pendencias: pendencias.map((x) => x.codigo) }, 'pedido revalidado');
    return detalhar(tx, repo, final);
  }

  // ---- Aprovação humana (RN-PED-03) ----
  async function aprovar(tx: Transacao, fx: Efeitos, id: string, entrada: AprovarEntrada): Promise<Pedido> {
    const repo = deps.repositorios(tx);
    if (fx.ator.tipo !== 'usuario') throw new RangeError('aprovação humana exige usuário');
    const previo = await obterOu404(repo, id);
    await repo.travarCliente(travaCliente(fx.tenant_id, previo.cliente_id));
    const p = await travarOu404(repo, id);
    exigirTransicao(p.status, 'aprovado');
    const av = await reavaliar(tx, repo, p);
    if (!av) throw erros.validacao({ cliente_id: 'Cadastro do pedido não encontrado' });
    const pendencias = semValores(av.detalhadas);
    const d = decidirAprovacao(pendencias, entrada.justificativa);
    if (!d.ok) {
      if (d.tipo === 'regra') throw erros.regra(d.rn, d.mensagem, { bloqueantes: d.bloqueantes.map((b) => b.codigo).join(',') });
      throw erros.validacao({ [d.campo]: d.mensagem });
    }
    await gravarPrecosDeTabela(repo, p, av.precos);
    await repo.atualizarStatus(id, 'aprovado', pendencias, fx.agora);
    const final = await obterOu404(repo, id);
    const idEvento = await fx.publicar(eventoAprovado(final, p.status, false, av.condicao));
    await repo.registrarAprovacao({ pedido_id: id, decisao: 'aprovado', automatica: false, decidido_por: fx.ator.id, perfil: fx.ator.perfil, pendencias_aceitas: d.pendencias_aceitas, justificativa: d.justificativa, motivo_codigo: null, motivo_texto: null, decidido_em: fx.agora });
    await repo.registrarEvento({ pedido_id: id, de: p.status, para: 'aprovado', ...rotuloAtor(fx), motivo_codigo: null, motivo_texto: null, pendencias, evento_id: idEvento, ocorrido_em: fx.agora });
    await fx.auditar({ acao: 'pedido.aprovar', entidade: 'pedido', entidade_id: id, antes: { status: p.status }, depois: { status: 'aprovado', pendencias_aceitas: d.pendencias_aceitas.map((x) => x.codigo), com_justificativa: d.justificativa !== null } });
    log(fx, { pedido_id: id, acao: 'aprovar', status: 'aprovado', pendencias_aceitas: d.pendencias_aceitas.map((x) => x.codigo) }, 'pedido aprovado');
    return detalhar(tx, repo, final);
  }

  // ---- Recusa e cancelamento (motivo obrigatório, §4.3) ----
  async function recusar(tx: Transacao, fx: Efeitos, id: string, entrada: RecusarEntrada): Promise<Pedido> {
    const repo = deps.repositorios(tx);
    if (fx.ator.tipo !== 'usuario') throw new RangeError('recusa exige usuário');
    const p = await travarOu404(repo, id);
    exigirTransicao(p.status, 'recusado');
    await repo.atualizarStatus(id, 'recusado', p.pendencias, null);
    const final = await obterOu404(repo, id);
    const idEvento = await fx.publicar(eventoRecusado(final, p.status, entrada.motivo_codigo, entrada.motivo_texto));
    await repo.registrarAprovacao({ pedido_id: id, decisao: 'recusado', automatica: false, decidido_por: fx.ator.id, perfil: fx.ator.perfil, pendencias_aceitas: [], justificativa: null, motivo_codigo: entrada.motivo_codigo, motivo_texto: entrada.motivo_texto, decidido_em: fx.agora });
    await repo.registrarEvento({ pedido_id: id, de: p.status, para: 'recusado', ...rotuloAtor(fx), motivo_codigo: entrada.motivo_codigo, motivo_texto: entrada.motivo_texto, pendencias: null, evento_id: idEvento, ocorrido_em: fx.agora });
    await fx.auditar({ acao: 'pedido.recusar', entidade: 'pedido', entidade_id: id, antes: { status: p.status }, depois: { status: 'recusado', motivo_codigo: entrada.motivo_codigo } });
    log(fx, { pedido_id: id, acao: 'recusar', status: 'recusado', motivo_codigo: entrada.motivo_codigo }, 'pedido recusado');
    return detalhar(tx, repo, final);
  }

  async function cancelar(tx: Transacao, fx: Efeitos, id: string, entrada: CancelarEntrada): Promise<Pedido> {
    const repo = deps.repositorios(tx);
    const p = await travarOu404(repo, id);
    exigirTransicao(p.status, 'cancelado');
    if (await notas.temNotaEmAutorizacao(tx, id)) throw erros.regra('RN-PED-02', 'O pedido tem nota em autorização: aguarde o resultado antes de cancelar');
    await repo.atualizarStatus(id, 'cancelado', p.pendencias, null);
    const final = await obterOu404(repo, id);
    const idEvento = await fx.publicar(eventoCancelado(final, p.status, entrada.motivo_codigo, entrada.motivo_texto));
    await repo.registrarEvento({ pedido_id: id, de: p.status, para: 'cancelado', ...rotuloAtor(fx), motivo_codigo: entrada.motivo_codigo as MotivoCodigo, motivo_texto: entrada.motivo_texto, pendencias: null, evento_id: idEvento, ocorrido_em: fx.agora });
    await fx.auditar({ acao: 'pedido.cancelar', entidade: 'pedido', entidade_id: id, antes: { status: p.status }, depois: { status: 'cancelado', motivo_codigo: entrada.motivo_codigo } });
    log(fx, { pedido_id: id, acao: 'cancelar', status: 'cancelado', motivo_codigo: entrada.motivo_codigo }, 'pedido cancelado');
    return detalhar(tx, repo, final);
  }

  // ---- Pedido do FDV (RF-PED-01, T-0013 §5.3 e decisão de 21/11/2026, 23h10): entra aprovado ----
  async function receberFdv(tx: Transacao, fx: Efeitos, entrada: PedidoFdvEntrada): Promise<ResultadoRecebimentoFdv> {
    const repo = deps.repositorios(tx);
    const externalId = entrada.pedido_uuid.toLowerCase(); // o banco exige o UUID canônico em minúsculas
    const jaExiste = async (): Promise<ResultadoRecebimentoFdv | null> => {
      const g = await repo.porExternalId(externalId);
      // Só o pedido do FDV é "repetido" (RN-PED-01). O manual com o mesmo external_id é conflito de dados: segue ao INSERT,
      // que não grava, e o recebedor lança 409 (a transação do integracao-fdv desfaz e o caso vai para a fila de erro).
      return g?.origem === 'fdv' ? { resultado: 'repetido', pedido_id: g.id, numero: g.numero, status: g.status } : null;
    };
    const repetidoAntes = await jaExiste();
    if (repetidoAntes) return repetidoAntes;

    const itens = entrada.itens.map((i) => ({ ...i }));
    const cad = await carregar(tx, { cliente_id: entrada.cliente_id, filial_id: entrada.filial_id, condicao_pagamento_id: entrada.condicao_pagamento_id, produto_ids: itens.map((i) => i.produto_id) });
    const decisao = decidirRecebimentoFdv({
      cliente: cad.cliente ? { inativo: cad.cliente.inativo } : null,
      filial: cad.filial,
      condicao: cad.condicao ? { inativo: cad.condicao.inativo } : null,
      condicao_pagamento_id: entrada.condicao_pagamento_id,
      produtos: [...cad.produtos.values()].map((p) => ({ id: p.id, inativo: p.inativo })),
      itens,
    });
    if (decisao.resultado === 'recusado') return { resultado: 'recusado', codigo: decisao.codigo };
    const cliente = cad.cliente as ClienteParaPedido;

    await repo.travarCliente(travaCliente(fx.tenant_id, entrada.cliente_id));
    // Duas entregas do mesmo pedido do mesmo cliente se enfileiram no lock: a segunda enxerga a primeira, sem gastar número.
    const aposTrava = await jaExiste();
    if (aposTrava) return aposTrava;
    const id = randomUUID();
    const numero = await repo.proximoNumero();
    const novo: NovoPedido = {
      id,
      origem: 'fdv',
      external_id: externalId,
      filial_id: entrada.filial_id,
      cliente_id: entrada.cliente_id,
      vendedor_id: entrada.vendedor_id,
      condicao_pagamento_id: entrada.condicao_pagamento_id,
      tabela_preco_id: null,
      cliente_retrato: retratoDoCliente(cliente),
      endereco_entrega: entrada.endereco_entrega,
      frete: entrada.frete,
      emitido_em: entrada.emitido_em,
      aprovado_origem_em: entrada.aprovado_origem_em,
      observacao: entrada.observacao,
      total_centavos: totalPedido(itens),
      total_informado_centavos: entrada.total_informado_centavos,
      pendencias: [],
      validado_em: null,
      criado_por: null,
      itens: entrada.itens.map(
        (i, n): NovoItem => ({
          sequencia: i.sequencia,
          produto_id: i.produto_id,
          produto_retrato: retratoDoProduto(cad.produtos.get(i.produto_id) as ProdutoParaPedido),
          quantidade: i.quantidade,
          unidade_venda: i.unidade_venda,
          fator_venda: i.fator_venda,
          quantidade_venda: i.quantidade_venda,
          preco_unitario_centavos: i.preco_unitario_centavos,
          preco_tabela_centavos: null,
          desconto_maximo_bp: null,
          desconto_centavos: i.desconto_centavos,
          total_centavos: totalItem(i.quantidade, i.preco_unitario_centavos, i.desconto_centavos, n),
          total_informado_centavos: i.total_informado_centavos,
          aplicacao: i.aplicacao,
        }),
      ),
    };
    if (!(await repo.inserir(id, numero, novo))) {
      // unique_violation de `pedido_external_id_uq` (corrida de duas buscas): o outro confirmou primeiro = repetido.
      const outro = await jaExiste();
      if (outro) return outro;
      throw erros.conflito('Não foi possível receber o pedido: tente de novo');
    }
    const criado = await obterOu404(repo, id);
    await registrarCriacao(repo, fx, criado, { status: 'aprovado', pendencias: [], validado: false }, cad.condicao);
    const final = await obterOu404(repo, id);
    await fx.auditar({ acao: 'pedido.receber', entidade: 'pedido', entidade_id: id, antes: null, depois: resumo(final) });
    log(fx, { pedido_id: id, acao: 'receber_fdv', status: 'aprovado' }, 'pedido do FDV recebido');
    return { resultado: 'criado', pedido_id: id, numero, status: 'aprovado' };
  }

  return { lancar, editar, revalidar, aprovar, recusar, cancelar, receberFdv, detalhar };
}

