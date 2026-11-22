/** Dublês em memória das portas do pedido: servem aos testes de rota (sem PostgreSQL). Não entram em produção. */
import { randomUUID } from 'node:crypto';
import { paginar, type Pagina, type Transacao } from '@macuxierp/platform-sdk';
import type { CondicaoPagamento, Filial, PrecoVigente, SaldoEstoque } from '@macuxierp/cadastros/contracts';
import type { ClienteParaPedido, DecisaoPedido, HistoricoPedido, Pendencia, ProdutoParaPedido } from '../contracts';
import { erroTransicao } from './util';
import { STATUS_COMPROMETEM, possiveis, validarTransicao } from '../domain';
import type {
  ConsultaCadastrosPedido, ConsultaTitulosPedido, DadosCabecalho, Dependencias, FiltroPedidos, ItemGravado, LinhaLista, LogPedido,
  NotaEmAberto, NovaAprovacao, NovoEvento, NovoItem, NovoPedido, PedidoGravado, RepoPedidos,
} from './portas';

export const TENANT_MEMORIA = '11111111-1111-4111-8111-111111111111';

/** Um schema `pedido` inteiro em memória; `tenant` decide o isolamento no teste de vazamento de rota. */
class ArmazemMemoria {
  pedidos: PedidoGravado[] = [];
  /** Itens retirados na edição (`deleted_at`), por pedido: a sequência não se reaproveita. */
  retirados = new Map<string, number[]>();
  eventos: (NovoEvento & { id: string })[] = [];
  aprovacoes: NovaAprovacao[] = [];
  proximo = 1;
  relogio = { agora: new Date('2026-11-21T15:00:00Z') };
  travas: bigint[] = [];
  /** Marca o `updated_at` crescente por linha (migração 0006). */
  private tique = 0;

  carimbo(): string {
    this.tique += 1;
    return new Date(this.relogio.agora.getTime() + this.tique).toISOString();
  }
}

class RepoMemoria implements RepoPedidos {
  constructor(private readonly a: ArmazemMemoria) {}

  async tenantId() {
    return TENANT_MEMORIA;
  }
  async travarCliente(chave: bigint) {
    this.a.travas.push(chave);
  }
  async proximoNumero() {
    return this.a.proximo++;
  }
  async inserir(id: string, numero: number, p: NovoPedido): Promise<boolean> {
    if (p.external_id !== null && this.a.pedidos.some((x) => x.external_id === p.external_id)) return false;
    const itens: ItemGravado[] = p.itens.map((i) => ({ ...i, id: randomUUID(), quantidade_faturada: 0 }));
    const { itens: _i, ...resto } = p;
    this.a.pedidos.push({ ...structuredClone(resto), id, numero, status: 'recebido', valor_faturado_centavos: 0, updated_at: this.a.carimbo(), itens: structuredClone(itens) });
    return true;
  }
  private achar(id: string): PedidoGravado | undefined {
    return this.a.pedidos.find((x) => x.id === id);
  }
  private copia(p: PedidoGravado | undefined): PedidoGravado | null {
    return p ? structuredClone(p) : null;
  }
  async porExternalId(e: string) {
    return this.copia(this.a.pedidos.find((x) => x.external_id === e));
  }
  async obter(id: string) {
    return this.copia(this.achar(id));
  }
  async obterParaAtualizar(id: string) {
    return this.copia(this.achar(id));
  }
  private tocar(p: PedidoGravado) {
    p.updated_at = this.a.carimbo();
  }
  async atualizarStatus(id: string, status: PedidoGravado['status'], pendencias: readonly Pendencia[], validadoEm: Date | null) {
    const p = this.achar(id) as PedidoGravado;
    // Espelha o gatilho pedido.validar_status: transição fora da tabela = 422 RN-PED-02 com os possíveis.
    if (status !== p.status && !validarTransicao(p.status, status).ok) {
      throw erroTransicao(possiveis(p.status));
    }
    p.status = status;
    p.pendencias = structuredClone([...pendencias]);
    if (validadoEm) p.validado_em = validadoEm.toISOString();
    this.tocar(p);
  }
  async atualizarAVista(id: string, aVista: boolean) {
    (this.achar(id) as PedidoGravado).a_vista = aVista;
  }
  async atualizarPendencias(id: string, pendencias: readonly Pendencia[], validadoEm: Date) {
    const p = this.achar(id) as PedidoGravado;
    p.pendencias = structuredClone([...pendencias]);
    p.validado_em = validadoEm.toISOString();
    this.tocar(p);
  }
  async atualizarCabecalho(id: string, d: DadosCabecalho) {
    const p = this.achar(id) as PedidoGravado;
    Object.assign(p, structuredClone(d));
    this.tocar(p);
  }
  async substituirItens(pedidoId: string, itens: readonly NovoItem[]) {
    const p = this.achar(pedidoId) as PedidoGravado;
    const livres = [...p.itens];
    const retirados = this.a.retirados.get(pedidoId) ?? [];
    const mantidos: ItemGravado[] = [];
    const novos: NovoItem[] = [];
    for (const i of itens) {
      const pos = livres.findIndex((x) => x.produto_id === i.produto_id);
      if (pos < 0) novos.push(i);
      else {
        const [achado] = livres.splice(pos, 1);
        mantidos.push({ ...(achado as ItemGravado), ...structuredClone(i), sequencia: (achado as ItemGravado).sequencia });
      }
    }
    retirados.push(...livres.map((x) => x.sequencia));
    this.a.retirados.set(pedidoId, retirados);
    let base = Math.max(0, ...p.itens.map((x) => x.sequencia), ...retirados);
    for (const n of novos) mantidos.push({ ...structuredClone(n), id: randomUUID(), sequencia: ++base, quantidade_faturada: 0 });
    p.itens = mantidos.sort((x, y) => x.sequencia - y.sequencia);
    this.tocar(p);
  }
  async atualizarPrecosDeTabela(pedidoId: string, linhas: readonly { sequencia: number; preco_tabela_centavos: number | null; desconto_maximo_bp: number | null }[]) {
    const p = this.achar(pedidoId) as PedidoGravado;
    for (const l of linhas) {
      const i = p.itens.find((x) => x.sequencia === l.sequencia);
      if (i) Object.assign(i, { preco_tabela_centavos: l.preco_tabela_centavos, desconto_maximo_bp: l.desconto_maximo_bp });
    }
  }
  async registrarEvento(e: NovoEvento) {
    this.a.eventos.push({ ...e, id: randomUUID() });
  }
  async aplicarFaturamento(id: string, itens: readonly { sequencia: number; quantidade_faturada: number }[], valorFaturadoCentavos: number, status: PedidoGravado['status']) {
    const p = this.achar(id) as PedidoGravado;
    if (status !== p.status && !validarTransicao(p.status, status).ok) throw erroTransicao(possiveis(p.status));
    for (const n of itens) {
      const i = p.itens.find((x) => x.sequencia === n.sequencia);
      if (i) i.quantidade_faturada = n.quantidade_faturada;
    }
    p.valor_faturado_centavos = valorFaturadoCentavos;
    p.status = status;
    this.tocar(p);
  }
  async eventoRegistrado(pedidoId: string, eventoId: string) {
    return this.a.eventos.some((e) => e.pedido_id === pedidoId && e.evento_id === eventoId);
  }
  async registrarAprovacao(ap: NovaAprovacao) {
    if (this.a.aprovacoes.some((x) => x.pedido_id === ap.pedido_id)) throw new Error('aprovacao_uma_por_pedido');
    this.a.aprovacoes.push(structuredClone(ap));
  }
  async historico(pedidoId: string): Promise<HistoricoPedido[]> {
    return this.a.eventos
      .filter((e) => e.pedido_id === pedidoId)
      .map((e) => ({ de: e.de, para: e.para, ator_tipo: e.ator_tipo, ator_id: e.ator_id, motivo_codigo: e.motivo_codigo, motivo_texto: e.motivo_texto, ocorrido_em: e.ocorrido_em.toISOString() }));
  }
  async decisao(pedidoId: string): Promise<DecisaoPedido | null> {
    const a = this.a.aprovacoes.find((x) => x.pedido_id === pedidoId);
    return a ? { ...structuredClone(a), decidido_em: a.decidido_em.toISOString() } : null;
  }
  private filtrar(f: Omit<FiltroPedidos, 'limite' | 'cursor'>, comDocumento: boolean): LinhaLista[] {
    return this.a.pedidos
      .filter((p) => (!f.status || p.status === f.status) && (!f.cliente_id || p.cliente_id === f.cliente_id) && (!f.vendedor_id || p.vendedor_id === f.vendedor_id) &&
        (!f.filial_id || p.filial_id === f.filial_id) && (!f.origem || p.origem === f.origem) &&
        (!f.busca || (/^\d+$/.test(f.busca) ? p.numero === Number(f.busca) : p.cliente_retrato.razao_social.toLowerCase().includes(f.busca.toLowerCase()))))
      .sort((x, y) => (x.emitido_em < y.emitido_em ? 1 : x.emitido_em > y.emitido_em ? -1 : x.id < y.id ? -1 : 1))
      .map((p) => ({
        id: p.id, numero: p.numero, origem: p.origem, status: p.status, filial_id: p.filial_id, cliente_id: p.cliente_id, cliente_razao_social: p.cliente_retrato.razao_social,
        vendedor_id: p.vendedor_id, emitido_em: p.emitido_em, total_centavos: p.total_centavos, pendencias: p.pendencias.length, cliente_documento: comDocumento ? p.cliente_retrato.documento : null,
      }));
  }
  async listar(f: FiltroPedidos): Promise<Pagina<LinhaLista>> {
    const todas = this.filtrar(f, f.comDocumento === true);
    const pos = f.cursor ? todas.findIndex((x) => x.id === f.cursor) : -1;
    return paginar(todas.slice(pos + 1, pos + 2 + f.limite), f.limite);
  }
  async listarTodos(f: Omit<FiltroPedidos, 'limite' | 'cursor'>, maximo: number) {
    return this.filtrar(f, f.comDocumento === true).slice(0, maximo);
  }
  async compromissoCredito(clienteId: string, exceto: string | null): Promise<number> {
    let total = 0;
    for (const p of this.a.pedidos) {
      if (p.cliente_id !== clienteId || p.a_vista || p.id === exceto || !(STATUS_COMPROMETEM as readonly string[]).includes(p.status)) continue;
      total += p.total_centavos - p.valor_faturado_centavos;
    }
    return total;
  }
  async compromissoEstoque(filialId: string, produtoIds: readonly string[], exceto: string | null) {
    const por = new Map<string, number>();
    for (const p of this.a.pedidos) {
      if (p.filial_id !== filialId || p.id === exceto || !(STATUS_COMPROMETEM as readonly string[]).includes(p.status)) continue;
      for (const i of p.itens) if (produtoIds.includes(i.produto_id)) por.set(i.produto_id, (por.get(i.produto_id) ?? 0) + i.quantidade - i.quantidade_faturada);
    }
    return [...por].map(([produto_id, quantidade]) => ({ produto_id, quantidade }));
  }
}

/** Dublê do `ConsultaCadastrosPedido`: o teste põe os cadastros nos mapas. */
export class CadastrosMemoria implements ConsultaCadastrosPedido {
  clientes = new Map<string, ClienteParaPedido>();
  filiais = new Map<string, Pick<Filial, 'id' | 'emissora' | 'padrao' | 'inativo'>>();
  produtosPorId = new Map<string, ProdutoParaPedido>();
  condicoes = new Map<string, CondicaoPagamento>();
  /** `tabela:filial:produto` → preço (o dublê não faz o recuo à filial padrão: o teste põe o `origem_filial_id`). */
  precos = new Map<string, PrecoVigente>();
  saldosPor = new Map<string, number>();
  tabelaPadraoId: string | null = null;
  vendedores = new Map<string, string>();
  consultas = 0;

  async cliente(_tx: Transacao, id: string) {
    this.consultas += 1;
    return this.clientes.get(id) ?? null;
  }
  async filial(_tx: Transacao, id: string) {
    return this.filiais.get(id) ?? null;
  }
  async filialPadrao() {
    return [...this.filiais.values()].find((f) => f.padrao)?.id ?? null;
  }
  async produtos(_tx: Transacao, ids: readonly string[]) {
    return ids.flatMap((i) => this.produtosPorId.get(i) ?? []);
  }
  async tabelaPadrao() {
    return this.tabelaPadraoId;
  }
  async precosVigentes(_tx: Transacao, c: { tabela_preco_id: string; filial_id: string; produto_ids: readonly string[] }) {
    return c.produto_ids.flatMap((p) => this.precos.get(`${c.tabela_preco_id}:${c.filial_id}:${p}`) ?? []);
  }
  async saldos(_tx: Transacao, filial_id: string, ids: readonly string[]): Promise<SaldoEstoque[]> {
    return ids.flatMap((p) => (this.saldosPor.has(`${filial_id}:${p}`) ? [{ filial_id, produto_id: p, quantidade: this.saldosPor.get(`${filial_id}:${p}`) as number }] : []));
  }
  async condicao(_tx: Transacao, id: string) {
    return this.condicoes.get(id) ?? null;
  }
  async vendedorDoUsuario(_tx: Transacao, usuario: string) {
    return this.vendedores.get(usuario) ?? null;
  }
}

/** Log em memória com o formato do pino (uma linha JSON por registro): o teste de LGPD varre o texto. */
function logEmMemoria(): LogPedido & { error: LogPedido['warn'] } & { linhas: string[] } {
  const linhas: string[] = [];
  const grava = (nivel: string) => (dados: Record<string, unknown>, mensagem: string) => void linhas.push(JSON.stringify({ nivel, ...dados, msg: mensagem }));
  return { linhas, info: grava('info'), warn: grava('warn'), error: grava('error') };
}

export function dependenciasEmMemoria(p: { notaEmAutorizacao?: boolean; saldoTitulos?: number } = {}) {
  const armazem = new ArmazemMemoria();
  const cadastros = new CadastrosMemoria();
  const log = logEmMemoria();
  const titulos: ConsultaTitulosPedido = { saldoAbertoCliente: async () => p.saldoTitulos ?? 0 };
  const notas: NotaEmAberto = { temNotaEmAutorizacao: async () => p.notaEmAutorizacao ?? false };
  const deps: Dependencias = { repositorios: () => new RepoMemoria(armazem), cadastros, titulos, notas, log };
  return { deps, armazem, cadastros, log };
}
