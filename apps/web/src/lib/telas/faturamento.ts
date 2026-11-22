/**
 * Adaptador do faturamento (T-0021): transforma os descritores de `@macuxierp/faturamento/web` (listas, nota, título e requisições)
 * nos tipos do renderizador genérico. Nenhuma regra de negócio aqui: ações por perfil e status, prazos, diálogos e corpos vêm do módulo;
 * a API revalida tudo (RN-CORE-02). Sem dado pessoal em log; horários no fuso do tenant.
 */
import {
  ACOES_DA_NOTA, PAGINAS_FATURAMENTO, ROTULO_ACAO_NOTA, ROTULO_LINHA, TEXTO_VAZIO, acaoPrincipalDaNota, acoesDoPedidoAFaturar, acoesDoTitulo, badgesDaNota, colunasDaPagina, confirmacaoReenviar,
  dialogoCancelar, dialogoCartaCorrecao, dialogoEstornar, dialogoInutilizar, faixaDaNota, faixaDoTitulo, formularioBaixa, hojeCivil, motivosDasAcoes, numeroSerie, requisicaoBaixa, requisicaoCancelar,
  requisicaoCartaCorrecao, requisicaoConsultar, requisicaoEmitir, requisicaoEstornar, requisicaoInutilizar, requisicaoReenviar, rotuloDaForma, situacaoDoTitulo, urlDoDanfe, urlDoXml,
  type AcaoDaNota, type Montagem, type Selo as SeloModulo,
} from '@macuxierp/faturamento/web';
import {
  Ambiente, EventoNotaResumo, FiltroNotas, FiltroPedidosAFaturar, FiltroRejeicoes, FiltroTitulos, NotaDetalhe, NotaResumo, PedidoAFaturarResumo, RejeicaoNota, StatusNota, TituloDetalhe, TituloResumo,
  type StatusPedidoAFaturar, type StatusTitulo,
} from '@macuxierp/faturamento/contracts';
import { z } from 'zod';
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarDataHora, formatarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { BASE_API } from '../arquivos';
import type { AcaoVista, DetalheVista, DownloadVista, Escrita, EntradaAcao, EventoVista, FiltroTela, Linha, ResultadoAcao, SeloVista, TelaDescrita, TelaDetalhe, TelaLista } from '../descritor/tipos';

const rotaDe = (id: string): string => PAGINAS_FATURAMENTO.find((p) => p.id === id)?.rota ?? `/faturamento/${id}`;
export const ROTA_PEDIDOS = rotaDe('pedidos-a-faturar');
export const ROTA_NOTAS = rotaDe('notas');
export const ROTA_NOTA = rotaDe('nota');
export const ROTA_REJEICOES = rotaDe('rejeicoes');
export const ROTA_TITULOS = rotaDe('titulos');
export const ROTA_TITULO = rotaDe('titulo');

/** Chave só para validar o diálogo (o envio usa a Idempotency-Key real da tentativa). */
const CHAVE_DE_VALIDACAO = 'validacao-do-dialogo';
const TOM = { ok: 'ok', alerta: 'aviso', erro: 'erro', neutro: 'neutro' } as const;
const FUSO_COLUNAS = 'America/Manaus';
const selo = (x: SeloModulo): SeloVista => ({ texto: x.texto, tom: TOM[x.tom], ...(x.dica ? { dica: x.dica } : {}) });

// Rótulos vêm das colunas e dos selos do módulo (uma só fonte): nada de tabela de texto copiada aqui.
const rotuloDeStatusNota = (s: StatusNota): string => badgesDaNota({ status: s, ambiente: 'producao' })[0]?.texto ?? s;
const rotuloDeStatusTitulo = (s: StatusTitulo): string => situacaoDoTitulo({ status: s, vencimento: '9999-12-31' }, '2000-01-01').texto;
const rotuloDeStatusPedido = (s: StatusPedidoAFaturar): string => String(colunasDaPagina('pedidos-a-faturar', FUSO_COLUNAS).find((c) => c.id === 'status')?.valor({ status: s }) ?? s);
const textoDoAmbiente = (a: Ambiente): string => String(colunasDaPagina('notas', FUSO_COLUNAS).find((c) => c.id === 'ambiente')?.valor({ ambiente: a }) ?? a);

// Um caminho, uma constante: a ação e a lista de escritas permitidas usam a mesma (`:id` é o UUID do registro).
const NOTAS = `${BASE_API}/notas`;
const INUTILIZACOES = `${BASE_API}/inutilizacoes`;
const TITULOS = `${BASE_API}/titulos`;
const NOTA_VERBO = (verbo: string): string => `${NOTAS}/:id/${verbo}`;
const BAIXAS = `${TITULOS}/:id/baixas`;
const ESTORNO = `${BAIXAS}/:baixa_id/estornar`;
const preencher = (modelo: string, valores: Readonly<Record<string, string>>): string => modelo.replace(/:(\w+)/g, (_, k: string) => valores[k] ?? '');
const POST = (caminho: string): Escrita => ({ metodo: 'POST', caminho });
const textoDoVencimento = (vencimento: string): string => String(colunasDaPagina('titulos', FUSO_COLUNAS).find((c) => c.id === 'vencimento')?.valor({ vencimento }) ?? vencimento);

const FILIAL: FiltroTela = { chave: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais' };
const DE: FiltroTela = { chave: 'de', rotulo: 'De', tipo: 'data' };
const ATE: FiltroTela = { chave: 'ate', rotulo: 'Até', tipo: 'data' };
const AMBIENTE: FiltroTela = { chave: 'ambiente', rotulo: 'Ambiente', tipo: 'selecao', opcoes: Ambiente.options.map((a) => ({ valor: a, rotulo: textoDoAmbiente(a) })) };

const SEM_CURSOR = { cursor: true, limite: true } as const;
type IdLista = keyof typeof TEXTO_VAZIO;

/** Página de lista do shell: a rota e a API vêm de `PAGINAS_FATURAMENTO`; colunas, filtros e contratos, do módulo. */
function paginaDe(id: IdLista, item: TelaLista['pagina']['item'], filtros: Parameters<typeof definirPaginaLista>[0]['filtros'], arquivo: string): TelaLista['pagina'] {
  const api = PAGINAS_FATURAMENTO.find((p) => p.id === id)?.api ?? `${BASE_API}/${id}`;
  return definirPaginaLista({ id, api, item, filtros, colunas: colunasDaPagina(id, FUSO_COLUNAS) as never, csv: { arquivo } }) as unknown as TelaLista['pagina'];
}

function lista(id: IdLista, pagina: TelaLista['pagina'], filtrosTela: readonly FiltroTela[], extra: Partial<TelaLista> = {}): TelaLista {
  return {
    tipo: 'lista',
    pagina,
    filtrosTela,
    colunas: () => colunasDaPagina(id, FUSO_COLUNAS).map((c) => ({ id: c.id, rotulo: c.titulo, ...(c.tipo ? { tipo: c.tipo } : {}) })),
    linha: (item, fuso) => Object.fromEntries(colunasDaPagina(id, fuso).map((c) => { const v = c.valor(item); return [c.id, v === null || v === undefined ? '' : String(v)]; })),
    selos: (item, fuso) => Object.fromEntries(colunasDaPagina(id, fuso).flatMap((c) => (c.selos ? [[c.id, c.selos(item).map(selo)] as const] : []))),
    textoVazio: TEXTO_VAZIO[id],
    ...extra,
  };
}

/** Sem o ambiente conhecido, a confirmação não afirma nada: manda conferir a filial emissora (RN-FAT-04). */
const AMBIENTE_DESCONHECIDO = { texto: 'Ambiente: confira a configuração da filial emissora', tom: 'alerta' } as const;
/** Linha "Ambiente:" do módulo (os mesmos dizeres do Reenviar), a partir do ambiente da filial emissora; ausente ou inválido, o aviso de conferir. */
function ambienteDaFilial(a: unknown): { texto: string; tom: 'neutro' | 'alerta' | 'ok' | 'erro' } {
  const v = Ambiente.safeParse(a);
  if (!v.success) return AMBIENTE_DESCONHECIDO;
  const c = confirmacaoReenviar({ numero: null, serie: 1, status: 'rascunho', ambiente: v.data });
  return { texto: c.ambiente, tom: c.tomAmbiente };
}

/** Baixa só a primeira letra ("Consulte…" vira "consulte…"); o resto, siglas e xMotivo, não muda. */
const minuscula = (t: string): string => (t === '' ? t : t.charAt(0).toLowerCase() + t.slice(1));

const rotuloDaLinha = (id: IdLista) => (l: Linha): string => (ROTULO_LINHA[id] as (x: unknown) => string)(l);

// ---- Pedidos a faturar: ação "Emitir nota" por linha (nota total; a parcial pede os itens do pedido e fica para o detalhe) ----

function acaoEmitir(l: Linha, perfil: Perfil): AcaoVista | null {
  const p = l as unknown as PedidoAFaturarResumo & { ambiente?: unknown }; // `ambiente` entra no resumo pelo modulo-faturamento; opcional até lá
  if (!acoesDoPedidoAFaturar(perfil, p.status).emitir) return null;
  const numero = p.numero === null || p.numero === undefined ? '' : ` ${p.numero}`;
  return {
    id: 'emitir', rotulo: 'Emitir nota', metodo: 'POST', caminho: NOTAS, entrada: 'confirmar', principal: true,
    tituloDialogo: `Emitir a nota do pedido${numero}?`, aviso: 'A nota leva todo o saldo do pedido e segue para a SEFAZ. Confira o cliente e o total antes de emitir.',
    rotuloConfirmar: 'Emitir nota', textoCarregando: 'Emitindo…', ambiente: ambienteDaFilial(p.ambiente), dados: { pedido_id: p.pedido_id },
  };
}

const desmontar = (m: Montagem): ResultadoAcao => (m.ok ? { ok: true, ...(m.requisicao.corpo !== undefined ? { corpo: m.requisicao.corpo } : {}) } : { ok: false, erro: m.erro });

function validarEmitir(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  if (a.id !== 'emitir') return { ok: true };
  return desmontar(requisicaoEmitir({ pedido_id: a.dados?.pedido_id ?? '', chave: e.chave ?? CHAVE_DE_VALIDACAO }));
}

const novaChave = (): string => globalThis.crypto.randomUUID();

// ---- Inutilizar números: ação da barra da lista de notas (filial, número inicial e final, justificativa) ----

const ESCRITAS_INUTILIZAR = [POST(INUTILIZACOES)];
const numeroDe = (t: string | undefined): number => (t !== undefined && /^\d+$/.test(t.trim()) ? Number(t.trim()) : Number.NaN);

function acaoInutilizar(perfil: Perfil): AcaoVista | null {
  if (!pode(perfil, 'faturamento.nota.emitir')) return null;
  const d = dialogoInutilizar({ numero_inicial: 1, numero_final: 1 });
  return {
    id: 'inutilizar', rotulo: 'Inutilizar números', metodo: 'POST', caminho: INUTILIZACOES, entrada: 'faixa', tituloDialogo: 'Inutilizar números',
    rotuloTexto: d.rotuloTexto, rotuloConfirmar: d.rotuloConfirmar, rotuloFechar: d.rotuloFechar, destrutivo: d.destrutivo, ...(d.aviso ? { aviso: d.aviso } : {}),
    ambiente: ambienteDaFilial(undefined), limitesTexto: { min: d.minimo, max: d.maximo }, // o shell não recebe o ambiente da filial (cadastro só traz nome)
  };
}

function validarInutilizar(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  if (a.id !== 'inutilizar') return { ok: true };
  const inicial = numeroDe(e.inicial);
  const final = numeroDe(e.final);
  if (!e.filial) return { ok: false, erro: 'Escolha a filial.' };
  if (!Number.isInteger(inicial) || !Number.isInteger(final) || inicial < 1 || final < 1) return { ok: false, erro: 'Informe o número inicial e o final, só com dígitos.' };
  return desmontar(requisicaoInutilizar({ filial_id: e.filial, numero_inicial: inicial, numero_final: final, justificativa: e.texto.trim() }, e.chave ?? CHAVE_DE_VALIDACAO));
}

const ACAO_INUTILIZAR = { acao: acaoInutilizar, validarAcao: validarInutilizar, escritas: ESCRITAS_INUTILIZAR, novaChave };

export const LISTA_PEDIDOS_A_FATURAR: TelaLista = lista(
  'pedidos-a-faturar',
  paginaDe('pedidos-a-faturar', PedidoAFaturarResumo, FiltroPedidosAFaturar.omit(SEM_CURSOR).shape, 'pedidos-a-faturar.csv'),
  [
    { chave: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: (['a_faturar', 'faturado_parcial', 'faturado', 'cancelado'] as const).map((s) => ({ valor: s, rotulo: rotuloDeStatusPedido(s) })) },
    FILIAL, DE, ATE,
  ],
  { acaoDaLinha: { acao: acaoEmitir, validarAcao: validarEmitir, escritas: [POST(NOTAS)], novaChave } },
);

export const LISTA_NOTAS: TelaLista = lista(
  'notas',
  paginaDe('notas', NotaResumo, FiltroNotas.omit(SEM_CURSOR).shape, 'notas-fiscais.csv'),
  [
    { chave: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: StatusNota.options.map((s) => ({ valor: s, rotulo: rotuloDeStatusNota(s) })) },
    AMBIENTE, FILIAL, { chave: 'serie', rotulo: 'Série', tipo: 'texto' }, { chave: 'numero', rotulo: 'Número', tipo: 'texto' }, DE, ATE,
  ],
  { rotaDaLinha: (l) => `${ROTA_NOTAS}/${String(l.id)}`, rotuloDaLinha: rotuloDaLinha('notas'), acaoDaBarra: ACAO_INUTILIZAR },
);

export const LISTA_REJEICOES: TelaLista = lista('rejeicoes', paginaDe('rejeicoes', RejeicaoNota, FiltroRejeicoes.omit(SEM_CURSOR).shape, 'rejeicoes.csv'), [FILIAL], { rotaDaLinha: (l) => `${ROTA_NOTAS}/${String(l.id)}`, rotuloDaLinha: rotuloDaLinha('rejeicoes') });

export const LISTA_TITULOS: TelaLista = lista(
  'titulos',
  paginaDe('titulos', TituloResumo, FiltroTitulos.omit(SEM_CURSOR).shape, 'titulos-a-receber.csv'),
  [
    { chave: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: (['aberto', 'baixado', 'cancelado'] as const).map((s) => ({ valor: s, rotulo: rotuloDeStatusTitulo(s) })) },
    AMBIENTE, { chave: 'vencimento_de', rotulo: 'Vencimento de', tipo: 'data' }, { chave: 'vencimento_ate', rotulo: 'Vencimento até', tipo: 'data' },
  ],
  { rotaDaLinha: (l) => `${ROTA_TITULOS}/${String(l.id)}`, rotuloDaLinha: rotuloDaLinha('titulos') },
);

// ---- Detalhe da nota ----

const ESCRITAS_NOTA = ['reenviar', 'consultar', 'cancelar', 'carta-correcao'].map((verbo) => POST(NOTA_VERBO(verbo)));

const RespostaEventos = z.object({ itens: z.array(EventoNotaResumo) });
/** Eventos já lidos (`DETALHE_NOTA.lerEventos`): o parse acontece uma vez, na tela; aqui só se monta o texto. */
export type EventosLidos = z.infer<typeof RespostaEventos>;
const semPonto = (t: string): string => t.trim().replace(/\.+$/, '');
const dataHora = (iso: string | null | undefined, fuso: string): string => (iso ? formatarDataHora(iso, fuso) : '');

/** Corpo e caminho da requisição do módulo (a chave só valida; o envio usa a Idempotency-Key real). */
const caminhoDe = (m: Montagem): string => (m.ok ? m.requisicao.caminho : '');

/** Chave de acesso em grupos de 4 dígitos (44 dígitos = 11 grupos), para ler e conferir; sem chave, vazio. */
export const chaveEmGrupos = (chave: string | null | undefined): string => (chave ?? '').replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');

const ROTULO_EVENTO = { cancelamento: 'Cancelamento', cce: 'Carta de correção' } as const;
const ROTULO_STATUS_EVENTO = { pendente: 'aguardando a SEFAZ', registrado: 'registrado', rejeitado: 'rejeitado pela SEFAZ' } as const;

/** Histórico da nota (`GET /notas/:id/eventos`): do mais antigo ao mais novo, horários no fuso do tenant. O texto livre do evento (justificativa) não é repetido aqui. */
export function historicoDaNota({ itens }: EventosLidos, fuso: string): EventoVista[] {
  return [...itens]
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
    .map((e) => {
      const nome = e.tipo === 'cce' ? `${ROTULO_EVENTO.cce} nº ${e.n_seq_evento}` : ROTULO_EVENTO.cancelamento;
      const detalhe = e.status === 'rejeitado' ? [e.c_stat === null ? '' : String(e.c_stat), semPonto(e.x_motivo ?? '')].filter(Boolean).join(': ') : e.protocolo ? `protocolo ${e.protocolo}` : '';
      return { quando: dataHora(e.registrado_em ?? e.criado_em, fuso), texto: `${nome} · ${ROTULO_STATUS_EVENTO[e.status]}${detalhe ? ` · ${detalhe}` : ''}` };
    });
}

export function vistaDaNota(n: NotaDetalhe, perfil: Perfil, fuso: string, agora: Date = new Date(), eventos?: EventosLidos): DetalheVista {
  const sigla = numeroSerie(n) || 'sem número';
  const [seloStatus] = badgesDaNota(n).slice(-1);
  const emite = pode(perfil, 'faturamento.nota.emitir');
  const para = { status: n.status, ambiente: n.ambiente, autorizada_em: n.autorizada_em ?? null };
  const motivos = motivosDasAcoes(perfil, para, agora);
  const livre = (a: AcaoDaNota): boolean => !motivos[a];
  const principal = acaoPrincipalDaNota(n.status);
  const caminho = (verbo: string) => preencher(NOTA_VERBO(verbo), { id: n.id });
  const dados = { nota_id: n.id };

  // A ordem é a do módulo (ACOES_DA_NOTA): downloads primeiro, Cancelar por último. Quem não pode agir (leitura, gerente) não vê nada.
  const acoes: AcaoVista[] = [];
  const downloads: DownloadVista[] = [];
  for (const id of emite ? ACOES_DA_NOTA : []) {
    const r = ROTULO_ACAO_NOTA[id];
    const ehPrincipal = id === principal;
    if (id === 'baixarDanfe' || id === 'baixarXml') {
      downloads.push({ rotulo: r.rotulo, href: id === 'baixarXml' ? urlDoXml(n.id) : urlDoDanfe(n.id), ...(ehPrincipal ? { principal: true } : {}), ...(livre(id) ? {} : { desabilitado: motivos[id] ?? 'Indisponível' }) });
      continue;
    }
    if (!livre(id)) {
      // Cancelar fora do prazo fica visível e desabilitado, com o motivo do módulo (RN-FAT-02); as demais só aparecem quando valem.
      if (id === 'cancelar' && n.status === 'autorizada') acoes.push({ id, rotulo: r.rotulo, metodo: 'POST', caminho: caminho('cancelar'), entrada: 'justificativa', destrutivo: true, desabilitada: motivos.cancelar ?? 'Indisponível', dados });
      continue;
    }
    if (id === 'reenviar') {
      const c = confirmacaoReenviar(n);
      acoes.push({ id, rotulo: c.rotuloConfirmar, metodo: 'POST', caminho: caminhoDe(requisicaoReenviar(n.id, CHAVE_DE_VALIDACAO)), entrada: 'confirmar', ...(ehPrincipal ? { principal: true } : {}), tituloDialogo: c.titulo, aviso: c.aviso, ambiente: { texto: c.ambiente, tom: c.tomAmbiente }, rotuloConfirmar: c.rotuloConfirmar, textoCarregando: c.textoCarregando, dados });
    } else if (id === 'consultar') {
      acoes.push({ id, rotulo: r.rotulo, metodo: 'POST', caminho: caminhoDe(requisicaoConsultar(n.id, CHAVE_DE_VALIDACAO)), entrada: 'nenhum', dados });
    } else {
      const d = id === 'cancelar' ? dialogoCancelar(n) : dialogoCartaCorrecao(n);
      // Sem vermelho na v1: o botão de confirmar é o principal e o texto diz a ação ("Cancelar a nota 12/1"). "Manter a nota" (rotuloFechar) é do módulo.
      acoes.push({
        id, rotulo: r.rotulo, metodo: 'POST', caminho: caminho(id === 'cancelar' ? 'cancelar' : 'carta-correcao'), entrada: 'justificativa', justificativaObrigatoria: true, tituloDialogo: d.titulo, rotuloTexto: d.rotuloTexto,
        rotuloConfirmar: id === 'cancelar' ? `Cancelar a nota ${sigla}` : d.rotuloConfirmar, rotuloFechar: d.rotuloFechar, destrutivo: d.destrutivo, ...(d.aviso ? { aviso: d.aviso } : {}), limitesTexto: { min: d.minimo, max: d.maximo }, dados,
      });
    }
  }

  const pendencias: DetalheVista['pendencias'][number][] = [];
  if (n.status === 'rejeitada') {
    const codigo = n.c_stat === null ? '' : `${n.c_stat}: `;
    pendencias.push({ texto: `Rejeitada pela SEFAZ. ${codigo}${semPonto(n.x_motivo ?? 'sem mensagem')}. O que fazer: ${minuscula(semPonto(n.acao_sugerida ?? 'confira os dados e reenvie'))}.`, bloqueante: true, codigoRn: 'RN-FAT-07' });
  }
  if (n.status === 'autorizada_guarda_pendente') pendencias.push({ texto: 'Autorizada pela SEFAZ. O XML ainda está sendo guardado; nada mais anda até guardar.', bloqueante: true, codigoRn: 'RN-FAT-03' });

  return {
    titulo: `Nota ${sigla}`,
    ...(seloStatus ? { selo: selo(seloStatus) } : {}),
    ...(faixaDaNota(n) ? { faixa: faixaDaNota(n) as string } : {}),
    cabecalho: [
      { rotulo: 'Filial', valor: n.filial_nome ?? '' }, { rotulo: 'Pedido', valor: n.pedido_numero === null || n.pedido_numero === undefined ? '' : String(n.pedido_numero) },
      { rotulo: 'Cliente', valor: n.cliente_razao_social ?? '' }, { rotulo: 'Ambiente', valor: textoDoAmbiente(n.ambiente) }, { rotulo: 'Natureza da operação', valor: n.natureza_operacao },
      { rotulo: 'Total', valor: formatarCentavos(n.total_centavos) }, { rotulo: 'Emitida em', valor: dataHora(n.emitida_em, fuso) }, { rotulo: 'Autorizada em', valor: dataHora(n.autorizada_em, fuso) },
      { rotulo: 'Chave de acesso', valor: chaveEmGrupos(n.chave_acesso), linhaInteira: true, numerico: true }, { rotulo: 'Protocolo', valor: n.protocolo ?? '' },
    ],
    pendencias,
    acoes,
    downloads,
    ...(eventos === undefined ? {} : { historico: historicoDaNota(eventos, fuso) }),
    tabelas: [{
      titulo: 'Itens',
      colunas: [{ id: 'sequencia', rotulo: '#', numerica: true, largura: '3rem' }, { id: 'quantidade', rotulo: 'Quantidade', numerica: true }, { id: 'valor', rotulo: 'Valor', numerica: true }],
      linhas: n.itens.map((i) => ({ sequencia: String(i.sequencia), quantidade: formatarQuantidade(i.quantidade), valor: formatarCentavos(i.valor_centavos) })),
    }],
  };
}

/** Validação do diálogo e corpo do envio: tudo pelas requisições do módulo (a API revalida). */
export function validarAcaoDaNota(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  const id = a.dados?.nota_id ?? '';
  const chave = e.chave ?? CHAVE_DE_VALIDACAO;
  if (a.id === 'cancelar') return desmontar(requisicaoCancelar(id, e.texto, chave));
  if (a.id === 'cartaCorrecao') return desmontar(requisicaoCartaCorrecao(id, e.texto, chave));
  return { ok: true };
}

export const DETALHE_NOTA: TelaDetalhe = {
  tipo: 'detalhe',
  api: (id) => `${NOTAS}/${encodeURIComponent(id)}`,
  ler: (corpo) => NotaDetalhe.parse(corpo),
  montar: (dados, perfil, fuso, _motivos, eventos) => vistaDaNota(dados as NotaDetalhe, perfil, fuso, new Date(), eventos as EventosLidos | undefined),
  eventosApi: (id) => `${NOTAS}/${encodeURIComponent(id)}/eventos`,
  lerEventos: (corpo) => RespostaEventos.parse(corpo),
  voltar: ROTA_NOTAS,
  validarAcao: validarAcaoDaNota,
  escritas: ESCRITAS_NOTA,
  novaChave,
};

// ---- Detalhe do título: baixa e estorno ----

const ESCRITAS_TITULO = [POST(BAIXAS), POST(ESTORNO)];

export function vistaDoTitulo(t: TituloDetalhe, perfil: Perfil, fuso: string, agora: Date = new Date()): DetalheVista {
  const hoje = hojeCivil(agora);
  const sit = situacaoDoTitulo(t, hoje);
  const a = acoesDoTitulo(perfil, t);
  const acoes: AcaoVista[] = [];
  if (a.baixar) {
    acoes.push({
      id: 'baixar', rotulo: 'Baixar título', metodo: 'POST', caminho: preencher(BAIXAS, { id: t.id }), entrada: 'baixa', principal: true,
      tituloDialogo: `Baixar o título da nota ${t.numero}, parcela ${t.parcela}/${t.total_parcelas}`, rotuloConfirmar: 'Baixar título', textoCarregando: 'Baixando…',
      baixa: { saldo: formatarCentavos(t.saldo_centavos), valorInicial: formatarCentavos(t.saldo_centavos).replace('R$ ', ''), hoje },
      dados: { titulo_id: t.id, saldo_centavos: String(t.saldo_centavos), hoje },
    });
  }
  if (a.estornar) {
    for (const b of t.baixas.filter((x) => x.estornada_em === null)) {
      const d = dialogoEstornar({ valor_centavos: b.valor_centavos, baixado_em: b.baixado_em }, fuso);
      acoes.push({
        id: `estornar-${b.id}`, rotulo: `Estornar baixa de ${formatarCentavos(b.valor_centavos)}`, metodo: 'POST', caminho: preencher(ESTORNO, { id: t.id, baixa_id: b.id }), entrada: 'confirmar',
        tituloDialogo: d.titulo, aviso: d.aviso, rotuloConfirmar: d.rotuloConfirmar, textoCarregando: d.textoCarregando, dados: { titulo_id: t.id, baixa_id: b.id },
      });
    }
  }
  return {
    titulo: `Título da nota ${t.numero}, parcela ${t.parcela}/${t.total_parcelas}`,
    selo: selo(sit),
    ...(faixaDoTitulo(t) ? { faixa: faixaDoTitulo(t) as string } : {}),
    cabecalho: [
      { rotulo: 'Cliente', valor: t.cliente_razao_social ?? '' }, { rotulo: 'Nota', valor: String(t.numero) }, { rotulo: 'Ambiente', valor: textoDoAmbiente(t.ambiente) },
      { rotulo: 'Vencimento', valor: textoDoVencimento(t.vencimento) },
      { rotulo: 'Valor', valor: formatarCentavos(t.valor_centavos) }, { rotulo: 'Saldo', valor: formatarCentavos(t.saldo_centavos) },
    ],
    pendencias: [],
    acoes,
    tabelas: [{
      titulo: 'Baixas',
      colunas: [{ id: 'quando', rotulo: 'Baixada em' }, { id: 'valor', rotulo: 'Valor', numerica: true }, { id: 'forma', rotulo: 'Forma' }, { id: 'situacao', rotulo: 'Situação' }],
      linhas: t.baixas.map((b) => ({ quando: dataHora(b.baixado_em, fuso), valor: formatarCentavos(b.valor_centavos), forma: rotuloDaForma(b.forma), situacao: b.estornada_em ? `Estornada em ${dataHora(b.estornada_em, fuso)}` : 'Vigente' })),
    }],
  };
}

export function validarAcaoDoTitulo(a: AcaoVista, e: EntradaAcao): ResultadoAcao {
  const chave = e.chave ?? CHAVE_DE_VALIDACAO;
  if (a.id === 'baixar') {
    const r = formularioBaixa({ valor: e.valor ?? '', data: e.data ?? '', saldo_centavos: Number(a.dados?.saldo_centavos ?? 0), hoje: a.dados?.hoje ?? '' });
    if (!r.ok) return { ok: false, erro: r.erro };
    return desmontar(requisicaoBaixa(a.dados?.titulo_id ?? '', r, chave));
  }
  if (a.id.startsWith('estornar-')) return desmontar(requisicaoEstornar(a.dados?.titulo_id ?? '', a.dados?.baixa_id ?? '', chave));
  return { ok: true };
}

export const DETALHE_TITULO: TelaDetalhe = {
  tipo: 'detalhe',
  api: (id) => `${TITULOS}/${encodeURIComponent(id)}`,
  ler: (corpo) => TituloDetalhe.parse(corpo),
  montar: (dados, perfil, fuso) => vistaDoTitulo(dados as TituloDetalhe, perfil, fuso),
  voltar: ROTA_TITULOS,
  validarAcao: validarAcaoDoTitulo,
  escritas: ESCRITAS_TITULO,
  novaChave,
};

export const TELAS_FATURAMENTO: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_PEDIDOS]: LISTA_PEDIDOS_A_FATURAR, [ROTA_NOTAS]: LISTA_NOTAS, [ROTA_NOTA]: DETALHE_NOTA, [ROTA_REJEICOES]: LISTA_REJEICOES, [ROTA_TITULOS]: LISTA_TITULOS, [ROTA_TITULO]: DETALHE_TITULO,
};
