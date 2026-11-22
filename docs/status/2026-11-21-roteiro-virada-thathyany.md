# Roteiro da virada da thathyany no Macuxi FDV, entidade por entidade

> Dono: gerente-projetos. Data: 21/11/2026, 23h50 (Manaus).
> Base:
> - decisões do Alexandre de 23h10 (R-20261121-230608), 23h12 e 23h22: "O TESTE É NA EMPRESA DA THATHYANY E PONTO FINAL";
> - opção B: virada entidade por entidade;
> - external_id agora (ADR 0010).
> Fonte das telas do FDV: código e docs do aloirr/macuxifdv@b75ab88, lidos pela T-0011 (conector.md, hub-api.md, topologia.ts, bko-conectores.ts). O ERP só lê o FDV e não altera nada lá.

## Como usar
- Siga as etapas na ordem. Cada etapa diz **o que fazer**, **onde** e **quando**.
- O "quando" é um aviso do gerente, que chega pelo PO com a frase **"pronto para a etapa N"**. O aviso só sai depois que o PR e o teste daquela etapa ficam verdes. Não é preciso acompanhar PR.
- Ao terminar uma etapa, mande ao PO a frase da coluna **"Devolva"**. Mais nada.
- Nenhuma etapa tem pergunta no meio. Se aparecer na tela algo que o roteiro não prevê, pare e mande ao PO o texto da tela.

## Regra que vale para todas as entidades
No FDV, **cada entidade tem um único Conector dono** (RN-INT-13 do FDV). Para uma entidade passar do kit para o ERP, a ordem é sempre esta:
1. Desligar a entidade no kit, nos dois lugares:
   - no arquivo `conector.json` do kit, na máquina onde o kit roda;
   - no BKO do FDV.
2. Só depois, ligar a entidade no Conector do ERP.

A ordem inversa dá o erro **409 topologia_conflitante** e nada muda.

A partir da virada de uma entidade, **essa entidade passa a ser mantida no Macuxi ERP**: por exemplo, o preço é alterado no ERP, e não mais no sistema antigo. O kit para de mandar só aquela entidade; as outras continuam normais.

## Etapa 0 — Criar o Conector do ERP (pode ser feita agora)
O FDV não aceita um Conector sem entidades: com o campo em branco, ele nasce com as 8 entidades padrão e dá 409 contra o kit. Por isso o Conector do ERP já nasce com `forma_pagamento`, depois que ela sai do kit.

| # | Onde | O que fazer |
|---|---|---|
| 0.1 | Máquina do kit | No `conector.json` do kit, desative `forma_pagamento`. |
| 0.2 | BKO do FDV, empresa thathyany, perfil administrador > **Integração ERP > Conectores** > Conector do **kit** | Desmarque `forma_pagamento` e salve. |
| 0.3 | BKO do FDV > **Integração ERP > Conectores > Novo Conector** | Preencha:<br>- identificador: `macuxierp`;<br>- nome: `Macuxi ERP (nuvem)`;<br>- **tipo: nuvem**;<br>- **recebe pedidos: DESMARCADO**;<br>- aceita cancelamento: desmarcado;<br>- **entidades: só `forma_pagamento`**. |
| 0.4 | Ao salvar | A chave `mxc_…` aparece **uma única vez**. **Não copie a chave para chat, recado ou e-mail.** Deixe a tela aberta. |
| 0.5 | Claude (formulário seguro) | Avise o PO (veja "Devolva" abaixo). O gerente abre o formulário seguro do ambiente MacuxiERP-GP para `api.macuxifdv.com.br` (Authorization: Bearer). Digite a chave **só no formulário**. Se a chave se perder, use **Rotacionar chave** no Conector; a chave anterior ainda vale por 24 h. |

Até o ERP entrar em produção (Etapa 1), `forma_pagamento` fica parada no Hub: o app dos vendedores continua com as formas que já estão lá, porque nada é inativado.

**Devolva:** `Conector criado: macuxierp` (o identificador não é segredo). Depois do formulário: `chave gravada`.

> **Etapa 0 CONCLUÍDA em 22/11, 02h06 (Manaus):** o Conector novo do ERP no Hub do FDV é `macuxierp` (só `forma_pagamento`, "recebe pedidos" desmarcado), com a chave gravada pelo formulário seguro no ambiente do gerente (substituiu a do kit). Leitura de teste `GET /integracao/v1/cursores/forma_pagamento`: HTTP 200, sem cursor (Conector novo). Nada foi enviado. A confirmar com o Alexandre: o kit segue com a chave do Conector dele (`thathyany-conector`), só com `forma_pagamento` desligada. Próximo: Etapa 1.

## Etapa 1 — Pré-requisitos do lado do ERP (sem ação no FDV)
A virada só funciona com o ERP em produção e com os dados da thathyany carregados nele, porque o Conector do ERP publica o que está no banco do ERP.

| # | O que é | Quem faz |
|---|---|---|
| 1.1 | `.env` de produção, secrets do GitHub, DNS e rota `erp.macuxifdv.com.br` (lista em `docs/status/2026-11-21-decisoes-alexandre.md`, seção 2) | Alexandre |
| 1.2 | Deploy, com a frase **"aprovo deploy vX.Y.Z"**. O pedido de deploy vem pronto do gerente pelo PO: versão, SHA, suíte verde e issue. | Alexandre, quando o pedido chegar |
| 1.2b | Logo depois do deploy (que aplica a migração 0019), na tela de condições de pagamento do ERP, a ação **Desativar formas recusadas** (`POST /condicoes-pagamento/desativar-formas-recusadas`, só administrador) em cada empresa. Até isso rodar, editar uma condição antiga de cartão sem parcelas dá erro. | administrador da empresa no ERP |
| 1.3 | Carga dos CSVs do kit da thathyany pela tela **Cadastros > Carga** do ERP, já em produção (T-0026). Os external_id do kit ficam guardados no ERP. | Alexandre ou thathyany, no ERP |
| 1.4 | No ERP, tela **Integração FDV**: identificador `macuxierp`, ambiente de produção e entidades habilitadas: nenhuma | gerente (pelo time), depois do 1.2 |

**Devolva:** `carga da thathyany feita no ERP` (depois do 1.3).

## Etapas 2 a 7 — Cadastros, do menor risco ao maior
Os passos são os mesmos em todas essas etapas. Troque `<entidade>` pelo nome da tabela abaixo.

| Passo | Onde | O que fazer |
|---|---|---|
| a | Máquina do kit | No `conector.json` do kit, desative `<entidade>`. |
| b | BKO do FDV > Integração ERP > Conectores > Conector do **kit** | Desmarque `<entidade>` e salve. |
| c | BKO do FDV > Integração ERP > Conectores > Conector **macuxierp** | Marque `<entidade>` e salve. |
| d | — | Mande ao PO: `virada <entidade> feita`. O ERP faz a primeira carga completa em lotes pequenos, de 50 registros, com os mesmos external_id do kit. |
| e | BKO do FDV > Integração ERP > **Inativações** | Se aparecer uma pendência de inativação da `<entidade>`, **RECUSE** e mande ao PO: `inativação recusada em <entidade>`. O Hub segura sozinho qualquer inativação acima de 30%. Com os mesmos external_id, o esperado é não aparecer nada. |
| f | — | O gerente confere no monitor do Hub e no ERP. Pelo PO, ele manda "pronto para a etapa seguinte" ou o motivo para parar. |

| Etapa | Entidade(s) | Quando ("pronto para a etapa N") | A partir daí, mantida no ERP |
|---|---|---|---|
| 2 | `forma_pagamento`: os passos a a c já foram feitos na Etapa 0; ficam d a f (primeira carga e conferência) | Depois de: L2 e L3 do conector (T-0011), ADR 0010 e migração 0015 no main; T-0012 verde no dublê; deploy com o conector ligado; Etapas 0 e 1 feitas. | formas de pagamento |
| 3 | `prazo_pagamento` | Etapa 2 conferida | condições e prazos |
| 4 | `filial` e depois `vendedor`. O vendedor exige a filial. | Etapa 3 conferida | filiais, equipe e carteira |
| 5 | `produto` e depois `produto_unidade` | Etapa 4 conferida | cadastro de produtos |
| 6 | `preco` | Etapa 5 conferida | tabelas de preço |
| 7 | `cliente` e depois `cliente_endereco` | Etapa 6 conferida | cadastro de clientes |

## Etapa 8 — Estoque, títulos e notas (junto com a produção fiscal, F5)
Estoque, títulos e notas nascem do faturamento. Enquanto a thathyany faturar no sistema antigo, essas três entidades ficam no kit; se mudassem antes, o estoque e os títulos ficariam parados.

| Etapa | Entidade(s) | Quando |
|---|---|---|
| 8 | `estoque`, `titulo` e `nota` (mesmos passos a até f) | Depois da homologação real (T-0046) e da frase **"aprovo produção fiscal thathyany"**, no dia em que a thathyany começar a faturar pelo ERP |

## Etapa 9 — Pedidos (virada final, T-0027)
| # | Onde | O que fazer |
|---|---|---|
| 9.0 | — | Quando: depois da Etapa 8, com a T-0017 verde. Num horário sem vendedor em campo. |
| 9.1 | BKO do FDV | Confira que não há pedido do kit sem retorno: todos estão `integrado` ou `rejeitado_erp`. |
| 9.2 | Conector do **kit** | Desmarque **recebe pedidos** e salve. |
| 9.3 | Conector **macuxierp** | Marque **recebe pedidos** e salve. Na v1, um só Conector por empresa recebe pedidos. |
| 9.4 | — | Mande ao PO: `virada de pedidos feita`. O ERP passa a buscar os pedidos aprovados. Um pedido sem retorno volta à fila em 10 min, e o ERP não duplica (RN-PED-01). |

## Conferido pelo time no código do FDV (22/11, 00h00)
A T-0011 conferiu por busca de código no aloirr/macuxifdv:
- **Tipo:** `nuvem` (`TIPOS_CONECTOR = ['conector', 'nuvem', 'arquivo']`). O tipo `conector` é o serviço on-premise e o `arquivo` é o portal de CSV.
- **Entidades:** o Conector precisa de pelo menos 1 entidade (`check cardinality(entidades) >= 1`). Daí a Etapa 0 acima.
- **Inativação da carga completa:** conta só os registros do próprio Conector (`registro_atual ... conector_id = $3`). A chave do registro é da empresa, `(tenant_id, entidade, external_id)`. Com os mesmos external_id do kit, o ERP atualiza o mesmo registro e não duplica. O que o ERP não mandar fica ativo, com o Conector do kit.
- **Fila de pedidos:** é da empresa, por `(tenant, pedido_uuid)`, e só é entregue a um Conector com "recebe pedidos". Na Etapa 9, os pedidos pendentes passam ao ERP.
