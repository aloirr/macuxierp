# ADR 0019 — Limites da carga iguais aos do Hub

- **Status:** Proposta (24/11/2026)
- **Data:** 24/11/2026, 06h00 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0057 (v0.3.12, cenário B). Decisão do PO de 24/11/2026: "entra nesta".
- **Amplia:** ADR 0014 (§2, contrato do Hub na `/entrada/v1`) e ADR 0010 (`external_id`).

## Contexto
O contrato `hub-v1` do SDK (`packages/platform-sdk/src/hub-v1.ts`, igual ao Hub `/integracao/v1` do FDV) aceita `external_id` com até 200 caracteres e `forma_pagamento.codigo` com até 30. A carga de CSV e o banco do `cadastros` aceitam 64 e 20 (`IdExternoValor` e `forma_codigo` em `modules/cadastros/contracts/index.ts`; `CHECK (length(external_id) <= 64)` desde a 0002 e `length(forma_codigo) <= 20` na 0010). Com a `/entrada/v1` (ADR 0014), um registro válido no Hub seria recusado aqui com `valor_fora_da_faixa`.

## Decisão
1. **Mesmo limite em todo o caminho:** carga de CSV (contracts e layout do `cadastros`), `/entrada/v1`, SDK e banco (colunas e CHECKs). O `external_id` vai até **200** e o `forma_pagamento.codigo` até **30**.
2. **Fonte única no `hub-v1` do SDK.** O `cadastros` importa de lá o `ExternalId` e o limite do código da forma, ou os trava por teste. Nenhum número solto no módulo.
3. **Quem faz:**
   - `banco-dados`: migração nova que amplia as colunas e os CHECKs (o número é dele, depois da 0045);
   - `modulo-cadastros`: contracts, layout da carga e kit;
   - `engenheiro-software`: esta ADR e a fonte no SDK (o `hub-v1` já está em 200 e 30).
4. **Regra do PO para o fechamento:** se a migração ameaçar o fechamento da v0.3.12 (19h30), ela sai para a versão seguinte, sem consulta. Até lá vale o erro por registro `valor_fora_da_faixa`.

## Consequências
- Ampliar o limite não quebra nada do que já está gravado.
- Os índices únicos por `(tenant_id, external_id)` continuam valendo (ADR 0010).
- Nenhuma mudança no FDV nem na publicação ao FDV (ADR 0013).

## Riscos
- Uma tela do BKO pode cortar o código longo na exibição. Fica com o `engenheiro-apps`, só de layout.

## Alternativas descartadas
- **Recusar por registro (opção B)** como regra definitiva: o FDV real manda `external_id` de até 200 caracteres, e o cliente perderia registros válidos no Hub.

## Referências
`packages/platform-sdk/src/hub-v1.ts` (`ExternalId`, `FormaPagamentoHub`) · a RN de cadastro que o `modulo-cadastros` indicar (pendência: o `docs/produto/03` vai até a RN-CAD-11).
