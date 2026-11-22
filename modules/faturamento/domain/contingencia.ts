/**
 * Contingência da NF-e 55. Funções puras, sem I/O. Regras (doc 03 v0.2.1):
 * RN-FAT-05 (o operador decide a entrada; o sistema sugere), RN-FAT-08 (mesma série e número; tpEmis e xJust no XML; EPEC conta como faturada desde o evento autorizado, ainda pendente de transmissão), RN-FAT-09 (o operador encerra; EPEC em fila na volta, dentro do prazo), RN-FAT-10 (filial com NF-e simulada não entra).
 * Modalidades v1 (coluna `modalidade`): svc_an (tpEmis 6), svc_rs (tpEmis 7) e epec (tpEmis 4, evento 110140); no XML ficam os nomes do Manual (tpEmis, dhCont, xJust). FS-DA fora da v1.
 */
import type { StatusNota } from '../contracts';
import type { ConteudoNota } from './tipos-nota';
import { validarTransicao } from './estados';
import { violacao, type Violacao } from './violacao';

/** Valores da coluna `modalidade` de faturamento.contingencia (0013 + 0032 acrescenta 'epec'). A contingência é por filial E ambiente: a API filtra (tenant, filial, ambiente) e checa a uma-aberta-por-vez; o domínio não recebe o ambiente. */
export type ModalidadeContingencia = 'svc_an' | 'svc_rs' | 'epec';
export type TpEmisContingencia = 4 | 6 | 7;
export const TP_EMIS_DA_MODALIDADE: Readonly<Record<ModalidadeContingencia, TpEmisContingencia>> = { 'svc_an': 6, 'svc_rs': 7, epec: 4 };

/** Qual SVC atende cada UF (sigla -> 'svc_an' | 'svc_rs'). Vem por parâmetro: a fonte única é `SVC_DA_UF` de packages/nfe-sefaz (ADR 0011); o domain não guarda tabela. AM -> SVC-RS, a conferir (ADR 0011). */
export type TabelaSvc = Readonly<Record<string, 'svc_an' | 'svc_rs'>>;

/** SVC que atende a UF do emitente; nulo quando a UF não consta na tabela (o chamador trata como violação). */
export function modalidadeDaUf(uf: string, tabela: TabelaSvc): 'svc_an' | 'svc_rs' | null {
  return tabela[uf.trim().toUpperCase()] ?? null;
}

export const MOTIVO_MIN = 15;
export const MOTIVO_MAX = 256;

/** Texto do emissor (`Texto` de packages/nfe-emissor, não exportado pelo pacote): sem controle C0/DEL (inclui tab e quebra de linha), sem espaço nas pontas e sem espaço duplo. Espelha `textoValidoXml` + `Texto`; trocar pelo import se o pacote exportar. */
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;
const textoDoEmissorValido = (s: string): boolean => !CONTROLE.test(s) && s.trim() === s && !/\s{2,}/.test(s);

/** cStat do statusServico que indicam SEFAZ fora (Manual): 108 paralisado temporariamente, 109 paralisado sem previsão. */
export const CSTAT_SERVICO_INDISPONIVEL: readonly number[] = [108, 109];
export type MotivoSugestao = 'consulta_indisponivel' | 'tempo_limite' | 'nenhum';

/**
 * RN-FAT-05: o sistema SUGERE a contingência (quem decide é o operador): statusServico com cStat 108 ou 109 (`cStatServico`) ou tentativas com tempo-limite
 * chegando ao `limite` (por parâmetro; limite < 1 desliga a sugestão por tempo-limite).
 */
export function sugerirContingencia(p: { cStatServico?: number | null; tentativasComTempoLimite: number; limite: number }): { sugerir: boolean; motivo: MotivoSugestao } {
  if (p.cStatServico != null && CSTAT_SERVICO_INDISPONIVEL.includes(p.cStatServico)) return { sugerir: true, motivo: 'consulta_indisponivel' };
  if (p.limite >= 1 && p.tentativasComTempoLimite >= p.limite) return { sugerir: true, motivo: 'tempo_limite' };
  return { sugerir: false, motivo: 'nenhum' };
}

export interface EntradaContingencia {
  /** RN-FAT-10: bandeira `faturamento_real_nfe_simulada` da configuracao_filial. */
  nfeSimulada: boolean;
  modalidade: ModalidadeContingencia;
  /** Coluna `motivo` de faturamento.contingencia (vira xJust no XML). */
  motivo: string;
  /** Coluna `inicio_em` (vira dhCont no XML). */
  inicioEm: Date;
  agora: Date;
}

/** RN-FAT-10: recusa filial com NF-e simulada. RN-FAT-05: modalidade v1 (FS-DA fora), xJust de 15 a 256 caracteres pela regra do Texto do emissor (sem espaço nas pontas nem duplo, sem controle); dhCont válido e nunca depois de `agora` (sem tolerância: não passa do dhEmi). */
export function validarEntradaContingencia(e: EntradaContingencia): Violacao[] {
  const v: Violacao[] = [];
  if (e.nfeSimulada) v.push(violacao('RN-FAT-10', 'nfeSimulada', 'Filial com NF-e simulada não entra em contingência.'));
  if (!(e.modalidade in TP_EMIS_DA_MODALIDADE)) v.push(violacao('RN-FAT-05', 'modalidade', 'Modalidade de contingência desconhecida.'));
  if (!textoDoEmissorValido(e.motivo)) v.push(violacao('RN-FAT-05', 'motivo', 'A justificativa não pode ter espaços no início, no fim ou repetidos, nem tabulação, quebra de linha ou caractere de controle.'));
  const n = e.motivo.length;
  if (n < MOTIVO_MIN || n > MOTIVO_MAX) v.push(violacao('RN-FAT-05', 'motivo', `A justificativa deve ter de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres (tem ${n}).`));
  if (Number.isNaN(e.inicioEm.getTime())) v.push(violacao('RN-FAT-05', 'inicioEm', 'Data e hora da entrada em contingência inválidas.'));
  else if (e.inicioEm.getTime() > e.agora.getTime()) v.push(violacao('RN-FAT-05', 'inicioEm', 'A entrada em contingência não pode estar no futuro.'));
  return v;
}

export interface ContingenciaDaNota {
  modalidade: ModalidadeContingencia;
  motivo: string;
  inicioEm: Date;
}

/** Devolve um conteúdo novo com tpEmis, dhCont (ISO UTC) e xJust (RN-FAT-08; série e número não mudam); não muda o original. A chave de acesso muda com tpEmis (dígito 35): é refeita na identidade. */
export function aplicarContingenciaAoConteudo(c: ConteudoNota, k: ContingenciaDaNota): ConteudoNota {
  return { ...c, contingencia: { tpEmis: TP_EMIS_DA_MODALIDADE[k.modalidade], dhCont: k.inicioEm.toISOString(), xJust: k.motivo.trim() } };
}

export interface NotaNaVolta {
  status: StatusNota;
  tpEmis: 1 | 4 | 6 | 7;
  /** Só EPEC: o evento 110140 foi autorizado pela SEFAZ (cStat 136). */
  epecAutorizado?: boolean;
}

/** RN-FAT-09 (ADR 0011): só a EPEC (tpEmis 4) é transmitida na volta, e só com o evento autorizado. SVC (6/7) não retransmite: já nasce autorizada no ambiente SVC e o autorizador normal recusa tpEmis 6/7. */
export function podeTransmitirNaVolta(n: NotaNaVolta): boolean {
  return n.status === 'emitida_contingencia' && n.tpEmis === 4 && n.epecAutorizado === true;
}

/** Entrada: `em_autorizacao` -> `emitida_contingencia` (só EPEC; SVC autoriza direto no ambiente SVC). */
export const transicaoEntradaContingencia = (de: StatusNota): Violacao[] => validarTransicao(de, 'emitida_contingencia');
/** Volta à normal (RN-FAT-09; rejeição segue a RN-FAT-07): `emitida_contingencia` -> `em_autorizacao` (transmissão), se `podeTransmitirNaVolta`. */
export function transicaoVoltaContingencia(n: NotaNaVolta): Violacao[] {
  if (n.tpEmis === 6 || n.tpEmis === 7) return [violacao('RN-FAT-09', 'tpEmis', 'Nota em SVC não é retransmitida na volta: o autorizador normal recusa tpEmis 6 e 7; só a EPEC é transmitida.')];
  if (!podeTransmitirNaVolta(n)) return [violacao('RN-FAT-09', 'status', 'Nota não pode ser transmitida na volta: não está em contingência ou a EPEC ainda não foi autorizada.')];
  return validarTransicao(n.status, 'em_autorizacao');
}

/**
 * RN-FAT-08: a nota conta como faturada para o pedido só se autorizada: SVC autorizada conta; EPEC só depois do evento 110140 registrado (cStat 136)
 * (nota `emitida_contingencia` com `epecAutorizado`), ou autorizada de fato na volta. Usado nas etapas 3/4 no saldo do pedido (`quantidadeFaturada`).
 */
export function contaComoFaturada(n: NotaNaVolta): boolean {
  if (n.tpEmis === 4) return n.epecAutorizado === true && !['cancelada', 'inutilizada', 'denegada'].includes(n.status);
  return n.status === 'autorizada';
}

/** Trocar por PRAZO_TRANSMISSAO_EPEC_HORAS de @macuxierp/nfe-sefaz/contingencia quando o PR do engenheiro entrar. RN-FAT-09 (PO, PR #271): a transmissão posterior sai assim que a SEFAZ normal responder, no máximo 168 h depois da AUTORIZAÇÃO DO EPEC. */
export const PRAZO_EPEC_HORAS = 168;
/** RN-FAT-09: limite = autorização do EPEC (`epec_autorizada_em`) + `prazoHoras` (padrão 168 h). Não conta da emissão nem do encerramento da contingência. */
export function prazoEpec(p: { epecAutorizadoEm: Date; prazoHoras?: number }): Date {
  return new Date(p.epecAutorizadoEm.getTime() + (p.prazoHoras ?? PRAZO_EPEC_HORAS) * 3_600_000);
}

export type SituacaoPrazoEpec = 'no_prazo' | 'perto_do_fim' | 'vencido';
/** Janela padrão de "perto do fim" (horas): decisão de UX nossa, não do Manual (conferir com o PO). Vencido -> alerta vermelho ao administrador (RN-FAT-09). */
export const JANELA_PERTO_DO_FIM_HORAS = 6;
export function situacaoPrazoEpec(agora: Date, prazo: Date, janelaHoras: number = JANELA_PERTO_DO_FIM_HORAS): SituacaoPrazoEpec {
  const restante = prazo.getTime() - agora.getTime();
  if (restante < 0) return 'vencido';
  return restante <= janelaHoras * 3_600_000 ? 'perto_do_fim' : 'no_prazo';
}
