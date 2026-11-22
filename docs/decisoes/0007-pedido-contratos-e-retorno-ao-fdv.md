# ADR 0007 — Pedido: contratos `pedido.*@1`, entrega do pedido do FDV por porta e status de retorno ao Hub

- **Status:** aceita no desenho; a implementação vai da T-0014 à T-0017 (banco-dados, modulo-pedido, modulo-integracao-fdv e testes), com o lote do engenheiro-software
- **Data:** 21/11/2026, 22h40 (Manaus)
- **Dono:** engenheiro-software
- **Base:** `CLAUDE.md` (regras 1, 3 e 4); RN-PED-01 a 05; RN-INF-01 e 05; desenho `docs/desenho/T-0013.md`; desenho `docs/desenho/T-0009.md` (M2, M7, §7 C-8 e §9); contrato do Hub do FDV (`hub-api.md` 6.5 e as recusas do retorno; `TRANSICOES_PEDIDO_ERP` em `modules/integracao/domain/estados.ts` do `aloirr/macuxifdv`, lidos pela busca de código)
- **Muda:** a C-8 da T-0009 (o evento `integracao-fdv.pedido_fdv.recebido@1` sai; o `pedido.pedido.faturado@1` fica) e a linha "recusado → `rejeitado_erp`" da tabela de status do doc 06

## Contexto
A F3 liga o pedido ao FDV nos dois sentidos. O pedido chega pelo `GET /integracao/v1/pedidos/pendentes`, e o status volta pelo `POST /integracao/v1/pedidos/{uuid}/retorno`. O manifest do `pedido` já declara `recebido@1`, `aprovado@1`, `recusado@1` e `cancelado@1`, mas sem payload. O faturamento (F4) consome `aprovado@1`, e o manifest do `integracao-fdv` consome todos. Três pontos precisam de decisão porque fixam contrato entre módulos e com o Hub.

1. **Como o pedido do FDV chega ao módulo `pedido`.** O `integracao-fdv` grava `integracao_fdv.pedido_recebido`, e o `pedido` não lê tabela de outro schema. A T-0009 previa um evento (C-8). Com evento, o `integracao-fdv` só sabe que o pedido nasceu (ou que foi recusado) quando consome outro evento de volta.
2. **Que status volta ao Hub quando o pedido cai em análise e depois é recusado.** O doc 06 manda `integrado` para recebido, em_analise e aprovado, e `rejeitado_erp` para recusado. A máquina do Hub, porém, só aceita `rejeitado_erp` a partir de `enviado`. Depois de `integrado`, os próximos possíveis são `faturado_parcial`, `faturado_total` e `cancelado`, e qualquer outro dá 422 `transicao_invalida`, que é definitivo. O Hub também reentrega, a cada 10 min, o pedido `enviado` que ficou sem retorno, em ordem de `aprovado_em` e até o `limite` da busca.
3. **A forma dos eventos `pedido.*@1`**, que o faturamento e o `integracao-fdv` vão ler.

## Opções
**Ponto 1: entrega do pedido do FDV**
- (a) Evento `integracao-fdv.pedido_fdv.recebido@1`, consumido pelo `pedido`, que responde com `pedido.pedido.recebido@1` ou com um evento de recusa. São duas idas pela outbox: o `pedido_recebido` fica em `recebido` até o retorno, e é preciso um evento a mais só para a recusa técnica.
- (b) **Porta de comando**: o `integracao-fdv` chama `RecebedorPedidoFdv.receber(tx, entrada)` na mesma transação em que grava o `pedido_recebido`. A interface fica no `integracao-fdv/api`, com os tipos de `pedido/contracts`, e a implementação no `pedido/api`, ligada pelo `apps/worker`. O resultado (criado, repetido ou recusado com código) volta na hora.

**Ponto 2: status ao Hub**
- (a) Segurar o retorno até a decisão: `integrado` só no aprovado e `rejeitado_erp` no recusado. Segue o doc 06 ao pé da letra. Só que o pedido em análise volta a cada 10 min, e com mais de 50 em análise os antigos tomam o `limite` da busca e os novos param de chegar. O vendedor também fica sem número do ERP durante a análise.
- (b) **`integrado` no recebimento**, também quando o pedido vai para análise, como manda a tabela do doc 06 para em_analise. A recusa depois disso volta como **`cancelado`** com o motivo. `rejeitado_erp` fica só para o pedido que o ERP não consegue receber (cliente ou produto fora do espelho, contrato inválido).
- (c) Pedir ao time do FDV a transição `integrado → rejeitado_erp`. Muda o contrato do Hub, e o ERP não muda o contrato do Hub (doc 06). Sai do prazo da F3.

**Ponto 3: forma dos eventos**
- (a) Eventos magros (só ids), com o faturamento lendo o pedido por porta.
- (b) **Eventos com o status e um payload comum (`Base`)**, e `aprovado@1` "gordo" com o pedido completo, como os `alterado@1` do cadastros (D6 da T-0002). A porta `SituacaoPedidoParaFaturar` serve só para a conferência transacional na hora de emitir.

## Decisão
**Ponto 1, opção (b); ponto 2, opção (b); ponto 3, opção (b).**

1. **Porta de recebimento** `RecebedorPedidoFdv` (ponto 1): RN-PED-01, T-0013 P2.
2. **Eventos do `pedido`, versão 1** (ponto 3): Eventos pedido.pedido.{recebido,aprovado,recusado,cancelado,faturado}@1 com payload Base comum e aprovado@1 com o pedido completo; forma em T-0013 §8.
3. **Status ao Hub** (ponto 2; função pura `retornoDoPedido` do `integracao-fdv`, que consome `recebido@1`, `recusado@1`, `cancelado@1` e `faturado@1`, e não `aprovado@1`): integrado no recebimento, também em análise; recusa depois do integrado = cancelado com motivo; rejeitado_erp só quando o ERP não recebe o pedido. Tabela em T-0013 §6.2.
4. O `.coord/contratos/eventos.md` (engenheiro-software), os manifests (donos) e os textos da RN-PED-02 e do doc 06 (gerente-projetos) mudam conforme o desenho T-0013, seções 2, 6.2 e 8.

## Consequências
- O pedido do FDV nasce, ou é recusado, numa transação só. O monitor mostra `entregue` ou `rejeitado` sem estado intermediário, e o vendedor recebe o número do ERP em segundos.
- No FDV, o pedido recusado na análise aparece como **cancelado pelo ERP**, com o motivo, e não como "rejeitado". É a única forma que o Hub aceita depois de `integrado`. O vendedor vê o motivo do mesmo jeito.
- O `integracao-fdv` passa a depender, em tempo de execução, da porta do `pedido` ligada pelo `apps/worker`. No pacote, já dependia (`depende: ['core', 'cadastros', 'pedido']`), então não há ciclo.
- O faturamento tem o pedido inteiro no `aprovado@1` e não lê o schema `pedido`. O `pedido` lê os eventos de nota com leitor tolerante, porque o `faturamento` depende do `pedido`.
- Mudança incompatível em qualquer payload acima = `@2`, nova ADR e recado aos consumidores (`faturamento`, `integracao-fdv`). Campo novo opcional continua no `@1`.
- Se o FDV um dia aceitar `integrado → rejeitado_erp` (opção c), basta mudar a função `retornoDoPedido`, sem mexer nos contratos do ERP.
