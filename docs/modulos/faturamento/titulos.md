# Títulos a receber (RF-FAT-07, RN-FAT-06) — domain

`modules/faturamento/domain/titulos.ts`, funções puras, centavos, datas civis de Manaus.

- **Geração** (`gerarParcelas`): só a classe `boleto` gera título, um por prazo da condição; vencimento = data de emissão em Manaus + prazo; rateio com `ratear` (resto na primeira parcela, RN-CORE-03). Cartão, à vista e forma desconhecida: lista vazia. Só nota autorizada (RN-FAT-03). Nota de homologação gera título com `ambiente = homologacao` e `vai_ao_fdv = false` (RN-FAT-04).
- **Baixa** (`baixar`): só título aberto; valor inteiro > 0 e ≤ saldo; saldo 0 = `baixado`, senão `aberto`.
- **Estorno** (`estornarBaixa`): marca a baixa e recalcula saldo = valor − baixas não estornadas (o mesmo cálculo do trigger da 0013); título baixado reabre; título cancelado não tem estorno.
- **Cancelamento da nota** (`cancelarTitulosDaNota`): cancela os abertos sem baixa. **Regra escolhida:** se algum título tem baixa (parcial ou total), é violação RN-FAT-06 e nada é cancelado até o estorno das baixas.
- **Eventos**: `payloadTituloGerado` e `payloadTituloBaixado` montam `faturamento.titulo.gerado@1` e `titulo.baixado@1` (agregado `titulo.id`), com `ambiente` e `valor_baixado_centavos`.
