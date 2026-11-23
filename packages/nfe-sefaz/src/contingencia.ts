/**
 * Subcaminho puro `@macuxierp/nfe-sefaz/contingencia` (ADR 0011): só constantes e tipos da contingência, sem XML,
 * assinatura nem XSD (nada do Node). Existe para o `domain` do faturamento, que roda também no BKO, usar a MESMA fonte
 * do prazo da EPEC, dos `tpEmis` e da tabela UF → SVC, sem copiar números (CLAUDE.md, regra 1: módulo importa
 * `packages/*`).
 */
export {
  C_ORGAO_AN,
  ModalidadeContingencia,
  PRAZO_TRANSMISSAO_EPEC_HORAS,
  TP_EMIS_CONTINGENCIA,
  TpEmis,
  Uf,
} from './ambiente';
export { EPEC_DA_UF, SVC_DA_UF, modalidadesContingencia } from './enderecos';
