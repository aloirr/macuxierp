# Contratos entre módulos — eventos

> Dono: engenheiro-software. Fonte: `manifest.ts` de cada módulo (o publicador é dono do schema do evento em `modules/<m>/contracts`). Mudança incompatível = `@2` + ADR + recado aos consumidores. Desenho da F1: `docs/desenho/T-0002.md`.

| Módulo | Publica | Consome |
|---|---|---|
| `cadastros` | `cadastros.cliente.alterado@1`, `cadastros.produto.alterado@1`, `cadastros.preco.alterado@1`, `cadastros.estoque.alterado@1`, `cadastros.filial.alterada@1`, `cadastros.vendedor.alterado@1`, `cadastros.carteira.alterada@1`, `cadastros.condicao_pagamento.alterada@1` | `core.usuario.alterado@1` (liga vendedor a usuário) |
| `core` | `core.empresa.alterada@1`, `core.usuario.alterado@1`, `core.certificado.alterado@1`, `core.ambiente_fiscal.alterado@1` | — |
| `faturamento` | `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1`, `faturamento.nota.rejeitada@1`, `faturamento.titulo.gerado@1` | `pedido.pedido.aprovado@1`, `core.certificado.alterado@1`, `core.ambiente_fiscal.alterado@1` (F4, a confirmar na T-0018) |
| `fiscal` | `fiscal.regra.alterada@1` | — |
| `integracao-fdv` | `integracao-fdv.lote.enviado@1`, `integracao-fdv.lote.falhou@1` | `cadastros.cliente.alterado@1`, `cadastros.produto.alterado@1`, `cadastros.preco.alterado@1`, `cadastros.estoque.alterado@1`, `cadastros.filial.alterada@1`, `cadastros.vendedor.alterado@1`, `cadastros.carteira.alterada@1` (só registro, T-0009), `cadastros.condicao_pagamento.alterada@1`, `pedido.pedido.recebido@1`, `pedido.pedido.aprovado@1`, `pedido.pedido.recusado@1`, `pedido.pedido.cancelado@1`, `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1`, `faturamento.titulo.gerado@1` |
| `pedido` | `pedido.pedido.recebido@1`, `pedido.pedido.aprovado@1`, `pedido.pedido.recusado@1`, `pedido.pedido.cancelado@1` | `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1` |

## Envelope (platform-sdk)
`{ id: uuid, nome: "<m>.<ent>.<fato>@vN", tenant_id, agregado_id, versao, ocorrido_em (UTC), ator: usuario_id | "sistema", request_id, payload }`. Gravado na outbox (`plataforma.evento`) na mesma transação da escrita. O consumidor é idempotente por `(consumidor, evento_id)` em `plataforma.evento_consumido` e descarta `versao` menor que a última já aplicada ao agregado.

`versao` (inteiro ≥ 1) é definida pela outbox (`Outbox.gravar`), não pelo módulo: contador por `(tenant_id, agregado_id)`, para qualquer nome de evento, sem buraco e sem repetição; rollback não consome versão. O `versao` passado a `ContextoRota.publicar` está obsoleto e é ignorado; o envelope devolvido traz a versão gravada (T-0034). A forma do envelope não muda (inteiro ≥ 1), por isso sem ADR nem nova versão de contrato.

## Payloads de core e cadastros (v1)
Os eventos `alterado@1` levam o **estado completo** da entidade, mais `inativo: boolean` (RN-CAD-08). Os campos seguem os esboços Zod de `docs/desenho/T-0002.md`.

| Evento | `agregado_id` | Payload |
|---|---|---|
| `core.empresa.alterada@1` | tenant | `Empresa` |
| `core.usuario.alterado@1` | usuário | `id`, `perfil`, `filial_ids`, `ativo`. **Sem** nome nem e-mail |
| `core.certificado.alterado@1` | certificado | `id`, `filial_id`, `cnpj`, `valido_ate`, `impressao_digital`, `ativo`. **Nunca** o `.pfx` nem a senha |
| `core.ambiente_fiscal.alterado@1` | filial | `filial_id`, `ambiente`, `recado_aprovacao` |
| `cadastros.filial.alterada@1` | filial | `Filial` + `inativo` |
| `cadastros.cliente.alterado@1` | cliente | `Cliente` (com endereços e `vendedor_id` da carteira) + `inativo` |
| `cadastros.produto.alterado@1` | produto | `Produto` + `unidades[]` + `inativo` (o custo vai no evento; o `integracao-fdv` não o manda ao Hub) |
| `cadastros.preco.alterado@1` | item da tabela | `PrecoItem` + `vigencia_inicio`, `vigencia_fim`, `inativo` |
| `cadastros.estoque.alterado@1` | `filial_id` + `produto_id` (UUID v5) | `filial_id`, `produto_id`, `quantidade` (escala 4) |
| `cadastros.condicao_pagamento.alterada@1` | condição | `CondicaoPagamento` + `inativo` |
| `cadastros.vendedor.alterado@1` | vendedor | `Vendedor` + `inativo` |
| `cadastros.carteira.alterada@1` | vendedor de destino | `de`, `para`, `cliente_ids[]`. Resumo da transferência, para auditoria (D7) |

## Dependências
core ← cadastros ← (pedido, fiscal) ← faturamento; integracao-fdv ← (cadastros, pedido) e consome eventos de faturamento. Quando importar o contrato do publicador criaria ciclo de pacotes (ex.: `cadastros` lendo `faturamento.nota.autorizada@1` para baixar estoque, na F4), o consumidor valida o evento com um leitor tolerante próprio (subconjunto do payload). O publicador continua dono do schema.

## Integração externa
O único contrato com o FDV é o **Hub `/integracao/v1`** (doc 06). Nenhum módulo do ERP lê tabela do FDV.
