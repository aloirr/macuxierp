/**
 * C-6: payloads do Hub `/integracao/v1` por entidade (docs/desenho/T-0009.md, seção 2).
 * Desde a T-0057 (ADR 0014 §2, E1) o schema vive em um lugar só, `@macuxierp/platform-sdk/hub-v1`, compartilhado com a
 * futura `/entrada/v1` do cadastros e o `apps/conector`. Este arquivo apenas reexporta (mesmos objetos, mesmos nomes).
 * `titulo` e `nota` são da F4 (T-0016) e ainda não têm payload.
 */
export {
  ENTIDADES_HUB,
  EntidadeHub,
  ENTIDADES_HUB_F2,
  LIMITE_REGISTROS_LOTE,
  VERSAO_CONTRATO_HUB,
  CodigoErro,
  CampoErro,
  SituacaoEntidade,
  FilialHub,
  VendedorHub,
  FormaPagamentoHub,
  PrazoPagamentoHub,
  ProdutoHub,
  ProdutoUnidadeHub,
  PrecoHub,
  EstoqueHub,
  EnderecoClienteHub,
  ClienteHub,
  ClienteEnderecoHub,
  PAYLOADS_HUB,
  RegistroLote,
  ModoLote,
  CursorHub,
  SessaoLote,
  LinhaInvalida,
  CODIGOS_LINHA_HUB,
  LinhaInvalidaHub,
  CorpoLote,
} from '@macuxierp/platform-sdk/hub-v1';
