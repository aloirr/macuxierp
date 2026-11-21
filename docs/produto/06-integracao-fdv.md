# 06 — Integração com o Macuxi FDV

> O ERP é a **fonte da verdade** dos cadastros e do faturamento. Ele faz o papel do **Conector** do FDV, mas como **conector nativo na nuvem**, sem Conector on-premise. Fala com o FDV **só pela API do Hub** (`/integracao/v1`), no **contrato canônico do doc 06 do FDV** (`aloirr/macuxifdv`, `docs/produto/06-integracao-erp.md` e `docs/modulos/integracao/hub-api.md`). Nunca lê tabela do FDV.
> Dono: modulo-integracao-fdv. Contrato do lado do FDV: modulo-integracao do FDV (mudança lá é pedido por recado do Alexandre ao time do FDV, nunca alteração deste time).

## Fluxos
```
ERP (eventos cadastros.*, faturamento.*) ─outbox─► worker ──POST /integracao/v1/lotes (Idempotency-Key)──► Hub do FDV ──► apps do FDV
ERP worker ──GET /integracao/v1/pedidos/pendentes──► Hub ◄── pedidos aprovados no FDV
ERP worker ──POST /integracao/v1/pedidos/{uuid}/retorno (nº ERP, status, nota)──► Hub
ERP worker ──POST /integracao/v1/sinal (1 min)──► Hub   (monitor do FDV: conector vivo)
```

## Credencial e cabeçalhos
- Um **conector** cadastrado no FDV por empresa (tenant do FDV), com `recebe_pedidos = true`. A chave é criada no BKO do FDV pelo admin da empresa e colada no BKO do ERP (tela Integração FDV), que a guarda **cifrada** por tenant.
- Toda chamada: `Authorization: Bearer <chave>`, `X-Macuxi-Conector-Id: <id>`, `X-Macuxi-Conector-Versao: <versão do ERP>`, `User-Agent: macuxierp/<versão>`.
- Respeita `Retry-After` (429/503) e a política de versão do Hub (426 pausa só a entidade).

## Entidades publicadas (ERP → FDV)
Ordem de dependência do Hub: **filial → vendedor → (forma e prazo de pagamento) → produto → produto_unidade → preço → estoque → cliente → cliente_endereco → título → nota**.

| Entidade do Hub | Origem no ERP | Gatilho | Observação |
|---|---|---|---|
| `filial` | `cadastros.filial` | `cadastros.filial.alterada@1` | vem antes de tudo |
| `vendedor` | `cadastros.vendedor` | `cadastros.vendedor.alterado@1` | vendedores do FDV cadastrados no ERP |
| `forma_pagamento`, `prazo_pagamento` | `cadastros.condicao_pagamento` | `cadastros.condicao_pagamento.alterada@1` | substituem "condição de pagamento" no FDV |
| `produto`, `produto_unidade` | `cadastros.produto` | `cadastros.produto.alterado@1` | custo nunca vai ao app do FDV (o Hub já filtra) |
| `preco` | `cadastros.tabela_preco_item` | `cadastros.preco.alterado@1` | com `filial_external_id` |
| `estoque` | `cadastros.estoque_saldo` | `cadastros.estoque.alterado@1` | só saldo |
| `cliente`, `cliente_endereco` | `cadastros.cliente` | `cadastros.cliente.alterado@1` | com `filial_external_id` e o vendedor da **carteira** |
| `titulo` | `faturamento.titulo` | `faturamento.titulo.gerado@1` | abertos + baixados recentes |
| `nota` | `faturamento.nota` | `faturamento.nota.autorizada@1` / `cancelada@1` | só notas de **produção** (RN-FAT-04) |

- **Carteira:** no contrato do FDV ela vai no cliente (vendedor responsável). Se o FDV exigir entidade própria, o pedido vai por recado do Alexandre ao time do FDV — o ERP não muda o contrato do Hub.
- Lotes de até 5.000 registros; carga inicial **completa** por entidade (cursor nulo no Hub) e depois **delta**.
- **Idempotência:** `external_id` = UUID do registro no ERP; `Idempotency-Key` = hash do conteúdo canônico do lote + geração. Reenvio com o mesmo conteúdo não muda nada no Hub (`Idempotent-Replay: true`).
- Resultado do lote (`GET /integracao/v1/lotes/{id}`) guardado em `integracao_fdv.lote_envio` e `lote_erro`, sem o valor do dado pessoal.

## Pedidos (FDV → ERP) e retorno (ERP → FDV)
1. A cada 1–2 min o worker chama `GET /integracao/v1/pedidos/pendentes?limite=50`.
2. Cada pedido vira `pedido.pedido` com `external_id` = `pedido_uuid` do FDV (RN-PED-01: idempotente; o Hub reenvia o pedido `enviado` há ≥ 10 min sem retorno).
3. O ERP devolve `POST /integracao/v1/pedidos/{uuid}/retorno` com `status` (`integrado`, `rejeitado_erp`, `faturado_parcial`, `faturado_total`, `cancelado`), `numero_erp`, `motivo`, `nota` (número, série, chave) e `itens_faturados` quando faturar.

| Status no ERP | Retorno ao Hub |
|---|---|
| recebido / em_analise / aprovado | `integrado` (com `numero_erp`) |
| recusado | `rejeitado_erp` (com `motivo`) |
| faturado_parcial | `faturado_parcial` (nota + itens) |
| faturado | `faturado_total` (nota + itens) |
| cancelado | `cancelado` |

## Resiliência e monitor
- Fila no worker (outbox) com retentativa e backoff (5 s, 10 s, 20 s… até 15 min), como no FDV (ADR 0007 do FDV).
- Sinal de vida a cada 1 min (`POST /integracao/v1/sinal`), sem dado pessoal.
- Reconciliação diária por contagem (`POST /integracao/v1/reconciliacoes`) por entidade.
- Monitor no BKO do ERP: último envio por entidade, erros por linha, fila, último sinal aceito.

## Ambiente de teste (F2/F3)
Um **tenant de teste no FDV** com conector próprio; o ERP aponta para ele na homologação. Pronto da F2: o tenant recebe tudo sem erro e o reenvio não duplica nada.
