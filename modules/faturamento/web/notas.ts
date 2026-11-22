/**
 * Regras de tela da nota (RF-FAT-01, RF-FAT-08, RN-FAT-02, RN-FAT-04, RN-FAT-07): selos de status, ações por perfil e status, e os
 * pedidos que o shell manda à API. Só esconde botão e monta requisição: a API revalida tudo (403, 404 ou 422; RN-CORE-02).
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { interpretarQuantidade } from '@macuxierp/platform-sdk/formatar';
import { CancelarNotaEntrada, CartaCorrecaoEntrada, EmitirNotaEntrada, InutilizarEntrada, type Ambiente, type StatusNota, type StatusPedidoAFaturar } from '../contracts';
import { prazoDeCancelamentoEsgotado } from '../domain/cancelamento';

export const BASE_API = '/v1/faturamento';
/** RN-FAT-04: nota de homologação não tem valor fiscal e a tela diz isso em todo lugar onde a nota aparece. */
export const TEXTO_HOMOLOGACAO = 'Homologação — sem valor fiscal';

export type Tom = 'ok' | 'alerta' | 'erro' | 'neutro';
export interface Selo {
  texto: string;
  tom: Tom;
}

export const ROTULO_STATUS_NOTA: Readonly<Record<StatusNota, Selo>> = {
  rascunho: { texto: 'Rascunho', tom: 'neutro' },
  em_autorizacao: { texto: 'Em autorização', tom: 'alerta' },
  autorizada_guarda_pendente: { texto: 'Autorizada (guardando o XML)', tom: 'alerta' },
  autorizada: { texto: 'Autorizada', tom: 'ok' },
  rejeitada: { texto: 'Rejeitada', tom: 'erro' },
  denegada: { texto: 'Denegada', tom: 'erro' },
  cancelada: { texto: 'Cancelada', tom: 'neutro' },
  emitida_contingencia: { texto: 'Emitida em contingência', tom: 'alerta' },
  inutilizada: { texto: 'Inutilizada', tom: 'neutro' },
};

export const ROTULO_STATUS_PEDIDO: Readonly<Record<StatusPedidoAFaturar, string>> = { a_faturar: 'A faturar', faturado_parcial: 'Faturado em parte', faturado: 'Faturado', cancelado: 'Cancelado' };

/** Texto curto da coluna "Ambiente" e do CSV; o texto longo fica só no selo (`badgesDaNota`) e na faixa do detalhe. */
export const textoDoAmbiente = (a: Ambiente): string => (a === 'homologacao' ? 'Homologação' : 'Produção');

/** Faixa fixa no topo do detalhe da nota de homologação (sem cor nova: o shell usa o tom `alerta` do `aviso`). */
export const FAIXA_HOMOLOGACAO = 'NOTA DE HOMOLOGAÇÃO — SEM VALOR FISCAL';
export const faixaDaNota = (n: { ambiente: Ambiente }): string | null => (n.ambiente === 'homologacao' ? FAIXA_HOMOLOGACAO : null);

/** "123/1"; sem número (rascunho) devolve "" (a coluna e o CSV ficam vazios). */
export const numeroSerie = (n: { numero: number | null; serie: number }): string => (n.numero === null ? '' : `${n.numero}/${n.serie}`);

/** Selos da nota: o de homologação vem primeiro (tpAmb 2), depois o status. */
export function badgesDaNota(n: { status: StatusNota; ambiente: Ambiente }): Selo[] {
  const status = ROTULO_STATUS_NOTA[n.status];
  return n.ambiente === 'homologacao' ? [{ texto: TEXTO_HOMOLOGACAO, tom: 'alerta' }, status] : [status];
}

export interface NotaParaAcao {
  status: StatusNota;
  ambiente: Ambiente;
  /** UTC ISO da autorização: base do prazo de cancelamento (RN-FAT-02). */
  autorizada_em?: string | null;
}

export interface AcoesDaNota {
  baixarXml: boolean;
  baixarDanfe: boolean;
  reenviar: boolean;
  cancelar: boolean;
  cartaCorrecao: boolean;
  consultar: boolean;
}
export type AcaoDaNota = keyof AcoesDaNota;

const COM_XML: readonly StatusNota[] = ['autorizada', 'cancelada'];
const CONSULTAVEIS: readonly StatusNota[] = ['em_autorizacao', 'autorizada_guarda_pendente', 'autorizada', 'rejeitada', 'emitida_contingencia'];
const SEM_PERMISSAO = 'Sem permissão para esta ação';

/**
 * Por que a ação não está disponível (texto para o shell mostrar ao lado do botão desabilitado), ou `null` se está. Todas pedem
 * `faturamento.nota.emitir` (a leitura só vê; o XML tem dado do destinatário). O cancelamento some depois de 24 h (RN-FAT-02); nota
 * autorizada nunca é reenviada nem editada, só recebe evento (RN-FAT-07).
 */
export function motivoIndisponivel(perfil: Perfil, n: NotaParaAcao, agora: Date, acao: AcaoDaNota): string | null {
  if (!pode(perfil, 'faturamento.nota.emitir')) return SEM_PERMISSAO;
  switch (acao) {
    case 'baixarXml':
    case 'baixarDanfe':
      return COM_XML.includes(n.status) ? null : 'Disponível só para nota autorizada ou cancelada';
    case 'reenviar':
      return n.status === 'rejeitada' || n.status === 'rascunho' ? null : 'Disponível só para nota rejeitada ou em rascunho';
    case 'cancelar':
      if (n.status !== 'autorizada') return 'Disponível só para nota autorizada';
      return n.autorizada_em && !prazoDeCancelamentoEsgotado(new Date(n.autorizada_em), agora) ? null : 'Prazo de cancelamento encerrado';
    case 'cartaCorrecao':
      return n.status === 'autorizada' ? null : 'Disponível só para nota autorizada';
    case 'consultar':
      return CONSULTAVEIS.includes(n.status) ? null : 'Não há o que consultar neste status';
  }
}

export const ACOES_DA_NOTA: readonly AcaoDaNota[] = ['baixarXml', 'baixarDanfe', 'reenviar', 'cancelar', 'cartaCorrecao', 'consultar'];

export function acoesDaNota(perfil: Perfil, n: NotaParaAcao, agora: Date): AcoesDaNota {
  const ok = (a: AcaoDaNota): boolean => motivoIndisponivel(perfil, n, agora, a) === null;
  return { baixarXml: ok('baixarXml'), baixarDanfe: ok('baixarDanfe'), reenviar: ok('reenviar'), cancelar: ok('cancelar'), cartaCorrecao: ok('cartaCorrecao'), consultar: ok('consultar') };
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

export const PRAZO_CANCELAMENTO_AVISO = 'Não dá para desfazer. Prazo: 24 h da autorização.';

/** Contador do campo de justificativa: "faltam N caracteres", "N/máx" ou "N caracteres a mais". */
export function contadorDeCaracteres(texto: string, min: number, max: number): string {
  const n = texto.trim().length;
  if (n < min) return `faltam ${min - n} caracteres`;
  if (n > max) return `${n - max} caracteres a mais`;
  return `${n}/${max}`;
}

export interface DialogoDeTexto {
  titulo: string;
  aviso: string | null;
  textoObrigatorio: true;
  rotuloTexto: string;
  rotuloConfirmar: string;
  minimo: number;
  maximo: number;
  /** Para o `validar` do DialogoMotivo (recebe `{ texto }`). */
  validar: (r: { texto: string }) => string | null;
  /** Texto do contador para o que o usuário digitou até agora. */
  contador: (texto: string) => string;
}

function dialogoDeTexto(d: { titulo: string; aviso: string | null; rotuloTexto: string; rotuloConfirmar: string; minimo: number; maximo: number; mensagem: string }): DialogoDeTexto {
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
    titulo: `Cancelar a nota ${numeroSerie(n) || 'sem número'}?`, aviso: PRAZO_CANCELAMENTO_AVISO, rotuloTexto: 'Justificativa', rotuloConfirmar: 'Cancelar a nota',
    minimo: 15, maximo: 255, mensagem: 'A justificativa do cancelamento deve ter de 15 a 255 caracteres.',
  });

export const dialogoCartaCorrecao = (n: { numero: number | null; serie: number }): DialogoDeTexto =>
  dialogoDeTexto({
    titulo: `Carta de correção da nota ${numeroSerie(n) || 'sem número'}`, aviso: null, rotuloTexto: 'Texto da correção', rotuloConfirmar: 'Enviar correção',
    minimo: 15, maximo: 1000, mensagem: 'O texto da carta de correção deve ter de 15 a 1000 caracteres.',
  });

export const dialogoInutilizar = (faixa: { numero_inicial: number; numero_final: number }): DialogoDeTexto =>
  dialogoDeTexto({
    titulo: `Inutilizar a faixa ${faixa.numero_inicial} a ${faixa.numero_final}?`, aviso: 'Não dá para desfazer. Os números deixam de poder ser usados.', rotuloTexto: 'Justificativa',
    rotuloConfirmar: 'Inutilizar a faixa', minimo: 15, maximo: 255, mensagem: 'A justificativa da inutilização deve ter de 15 a 255 caracteres.',
  });

/** Confirmação simples do "Reenviar"/"Emitir": o botão fica em carregamento até a API responder (202). */
export function confirmacaoReenviar(n: { numero: number | null; serie: number; status: StatusNota }): { titulo: string; aviso: string; rotuloConfirmar: string; textoCarregando: string } {
  const emitir = n.status === 'rascunho';
  return {
    titulo: `${emitir ? 'Emitir' : 'Reenviar'} a nota ${numeroSerie(n) || 'sem número'} à SEFAZ?`,
    aviso: 'A nota segue o mesmo número. Confira os dados antes de enviar.',
    rotuloConfirmar: rotuloReenviar(n.status),
    textoCarregando: emitir ? 'Emitindo…' : 'Reenviando…',
  };
}

/** Um só `emitir`: o diálogo escolhe nota total ou parcial. */
export interface AcoesDoPedidoAFaturar {
  emitir: boolean;
}

export function acoesDoPedidoAFaturar(perfil: Perfil, status: StatusPedidoAFaturar): AcoesDoPedidoAFaturar {
  return { emitir: pode(perfil, 'faturamento.nota.emitir') && (status === 'a_faturar' || status === 'faturado_parcial') };
}

// ---- Requisições: o shell executa com o fetch dele (sessão, tenant); aqui só o contrato ----

export interface Requisicao {
  metodo: 'POST';
  caminho: string;
  cabecalhos?: { 'Idempotency-Key': string };
  corpo?: unknown;
}
export type Montagem = { ok: true; requisicao: Requisicao } | { ok: false; erro: string };

const falha = (erro: string): { ok: false; erro: string } => ({ ok: false, erro });
export const comChave = (chave: string) => ({ 'Idempotency-Key': chave });
export const CHAVE_OK = /^[A-Za-z0-9_.:-]{8,128}$/;
const MSG_CHAVE = 'Não foi possível identificar a operação. Recarregue a página e tente de novo.';

export interface ItemParcial {
  sequencia: number;
  /** Texto digitado ("1,5", até 4 casas); omitido = todo o saldo do item. */
  quantidade?: string;
}

/** RF-FAT-01: nota total (sem `itens`) ou parcial (itens e quantidades). A `Idempotency-Key` vai no cabeçalho e no corpo (RN-CORE-05). */
export function requisicaoEmitir(e: { pedido_id: string; chave: string; itens?: readonly ItemParcial[] }): Montagem {
  if (!CHAVE_OK.test(e.chave)) return falha(MSG_CHAVE);
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

/** RN-FAT-02: justificativa de 15 a 255 caracteres. */
export function requisicaoCancelar(nota_id: string, justificativa: string, chave: string): Montagem {
  if (!CHAVE_OK.test(chave)) return falha(MSG_CHAVE);
  const v = CancelarNotaEntrada.safeParse({ justificativa });
  if (!v.success) return falha('A justificativa do cancelamento deve ter de 15 a 255 caracteres.');
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/notas/${nota_id}/cancelar`, cabecalhos: comChave(chave), corpo: v.data } };
}

/** RN-FAT-02: texto da carta de correção de 15 a 1000 caracteres. */
export function requisicaoCartaCorrecao(nota_id: string, texto: string, chave: string): Montagem {
  if (!CHAVE_OK.test(chave)) return falha(MSG_CHAVE);
  const v = CartaCorrecaoEntrada.safeParse({ texto });
  if (!v.success) return falha('O texto da carta de correção deve ter de 15 a 1000 caracteres.');
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/notas/${nota_id}/carta-correcao`, cabecalhos: comChave(chave), corpo: v.data } };
}

/** RN-FAT-01: inutilização de faixa (a API tem `POST /inutilizacoes`); justificativa de 15 a 255 caracteres. */
export function requisicaoInutilizar(e: { filial_id: string; numero_inicial: number; numero_final: number; serie?: number; ano?: number; justificativa: string }, chave: string): Montagem {
  if (!CHAVE_OK.test(chave)) return falha(MSG_CHAVE);
  const v = InutilizarEntrada.safeParse(e);
  if (!v.success) return falha(v.error.issues[0]?.path.includes('numero_final') ? 'O número inicial não pode ser maior que o final.' : 'Confira a filial, a faixa de números e a justificativa (15 a 255 caracteres).');
  return { ok: true, requisicao: { metodo: 'POST', caminho: `${BASE_API}/inutilizacoes`, cabecalhos: comChave(chave), corpo: v.data } };
}

export const requisicaoReenviar = (nota_id: string): Requisicao => ({ metodo: 'POST', caminho: `${BASE_API}/notas/${nota_id}/reenviar` });
export const requisicaoConsultar = (nota_id: string): Requisicao => ({ metodo: 'POST', caminho: `${BASE_API}/notas/${nota_id}/consultar` });

export const urlDoXml = (nota_id: string): string => `${BASE_API}/notas/${nota_id}/xml`;
/** O link fica pronto; a rota do DANFE em PDF chega no lote 3 da T-0021 (até lá a API responde 404). */
export const urlDoDanfe = (nota_id: string): string => `${BASE_API}/notas/${nota_id}/danfe`;
