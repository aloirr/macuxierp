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
| # | Onde | O que fazer |
|---|---|---|
| 0.1 | BKO do FDV, empresa thathyany, perfil administrador | Abra **Integração ERP > Conectores > Novo Conector**. |
| 0.2 | Cadastro do Conector | Preencha:<br>- identificador: `macuxierp`;<br>- nome: `Macuxi ERP (nuvem)`;<br>- tipo: API direta;<br>- **recebe pedidos: DESMARCADO**;<br>- aceita cancelamento: desmarcado;<br>- **entidades: nenhuma**. Se a tela não aceitar a lista vazia, marque só `forma_pagamento` e faça antes os passos 2.1 e 2.2 da Etapa 2. |
| 0.3 | Ao salvar | A chave `mxc_…` aparece **uma única vez**. **Não copie a chave para chat, recado nem e-mail.** Deixe a tela aberta. |
| 0.4 | Claude (formulário seguro) | Avise o PO com a frase da coluna "Devolva". O gerente abre o formulário seguro do ambiente MacuxiERP-GP para `api.macuxifdv.com.br` (Authorization: Bearer). Digite a chave **só no formulário**. Se a chave se perder, use **Rotacionar chave** no Conector; a chave anterior continua valendo por 24 h. |

**Devolva:** `Conector criado: macuxierp` (o identificador não é segredo). Depois do formulário: `chave gravada`.

## Etapa 1 — Pré-requisitos do lado do ERP (sem ação no FDV)
A virada só funciona com o ERP em produção e com os dados da thathyany carregados nele, porque o Conector do ERP publica o que está no banco do ERP.

| # | O que é | Quem faz |
|---|---|---|
| 1.1 | `.env` de produção, secrets do GitHub, DNS e rota `erp.macuxifdv.com.br` (lista em `docs/status/2026-11-21-decisoes-alexandre.md`, seção 2) | Alexandre |
| 1.2 | Deploy, com a frase **"aprovo deploy vX.Y.Z"**. O pedido de deploy vem pronto do gerente pelo PO: versão, SHA, suíte verde e issue. | Alexandre, quando o pedido chegar |
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
| 2 | `forma_pagamento` | Depois de: L2 e L3 do conector (T-0011), ADR 0010 e migração 0015 no main; T-0012 verde no dublê; deploy com o conector ligado; Etapas 0 e 1 feitas. | formas de pagamento |
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

## O que o time confere antes da Etapa 2 (sem pergunta ao Alexandre)
O time do ERP confere no código do FDV, antes de pedir a Etapa 2, os pontos que o código não diz com todas as letras:
- o valor do tipo "API direta" no cadastro;
- se o BKO aceita um Conector sem entidades;
- se a inativação da carga completa conta só os registros daquele Conector ou todos os da entidade;
- se a fila de pedidos pendentes é da empresa ou do Conector.
Se algum ponto mudar um passo, o roteiro é corrigido antes do aviso "pronto para a etapa 2".
