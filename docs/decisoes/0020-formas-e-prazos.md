# ADR 0020 — Formas e prazos de pagamento: prazo com prazo médio digitado e cliente com prazo médio

- **Status:** Proposta (24/11/2026)
- **Data:** 24/11/2026, 17h20 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0085 (v0.3.12). Desenho: `docs/desenho/T-0085.md`.
- **Decisões de origem (Alexandre):** R-20261124-095505, R-20261124-110213, R-20261124-111025 e R-20261124-111329. Formato do FDV: R-20261124-164445.
- **Emenda:** RN-CAD-09 (o cartão passa a ter os dias das parcelas digitados; sai o 30×N). **Amplia:** ADR 0010 (chave do Hub).

## Contexto
No ERP, a forma de pagamento não é tabela própria: cada condição de pagamento (o "prazo") leva a sua forma (`forma_tpag`, `forma_external_id`, `forma_codigo`, `forma_nome`; D12 da T-0026). O prazo tem código, descrição e `prazos_dias`. Não tem prazo médio, e o cliente aponta para uma condição só (`condicao_pagamento_id`).

O Alexandre decidiu em 24/11 que o ERP é a fonte única de formas e prazos e que o FDV só consulta:
- uma forma tem 1 ou mais prazos;
- todo prazo tem código, descrição, parcelas em dias e prazo médio, e o prazo médio é **digitado**, não calculado;
- o cliente tem só o campo prazo médio e usa os prazos com prazo médio menor ou igual ao dele.

O Hub (`/integracao/v1`) recusou 95 prazos (`tipo_invalido`, `regra_invalida`) porque `parcelas_dias` ia como texto. O lote 1 da T-0085 (PR #510) já corrigiu isso: a lista vai como inteiros.

## Decisão
1. **Forma 1:N prazo.** O prazo continua sendo a linha de `cadastros.condicao_pagamento`, e a forma continua nos campos `forma_*` da linha. Várias condições com o mesmo `forma_external_id` (ou o mesmo `forma_tpag` sem ele) formam a relação 1:N. Sem tabela nova.
2. **O prazo tem quatro campos obrigatórios na entrada:** código, descrição, parcelas em dias e prazo médio em dias.
   - As parcelas são digitadas uma a uma, com o botão "+ Parcela": de 1 a 36, com 0 a 999 dias cada. À vista é `[0]`.
   - O prazo médio é um inteiro de 0 a 999 e é digitado. O ERP **não** o calcula nem confere contra a média das parcelas.
   - Na forma à vista (tPag 01, 04 e 17), o prazo médio é 0.
   - O cartão de crédito passa a ter os dias das parcelas, como as outras formas. A notação "Nx" sai da carga.
   - Regra: **RN-CAD-15**.
3. **O cliente tem só `prazo_medio_dias`** (inteiro de 0 a 999, opcional). Sem lista de prazos liberados.
   - O cliente usa os prazos completos com prazo médio menor ou igual ao dele.
   - Cliente sem prazo médio não tem limite.
   - Exceção do cartão de crédito: emenda de 24/11, abaixo.
   - Regra: **RN-CAD-16**. A função pura `prazoPermitidoAoCliente` fica em `modules/cadastros/contracts`.
4. **O pedido revalida o prazo** (**RN-PED-07**), no pedido manual e no pedido recebido do FDV.
   - Pedido manual: a recusa é 422 com o código `RN-PED-07` e o campo `condicao_pagamento_id`.
   - Pedido recebido do FDV: emenda de 24/11, abaixo.
5. **Os eventos seguem `@1`** (mudança aditiva): `prazo_medio_dias` entra, anulável, em `cadastros.condicao_pagamento.alterada@1` e em `cadastros.cliente.alterado@1`. Ver `.coord/contratos/eventos.md`, "Aditivo T-0085".
6. **O legado fica "incompleto", sem backfill.** As condições gravadas antes da 0052 ficam com `prazo_medio_dias` nulo.
   - Prazo incompleto não sai ao FDV.
   - O pedido não aceita prazo incompleto.
   - A tela mostra o prazo como "Incompleto" até alguém digitar o prazo médio.
   - O banco não ganha `NOT NULL`: a obrigação está na entrada (contracts e API).
7. **Envio ao FDV** (formato de R-20261124-164445; o formato final vem com a ADR do FDV):
   - o `prazo_pagamento` vai com `codigo`, `forma_external_id`, `descricao`, `parcelas_dias` (lista de inteiros; à vista `[0]`) e `prazo_medio_dias`;
   - o cliente vai com `prazo_medio_max_dias` = `prazo_medio_dias` do cliente (nulo omite o campo);
   - `formas_pagamento` deixa de sair no cliente e sai do M10.
8. **Limites:** os da ADR 0019, sem mudança.

## Emenda de 24/11/2026, ~18h14 (Alexandre, via PO; doc 03 no #524)
1. **Cartão de crédito (tPag 03) fora do limite do prazo médio:** exceção na RN-CAD-16 e na RN-PED-07. `prazoPermitidoAoCliente` devolve `true` para todo prazo **completo** do cartão, qualquer que seja o prazo médio do cliente. O prazo incompleto do cartão continua recusado (RN-CAD-15).
2. **Pedido do FDV com prazo incompleto ou não permitido entra em análise** (`em_analise`), com a pendência e o motivo visíveis no BKO. Não vai a `rejeitado_erp`: o retorno ao FDV segue o fluxo da análise, aprovado ou recusado (RN-PED-02 e RN-PED-05). O pedido manual continua com o 422.

Detalhe em `docs/desenho/T-0085.md` §2.2, §5 e §6.

## Consequências
- Nenhuma tabela nova. A migração 0052 é aditiva e reexecutável: duas colunas anuláveis, um CHECK `NOT VALID` e um índice (`docs/desenho/T-0085.md` §3).
- Quem consome `@1` e não conhece o campo novo continua igual.
- O cliente que tinha `condicao_pagamento_id` mantém o campo. Ele continua sendo o prazo padrão do cliente no pedido, mas também passa pela RN-PED-07.
- O FDV recebe só prazos completos. Os prazos legados publicados antes da 0052 continuam no FDV como estavam até alguém completá-los. Quando forem completados, saem de novo, com o hash novo.

## Riscos
- **Prazo médio digitado diferente da média real** (por exemplo, 30/60/90 com prazo médio 45). É decisão do Alexandre. A tela mostra as parcelas ao lado do prazo médio.
- **Legado incompleto trava o pedido** de quem usava esses prazos. Mitigação: a tela de prazos destaca os incompletos, o pedido manual recusado (422) e o pedido do FDV em análise mostram o motivo.
- **Formato final do FDV ainda aberto.** O `PrazoPagamentoHub` muda num lote só, quando a ADR do FDV sair.

## Alternativas descartadas
- **Calcular o prazo médio** pela média das parcelas: o Alexandre decidiu pelo prazo médio digitado (R-20261124-111025).
- **Lista de prazos liberados no cliente:** o Alexandre pediu só o campo prazo médio (R-20261124-111329).
- **Backfill do prazo médio do legado** pela média das parcelas: inventaria um dado que o cliente não digitou.
- **Tabela própria de forma:** muda o schema e a carga sem ganho para a v1. A forma já viaja na condição (D12).

## Referências
`modules/cadastros/contracts/index.ts` (`CondicaoPagamentoDados`, `ClienteDados`) · `modules/integracao-fdv/contracts/hub.ts` (`PrazoPagamentoHub`, `ClienteHub`) · `docs/desenho/T-0085.md` · `.coord/contratos/eventos.md` · `docs/produto/03` (RN-CAD-15, RN-CAD-16 e RN-PED-07, a cargo do gerente).
