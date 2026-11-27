/**
 * Rotas `/v1/pedido` (T-0013 §4.2). Perfil, tenant e licença do módulo `pedido` são checados pela API antes do
 * `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`). Aqui entram as regras do domain (a API sempre revalida),
 * a carteira do vendedor, a auditoria (A) e os eventos, tudo pelo serviço, na transação do tenant.
 */
import { csvDaLista, definirRota, erros, fusoDaRota, type ContextoRota, type RotaModulo } from '@macuxierp/platform-sdk';
import { AprovarEntrada, CancelarEntrada, PedidoManualEntrada, RecusarEntrada } from '../contracts';
import { CATALOGO_MOTIVOS, ocultarDocumento, podeVerDocumentoCliente } from '../domain';
import { MotivoCancelamento, MotivoRecusa } from '../contracts';
import { COLUNA_DOCUMENTO, paginaPedidos, paginaPedidosNoFuso } from '../web/paginas';
import type { Dependencias, FiltroPedidos } from './portas';
import { criarServico, type Efeitos, type ResultadoLancamento } from './servico';
import { idDe } from './util';

/** Teto de linhas do CSV (RF-PED-05); a lista paginada não tem teto. */
const MAXIMO_LINHAS_CSV = 10_000;

/** Efeitos do serviço a partir do contexto da rota: outbox e auditoria na transação da rota, ator = o usuário. */
const efeitosDoContexto = (c: ContextoRota): Efeitos => ({
  tenant_id: c.sessao.tenant_id,
  ator: { tipo: 'usuario', id: c.sessao.usuario_id, perfil: c.sessao.perfil },
  agora: c.agora,
  publicar: async (e) => (await c.publicar({ nome: e.nome, agregado_id: e.agregado_id, payload: e.payload })).id,
  auditar: (d) => c.auditar(d),
});

/** `If-Match` = o `updated_at` do pedido (com ou sem aspas e `W/`). */
const tokenIfMatch = (cabecalhos: Readonly<Record<string, string>>): string => {
  const v = cabecalhos['if-match']?.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  if (!v) throw erros.validacao({ 'if-match': 'cabeçalho obrigatório: o updated_at do pedido' });
  return v;
};

export function criarRotas(deps: Dependencias): RotaModulo[] {
  const servico = criarServico(deps);
  const R = (c: ContextoRota) => deps.repositorios(c.tx);

  /** Carteira do vendedor: perfil `vendedor` enxerga só os pedidos do próprio vendedor (RF-PED-04, matriz do doc 03). */
  const carteira = async (c: ContextoRota): Promise<{ restrita: boolean; vendedor_id: string | null }> => {
    if (c.sessao.perfil !== 'vendedor') return { restrita: false, vendedor_id: null };
    return { restrita: true, vendedor_id: await deps.cadastros.vendedorDoUsuario(c.tx, c.sessao.usuario_id) };
  };

  const filtroDaLista = async (c: ContextoRota, consulta: Record<string, unknown>) => {
    const { limite: _l, cursor: _c, ...filtros } = consulta;
    const { restrita, vendedor_id } = await carteira(c);
    return { restrita, vendedor_id, filtros: { ...filtros, ...(restrita ? { vendedor_id } : {}) } as Omit<FiltroPedidos, 'limite' | 'cursor'> };
  };

  /** Pedido de outro vendedor = 404, como se não existisse. */
  const visivel = async (c: ContextoRota, vendedorDoPedido: string | null): Promise<void> => {
    const { restrita, vendedor_id } = await carteira(c);
    if (restrita && (vendedor_id === null || vendedorDoPedido !== vendedor_id)) throw erros.naoEncontrado('Pedido');
  };

  const respostaLancamento = (r: ResultadoLancamento) =>
    r.http === 409
      ? { status: 409, corpo: { codigo: 'CONFLITO', mensagem: 'RN-PED-01: já existe um pedido com este external_id e outro conteúdo', pedido: r.pedido } }
      : { status: r.http, corpo: r.pedido };

  return [
    definirRota({
      metodo: 'GET', caminho: '/pedidos', acao: 'pedido.ver', consulta: paginaPedidos.consulta,
      async executar(c, e) {
        const { restrita, vendedor_id, filtros } = await filtroDaLista(c, e.consulta as Record<string, unknown>);
        if (restrita && vendedor_id === null) return { corpo: { itens: [], proximo_cursor: null } };
        const { cursor, limite } = e.consulta as { cursor?: string; limite: number };
        const p = await R(c).listar({ ...filtros, cursor, limite });
        // O documento do cliente só existe no CSV de quem pode vê-lo: a lista JSON nunca o leva.
        return { corpo: { itens: p.itens.map(({ cliente_documento: _d, ...l }) => l), proximo_cursor: p.proximo_cursor } };
      },
    }),
    // Antes de `/:id`: o caminho fixo vence o parâmetro.
    definirRota({
      metodo: 'GET', caminho: '/pedidos/exportar', acao: 'pedido.ver', consulta: paginaPedidos.consulta,
      async executar(c, e) {
        const { restrita, vendedor_id, filtros } = await filtroDaLista(c, e.consulta as Record<string, unknown>);
        const comDocumento = podeVerDocumentoCliente(c.sessao.perfil);
        const linhas = restrita && vendedor_id === null ? [] : await R(c).listarTodos({ ...filtros, comDocumento }, MAXIMO_LINHAS_CSV);
        // O vendedor nunca recebe o documento do cliente: a coluna sai do CSV e o SQL nem a seleciona.
        const pagina = paginaPedidosNoFuso(fusoDaRota(c));
        const colunas = !comDocumento ? pagina.colunas.filter((col) => col.id !== COLUNA_DOCUMENTO) : pagina.colunas;
        return csvDaLista({ ...pagina, colunas }, c.sessao.perfil, linhas);
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/pedidos/:id', acao: 'pedido.ver',
      async executar(c, e) {
        const p = await R(c).obter(idDe(e.params));
        if (!p) throw erros.naoEncontrado('Pedido');
        await visivel(c, p.vendedor_id);
        const detalhe = await servico.detalhar(c.tx, R(c), p);
        return { corpo: { ...detalhe, cliente_retrato: ocultarDocumento(detalhe.cliente_retrato, c.sessao.perfil) } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/pedidos', acao: 'pedido.pedido.lancar', corpo: PedidoManualEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        return respostaLancamento(await servico.lancar(c.tx, efeitosDoContexto(c), e.corpo));
      },
    }),
    definirRota({
      metodo: 'PUT', caminho: '/pedidos/:id', acao: 'pedido.pedido.lancar', corpo: PedidoManualEntrada,
      async executar(c, e) {
        return { corpo: await servico.editar(c.tx, efeitosDoContexto(c), idDe(e.params), e.corpo, tokenIfMatch(e.cabecalhos)) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/pedidos/:id/revalidar', acao: 'pedido.pedido.lancar',
      async executar(c, e) {
        return { corpo: await servico.revalidar(c.tx, efeitosDoContexto(c), idDe(e.params)) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/pedidos/:id/aprovar', acao: 'pedido.pedido.aprovar', corpo: AprovarEntrada.default({}),
      async executar(c, e) {
        return { corpo: await servico.aprovar(c.tx, efeitosDoContexto(c), idDe(e.params), e.corpo) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/pedidos/:id/recusar', acao: 'pedido.pedido.aprovar', corpo: RecusarEntrada,
      async executar(c, e) {
        return { corpo: await servico.recusar(c.tx, efeitosDoContexto(c), idDe(e.params), e.corpo) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/pedidos/:id/cancelar', acao: 'pedido.pedido.cancelar', corpo: CancelarEntrada,
      async executar(c, e) {
        return { corpo: await servico.cancelar(c.tx, efeitosDoContexto(c), idDe(e.params), e.corpo) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/motivos', acao: 'pedido.ver',
      async executar() {
        const lista = (codigos: readonly string[]) => codigos.map((codigo) => ({ codigo, texto: CATALOGO_MOTIVOS[codigo as keyof typeof CATALOGO_MOTIVOS] }));
        return { corpo: { recusa: lista(MotivoRecusa.options), cancelamento: lista(MotivoCancelamento.options) } };
      },
    }),
  ];
}
