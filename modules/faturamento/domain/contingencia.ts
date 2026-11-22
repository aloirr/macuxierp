/**
 * Contingência da NF-e 55. Funções puras, sem I/O. Regras (doc 03 v0.2.1):
 * RN-FAT-05 (o operador decide a entrada; o sistema sugere), RN-FAT-08 (mesma série e número; tpEmis e xJust no XML; EPEC só conta como faturada
 * após o evento), RN-FAT-09 (o operador encerra; EPEC em fila na volta, dentro do prazo), RN-FAT-10 (filial com NF-e simulada não entra).
 * Modalidades v1: SVC-AN (tpEmis 6), SVC-RS (tpEmis 7) e EPEC (tpEmis 4, evento 110140). FS-DA fora da v1.
 */
import type { StatusNota } from '../contracts';
import type { ConteudoNota } from './tipos-nota';
import { validarTransicao } from './estados';
import { violacao, type Violacao } from './violacao';

export type ModalidadeContingencia = 'SVC-AN' | 'SVC-RS' | 'EPEC';
export type TpEmisContingencia = 4 | 6 | 7;
export const TP_EMIS_DA_MODALIDADE: Readonly<Record<ModalidadeContingencia, TpEmisContingencia>> = { 'SVC-AN': 6, 'SVC-RS': 7, EPEC: 4 };

/** Qual SVC atende cada UF (sigla -> 'SVC-AN' | 'SVC-RS'). Vem por parâmetro: tabela do Manual de Contingência (conferir com o fiscal). */
export type TabelaSvc = Readonly<Record<string, 'SVC-AN' | 'SVC-RS'>>;

/**
 * Tabela padrão (conferir com o Manual/NT antes de produção; a fonte oficial é do fiscal). SVC-RS atende AM, BA, CE, GO, MA, MS, MT, PA, PE, PI e PR;
 * as demais UFs usam SVC-AN.
 */
export const TABELA_SVC_PADRAO: TabelaSvc = Object.fromEntries([
  ...['AM', 'BA', 'CE', 'GO', 'MA', 'MS', 'MT', 'PA', 'PE', 'PI', 'PR'].map((u) => [u, 'SVC-RS'] as const),
  ...['AC', 'AL', 'AP', 'DF', 'ES', 'MG', 'PB', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'].map((u) => [u, 'SVC-AN'] as const),
]);

/** SVC que atende a UF do emitente; nulo quando a UF não consta na tabela (o chamador trata como violação). */
export function modalidadeDaUf(uf: string, tabela: TabelaSvc): 'SVC-AN' | 'SVC-RS' | null {
  return tabela[uf.trim().toUpperCase()] ?? null;
}

export const XJUST_MIN = 15;
export const XJUST_MAX = 256;
/** Tolerância de relógio para dhCont "no futuro" (ms). */
export const TOLERANCIA_DHCONT_MS = 5 * 60 * 1000;

export type ConsultaStatus = 'ok' | 'indisponivel' | 'desconhecida';
export type MotivoSugestao = 'consulta_indisponivel' | 'tempo_limite' | 'nenhum';

/**
 * RN-FAT-05: o sistema SUGERE a contingência (quem decide é o operador): consulta de status indisponível ou tentativas com tempo-limite
 * chegando ao `limite` (por parâmetro; limite < 1 desliga a sugestão por tempo-limite).
 */
export function sugerirContingencia(p: { consultaStatus: ConsultaStatus; tentativasComTempoLimite: number; limite: number }): { sugerir: boolean; motivo: MotivoSugestao } {
  if (p.consultaStatus === 'indisponivel') return { sugerir: true, motivo: 'consulta_indisponivel' };
  if (p.limite >= 1 && p.tentativasComTempoLimite >= p.limite) return { sugerir: true, motivo: 'tempo_limite' };
  return { sugerir: false, motivo: 'nenhum' };
}

export interface EntradaContingencia {
  /** RN-FAT-10: bandeira `faturamento_real_nfe_simulada` da configuracao_filial. */
  nfeSimulada: boolean;
  modalidade: ModalidadeContingencia;
  xJust: string;
  dhCont: Date;
  agora: Date;
}

/** RN-FAT-10: recusa filial com NF-e simulada. RN-FAT-05: modalidade v1 (FS-DA fora), xJust de 15 a 256 caracteres sem espaços nas pontas; dhCont válido e não no futuro (tolerância de 5 min). */
export function validarEntradaContingencia(e: EntradaContingencia): Violacao[] {
  const v: Violacao[] = [];
  if (e.nfeSimulada) v.push(violacao('RN-FAT-10', 'nfeSimulada', 'Filial com NF-e simulada não entra em contingência.'));
  if (!(e.modalidade in TP_EMIS_DA_MODALIDADE)) v.push(violacao('RN-FAT-05', 'modalidade', 'Modalidade de contingência desconhecida.'));
  if (e.xJust !== e.xJust.trim()) v.push(violacao('RN-FAT-05', 'xJust', 'A justificativa não pode ter espaços no início ou no fim.'));
  const n = e.xJust.trim().length;
  if (n < XJUST_MIN || n > XJUST_MAX) v.push(violacao('RN-FAT-05', 'xJust', `A justificativa deve ter de ${XJUST_MIN} a ${XJUST_MAX} caracteres (tem ${n}).`));
  if (Number.isNaN(e.dhCont.getTime())) v.push(violacao('RN-FAT-05', 'dhCont', 'Data e hora da entrada em contingência inválidas.'));
  else if (e.dhCont.getTime() > e.agora.getTime() + TOLERANCIA_DHCONT_MS) v.push(violacao('RN-FAT-05', 'dhCont', 'A entrada em contingência não pode estar no futuro.'));
  return v;
}

export interface ContingenciaDaNota {
  modalidade: ModalidadeContingencia;
  xJust: string;
  dhCont: Date;
}

/** Devolve um conteúdo novo com tpEmis, dhCont (ISO UTC) e xJust (RN-FAT-08; série e número não mudam); não muda o original. A chave de acesso muda com tpEmis (dígito 35): é refeita na identidade. */
export function aplicarContingenciaAoConteudo(c: ConteudoNota, k: ContingenciaDaNota): ConteudoNota {
  return { ...c, contingencia: { tpEmis: TP_EMIS_DA_MODALIDADE[k.modalidade], dhCont: k.dhCont.toISOString(), xJust: k.xJust.trim() } };
}

export interface NotaNaVolta {
  status: StatusNota;
  tpEmis: 1 | 4 | 6 | 7;
  /** Só EPEC: o evento 110140 foi autorizado pela SEFAZ (cStat 136). */
  epecAutorizado?: boolean;
}

/** RN-FAT-05: na volta à normal só se transmite nota `emitida_contingencia`; a EPEC exige antes o evento autorizado. */
export function podeTransmitirNaVolta(n: NotaNaVolta): boolean {
  if (n.status !== 'emitida_contingencia') return false;
  if (n.tpEmis === 4) return n.epecAutorizado === true;
  return n.tpEmis === 6 || n.tpEmis === 7;
}

/** Entrada: `em_autorizacao` -> `emitida_contingencia` (só EPEC; SVC autoriza direto no ambiente SVC). */
export const transicaoEntradaContingencia = (de: StatusNota): Violacao[] => validarTransicao(de, 'emitida_contingencia');
/** Volta à normal (RN-FAT-09; rejeição segue a RN-FAT-07): `emitida_contingencia` -> `em_autorizacao` (transmissão), se `podeTransmitirNaVolta`. */
export function transicaoVoltaContingencia(n: NotaNaVolta): Violacao[] {
  if (!podeTransmitirNaVolta(n)) return [violacao('RN-FAT-09', 'status', 'Nota não pode ser transmitida na volta: não está em contingência ou a EPEC ainda não foi autorizada.')];
  return validarTransicao(n.status, 'em_autorizacao');
}

/**
 * RN-FAT-08: a nota conta como faturada para o pedido só se autorizada: SVC autorizada conta; EPEC só depois do evento 110140 vinculado/autorizado
 * (nota `emitida_contingencia` com `epecAutorizado`), ou autorizada de fato na volta. Usado nas etapas 3/4 no saldo do pedido (`quantidadeFaturada`).
 */
export function contaComoFaturada(n: NotaNaVolta): boolean {
  if (n.tpEmis === 4) return n.status === 'autorizada' || (n.status === 'emitida_contingencia' && n.epecAutorizado === true);
  return n.status === 'autorizada';
}

/** RN-FAT-09: limite para transmitir a EPEC = emissão + `prazoHoras` (parâmetro; conferir com o Manual/NT (fiscal)). */
export function prazoEpec(p: { emitidaEm: Date; prazoHoras: number }): Date {
  return new Date(p.emitidaEm.getTime() + p.prazoHoras * 3_600_000);
}

export type SituacaoPrazoEpec = 'no_prazo' | 'perto_do_fim' | 'vencido';
/** Janela padrão de "perto do fim" (horas; conferir com o fiscal/PO). Vencido -> alerta vermelho ao administrador (RN-FAT-09). */
export const JANELA_PERTO_DO_FIM_HORAS = 6;
export function situacaoPrazoEpec(agora: Date, prazo: Date, janelaHoras: number = JANELA_PERTO_DO_FIM_HORAS): SituacaoPrazoEpec {
  const restante = prazo.getTime() - agora.getTime();
  if (restante < 0) return 'vencido';
  return restante <= janelaHoras * 3_600_000 ? 'perto_do_fim' : 'no_prazo';
}
