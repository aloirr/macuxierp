/**
 * Cenário B (ADR 0014, §13 e §15): o ERP mantém o banco próprio e a nota autorizada desce ao banco do cliente pelo Conector; com o
 * faturamento desligado, o ERP é só ponte (a referência da nota do cliente fica no pedido, ADR 0014 §15 item 4).
 * Funções puras. A regra da descida é a RN-FAT-11.
 */
import type { Ambiente, StatusNota } from '../contracts';
import { CHAVE_ACESSO_REGEX } from '../contracts';
import { violacao, type Violacao } from './violacao';

export type ModoFaturamento = 'ligado' | 'desligado';

/** RN-CORE-02 (ADR 0014 §15): o modo é a licença do módulo `faturamento` da empresa, sem chave nova. */
export const modoFaturamento = (licencaFaturamentoAtiva: boolean): ModoFaturamento => (licencaFaturamentoAtiva ? 'ligado' : 'desligado');

const RN_DESCIDA = 'RN-FAT-11';

export interface NotaParaDescer {
  status: StatusNota;
  ambiente: Ambiente;
  /** O XML autorizado já está guardado e imutável (regra 7; RN-FAT-03). */
  xml_guardado: boolean;
  chave_acesso: string | null;
  pedido_id: string | null;
  /** Modo da empresa no momento (ADR 0014 §15). */
  faturamento: ModoFaturamento;
}

/**
 * RN-FAT-11: "Descida da nota autorizada ao cliente só com o faturamento ligado, em produção e com o XML guardado; homologação e simulador nunca descem."
 * ADR 0014 §13 e §15: a nota só desce ao banco do cliente se estiver `autorizada`, com o XML já guardado (RN-FAT-03, regra 7) e o
 * faturamento ligado. Premissa (na dúvida, a falha segura, RN-FAT-04): nota de homologação ou do simulador NUNCA desce, mesmo com a
 * bandeira "faturamento real com NF-e simulada" (essa bandeira vale só para o FDV); o banco do cliente só recebe nota de produção.
 */
export function notaPodeDescer(n: NotaParaDescer): Violacao[] {
  const v: Violacao[] = [];
  if (n.faturamento !== 'ligado') v.push(violacao(RN_DESCIDA, 'faturamento', 'Com o faturamento desligado o ERP não emite nota; não há nota do ERP para descer.'));
  if (n.status !== 'autorizada') v.push(violacao('RN-FAT-03', 'status', `Só nota autorizada desce ao banco do cliente (status atual: ${n.status}).`));
  if (!n.xml_guardado) v.push(violacao('RN-FAT-03', 'xml_guardado', 'O XML autorizado precisa estar guardado antes de a nota descer.'));
  if (n.ambiente !== 'producao') v.push(violacao('RN-FAT-04', 'ambiente', 'Nota de homologação ou do simulador não desce ao banco do cliente.'));
  if (n.chave_acesso === null || !CHAVE_ACESSO_REGEX.test(n.chave_acesso)) v.push(violacao(RN_DESCIDA, 'chave_acesso', 'A nota que desce é identificada pela chave de acesso.'));
  if (n.pedido_id === null) v.push(violacao(RN_DESCIDA, 'pedido_id', 'A nota que desce tem de estar ligada a um pedido.'));
  return v;
}
