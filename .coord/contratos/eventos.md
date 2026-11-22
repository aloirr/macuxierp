# Contratos entre módulos — eventos

> Dono: engenheiro-software. Fonte: `manifest.ts` de cada módulo (o publicador é dono do schema do evento em `modules/<m>/contracts`). Mudança incompatível = `@2` + ADR + recado aos consumidores. Desenho da F1: `docs/desenho/T-0002.md`.

| Módulo | Publica | Consome |
|---|---|---|
| `cadastros` | `cadastros.cliente.alterado@1`, `cadastros.produto.alterado@1`, `cadastros.preco.alterado@1`, `cadastros.estoque.alterado@1`, `cadastros.filial.alterada@1`, `cadastros.vendedor.alterado@1`, `cadastros.carteira.alterada@1`, `cadastros.condicao_pagamento.alterada@1`, `cadastros.tabela_preco.alterada@1` | `core.usuario.alterado@1` (liga vendedor a usuário), `integracao-fdv.carga_inicial.solicitada@1` (leitor tolerante, T-0034) |
| `core` | `core.empresa.alterada@1`, `core.usuario.alterado@1`, `core.certificado.alterado@1`, `core.ambiente_fiscal.alterado@1` | — |
| `faturamento` | `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1`, `faturamento.nota.rejeitada@1`, `faturamento.titulo.gerado@1`, `faturamento.titulo.baixado@1` | `pedido.pedido.aprovado@1`, `core.certificado.alterado@1`, `core.ambiente_fiscal.alterado@1` (F4, a confirmar na T-0018) |
| `fiscal` | `fiscal.regra.alterada@1` | — |
| `integracao-fdv` | `integracao-fdv.lote.enviado@1`, `integracao-fdv.lote.falhou@1`, `integracao-fdv.carga_inicial.solicitada@1` | `cadastros.cliente.alterado@1`, `cadastros.produto.alterado@1`, `cadastros.preco.alterado@1`, `cadastros.estoque.alterado@1`, `cadastros.filial.alterada@1`, `cadastros.vendedor.alterado@1`, `cadastros.carteira.alterada@1` (só registro, T-0009), `cadastros.condicao_pagamento.alterada@1`, `cadastros.tabela_preco.alterada@1`, `pedido.pedido.recebido@1`, `pedido.pedido.cancelado@1`, `pedido.pedido.faturado@1` (F4), `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1`, `faturamento.titulo.gerado@1`, `faturamento.titulo.baixado@1` (sem `pedido.pedido.aprovado@1` nem `pedido.pedido.recusado@1`: RN-PED-01, ADR 0007 e emenda, T-0013 §6.1) |
| `pedido` | `pedido.pedido.recebido@1`, `pedido.pedido.aprovado@1`, `pedido.pedido.recusado@1`, `pedido.pedido.cancelado@1`, `pedido.pedido.faturado@1` (F4); payloads em `docs/desenho/T-0013.md` §8 (ADR 0007) | `faturamento.nota.autorizada@1`, `faturamento.nota.cancelada@1` |

## Envelope (platform-sdk)
`{ id: uuid, nome: "<m>.<ent>.<fato>@vN", tenant_id, agregado_id, versao, ocorrido_em (UTC), ator: usuario_id | "sistema", request_id, payload }`. Gravado na outbox (`plataforma.evento`) na mesma transação da escrita. O consumidor é idempotente por `(consumidor, evento_id)` em `plataforma.evento_consumido` e descarta `versao` menor que a última já aplicada ao agregado.

`versao` (inteiro ≥ 1) é definida pela outbox (`Outbox.gravar`), não pelo módulo: contador por `(tenant_id, agregado_id)`, para qualquer nome de evento, sem buraco e sem repetição; rollback não consome versão. O `versao` passado a `ContextoRota.publicar` está obsoleto e é ignorado; o envelope devolvido traz a versão gravada (T-0034). A forma do envelope não muda (inteiro ≥ 1), por isso sem ADR nem nova versão de contrato.

### Entrega, limite de tentativas e reentrega (T-0045, sem mudança de envelope)
- **Limite:** o despachante tenta cada evento até `MACUXIERP_OUTBOX_MAX_TENTATIVAS` (padrão 10) com backoff (10 s, 20 s... teto 1 h). Na última falha o evento vai ao estado terminal **`falhou`** sem coluna nova: `publicado_em` preenchido, `erro` começando por `falhou: ` e sem linha em `evento_consumido` para o consumidor que falhou. Sai o alerta do monitor `evento_falhou` (`evento_id`, `consumidor`) e os eventos seguintes do agregado seguem. O contador `tentativas` é do evento (dois consumidores falhando somam no mesmo).
- **Recusa definitiva não lança:** o consumidor que sabe que a repetição não muda nada (payload fora do contrato, status inválido) loga, alerta e retorna; só o erro transitório (banco, rede) lança.
- **Reentrega na partida:** consumidor ligado depois do evento publicado o recebe na partida do worker (`apps/worker/src/reentrega.ts`), desde o início, para os nomes de `EVENTOS_REENTREGA_PADRAO` (hoje `pedido.pedido.aprovado@1`). Lê só `plataforma.evento` e `plataforma.evento_consumido`; pula evento em `falhou`; idempotente por `(consumidor, evento_id)`. Quem consome um nome da lista precisa aceitar eventos antigos (conferir o estado atual do agregado antes de agir).

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
| `cadastros.tabela_preco.alterada@1` | tabela de preço | `TabelaPreco` (`id`, `nome`, `padrao`, `vigencia_inicio`, `vigencia_fim`) + `inativo`. Sai na criação e na alteração (PATCH e inativação). Consome: `integracao-fdv` (C-2 de `docs/desenho/T-0009.md` §7) |
| `cadastros.preco.alterado@1` | item da tabela | `PrecoItem` + `vigencia_inicio`, `vigencia_fim`, `inativo` |
| `cadastros.estoque.alterado@1` | `filial_id` + `produto_id` (UUID v5) | `filial_id`, `produto_id`, `quantidade` (escala 4) |
| `cadastros.condicao_pagamento.alterada@1` | condição | `CondicaoPagamento` + `inativo` |
| `cadastros.vendedor.alterado@1` | vendedor | `Vendedor` + `inativo` |
| `cadastros.carteira.alterada@1` | vendedor de destino | `de`, `para`, `cliente_ids[]`. Resumo da transferência, para auditoria (D7) |

**Campos aditivos em `CondicaoPagamento` (T-0026, D12 do `docs/desenho/T-0026.md`):** `forma_external_id` (até 64, anulável), `forma_codigo` (até 20, anulável) e `forma_nome` (até 60, anulável), ao lado do `forma_tpag` que já existe. São **opcionais e compatíveis**: o evento continua `cadastros.condicao_pagamento.alterada@1`, e o consumidor que não os conhece segue igual. Vêm da carga do `forma_pagamento.csv` do kit (a forma não é tabela própria: cada condição leva a sua). Na F2, o `integracao-fdv` publica forma e prazo ao Hub a partir desses campos, sem ler tabela.

**Campo aditivo `parcelas_cartao` em `CondicaoPagamento` (T-0015):** inteiro, opcional e anulável. O evento continua `cadastros.condicao_pagamento.alterada@1`; quem não conhece o campo o ignora. Regra: RN-CAD-09 (doc 03). Tipo: `CondicaoPagamento` de `modules/cadastros/contracts`.

### Aditivo T-0034 (sem ADR)
`cadastros.cliente.alterado@1` ganha `enderecos[].id` e `enderecos[].municipio_nome`; `cadastros.filial.alterada@1` ganha `endereco.municipio_nome` (C-1 e C-3 de `docs/desenho/T-0009.md` §7). Os campos são opcionais para o leitor e vêm nulos quando o código IBGE não está na tabela oficial. Mudança aditiva: segue `@1`.

### Aditivo C-10 (ADR 0010, sem ADR nova)
Chave do Hub e regras de troca e conflito: ADR 0010. Publica: `cadastros`. Consome: `integracao-fdv`. Mudança aditiva: segue `@1`, com recado aos consumidores.

| Evento | Campo aditivo (opcional, anulável) |
|---|---|
| `cadastros.preco.alterado@1` | `external_id` do item da tabela |
| `cadastros.produto.alterado@1` | `unidades[].external_id` |
| `cadastros.cliente.alterado@1` | `enderecos[].external_id` |
| todo `cadastros.*.alterado@1` | `external_id_anterior`: o valor de antes quando o `external_id` muda, `null` na adoção |

Trocar um `external_id` preenchido só pela ação `cadastros.external_id.trocar` (ADR 0010, item 3).

## Payloads de faturamento (v1)
Zod em `modules/faturamento/contracts/index.ts` (fonte da verdade); regras em `docs/modulos/faturamento/README.md`, "Eventos publicados".

| Evento | `agregado_id` | Payload |
|---|---|---|
| `faturamento.titulo.gerado@1` | título | `TituloGeradoPayload` (com `nota_id`). Consome: `integracao-fdv`, com leitor tolerante |
| `faturamento.titulo.baixado@1` | título | campos do `TituloGeradoPayload` + `baixado_em` (data civil) + `valor_baixado_centavos`. Motivo: C-5 de `docs/desenho/T-0009.md` §7 (§2.9). Consome: `integracao-fdv`, com leitor tolerante |

## Payloads de integracao-fdv (v1)
| Evento | `agregado_id` | Payload |
|---|---|---|
| `integracao-fdv.carga_inicial.solicitada@1` | tenant (`tenant_id`) | `{ entidades: string[] }`. Motivo: o espelho do Hub está vazio na primeira credencial ou na troca de conector (C-4). Consome: `cadastros`, com leitor tolerante (Zod local com `passthrough`, sem importar o pacote do `integracao-fdv`, ignorando entidade desconhecida), que republica os `alterado@1` do tenant pelo trabalho paginado `cadastros.carga_inicial` |

## Payloads de pedido (v1)
| Evento | `agregado_id` | Payload |
|---|---|---|
| `pedido.pedido.faturado@1` | pedido | `Base` + `ambiente` + `nota {…}` + `itens_faturados […]`. Campos em `docs/desenho/T-0013.md` §8; Zod em `modules/pedido/contracts` |

## Dependências
core ← cadastros ← (pedido, fiscal) ← faturamento; integracao-fdv ← (cadastros, pedido) e consome eventos de faturamento. Quando importar o contrato do publicador criaria ciclo de pacotes (ex.: `cadastros` lendo `faturamento.nota.autorizada@1` para baixar estoque, na F4), o consumidor valida o evento com um leitor tolerante próprio (subconjunto do payload). O publicador continua dono do schema.

## Integração externa
O único contrato com o FDV é o **Hub `/integracao/v1`** (doc 06). Nenhum módulo do ERP lê tabela do FDV.
