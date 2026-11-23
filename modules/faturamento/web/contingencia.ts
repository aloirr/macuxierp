/**
 * Regras de tela da contingência por filial (T-0021, lote 4; RN-FAT-05, RN-FAT-09, RN-FAT-10): selo e faixa "em contingência", diálogos de
 * abrir e encerrar, requisições e o selo do prazo das EPEC pendentes. Só descreve e monta: a API revalida tudo (403, 409, 422).
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { AbrirContingenciaEntrada, type Ambiente, type ModalidadeContingencia, type SituacaoPrazoEpec } from '../contracts';
import { MOTIVO_MAX, MOTIVO_MIN, PRAZO_EPEC_HORAS } from '../domain/contingencia';
import { BASE_API, comChave, dialogoDeTexto, exigirChave, falha, mensagemDeTamanho, postSemCorpo, type DialogoDeTexto, type Montagem, type Selo } from './notas';

export const ROTULO_MODALIDADE: Readonly<Record<ModalidadeContingencia, { rotulo: string; dica: string }>> = {
  svc_an: { rotulo: 'SVC-AN', dica: 'Autorização pelo ambiente SVC-AN. A nota já sai autorizada' },
  svc_rs: { rotulo: 'SVC-RS', dica: 'Autorização pelo ambiente SVC-RS. A nota já sai autorizada' },
  epec: { rotulo: 'EPEC', dica: `Só o evento é autorizado agora. A nota precisa ser enviada em até ${PRAZO_EPEC_HORAS} h` },
};

/** Selo do prazo da EPEC pendente (RN-FAT-09): vencido em tom de alerta forte. */
export const ROTULO_PRAZO_EPEC: Readonly<Record<SituacaoPrazoEpec, Selo>> = {
  no_prazo: { texto: 'No prazo', tom: 'ok' },
  perto_do_fim: { texto: 'Perto do fim', tom: 'alerta', dica: 'Envie a nota assim que a SEFAZ responder' },
  vencido: { texto: 'Vencido', tom: 'erro', dica: 'O prazo acabou. Fale com o fiscal agora' },
};

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
export function seloDaContingencia(c: ContingenciaAberta | null, fuso: string): Selo | null {
  if (!c) return null;
  return { texto: `Em contingência (${ROTULO_MODALIDADE[c.modalidade].rotulo})`, tom: 'alerta', dica: `Desde ${formatarDataHora(c.inicio_em, fuso)}. ${ROTULO_MODALIDADE[c.modalidade].dica}` };
}

/** Faixa fixa da filial em contingência, no topo das telas do faturamento (o shell usa o tom `alerta`). */
export const faixaDaContingencia = (c: ContingenciaAberta | null, fuso: string): string | null =>
  c ? `FILIAL EM CONTINGÊNCIA — ${ROTULO_MODALIDADE[c.modalidade].rotulo}, DESDE ${formatarDataHora(c.inicio_em, fuso)}` : null;

const SEM_PERMISSAO = 'sem permissão para esta ação';
/** Por que abrir/encerrar não está disponível (texto ao lado do botão desabilitado), ou `null` se está. Quem liga e desliga é quem emite nota (`faturamento.nota.emitir`). */
export function acoesDaContingencia(perfil: Perfil, aberta: boolean): { abrir: string | null; encerrar: string | null } {
  if (!pode(perfil, 'faturamento.nota.emitir')) return { abrir: SEM_PERMISSAO, encerrar: SEM_PERMISSAO };
  return { abrir: aberta ? 'a filial já está em contingência.' : null, encerrar: aberta ? null : 'a filial não está em contingência.' };
}

export interface DialogoAbrirContingencia extends DialogoDeTexto {
  rotuloModalidade: string;
  modalidades: readonly { valor: ModalidadeContingencia; rotulo: string; dica: string }[];
}

/** Diálogo de abertura: a modalidade e o motivo (contador); o aviso diz o que muda. */
export const dialogoAbrirContingencia = (filial: { nome?: string | null } = {}): DialogoAbrirContingencia => ({
  ...dialogoDeTexto({
    titulo: filial.nome ? `Entrar em contingência: ${filial.nome}` : 'Entrar em contingência?',
    aviso: 'Use quando a SEFAZ não responde. As notas emitidas daqui até você encerrar saem em contingência.',
    rotuloTexto: 'Motivo', rotuloConfirmar: 'Entrar em contingência', rotuloFechar: 'Voltar', destrutivo: false,
    minimo: MOTIVO_MIN, maximo: MOTIVO_MAX, mensagem: mensagemDeTamanho('O motivo', { min: MOTIVO_MIN, max: MOTIVO_MAX }),
  }),
  rotuloModalidade: 'Modalidade',
  modalidades: (Object.keys(ROTULO_MODALIDADE) as ModalidadeContingencia[]).map((valor) => ({ valor, ...ROTULO_MODALIDADE[valor] })),
});

export const dialogoEncerrarContingencia = (filial: { nome?: string | null } = {}): { titulo: string; aviso: string; rotuloConfirmar: string; rotuloFechar: string; destrutivo: false } => ({
  titulo: filial.nome ? `Encerrar a contingência: ${filial.nome}?` : 'Encerrar a contingência?',
  aviso: `As notas EPEC pendentes continuam na lista e precisam ser enviadas em até ${PRAZO_EPEC_HORAS} h da autorização do EPEC.`,
  rotuloConfirmar: 'Encerrar contingência', rotuloFechar: 'Voltar', destrutivo: false,
});

/** POST de abertura com a Idempotency-Key; confere a modalidade e o tamanho do motivo antes de enviar (a API revalida). */
export function requisicaoAbrirContingencia(e: { filial_id: string; modalidade: ModalidadeContingencia; motivo: string; ambiente?: Ambiente; inicio_em?: string }, chave: string): Montagem {
  const semChave = exigirChave(chave);
  if (semChave) return semChave;
  const motivo = e.motivo.trim();
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) return falha(mensagemDeTamanho('O motivo', { min: MOTIVO_MIN, max: MOTIVO_MAX }));
  const v = AbrirContingenciaEntrada.safeParse({ ...e, motivo });
  if (!v.success) return falha('Confira a modalidade e a filial.');
  return { ok: true, requisicao: { metodo: 'POST', caminho: urlDaContingencia(e.filial_id), cabecalhos: comChave(chave), corpo: v.data } };
}

export const requisicaoEncerrarContingencia = (filial_id: string, chave: string): Montagem => postSemCorpo(urlDoEncerramentoDaContingencia(filial_id), chave);
