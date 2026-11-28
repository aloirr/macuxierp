/**
 * Regras de tela da nota (RF-FAT-01, RF-FAT-08, RN-FAT-02, RN-FAT-04, RN-FAT-07): selos de status, ações por perfil e status, e os
 * pedidos que o shell manda à API. Só esconde botão e monta requisição: a API revalida tudo (403, 404 ou 422; RN-CORE-02).
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { interpretarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { plural } from '@macuxierp/platform-sdk/texto';
import { CancelarNotaEntrada, CartaCorrecaoEntrada, EmitirNotaEntrada, InutilizarEntrada, LIMITES_TEXTO, type Ambiente, type StatusNota, type StatusPedidoAFaturar } from '../contracts';
import { prazoDeCancelamentoEsgotado } from '../domain/cancelamento';
import { STATUS_FILA_EMITE } from '../domain/fila';

export const BASE_API = '/v1/faturamento';
/** RN-FAT-04: nota de homologação não tem valor fiscal e a tela diz isso em todo lugar onde a nota aparece (uma só fonte do texto). */
const SEM_VALOR_FISCAL = 'sem valor fiscal';
const TEXTO_HOMOLOGACAO = `Homologação — ${SEM_VALOR_FISCAL}`;
/** "Não dá para desfazer" dos diálogos de cancelar e inutilizar. */
const NAO_DESFAZ = 'Não dá para desfazer';
/** A rota `GET /notas/:id/danfe` (RF-FAT-03, #219) está no ar: o DANFE é a ação principal da nota autorizada e fica ativo também na cancelada. */
export const DANFE_DISPONIVEL = true;

export type Tom = 'ok' | 'alerta' | 'erro' | 'neutro';
export interface Selo {
  texto: string;
  tom: Tom;
  /** Dica curta (tooltip) para o status que pede explicação. */
  dica?: string;
}

export const ROTULO_STATUS_NOTA: Readonly<Record<StatusNota, Selo>> = {
  rascunho: { texto: 'Rascunho', tom: 'neutro' },
  em_autorizacao: { texto: 'Em autorização', tom: 'alerta', dica: 'Aguardando a SEFAZ' },
  autorizada_guarda_pendente: { texto: 'Autorizada, salvando o arquivo', tom: 'alerta', dica: 'Autorizada. Salvando o arquivo da nota' },
  autorizada: { texto: 'Autorizada', tom: 'ok' },
  rejeitada: { texto: 'Rejeitada', tom: 'erro' },
  denegada: { texto: 'Denegada', tom: 'erro', dica: 'A SEFAZ recusou em definitivo. Fale com o fiscal' },
  cancelada: { texto: 'Cancelada', tom: 'neutro' },
  emitida_contingencia: { texto: 'Emitida em contingência', tom: 'alerta', dica: 'Emitida sem a SEFAZ no ar. Será enviada depois' },
  inutilizada: { texto: 'Inutilizada', tom: 'neutro' },
};

export const ROTULO_STATUS_PEDIDO: Readonly<Record<StatusPedidoAFaturar, string>> = { a_faturar: 'A faturar', faturado_parcial: 'Faturado em parte', faturado: 'Faturado', cancelado: 'Cancelado' };

/** Selo do status do pedido na fila: o texto é o de `ROTULO_STATUS_PEDIDO`; só o faturado ganha o tom `ok` e o faturado em parte pede atenção. */
const TOM_STATUS_PEDIDO: Readonly<Record<StatusPedidoAFaturar, Tom>> = { a_faturar: 'neutro', faturado_parcial: 'alerta', faturado: 'ok', cancelado: 'neutro' };
export const seloDoPedido = (status: StatusPedidoAFaturar): Selo => ({ texto: ROTULO_STATUS_PEDIDO[status], tom: TOM_STATUS_PEDIDO[status] });

/** Texto curto do ambiente no CSV; na tela o ambiente é o selo (`badgesDaNota`) e a faixa do detalhe. */
export const textoDoAmbiente = (a: Ambiente): string => (a === 'homologacao' ? 'Homologação' : 'Produção');
/** Linha "Ambiente: ..." das confirmações fiscais (emitir e reenviar); em produção o tom é de alerta (a nota vale). */
export const ambienteDaConfirmacao = (a: Ambiente): { texto: string; tom: Tom } =>
  a === 'homologacao' ? { texto: `Ambiente: Homologação, ${SEM_VALOR_FISCAL}`, tom: 'neutro' } : { texto: 'Ambiente: Produção, com valor fiscal', tom: 'alerta' };

/** Faixa fixa no topo do detalhe da nota de homologação (sem cor nova: o shell usa o tom `alerta` do `aviso`). */
const FAIXA_HOMOLOGACAO = `NOTA DE HOMOLOGAÇÃO — ${SEM_VALOR_FISCAL.toUpperCase()}`;
/** Faixa do detalhe do título de nota de homologação (o mesmo aviso, com "título"). */
export const FAIXA_TITULO_HOMOLOGACAO = `TÍTULO DE NOTA DE HOMOLOGAÇÃO — ${SEM_VALOR_FISCAL.toUpperCase()}`;
export const faixaDaNota = (n: { ambiente: Ambiente }): string | null => (n.ambiente === 'homologacao' ? FAIXA_HOMOLOGACAO : null);

/** "123/1"; sem número (rascunho) devolve "" (a coluna e o CSV ficam vazios). */
export const numeroSerie = (n: { numero: number | null; serie: number }): string => (n.numero === null ? '' : `${n.numero}/${n.serie}`);

/** Selo do ambiente: só a homologação tem (tpAmb 2); produção não leva selo. */
export const seloDoAmbiente = (ambiente: Ambiente): Selo | null => (ambiente === 'homologacao' ? { texto: TEXTO_HOMOLOGACAO, tom: 'alerta' } : null);

/** Selos da nota: o de homologação vem primeiro, depois o status. */
export function badgesDaNota(n: { status: StatusNota; ambiente: Ambiente }): Selo[] {
  const ambiente = seloDoAmbiente(n.ambiente);
  return ambiente ? [ambiente, ROTULO_STATUS_NOTA[n.status]] : [ROTULO_STATUS_NOTA[n.status]];
}

export interface NotaParaAcao {
  status: StatusNota;
  ambiente: Ambiente;
  /** UTC ISO da autorização: base do prazo de cancelamento (RN-FAT-02). */
  autorizada_em?: string | null;
  /** Há cancelamento aguardando a SEFAZ (`cancelamento_pendente` do detalhe): bloqueia novo cancelamento e a CC-e. */
  cancelamento_pendente?: boolean | null;
}

/** Na ordem da barra de ações: Cancelar por último. */
export const ACOES_DA_NOTA = ['baixarDanfe', 'baixarXml', 'reenviar', 'consultar', 'cartaCorrecao', 'cancelar'] as const;
export type AcaoDaNota = (typeof ACOES_DA_NOTA)[number];

export const ROTULO_ACAO_NOTA: Readonly<Record<AcaoDaNota, { rotulo: string; destrutiva: boolean }>> = {
  baixarDanfe: { rotulo: 'Baixar DANFE', destrutiva: false },
  baixarXml: { rotulo: 'Baixar XML', destrutiva: false },
  reenviar: { rotulo: 'Reenviar', destrutiva: false },
  consultar: { rotulo: 'Consultar na SEFAZ', destrutiva: false },
  cartaCorrecao: { rotulo: 'Carta de correção (CC-e)', destrutiva: false },
  cancelar: { rotulo: 'Cancelar nota', destrutiva: true },
};

/** Uma ação principal por status: Reenviar (ou Emitir) na rejeitada/rascunho; na autorizada, o DANFE. */
export function acaoPrincipalDaNota(status: StatusNota): AcaoDaNota | null {
  if (status === 'rejeitada' || status === 'rascunho') return 'reenviar';
  if (status === 'autorizada') return DANFE_DISPONIVEL ? 'baixarDanfe' : 'baixarXml';
  return null;
}

const COM_XML: readonly StatusNota[] = ['autorizada', 'cancelada'];
const CONSULTAVEIS: readonly StatusNota[] = ['em_autorizacao', 'autorizada_guarda_pendente', 'autorizada', 'rejeitada', 'emitida_contingencia'];
const CANCELAMENTO_PENDENTE = 'cancelamento aguardando a SEFAZ.';
const SEM_PERMISSAO = 'sem permissão para esta ação';

/**
 * Por que a ação não está disponível (texto para o shell mostrar ao lado do botão desabilitado), ou `null` se está. Todas pedem
 * `faturamento.nota.emitir` (a leitura só vê; o XML tem dado do destinatário). O cancelamento some depois de 24 h (RN-FAT-02); nota
 * autorizada nunca é reenviada nem editada, só recebe evento (RN-FAT-07).
 */
function motivoIndisponivel(perfil: Perfil, n: NotaParaAcao, agora: Date, acao: AcaoDaNota): string | null {
  if (!pode(perfil, 'faturamento.nota.emitir')) return SEM_PERMISSAO;
  switch (acao) {
    case 'baixarXml':
      return COM_XML.includes(n.status) ? null : 'disponível só para nota autorizada ou cancelada.';
    case 'baixarDanfe':
      if (!COM_XML.includes(n.status)) return 'disponível só para nota autorizada ou cancelada.';
      return DANFE_DISPONIVEL ? null : 'DANFE em breve; por enquanto, baixe o XML.';
    case 'reenviar':
      return n.status === 'rejeitada' || n.status === 'rascunho' ? null : 'disponível só para nota rejeitada ou em rascunho.';
    case 'cancelar':
      if (n.status !== 'autorizada') return 'disponível só para nota autorizada.';
      if (n.cancelamento_pendente) return CANCELAMENTO_PENDENTE;
      return n.autorizada_em && !prazoDeCancelamentoEsgotado(new Date(n.autorizada_em), agora) ? null : 'prazo de cancelamento encerrado.';
    case 'cartaCorrecao':
      if (n.status !== 'autorizada') return 'disponível só para nota autorizada.';
      return n.cancelamento_pendente ? CANCELAMENTO_PENDENTE : null;
    case 'consultar':
      return CONSULTAVEIS.includes(n.status) ? null : 'não há o que consultar neste status.';
  }
}

/** Motivos das ações indisponíveis, por ação (só as que não estão liberadas): o shell mostra no botão desabilitado. */
export function motivosDasAcoes(perfil: Perfil, n: NotaParaAcao, agora: Date): Partial<Record<AcaoDaNota, string>> {
  const m: Partial<Record<AcaoDaNota, string>> = {};
  for (const a of ACOES_DA_NOTA) {
    const x = motivoIndisponivel(perfil, n, agora, a);
    if (x) m[a] = x;
  }
  return m;
}

/** Rascunho ainda não foi enviado à SEFAZ: o botão é "Emitir"; a rejeitada é "Reenviar". */
export const rotuloReenviar = (status: StatusNota): string => (status === 'rascunho' ? 'Emitir' : 'Reenviar');

// ---- Diálogos: props prontas para o `DialogoMotivo` do packages/ui (textoObrigatorio, validar) ----

const PRAZO_CANCELAMENTO_AVISO = `${NAO_DESFAZ}. O cancelamento só é aceito até 24 h depois da autorização.`;

/** Contador do campo de justificativa: "falta 1 caractere"/"faltam N caracteres", "N/máx" ou "1 caractere a mais"/"N caracteres a mais". */
export function contadorDeCaracteres(texto: string, min: number, max: number): string {
  const n = texto.trim().length;
  if (n < min) return `${min - n === 1 ? 'falta' : 'faltam'} ${plural(min - n, 'caractere', 'caracteres')}`;
  if (n > max) return `${plural(n - max, 'caractere', 'caracteres')} a mais`;
  return `${n}/${max}`;
}

export interface DialogoDeTexto {
  titulo: string;
  aviso: string | null;
  textoObrigatorio: true;
  rotuloTexto: string;
  rotuloConfirmar: string;
  /** Botão que fecha sem agir. */
  rotuloFechar: string;
  /** Confirmação em estilo destrutivo. */
  destrutivo: boolean;
  minimo: number;
  maximo: number;
  /** Para o `validar` do DialogoMotivo (recebe `{ texto }`). */
  validar: (r: { texto: string }) => string | null;
  /** Texto do contador para o que o usuário digitou até agora. */
  contador: (texto: string) => string;
}

export function dialogoDeTexto(d: { titulo: string; aviso: string | null; rotuloTexto: string; rotuloConfirmar: string; rotuloFechar: string; destrutivo: boolean; minimo: number; maximo: number; mensagem: string }): DialogoDeTexto {
  const { mensagem, ...resto } = d;
  return {
    ...resto,
    textoObrigatorio: true,
    validar: (r) => {
      const n = r.texto.trim().length;
      return n < d.minimo || n > d.maximo ? mensagem : null;
    },
    contador: (t) => contadorDeCaracteres(t, d.minimo, d.maximo),
  };
}

export const dialogoCancelar = (n: { numero: number | null; serie: number }): DialogoDeTexto =>
  dialogoDeTexto({
    titulo: `Cancelar a nota ${numeroSerie(n) || 'sem número'}?`, aviso: PRAZO_CANCELAMENTO_AVISO, rotuloTexto: 'Justificativa', rotuloConfirmar: 'Cancelar nota', rotuloFechar: 'Manter a nota', destrutivo: true,
    minimo: LIMITES_TEXTO.justificativa.min, maximo: LIMITES_TEXTO.justificativa.max, mensagem: mensagemDeTamanho(ASSUNTO.cancelar, LIMITES_TEXTO.justificativa),
  });

export const dialogoCartaCorrecao = (n: { numero: number | null; serie: number }): DialogoDeTexto =>
  dialogoDeTexto({
    titulo: `Carta de correção da nota ${numeroSerie(n) || 'sem número'}`, aviso: null, rotuloTexto: 'Texto da correção', rotuloConfirmar: 'Enviar correção', rotuloFechar: 'Voltar', destrutivo: false,
    minimo: LIMITES_TEXTO.cartaCorrecao.min, maximo: LIMITES_TEXTO.cartaCorrecao.max, mensagem: mensagemDeTamanho(ASSUNTO.carta, LIMITES_TEXTO.cartaCorrecao),
  });

export const dialogoInutilizar = (faixa: { numero_inicial: number; numero_final: number }): DialogoDeTexto =>
  dialogoDeTexto({
    titulo: faixa.numero_inicial === faixa.numero_final ? `Inutilizar o número ${faixa.numero_inicial}?` : `Inutilizar os números ${faixa.numero_inicial} a ${faixa.numero_final}?`,
    aviso: `Use quando um número foi pulado e a nota nunca será emitida. ${NAO_DESFAZ}: esses números não poderão mais ser usados.`, rotuloTexto: 'Justificativa',
    rotuloConfirmar: 'Inutilizar números', rotuloFechar: 'Voltar', destrutivo: true, minimo: LIMITES_TEXTO.justificativa.min, maximo: LIMITES_TEXTO.justificativa.max, mensagem: mensagemDeTamanho(ASSUNTO.inutilizar, LIMITES_TEXTO.justificativa),
  });

/** Confirmação do "Reenviar"/"Emitir": mostra o ambiente (a nota de produção vale) e o botão fica em carregamento até a API responder (202). */
export function confirmacaoReenviar(n: { numero: number | null; serie: number; status: StatusNota; ambiente: Ambiente }): {
  titulo: string; aviso: string; ambiente: string; tomAmbiente: Tom; rotuloConfirmar: string; textoCarregando: string;
} {
  const emitir = n.status === 'rascunho';
  const amb = ambienteDaConfirmacao(n.ambiente);
  return {
    titulo: `${emitir ? 'Emitir' : 'Reenviar'} a nota ${numeroSerie(n) || 'sem número'} à SEFAZ?`,
    aviso: emitir ? 'A nota será enviada à SEFAZ agora. Confira os dados.' : 'Reenvia com o mesmo número. Corrija a causa da rejeição antes.',
    ambiente: amb.texto, tomAmbiente: amb.tom,
    rotuloConfirmar: rotuloReenviar(n.status),
    textoCarregando: emitir ? 'Emitindo…' : 'Reenviando…',
  };
}

/** Um só `emitir`: o diálogo escolhe nota total ou parcial. */
export interface AcoesDoPedidoAFaturar {
  emitir: boolean;
}

/** Mais estrita que `filaAceitaNota` (domain): aqui `faturado` também não emite (sem saldo); a API recusa só `cancelado` com RN-CAD-10 e o saldo fica com RN-FAT-01. */
export function acoesDoPedidoAFaturar(perfil: Perfil, status: StatusPedidoAFaturar): AcoesDoPedidoAFaturar {
  return { emitir: pode(perfil, 'faturamento.nota.emitir') && (STATUS_FILA_EMITE as readonly string[]).includes(status) };
}

// ---- Requisições: o shell executa com o fetch dele (sessão, tenant); aqui só o contrato ----

export interface Requisicao {
  metodo: 'POST' | 'PUT';
  caminho: string;
  cabecalhos?: { 'Idempotency-Key': string };
  corpo?: unknown;
}
export type Montagem = { ok: true; requisicao: Requisicao } | { ok: false; erro: string };

export const falha = (erro: string): { ok: false; erro: string } => ({ ok: false, erro });
export const comChave = (chave: string) => ({ 'Idempotency-Key': chave });
/** `null` = a Idempotency-Key é aceitável; senão a falha pronta (mesma validação em toda requisição com chave). */
export const exigirChave = (chave: string): { ok: false; erro: string } | null => (CHAVE_OK.test(chave) ? null : falha(MSG_CHAVE));
type Limite = { readonly min: number; readonly max: number };
/** "A justificativa do cancelamento deve ter de 15 a 255 caracteres." (limites do contrato). */
export const mensagemDeTamanho = (assunto: string, l: Limite): string => `${assunto} deve ter de ${l.min} a ${l.max} caracteres.`;
const ASSUNTO = { cancelar: 'A justificativa do cancelamento', carta: 'O texto da carta de correção', inutilizar: 'A justificativa da inutilização' } as const;
const CHAVE_OK = /^[A-Za-z0-9_.:-]{8,128}$/;
export const MSG_CHAVE = 'Não foi possível identificar a operação. Recarregue a página e tente de novo.';

export interface ItemParcial {
  sequencia: number;
  /** Texto digitado ("1,5", até 4 casas); omitido = todo o saldo do item. */
  quantidade?: string;
}

/** RF-FAT-01: nota total (sem `itens`) ou parcial (itens e quantidades). A `Idempotency-Key` vai no cabeçalho e no corpo (RN-CORE-05). */
export function requisicaoEmitir(e: { pedido_id: string; chave: string; itens?: readonly ItemParcial[] }): Montagem {
  const semChave = exigirChave(e.chave);
  if (semChave) return semChave;
  let itens: { sequencia: number; quantidade?: number }[] | undefined;
  if (e.itens) {
    if (e.itens.length === 0) return falha('Escolha ao menos um item para a nota parcial.');
    const vistas = new Set<number>();
    itens = [];
    for (const i of e.itens) {
      if (vistas.has(i.sequencia)) return falha(`O item ${i.sequencia} aparece mais de uma vez.`);
      vistas.add(i.sequencia);
      if (i.quantidade === undefined || i.quantidade.trim() === '') {
        itens.push({ sequencia: i.sequencia });
        continue;
      }
      const q = interpretarQuantidade(i.quantidade);
      if (q === null || q <= 0) return falha(`Informe uma quantidade válida para o item ${i.sequencia}, com até 4 casas decimais.`);
      itens.push({ sequencia: i.sequencia, quantidade: q });
    }
  }
  const corpo = { pedido_id: e.pedido_id, ...(itens ? { itens } : {}), idempotencia: e.chave };
  const v = EmitirNotaEntrada.safeParse(corpo);
  if (!v.success) return falha('Os dados da nota não são válidos. Confira o pedido e os itens.');
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/notas`, cabecalhos: comChave(e.chave), corpo: v.data } };
}

/** RN-FAT-02: justificativa dentro dos limites do contrato. */
export function requisicaoCancelar(nota_id: string, justificativa: string, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const v = CancelarNotaEntrada.safeParse({ justificativa });
  if (!v.success) return falha(mensagemDeTamanho(ASSUNTO.cancelar, LIMITES_TEXTO.justificativa));
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/notas/${nota_id}/cancelar`, cabecalhos: comChave(chave), corpo: v.data } };
}

/** RN-FAT-02: texto da carta de correção de 15 a 1000 caracteres. */
export function requisicaoCartaCorrecao(nota_id: string, texto: string, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const v = CartaCorrecaoEntrada.safeParse({ texto });
  if (!v.success) return falha(mensagemDeTamanho(ASSUNTO.carta, LIMITES_TEXTO.cartaCorrecao));
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/notas/${nota_id}/carta-correcao`, cabecalhos: comChave(chave), corpo: v.data } };
}

/** RN-FAT-01: inutilização de faixa (a API tem `POST /inutilizacoes`); justificativa dentro dos limites do contrato. */
export function requisicaoInutilizar(e: { filial_id: string; numero_inicial: number; numero_final: number; serie?: number; ano?: number; justificativa: string }, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const v = InutilizarEntrada.safeParse(e);
  if (!v.success) return falha(v.error.issues[0]?.path.includes('numero_final') ? 'O número inicial não pode ser maior que o final.' : `Confira a filial, a faixa de números e a justificativa (${LIMITES_TEXTO.justificativa.min} a ${LIMITES_TEXTO.justificativa.max} caracteres).`);
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/inutilizacoes`, cabecalhos: comChave(chave), corpo: v.data } };
}

/** POST sem corpo, com a Idempotency-Key como as demais. */
export const postSemCorpo = (caminho: string, chave: string): Montagem => exigirChave(chave) ?? { ok: true, requisicao: { metodo: 'POST', caminho, cabecalhos: comChave(chave) } };
export const requisicaoReenviar = (nota_id: string, chave: string): Montagem => postSemCorpo(`${BASE_API}/notas/${nota_id}/reenviar`, chave);
export const requisicaoConsultar = (nota_id: string, chave: string): Montagem => postSemCorpo(`${BASE_API}/notas/${nota_id}/consultar`, chave);

/** Detalhe do pedido a faturar (itens e saldo, para a nota parcial): `id` é `PedidoAFaturarResumo.id`. Resposta: `PedidoAFaturarDetalhe`. */
export const urlDoPedidoAFaturar = (id: string): string => `${BASE_API}/pedidos-a-faturar/${id}`;

/** Configuração da filial (`GET`/`PUT`; `ConfiguracaoFilialResposta`): `filialId` é o id da filial emissora. */
export const urlDaConfiguracaoDaFilial = (filialId: string): string => `${BASE_API}/filiais/${filialId}/configuracao`;

export const urlDoXml = (nota_id: string): string => `${BASE_API}/notas/${nota_id}/xml`;
/** O link fica pronto; a rota do DANFE em PDF chega no lote 3 da T-0021 (até lá a API responde 404). */
export const urlDoDanfe = (nota_id: string): string => `${BASE_API}/notas/${nota_id}/danfe`;
