/**
 * Rotas `/v1/faturamento` (RF-FAT-01, RF-FAT-08). Perfil, tenant e licença do módulo `faturamento` são checados pela API antes do
 * `executar` (RN-CORE-02; sem licença, 403 `MODULO_INATIVO`); aqui entram as regras do domain (a API sempre revalida), a auditoria e
 * o enfileiramento. A SEFAZ NUNCA é chamada daqui e o A1 não é lido: o worker assina e transmite (`transmissor.ts`, ADR 0005 item 4).
 * `vendedor` não acessa as notas na v1 (a carteira por vendedor entra com o BKO): 403.
 */
import { csvDaLista, definirRota, ErroApi, erros, fusoDaRota, type ContextoRota, type RespostaRota, type RotaModulo } from '@macuxierp/platform-sdk';
import type { ColunaLista } from '@macuxierp/platform-sdk/listas';
import {
  AbrirContingenciaEntrada, BaixarTituloEntrada, CancelarNotaEntrada, ConfigurarFilialEntrada, ConfiguracaoFilialResposta, CartaCorrecaoEntrada, EmitirNotaEntrada, FiltroEpecPendentes, FiltroNotas, FiltroPedidosAFaturar, FiltroRejeicoes, FiltroTitulos, InutilizarEntrada, TransmitirEpecPendentesEntrada, TRABALHO_CONSULTAR_NOTA, TRABALHO_PROCESSAR_EVENTO,
  TRABALHO_PROCESSAR_INUTILIZACAO, TRABALHO_TRANSMITIR_NOTA,
} from '../contracts';
import type { AlertaPrazoEpec, ContingenciaDaFilialResposta, EpecPendente, EventoNotaResumo } from '../contracts';
import { montarDanfe } from '../domain/danfe';
import { lerAssinaturaDaMarca, MENSAGEM_ATIVO_AUSENTE, type ResultadoAtivosDanfe } from './ativos-marca';
import { renderizarDanfe } from './danfe-pdf';
import { alertaPrazoEpec, podeBaixarTitulo, prazoEpec, situacaoPrazoEpec, validarEntradaContingencia } from '../domain';
import { paginaNoFuso, paginaEpecPendentes, paginaNotas, paginaPedidosAFaturar, paginaRejeicoes, paginaTitulos } from '../web/paginas';
import type { ConfiguracaoFaturamento, EventoRegistro, RepositorioContingencia, PortaDanfe, RepositorioTitulos } from './portas';
import { criarServicoTitulos } from './titulos';
import { criarServicoEmissao, type DepsEmissao } from './emissao';
import { criarServicoEventos, type DepsEventos } from './eventos';
import { traduzirErroBanco } from './sql';
import { erroDeViolacoes, idDe } from './util';

const semDhEvento = ({ dh_evento: _d, ...resto }: EventoRegistro): EventoNotaResumo => resto;

/** Teto de linhas do CSV (o mesmo do pedido, RF-PED-05); a lista paginada não tem teto. */
const MAXIMO_LINHAS_CSV = 10_000;

/** Lê a lista inteira, página a página (com os mesmos filtros da tela), até o teto de linhas do CSV. */
async function todasAsLinhas<L, F extends { limite: number; cursor?: string | undefined }>(
  listar: (filtro: F) => Promise<{ itens: L[]; proximo_cursor: string | null }>,
  consulta: F,
): Promise<L[]> {
  const { cursor: _c, limite: _l, ...filtros } = consulta;
  const saida: L[] = [];
  let cursor: string | undefined;
  while (saida.length < MAXIMO_LINHAS_CSV) {
    const p = await listar({ ...filtros, limite: 200, ...(cursor ? { cursor } : {}) } as unknown as F);
    saida.push(...p.itens);
    if (!p.proximo_cursor || p.itens.length === 0) break;
    cursor = p.proximo_cursor;
  }
  return saida.slice(0, MAXIMO_LINHAS_CSV);
}

/** CSV das listas com data e hora no fuso do tenant: lê `fusoDaRota(c)` uma vez e o usa nas linhas (filtros `de`/`ate`) e nas colunas (`paginaNoFuso`). */
async function csvNoFuso<L>(c: ContextoRota, pagina: Parameters<typeof paginaNoFuso<{ id: string; colunas: readonly ColunaLista<L>[]; csv: { readonly arquivo: string } | false }>>[0], linhasNoFuso: (fuso: string) => Promise<L[]>): Promise<RespostaRota> {
  const fuso = fusoDaRota(c);
  return csvDaLista(paginaNoFuso(pagina, fuso), c.sessao.perfil, await linhasNoFuso(fuso));
}

const SEM_VENDEDOR = (c: ContextoRota): void => {
  if (c.sessao.perfil === 'vendedor') throw erros.perfilSemPermissao();
};

/** Abrir e encerrar contingência (RN-FAT-05): só o administrador; os demais perfis, inclusive faturista e fiscal, recebem 403. */
const SOMENTE_ADMINISTRADOR = (c: ContextoRota): void => {
  if (c.sessao.perfil !== 'administrador') throw erros.perfilSemPermissao();
};

/** Emissão mais os eventos: a API só grava o pedido e confere o A1 pelos metadados (`temA1Ativo`); nunca lê o A1 decifrado nos eventos (ADR 0005 item 4). */
export type DepsRotas = DepsEmissao & Pick<DepsEventos, 'eventos'> & { titulos: RepositorioTitulos; configuracao: ConfiguracaoFaturamento; contingencia?: RepositorioContingencia; danfe?: PortaDanfe; ativosDanfe?: ResultadoAtivosDanfe };

/** Baixa e estorno só para administrador, gerente e faturista (RN-FAT-06). A rota usa `faturamento.ver` (licença e tenant) e confere o perfil aqui, até existir ação própria no platform-sdk. */
const SO_QUEM_BAIXA = (c: ContextoRota): void => {
  if (!podeBaixarTitulo(c.sessao.perfil)) throw erros.perfilSemPermissao();
};

/** Histórico curto da contingência da filial (as últimas fechadas). */
const HISTORICO_CONTINGENCIA = 10;
/** Contingência sem o adaptador (`DepsRotas.contingencia` ausente): 503, nunca 500. */
const SEM_CONTINGENCIA = 'Contingência';

export function criarRotas(deps: DepsRotas): RotaModulo[] {
  const contingencia = (): RepositorioContingencia => deps.contingencia ?? ((): never => { throw erros.indisponivel(SEM_CONTINGENCIA); })();
  /** Filial emissora do tenant e o ambiente vigente dela (regra 7: contingência por filial E ambiente). */
  const filialEAmbiente = async (c: ContextoRota, params: Readonly<Record<string, string>>) => {
    const filial_id = idDe(params, 'id', 'Filial');
    if (!(await deps.cadastros.filial(c.tx, filial_id))) throw erros.naoEncontrado('Filial');
    return { filial_id, ambiente: await deps.ambiente.ambiente(c.tx, filial_id) };
  };
  /** Pendentes com o prazo e a situação calculados no domain (RN-FAT-09: 168 h da autorização do EPEC). Volume baixo: filtra e pagina em memória. */
  const epecPendentes = async (c: ContextoRota, f: FiltroEpecPendentes): Promise<{ itens: EpecPendente[]; proximo_cursor: string | null }> => {
    const linhas = await contingencia().epecPendentes(c.tx, { filial_id: f.filial_id });
    const todas = linhas.map((l): EpecPendente => {
      const prazo = prazoEpec({ epecAutorizadoEm: new Date(l.epec_autorizada_em) });
      return { ...l, prazo_ate: prazo.toISOString(), situacao_prazo: situacaoPrazoEpec(c.agora, prazo) };
    }).filter((l) => !f.situacao || l.situacao_prazo === f.situacao).sort((a, b) => a.prazo_ate.localeCompare(b.prazo_ate) || a.id.localeCompare(b.id));
    const depois = f.cursor ? todas.findIndex((l) => l.id === f.cursor) + 1 : 0;
    const itens = todas.slice(depois, depois + f.limite);
    return { itens, proximo_cursor: depois + f.limite < todas.length ? (itens.at(-1)?.id ?? null) : null };
  };
  const servico = criarServicoEmissao(deps);
  const eventosSvc = criarServicoEventos({ eventos: deps.eventos, cadastros: deps.cadastros, ambiente: deps.ambiente, certificado: deps.certificado, agora: deps.agora });
  const notas = deps.notas;
  const titulosSvc = criarServicoTitulos({ titulos: deps.titulos, notas: deps.notas }, deps.agora);

  const enfileirar = (c: ContextoRota, nota_id: string, reenvio: boolean) =>
    c.enfileirar({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id }, external_id: reenvio ? `${nota_id}:${c.request_id}` : nota_id });

  /** RN-FAT-09: enfileira a volta das EPEC `emitida_contingencia` (filial e ambiente); o external_id leva a origem (encerramento ou requisição) para não colidir com a emissão nem repetir. Devolve a contagem e o prazo. */
  const enfileirarVolta = async (c: ContextoRota, filial_id: string | undefined, ambiente: string | undefined, origem: string): Promise<{ enfileiradas: number; vencidas: number }> => {
    const linhas = (await contingencia().epecPendentes(c.tx, { filial_id })).filter((l) => l.status === 'emitida_contingencia' && (!ambiente || l.ambiente === ambiente));
    let vencidas = 0;
    for (const l of linhas) {
      if (situacaoPrazoEpec(c.agora, prazoEpec({ epecAutorizadoEm: new Date(l.epec_autorizada_em) })) === 'vencido') vencidas++;
      await c.enfileirar({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id: l.id }, external_id: `${l.id}:volta:${origem}` });
    }
    return { enfileiradas: linhas.length, vencidas };
  };

  const enfileirarEvento = (c: ContextoRota, evento_id: string, dh_evento: string) =>
    c.enfileirar({ tipo: TRABALHO_PROCESSAR_EVENTO, payload: { evento_id }, external_id: `${evento_id}:${dh_evento}` });

  return [
    // RF-FAT-01: fila do BKO "Pedidos a faturar" (pedidos aprovados que ainda têm saldo). Só leitura; a emissão é o POST /notas.
    definirRota({
      metodo: 'GET', caminho: '/pedidos-a-faturar', acao: 'faturamento.ver', consulta: FiltroPedidosAFaturar,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await deps.pedidos.listar(c.tx, e.consulta, fusoDaRota(c)) };
      },
    }),
    // Exportações CSV das listas (RF-FAT-08): mesmos filtros da tela e mesma permissão, sem dado pessoal em log. Ficam antes dos caminhos com `:id`.
    definirRota({
      metodo: 'GET', caminho: '/pedidos-a-faturar/exportar', acao: 'faturamento.ver', consulta: FiltroPedidosAFaturar,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return csvNoFuso(c, paginaPedidosAFaturar, (fuso) => todasAsLinhas((f) => deps.pedidos.listar(c.tx, f, fuso), e.consulta));
      },
    }),
    // RF-FAT-01: detalhe com os itens e o saldo (base da nota parcial). `:id` = linha da fila (`PedidoAFaturarResumo.id`).
    definirRota({
      metodo: 'GET', caminho: '/pedidos-a-faturar/:id', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const p = await deps.pedidos.detalhar(c.tx, idDe(e.params, 'id', 'Pedido'), (pedido_id) => deps.situacao.situacao(c.tx, pedido_id));
        if (!p) throw erros.naoEncontrado('Pedido');
        return { corpo: p };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/notas/exportar', acao: 'faturamento.ver', consulta: FiltroNotas,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return csvNoFuso(c, paginaNotas, (fuso) => todasAsLinhas((f) => notas.listar(c.tx, f, fuso), e.consulta));
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/rejeicoes/exportar', acao: 'faturamento.ver', consulta: FiltroRejeicoes,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return csvNoFuso(c, paginaRejeicoes, () => todasAsLinhas((f) => notas.listarRejeicoes(c.tx, f), e.consulta));
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/titulos/exportar', acao: 'faturamento.ver', consulta: FiltroTitulos,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return csvDaLista(paginaTitulos, c.sessao.perfil, await todasAsLinhas((f) => deps.titulos.listar(c.tx, f), e.consulta));
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/notas', acao: 'faturamento.ver', consulta: FiltroNotas,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await notas.listar(c.tx, e.consulta, fusoDaRota(c)) };
      },
    }),
    // RF-FAT-08: painel de rejeições. Caminho fixo antes de `/notas/:id`.
    definirRota({
      metodo: 'GET', caminho: '/rejeicoes', acao: 'faturamento.ver', consulta: FiltroRejeicoes,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await notas.listarRejeicoes(c.tx, e.consulta) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/notas/:id', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const n = await notas.detalhar(c.tx, idDe(e.params));
        if (!n) throw erros.naoEncontrado('Nota');
        return { corpo: n };
      },
    }),
    // O XML tem dado do destinatário: só quem emite (administrador, faturista, fiscal) baixa. Só existe depois da guarda (RN-FAT-03).
    definirRota({
      metodo: 'GET', caminho: '/notas/:id/xml', acao: 'faturamento.nota.emitir',
      async executar(c, e) {
        const xml = await notas.lerXmlAutorizado(c.tx, idDe(e.params));
        if (!xml) throw erros.naoEncontrado('XML autorizado');
        return {
          corpo: xml.xml,
          cabecalhos: { 'content-type': 'application/xml; charset=utf-8', 'content-disposition': `attachment; filename="NFe${xml.chave_acesso}.xml"`, 'cache-control': 'no-store' },
        };
      },
    }),
    // RF-FAT-03: DANFE gerado sob demanda a partir do nfeProc guardado (a fonte é o XML; o PDF não é guardado). Leitura: vendedor não acessa.
    definirRota({
      metodo: 'GET', caminho: '/notas/:id/danfe', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const nota = await notas.obter(c.tx, idDe(e.params));
        if (!nota) throw erros.naoEncontrado('Nota');
        // RN-FAT-08: a EPEC com o evento registrado (emitida_contingencia, ou em_autorizacao/rejeitada na volta) imprime o DANFE da <NFe> assinada, com o protocolo do EVENTO; ainda sem protNFe.
        const emEpec = nota.tp_emis === 4 && !!nota.epec_protocolo && !!nota.epec_autorizada_em && ['emitida_contingencia', 'em_autorizacao', 'rejeitada'].includes(nota.status);
        if (nota.status !== 'autorizada' && nota.status !== 'cancelada' && !emEpec) {
          throw erros.regra('RN-FAT-03', 'O DANFE só existe para nota autorizada, cancelada ou EPEC com o evento registrado.', { status: nota.status });
        }
        const xml = emEpec ? await notas.ultimoXmlAssinado(c.tx, nota.id) : await notas.lerXmlAutorizado(c.tx, nota.id);
        if (!xml) throw erros.naoEncontrado(emEpec ? 'XML assinado' : 'XML autorizado');
        let modelo;
        try {
          modelo = montarDanfe({ nfeProc: xml.xml, cancelada: nota.status === 'cancelada', ...(emEpec ? { epec: { protocolo: nota.epec_protocolo as string, dhRegistro: nota.epec_autorizada_em as string } } : {}) });
        } catch (err) {
          throw erros.regra('RN-FAT-03', 'O XML guardado não pôde ser lido para o DANFE.', { nota: err instanceof Error ? err.constructor.name : 'erro' });
        }
        const assinaturaMarca = await (deps.danfe?.assinaturaMarca ?? lerAssinaturaDaMarca)();
        if ((deps.ativosDanfe && !deps.ativosDanfe.ok) || !assinaturaMarca) throw new ErroApi(503, 'ATIVO_MARCA_AUSENTE', MENSAGEM_ATIVO_AUSENTE); // nunca um DANFE sem o rodapé
        const pdf = await renderizarDanfe(modelo, {
          logoEmitente: (await deps.danfe?.logoEmitente?.(c.tx, nota.filial_id)) ?? null,
          assinaturaMarca,
          agora: c.agora,
        });
        return {
          corpo: Buffer.from(pdf),
          cabecalhos: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="DANFE${nota.chave_acesso}.pdf"`, 'cache-control': 'no-store' },
        };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/notas', acao: 'faturamento.nota.emitir', corpo: EmitirNotaEntrada,
      async executar(c, e) {
        const r = await servico.emitirNota(c.tx, c.sessao.tenant_id, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        if (!r.repetida) {
          await c.auditar({ acao: 'faturamento.nota.emitir', entidade: 'nota', entidade_id: r.nota.id, depois: { pedido_id: r.nota.pedido_id, serie: r.nota.serie, numero: r.nota.numero, ambiente: r.nota.ambiente } });
          await enfileirar(c, r.nota.id, false);
        } else if (r.nota.status === 'rascunho') {
          // Repetição com a nota ainda em rascunho (trabalho perdido ou worker sem A1): enfileira de novo; o worker é idempotente (RN-FAT-03).
          await enfileirar(c, r.nota.id, true);
        }
        const detalhe = await notas.detalhar(c.tx, r.nota.id);
        return { status: r.repetida ? 200 : 201, corpo: detalhe };
      },
    }),
    // RN-FAT-07: reenvio da rejeitada (ou do rascunho não assinado) com o MESMO número; a API refaz o conteúdo; o worker reassina e transmite.
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/reenviar', acao: 'faturamento.nota.emitir',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params), { travar: true });
        if (!nota) throw erros.naoEncontrado('Nota');
        const r = await servico.reenviarNota(c.tx, nota).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        await c.auditar({ acao: 'faturamento.nota.reenviar', entidade: 'nota', entidade_id: nota.id, depois: { serie: nota.serie, numero: nota.numero } });
        await enfileirar(c, nota.id, true);
        return { corpo: await notas.detalhar(c.tx, nota.id) };
      },
    }),
    // ---- Eventos (lote 2): a API grava o pedido `pendente` e enfileira; o worker chama a SEFAZ (processador-eventos.ts). 202 = aceito para processar. ----
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/cancelar', acao: 'faturamento.nota.emitir', corpo: CancelarNotaEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params), { travar: true });
        if (!nota) throw erros.naoEncontrado('Nota');
        const r = await eventosSvc.pedirCancelamento(c.tx, nota, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        if (!r.repetido) {
          await c.auditar({ acao: 'faturamento.nota.cancelar', entidade: 'nota', entidade_id: nota.id, depois: { evento_id: r.evento.id, serie: nota.serie, numero: nota.numero } });
          await enfileirarEvento(c, r.evento.id, r.evento.dh_evento);
        }
        return { status: 202, corpo: semDhEvento(r.evento) };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/carta-correcao', acao: 'faturamento.nota.emitir', corpo: CartaCorrecaoEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params), { travar: true });
        if (!nota) throw erros.naoEncontrado('Nota');
        const r = await eventosSvc.pedirCartaCorrecao(c.tx, nota, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        if (!r.repetido) {
          await c.auditar({ acao: 'faturamento.nota.carta_correcao', entidade: 'nota', entidade_id: nota.id, depois: { evento_id: r.evento.id, n_seq_evento: r.evento.n_seq_evento } });
          await enfileirarEvento(c, r.evento.id, r.evento.dh_evento);
        }
        return { status: 202, corpo: { evento: semDhEvento(r.evento), avisos: r.avisos } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/inutilizacoes', acao: 'faturamento.nota.emitir', corpo: InutilizarEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        const r = await eventosSvc.pedirInutilizacao(c.tx, e.corpo).catch(traduzirErroBanco);
        if (!r.ok) throw erroDeViolacoes(r.violacoes);
        const i = r.inutilizacao;
        await c.auditar({ acao: 'faturamento.inutilizacao.pedir', entidade: 'inutilizacao', entidade_id: i.id, depois: { filial_id: i.filial_id, serie: i.serie, numero_inicial: i.numero_inicial, numero_final: i.numero_final } });
        await c.enfileirar({ tipo: TRABALHO_PROCESSAR_INUTILIZACAO, payload: { inutilizacao_id: i.id }, external_id: i.id });
        return { status: 202, corpo: i };
      },
    }),
    // Consulta de protocolo (reconcilia o status sem editar a nota autorizada): enfileira; a SEFAZ é chamada pelo worker.
    definirRota({
      metodo: 'POST', caminho: '/notas/:id/consultar', acao: 'faturamento.nota.emitir', idempotencia: 'opcional',
      async executar(c, e) {
        const nota = await notas.obter(c.tx, idDe(e.params));
        if (!nota) throw erros.naoEncontrado('Nota');
        await c.auditar({ acao: 'faturamento.nota.consultar', entidade: 'nota', entidade_id: nota.id });
        await c.enfileirar({ tipo: TRABALHO_CONSULTAR_NOTA, payload: { nota_id: nota.id }, external_id: `${nota.id}:${c.request_id}` });
        return { status: 202, corpo: { nota_id: nota.id, enfileirada: true } };
      },
    }),
    // ---- Títulos a receber (lote 5, RF-FAT-07). Baixa e estorno gravam em `titulo_baixa` (o gatilho do banco abate o saldo na mesma tx). ----
    definirRota({
      metodo: 'GET', caminho: '/titulos', acao: 'faturamento.ver', consulta: FiltroTitulos,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await deps.titulos.listar(c.tx, e.consulta) };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/titulos/:id', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const t = await deps.titulos.detalhar(c.tx, idDe(e.params));
        if (!t) throw erros.naoEncontrado('Título');
        return { corpo: t };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/titulos/:id/baixas', acao: 'faturamento.ver', corpo: BaixarTituloEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        SO_QUEM_BAIXA(c);
        const id = idDe(e.params);
        const r = await titulosSvc.baixar(c.tx, id, e.corpo, c.sessao.usuario_id).catch(traduzirErroBanco);
        await c.auditar({ acao: 'faturamento.titulo.baixar', entidade: 'titulo', entidade_id: id, depois: { baixa_id: r.baixa.id, valor_centavos: r.baixa.valor_centavos, forma: r.baixa.forma, saldo_centavos: r.titulo.saldo_centavos } });
        return { status: 201, corpo: { baixa: r.baixa, titulo: r.titulo } };
      },
    }),
    definirRota({
      metodo: 'POST', caminho: '/titulos/:id/baixas/:baixa_id/estornar', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        SO_QUEM_BAIXA(c);
        const id = idDe(e.params);
        const baixa_id = idDe(e.params, 'baixa_id');
        const r = await titulosSvc.estornar(c.tx, id, baixa_id).catch(traduzirErroBanco);
        await c.auditar({ acao: 'faturamento.titulo.estornar', entidade: 'titulo', entidade_id: id, depois: { baixa_id, saldo_centavos: r.titulo.saldo_centavos } });
        return { corpo: { titulo: r.titulo } };
      },
    }),
    // ---- Bandeira por filial "faturamento real com NF-e simulada" (desligada por padrão; só o administrador liga). A nota segue de homologação no XML (regra 7). ----
    definirRota({
      metodo: 'GET', caminho: '/filiais/:id/configuracao', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const filial_id = idDe(e.params);
        const resposta: ConfiguracaoFilialResposta = {
          filial_id,
          faturamento_real_nfe_simulada: await deps.configuracao.faturamentoRealComNfeSimulada(c.tx, filial_id),
          ambiente: await deps.ambiente.ambiente(c.tx, filial_id),
        };
        return { corpo: resposta };
      },
    }),
    definirRota({
      metodo: 'PUT', caminho: '/filiais/:id/configuracao', acao: 'faturamento.ver', corpo: ConfigurarFilialEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        if (c.sessao.perfil !== 'administrador') throw erros.perfilSemPermissao();
        const filial_id = idDe(e.params);
        if (!(await deps.cadastros.filial(c.tx, filial_id))) throw erros.naoEncontrado('Filial');
        const antes = await deps.configuracao.faturamentoRealComNfeSimulada(c.tx, filial_id);
        await deps.configuracao.definir(c.tx, filial_id, e.corpo.faturamento_real_nfe_simulada, c.sessao.usuario_id);
        await c.auditar({ acao: 'faturamento.filial.configurar', entidade: 'filial', entidade_id: filial_id, antes: { faturamento_real_nfe_simulada: antes }, depois: { faturamento_real_nfe_simulada: e.corpo.faturamento_real_nfe_simulada } });
        return { corpo: { filial_id, faturamento_real_nfe_simulada: e.corpo.faturamento_real_nfe_simulada } };
      },
    }),
    // ---- Contingência por filial (T-0021, lote 4; RN-FAT-05, 09 e 10). Abrir e encerrar: SÓ o administrador (decisão do Alexandre, 23/11 07h40); não há ação própria no SDK, então a rota usa `faturamento.nota.emitir` (licença, tenant e perfil emissor) e confere o perfil `administrador` no corpo, como a bandeira da filial. Faturista e fiscal seguem emitindo, inclusive em contingência aberta. ----
    // Caminho fixo antes de qualquer `:id`.
    definirRota({
      metodo: 'GET', caminho: '/contingencia/epec-pendentes', acao: 'faturamento.ver', consulta: FiltroEpecPendentes,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return { corpo: await epecPendentes(c, e.consulta) };
      },
    }),
    // RN-FAT-09: sinal do prazo de 168 h para o painel do administrador: vermelho = alguma EPEC vencida; amarelo = alguma perto do fim; verde = nenhuma pendente em risco.
    definirRota({
      metodo: 'GET', caminho: '/contingencia/epec-pendentes/alerta', acao: 'faturamento.ver', consulta: FiltroEpecPendentes.pick({ filial_id: true }),
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const linhas = await contingencia().epecPendentes(c.tx, { filial_id: e.consulta.filial_id });
        const prazos = linhas.map((l) => prazoEpec({ epecAutorizadoEm: new Date(l.epec_autorizada_em) }));
        const corpo: AlertaPrazoEpec = alertaPrazoEpec(c.agora, prazos);
        return { corpo };
      },
    }),
    // RN-FAT-09: o administrador manda transmitir as EPEC pendentes (emitida_contingencia) sem esperar o encerramento; o worker transmite a mesma nfe_assinada ao autorizador normal.
    definirRota({
      metodo: 'POST', caminho: '/contingencia/epec-pendentes/transmitir', acao: 'faturamento.nota.emitir', corpo: TransmitirEpecPendentesEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        SOMENTE_ADMINISTRADOR(c);
        const r = await enfileirarVolta(c, e.corpo.filial_id, undefined, c.request_id);
        await c.auditar({ acao: 'faturamento.epec.transmitir_pendentes', entidade: 'contingencia', entidade_id: e.corpo.filial_id ?? c.sessao.tenant_id, depois: { filial_id: e.corpo.filial_id ?? null, enfileiradas: r.enfileiradas, vencidas: r.vencidas } });
        return { status: 202, corpo: r };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/contingencia/epec-pendentes/exportar', acao: 'faturamento.ver', consulta: FiltroEpecPendentes,
      async executar(c, e) {
        SEM_VENDEDOR(c);
        return csvNoFuso(c, paginaEpecPendentes, () => todasAsLinhas((f) => epecPendentes(c, f), e.consulta));
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/filiais/:id/contingencia', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const { filial_id, ambiente } = await filialEAmbiente(c, e.params);
        const repo = contingencia();
        const resposta: ContingenciaDaFilialResposta = { filial_id, ambiente, aberta: await repo.aberta(c.tx, filial_id, ambiente), historico: await repo.historico(c.tx, filial_id, ambiente, HISTORICO_CONTINGENCIA) };
        return { corpo: resposta };
      },
    }),
    // RN-FAT-05: o operador decide a entrada; o domain valida a justificativa, o início e a modalidade. RN-FAT-10: filial com NF-e simulada não entra.
    definirRota({
      metodo: 'POST', caminho: '/filiais/:id/contingencia', acao: 'faturamento.nota.emitir', corpo: AbrirContingenciaEntrada, idempotencia: 'obrigatoria',
      async executar(c, e) {
        SOMENTE_ADMINISTRADOR(c);
        const repo = contingencia();
        const { filial_id, ambiente } = await filialEAmbiente(c, e.params);
        if (e.corpo.filial_id !== filial_id) throw erros.validacao({ filial_id: 'A filial do corpo deve ser a da URL.' });
        if (e.corpo.ambiente && e.corpo.ambiente !== ambiente) throw erros.regra('RN-FAT-04', `A filial emite em ${ambiente}; a contingência é aberta no ambiente da filial.`, { ambiente: 'diferente do ambiente da filial' });
        const inicioEm = e.corpo.inicio_em ? new Date(e.corpo.inicio_em) : c.agora;
        const v = validarEntradaContingencia({
          nfeSimulada: await deps.configuracao.faturamentoRealComNfeSimulada(c.tx, filial_id), modalidade: e.corpo.modalidade, motivo: e.corpo.motivo, inicioEm, agora: c.agora,
        });
        if (v.length > 0) throw erroDeViolacoes(v);
        if (await repo.aberta(c.tx, filial_id, ambiente)) throw erros.conflito('A filial já está em contingência neste ambiente. Encerre a atual antes de abrir outra.');
        const aberta = await repo.abrir(c.tx, { filial_id, ambiente, modalidade: e.corpo.modalidade, motivo: e.corpo.motivo, inicio_em: inicioEm, ligada_por: c.sessao.usuario_id }).catch((err: unknown) => {
          if ((err as { code?: string } | null)?.code === '23505') throw erros.conflito('A filial já está em contingência neste ambiente. Encerre a atual antes de abrir outra.');
          return traduzirErroBanco(err);
        });
        await c.auditar({ acao: 'faturamento.contingencia.abrir', entidade: 'contingencia', entidade_id: aberta.id, depois: { filial_id, ambiente, modalidade: aberta.modalidade } });
        return { status: 201, corpo: aberta };
      },
    }),
    // RN-FAT-09: o operador encerra (nada de volta automática); as EPEC pendentes seguem pela fila da volta.
    definirRota({
      metodo: 'POST', caminho: '/filiais/:id/contingencia/encerrar', acao: 'faturamento.nota.emitir', idempotencia: 'obrigatoria',
      async executar(c, e) {
        SOMENTE_ADMINISTRADOR(c);
        const repo = contingencia();
        const { filial_id, ambiente } = await filialEAmbiente(c, e.params);
        const encerrada = await repo.encerrar(c.tx, filial_id, ambiente, c.agora, c.sessao.usuario_id).catch(traduzirErroBanco);
        if (!encerrada) throw erros.naoEncontrado('Contingência aberta');
        await c.auditar({ acao: 'faturamento.contingencia.encerrar', entidade: 'contingencia', entidade_id: encerrada.id, depois: { filial_id, ambiente, modalidade: encerrada.modalidade } });
        // RN-FAT-09: ao encerrar a EPEC da filial e do ambiente, as notas pendentes entram na fila da volta (o worker transmite a mesma nfe_assinada ao autorizador normal).
        if (encerrada.modalidade === 'epec') await enfileirarVolta(c, filial_id, ambiente, encerrada.id);
        return { corpo: encerrada };
      },
    }),
    definirRota({
      metodo: 'GET', caminho: '/notas/:id/eventos', acao: 'faturamento.ver',
      async executar(c, e) {
        SEM_VENDEDOR(c);
        const id = idDe(e.params);
        if (!(await notas.obter(c.tx, id))) throw erros.naoEncontrado('Nota');
        return { corpo: { itens: (await deps.eventos.listarEventos(c.tx, id)).map(semDhEvento) } };
      },
    }),
  ];
}
