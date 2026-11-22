/** Serviço de aplicação dos eventos fiscais (RF-FAT-02, RN-FAT-01, RN-FAT-02): a API só valida (domain), confere o A1 pelos metadados e grava o pedido `pendente`, na `tx` recebida.
 * Quem chama a SEFAZ é o worker (`processador-eventos.ts`); o fluxo está em docs/modulos/faturamento/eventos.md. */
import { violacao, type Transacao, type Violacao } from '@macuxierp/platform-sdk';
import type { CancelarNotaEntrada, CartaCorrecaoEntrada, InutilizarEntrada } from '../contracts';
import { avisosCartaCorrecao, instanteManaus, proximaSequenciaCce, validarCancelamento, validarCartaCorrecao, validarInutilizacao, type AvisoCartaCorrecao } from '../domain';
import type { AmbienteFiscalDaFilial, ConsultaA1Ativo, ConsultaCadastrosFaturamento, EventoRegistro, InutilizacaoRegistro, NotaRegistro, RepositorioEventos } from './portas';

export const EVENTO_NOTA_CANCELADA = 'faturamento.nota.cancelada@1' as const;

/** Base dos payloads de `nota.*@1` (agregado = nota.id): pedido, ambiente, nota, itens e vendedor. */
export const baseEventoDaNota = (n: NotaRegistro, protocolo: string | null, comoReal = false): Record<string, unknown> => ({
  pedido_id: n.pedido_id,
  ambiente: n.ambiente,
  nota: {
    id: n.id, filial_id: n.filial_id, cliente_id: n.cliente_id, serie: n.serie, numero: n.numero, chave_acesso: n.chave_acesso,
    emitida_em: n.emitida_em, total_centavos: n.total_centavos, protocolo,
  },
  itens: n.itens.map((i) => ({ sequencia: i.sequencia, quantidade: i.quantidade, valor_centavos: i.valor_centavos, ...(i.produto_id ? { produto_id: i.produto_id, filial_id: n.filial_id } : {}) })),
  vendedor_id: n.vendedor_id,
  quantidade_itens: n.itens.length,
  ...(comoReal ? { conta_como_real: true } : {}),
});

/** Texto livre da SEFAZ: sem espaço nas pontas nem repetido (o emissor recusa), quebra de linha vira espaço. */
const normalizarTexto = (t: string): string => t.replace(/\s+/g, ' ').trim();

export interface DepsEventos {
  eventos: RepositorioEventos;
  cadastros: Pick<ConsultaCadastrosFaturamento, 'filial'>;
  ambiente: AmbienteFiscalDaFilial;
  /** Veredito sobre os metadados do certificado (`A1ValidoDaFilial` do core, sem decifrar): a mesma porta da emissão. */
  certificado: ConsultaA1Ativo;
  agora?: () => Date;
  /** Prazo do cancelamento em horas (padrão 24; extemporâneo depende da UF, RN-FAT-02). */
  prazoCancelamentoHoras?: number;
}

export type ResultadoPedidoEvento = { ok: true; evento: EventoRegistro; repetido: boolean; avisos: AvisoCartaCorrecao[] } | { ok: false; violacoes: Violacao[] };
export type ResultadoPedidoInutilizacao = { ok: true; inutilizacao: InutilizacaoRegistro } | { ok: false; violacoes: Violacao[] };

const SEM_A1 = (campo: string, mensagem: string): Violacao => violacao('RN-CORE-06', campo, mensagem);

export function criarServicoEventos(deps: DepsEventos) {
  const agora = deps.agora ?? ((): Date => new Date());

  /** RN-FAT-02: cancela a nota autorizada dentro do prazo. Repetir com o cancelamento ainda pendente devolve o mesmo pedido. */
  async function pedirCancelamento(tx: Transacao, nota: NotaRegistro, entrada: CancelarNotaEntrada): Promise<ResultadoPedidoEvento> {
    const justificativa = normalizarTexto(entrada.justificativa);
    const existentes = (await deps.eventos.listarEventos(tx, nota.id)).filter((e) => e.tipo === 'cancelamento');
    const atual = existentes[0];
    if (atual?.status === 'pendente') return { ok: true, evento: atual, repetido: true, avisos: [] };
    if (!nota.autorizada_em) return { ok: false, violacoes: [violacao('RN-FAT-02', 'status', 'Nota sem data de autorização: não dá para conferir o prazo do cancelamento.')] };
    const v = validarCancelamento({ status: nota.status, autorizadaEm: new Date(nota.autorizada_em), agora: agora(), justificativa, prazoHoras: deps.prazoCancelamentoHoras });
    if (v.length > 0) return { ok: false, violacoes: v };
    {
      const a1 = await deps.certificado.temA1Ativo(tx, nota.filial_id);
      if (!a1.valido) return { ok: false, violacoes: [SEM_A1('filial_id', a1.mensagem)] };
    }
    const evento = atual ? await deps.eventos.reabrirEvento(tx, atual.id, justificativa) : await deps.eventos.criarEvento(tx, { nota_id: nota.id, tipo: 'cancelamento', n_seq_evento: 1, texto: justificativa });
    return { ok: true, evento, repetido: false, avisos: [] };
  }

  /** RN-FAT-02: CC-e na nota autorizada, sequência 1 a 20. A rejeitada mais recente volta a pendente com a mesma sequência (0013). */
  async function pedirCartaCorrecao(tx: Transacao, nota: NotaRegistro, entrada: CartaCorrecaoEntrada): Promise<ResultadoPedidoEvento> {
    const texto = normalizarTexto(entrada.texto);
    const todos = await deps.eventos.listarEventos(tx, nota.id);
    const cancelamento_pendente = todos.some((e) => e.tipo === 'cancelamento' && e.status === 'pendente'); // a tela já bloqueia; a API revalida (domain)
    const ces = todos.filter((e) => e.tipo === 'cce');
    const pendente = cancelamento_pendente ? undefined : ces.find((e) => e.status === 'pendente'); // com cancelamento pendente a regra do domain recusa antes de repetir
    if (pendente) {
      if (pendente.texto === texto) return { ok: true, evento: pendente, repetido: true, avisos: avisosCartaCorrecao(texto) };
      return { ok: false, violacoes: [violacao('RN-FAT-02', 'texto', 'Há uma carta de correção em processamento nesta nota: aguarde o retorno da SEFAZ.')] };
    }
    const ultima = ces.reduce<EventoRegistro | undefined>((a, e) => (!a || e.n_seq_evento > a.n_seq_evento ? e : a), undefined);
    const reabrir = ultima?.status === 'rejeitado' ? ultima : undefined;
    const sequencias = ces.filter((e) => e !== reabrir).map((e) => e.n_seq_evento);
    const v = validarCartaCorrecao({ status: nota.status, texto, sequenciasRegistradas: sequencias, cancelamento_pendente });
    if (v.length > 0) return { ok: false, violacoes: v };
    {
      const a1 = await deps.certificado.temA1Ativo(tx, nota.filial_id);
      if (!a1.valido) return { ok: false, violacoes: [SEM_A1('filial_id', a1.mensagem)] };
    }
    const evento = reabrir
      ? await deps.eventos.reabrirEvento(tx, reabrir.id, texto)
      : await deps.eventos.criarEvento(tx, { nota_id: nota.id, tipo: 'cce', n_seq_evento: proximaSequenciaCce(sequencias), texto });
    return { ok: true, evento, repetido: false, avisos: avisosCartaCorrecao(texto) };
  }

  /** RN-FAT-01: faixa de uma série da filial emissora. O banco confere de novo (até proximo+99, sem sobreposição, só rascunho ou rejeitada). */
  async function pedirInutilizacao(tx: Transacao, entrada: InutilizarEntrada): Promise<ResultadoPedidoInutilizacao> {
    const filial = await deps.cadastros.filial(tx, entrada.filial_id);
    if (!filial?.emissora || filial.nfe_serie === null) return { ok: false, violacoes: [violacao('RN-FAT-01', 'filial_id', 'Filial não é emissora de NF-e ou está sem série configurada.')] };
    const serie = entrada.serie ?? filial.nfe_serie;
    const ambiente = await deps.ambiente.ambiente(tx, filial.id);
    const proximo = await deps.eventos.proximoNumero(tx, filial.id, ambiente, serie);
    if (proximo === null) return { ok: false, violacoes: [violacao('RN-FAT-01', 'serie', `Série ${serie} sem numeração nesta filial e ambiente.`)] };
    const ano = entrada.ano ?? instanteManaus(agora()).getUTCFullYear();
    const justificativa = normalizarTexto(entrada.justificativa);
    const notasNaFaixa = await deps.eventos.notasNaFaixa(tx, filial.id, ambiente, serie, entrada.numero_inicial, entrada.numero_final);
    const v = validarInutilizacao({ numeroInicial: entrada.numero_inicial, numeroFinal: entrada.numero_final, proximoNumero: proximo, ano, justificativa, notasNaFaixa });
    if (v.length > 0) return { ok: false, violacoes: v };
    {
      const a1 = await deps.certificado.temA1Ativo(tx, filial.id);
      if (!a1.valido) return { ok: false, violacoes: [SEM_A1('filial_id', a1.mensagem)] };
    }
    const inutilizacao = await deps.eventos.criarInutilizacao(tx, { filial_id: filial.id, ambiente, serie, ano, numero_inicial: entrada.numero_inicial, numero_final: entrada.numero_final, justificativa });
    return { ok: true, inutilizacao };
  }

  return { pedirCancelamento, pedirCartaCorrecao, pedirInutilizacao };
}
