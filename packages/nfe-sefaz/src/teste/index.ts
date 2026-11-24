/**
 * `@macuxierp/nfe-sefaz/teste`: apoio SÓ DE TESTE (A1 fictício gerado na hora, documentos mínimos e assinatura de
 * teste). Nunca é importado por código de produção (apps, módulos): só por `*.test.ts` e pelo `tests/`.
 * A única exceção é o gerador do A1, pelo subcaminho próprio `@macuxierp/nfe-sefaz/a1-de-teste` (T-0080): a entrada do
 * operador `apps/api/src/a1-teste-main.ts` grava o A1 de teste da filial em homologação (simulador, ADR 0008).
 */
export {
  CNPJ_EMITENTE_DE_TESTE,
  CNPJ_OUTRO_DE_TESTE,
  INSTANTE_DE_TESTE,
  VALIDADE_DE_TESTE,
  gerarA1DeTeste,
  type A1DeTeste,
  type OpcoesA1DeTeste,
} from './a1-de-teste';
export { assinarXmlDeTeste } from './assinar-de-teste';
export {
  montarCancelamentoDeTeste,
  montarCartaCorrecaoDeTeste,
  montarEpecDeTeste,
  montarInutilizacaoDeTeste,
  montarNFeDeTeste,
  type NFeDeTeste,
  type OpcoesEventoDeTeste,
  type OpcoesNFeDeTeste,
} from './documentos-de-teste';
