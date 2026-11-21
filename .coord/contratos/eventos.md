# Contratos entre módulos — eventos

> Dono: engenheiro-software. Fonte: `manifest.ts` de cada módulo (o publicador é dono do schema do evento em `modules/<m>/contracts`). Mudança incompatível = `@2` + ADR + recado aos consumidores.

| Módulo | Publica | Consome |
|---|---|---|
| `cadastros` | `cadastros.cliente.alterado@1`, `cadastros.produto.alterado@1`, `cadastros.preco.alterado@1`, `cadastros.estoque.alterado@1`, `cadastros.filial.alterada@1`, `cadastros.vendedor.alterado@1`, `cadastros.carteira.alterada@1`, `cadastros.condicao_pagamento.alterada@1` | — |
| `core` | `core.empresa.alterada@1`, `core.usuario.alterado@1` | — |
| `faturamento` | `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1`, `faturamento.nota.rejeitada@1`, `faturamento.titulo.gerado@1` | `pedido.pedido.aprovado@1` |
| `fiscal` | `fiscal.regra.alterada@1` | — |
| `integracao-fdv` | `integracao-fdv.lote.enviado@1`, `integracao-fdv.lote.falhou@1` | `cadastros.cliente.alterado@1`, `cadastros.produto.alterado@1`, `cadastros.preco.alterado@1`, `cadastros.estoque.alterado@1`, `cadastros.filial.alterada@1`, `cadastros.vendedor.alterado@1`, `cadastros.carteira.alterada@1`, `cadastros.condicao_pagamento.alterada@1`, `pedido.pedido.recebido@1`, `pedido.pedido.aprovado@1`, `pedido.pedido.recusado@1`, `pedido.pedido.cancelado@1`, `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1`, `faturamento.titulo.gerado@1` |
| `pedido` | `pedido.pedido.recebido@1`, `pedido.pedido.aprovado@1`, `pedido.pedido.recusado@1`, `pedido.pedido.cancelado@1` | `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1` |

## Dependências
core ← cadastros ← (pedido, fiscal) ← faturamento; integracao-fdv ← (cadastros, pedido) e consome eventos de faturamento.

## Integração externa
O único contrato com o FDV é o **Hub `/integracao/v1`** (doc 06). Nenhum módulo do ERP lê tabela do FDV.
