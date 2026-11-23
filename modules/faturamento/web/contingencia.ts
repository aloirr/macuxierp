/**
 * Regras de tela da contingência por filial (T-0021, lote 4; RN-FAT-05, RN-FAT-09, RN-FAT-10): selo e faixa "em contingência", diálogos de
 * abrir e encerrar, requisições e o selo do prazo das EPEC pendentes. Só descreve e monta: a API revalida tudo (403, 409, 422).
 */
import { type Perfil } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { AbrirContingenciaEntrada, type AlertaPrazoEpec, type Ambiente, type ModalidadeContingencia, type SituacaoPrazoEpec } from '../contracts';
import { EPEC_LIGADA, MOTIVO_MAX, MOTIVO_MIN, PRAZO_EPEC_HORAS } from '../domain/contingencia';
import { BASE_API, comChave, dialogoDeTexto, exigirChave, falha, mensagemDeTamanho, postSemCorpo, type DialogoDeTexto, type Montagem, type Selo } from './notas';

export const ROTULO_MODALIDADE: Readonly<Record<ModalidadeContingencia, { rotulo: string; dica: string }>> = {
  svc_an: { rotulo: 'SVC-AN', dica: 'A nota já sai autorizada' },
  svc_rs: { rotulo: 'SVC-RS', dica: 'A nota já sai autorizada' },
  epec: { rotulo: 'EPEC', dica: `Só o evento é autorizado agora. A nota precisa ser enviada em até ${PRAZO_EPEC_HORAS} h` },
};

/** Selo do prazo da EPEC pendente (RN-FAT-09): vencido em tom de alerta forte. */
export const ROTULO_PRAZO_EPEC: Readonly<Record<SituacaoPrazoEpec, Selo>> = {
  no_prazo: { texto: 'No prazo', tom: 'ok' },
  perto_do_fim: { texto: 'Perto do fim', tom: 'alerta', dica: 'Envie a nota assim que a SEFAZ responder' },
  vencido: { texto: 'Vencido', tom: 'erro', dica: 'O prazo acabou. Fale com o fiscal agora' },
};

const MENSAGEM_JUSTIFICATIVA = mensagemDeTamanho('A justificativa', { min: MOTIVO_MIN, max: MOTIVO_MAX });

export const urlDaContingencia = (filialId: string): string => `${BASE_API}/filiais/${filialId}/contingencia`;
export const urlDoEncerramentoDaContingencia = (filialId: string): string => `${urlDaContingencia(filialId)}/encerrar`;
export const urlDasEpecPendentes = (): string => `${BASE_API}/contingencia/epec-pendentes`;

/** Contingência aberta, como a API devolve (`ContingenciaResumo`); só o que a tela usa. */
export interface ContingenciaAberta {
  modalidade: ModalidadeContingencia;
  inicio_em: string;
  ambiente: Ambiente;
}

/** Selo de destaque da filial em contingência (aparece em todas as telas do faturamento da filial); sem contingência aberta não há selo. */
export function seloDaContingencia(c: ContingenciaAberta | null): Selo | null {
  if (!c) return null;
  return { texto: `Em contingência (${ROTULO_MODALIDADE[c.modalidade].rotulo})`, tom: 'alerta', dica: ROTULO_MODALIDADE[c.modalidade].dica };
}

/** Faixa fixa da filial em contingência, no topo das telas do faturamento (o shell usa o tom `alerta`). */
export const faixaDaContingencia = (c: ContingenciaAberta | null, fuso: string): string | null =>
  c ? `FILIAL EM CONTINGÊNCIA — DESDE ${formatarDataHora(c.inicio_em, fuso)}` : null;

/** RN-FAT-09: faixa do alerta do prazo da EPEC (sinal do `GET .../epec-pendentes/alerta`), no tom `erro` (vermelho) ou `alerta` (amarelo); `null` quando verde. Sem dado pessoal. */
export const faixaDoAlertaEpec = (a: AlertaPrazoEpec): { tom: 'erro' | 'alerta'; texto: string } | null =>
  a.sinal === 'vermelho'
    ? { tom: 'erro', texto: `${a.vencidas} nota(s) em EPEC com o prazo de ${PRAZO_EPEC_HORAS} h vencido. Transmita agora e confira a SEFAZ.` }
    : a.sinal === 'amarelo' ? { tom: 'alerta', texto: `${a.perto_do_fim} nota(s) em EPEC perto do fim do prazo de ${PRAZO_EPEC_HORAS} h.` } : null;

const SEM_PERMISSAO = 'sem permissão para esta ação';
/** Por que abrir/encerrar não está disponível (texto ao lado do botão desabilitado), ou `null` se está. Só o administrador liga e desliga (RN-FAT-05, decisão do Alexandre, 23/11); a API responde 403 aos demais. */
/**
 * `contingenciaDisponivel` = `pode_abrir` da resposta do GET (RN-FAT-10: filial simulada ou sem transporte SVC): com `false` o botão de abrir NÃO é oferecido (`mostrarAbrir: false`: nem desabilitado, nem com dica);
 * encerrar segue pelas regras de sempre (aparece com contingência aberta).
 */
export function acoesDaContingencia(perfil: Perfil, aberta: boolean, contingenciaDisponivel: boolean): { mostrarAbrir: boolean; abrir: string | null; encerrar: string | null } {
  if (perfil !== 'administrador') return { mostrarAbrir: contingenciaDisponivel, abrir: SEM_PERMISSAO, encerrar: SEM_PERMISSAO };
  return { mostrarAbrir: contingenciaDisponivel, abrir: aberta ? 'a filial já está em contingência.' : null, encerrar: aberta ? null : 'a filial não está em contingência.' };
}

export interface DialogoAbrirContingencia extends DialogoDeTexto {
  rotuloModalidade: string;
  modalidades: readonly { valor: ModalidadeContingencia; rotulo: string; dica: string }[];
}

/** Diálogo de abertura: a modalidade e o motivo (contador); o aviso diz o que muda. */
export const dialogoAbrirContingencia = (filial: { nome?: string | null } = {}, epecLigada: boolean = EPEC_LIGADA): DialogoAbrirContingencia => ({
  ...dialogoDeTexto({
    titulo: filial.nome ? `Entrar em contingência: ${filial.nome}?` : 'Entrar em contingência?',
    aviso: 'Use quando a SEFAZ não responde. As notas emitidas daqui até você encerrar saem em contingência.',
    rotuloTexto: 'Justificativa', rotuloConfirmar: 'Entrar em contingência', rotuloFechar: 'Voltar', destrutivo: false,
    minimo: MOTIVO_MIN, maximo: MOTIVO_MAX, mensagem: MENSAGEM_JUSTIFICATIVA,
  }),
  rotuloModalidade: 'Modalidade',
  /** Sem a bandeira da EPEC (v0.3.0), a EPEC não é oferecida; a API recusa com 422 de qualquer jeito. */
  modalidades: (Object.keys(ROTULO_MODALIDADE) as ModalidadeContingencia[]).filter((valor) => valor !== 'epec' || epecLigada).map((valor) => ({ valor, ...ROTULO_MODALIDADE[valor] })),
});

/** O aviso depende da modalidade aberta: a EPEC deixa notas pendentes de envio; a SVC já autoriza no ato. */
export const dialogoEncerrarContingencia = (filial: { nome?: string | null }, modalidade: ModalidadeContingencia): { titulo: string; aviso: string; rotuloConfirmar: string; rotuloFechar: string; destrutivo: false } => ({
  titulo: filial.nome ? `Encerrar a contingência: ${filial.nome}?` : 'Encerrar a contingência?',
  aviso: modalidade === 'epec'
    ? `As notas EPEC pendentes continuam na lista e precisam ser enviadas em até ${PRAZO_EPEC_HORAS} h da autorização do EPEC.`
    : 'As próximas notas saem pelo autorizador normal.',
  rotuloConfirmar: 'Encerrar contingência', rotuloFechar: 'Voltar', destrutivo: false,
});

/** POST de abertura com a Idempotency-Key; confere a modalidade e o tamanho do motivo antes de enviar (a API revalida). */
export function requisicaoAbrirContingencia(e: { filial_id: string; modalidade: ModalidadeContingencia; motivo: string; ambiente?: Ambiente; inicio_em?: string }, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const motivo = e.motivo.trim();
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) return falha(MENSAGEM_JUSTIFICATIVA);
  const v = AbrirContingenciaEntrada.safeParse({ ...e, motivo });
  if (!v.success) return falha('Confira a modalidade e a filial.');
  return { ok: true, requisicao: { metodo: 'POST', caminho: urlDaContingencia(e.filial_id), cabecalhos: comChave(chave), corpo: v.data } };
}

export const requisicaoEncerrarContingencia = (filial_id: string, chave: string): Montagem => postSemCorpo(urlDoEncerramentoDaContingencia(filial_id), chave);
