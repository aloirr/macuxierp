# Roteiro da virada da thathyany para o Macuxi ERP (replanejado em 22/11, 02h15)

> Dono: gerente-projetos. Primeira versão: 21/11/2026, 23h50 (Manaus). Replanejado em 22/11, 02h15 e 02h25 (Manaus).
> Motivo do replanejamento (via PO, 22/11, ~02h00): o Alexandre **desativou o Conector do kit** ("Esqueca o conector da thathyany, ja desative. Agora é so via api nuvem") e **ativou todos os módulos no Conector `macuxierp`** ("Todos os modulos estao ativos na api. Vai enviar tudo"). Não existe mais o passo "desligar no kit".
> Base que segue valendo: teste na empresa da thathyany (R-20261121-230608); external_id do kit preservados (ADR 0010); decisões das formas de pagamento.
> Fonte das telas do FDV: código e docs do aloirr/macuxifdv@b75ab88, lidos pela T-0011. O ERP só lê o FDV e não altera nada lá.

## Trava em vigor (desde 22/11, 02h08, R-20261122-020834-gerente-projetos)
**Proibida qualquer escrita no Hub real com a chave do `macuxierp`:**
- `POST /integracao/v1/lotes`;
- `GET /integracao/v1/pedidos/pendentes` (marca o pedido como enviado);
- qualquer retorno de status.

**A trava cai só com as três condições juntas:**
1. ERP em produção;
2. carga da thathyany conferida;
3. ok do PO, que leva a primeira carga ao Alexandre.

**Durante a trava:**
- testes só contra o dublê;
- leitura de cursor (`GET /integracao/v1/cursores/{entidade}`) permitida.

Cada **primeiro envio real** abaixo é uma etapa própria, que só começa com o ok do PO.

## Situação em 22/11, 02h15
- **Pedidos:** os pedidos dos vendedores ficam na fila do Hub, por empresa, e não se perdem. Até a Fase A terminar, ninguém os recebe.
- **Cadastros:** ficam congelados no app até a Fase B. Preço, cliente, produto, estoque e títulos deixam de atualizar, e nada é inativado.
- **BKO do FDV:** nada a mudar. O `macuxierp` fica com todas as entidades e, se estiver marcado, com "recebe pedidos". A confirmar com o Alexandre, pela tela: "recebe pedidos" está marcado no `macuxierp`?

## Como usar
- Siga as etapas na ordem. O aviso "pronto para a etapa X" chega pelo PO, depois que o PR e o teste daquela etapa ficam verdes.
- Ao terminar, mande ao PO a frase da coluna **Devolva**.
- Se a tela mostrar algo que o roteiro não prevê, pare e mande ao PO o texto da tela.

## Fase A — o mínimo para voltar a receber pedidos (versão de 02h25, com o deploy automatizado: R-20261122-021030-alexandre)
| # | O que | Quem | Previsão (Manaus) | Devolva |
|---|---|---|---|---|
| A1 | Só os 3 secrets do GitHub (`PROD_SSH_KEY`, `PROD_HOST`, `PROD_USER`) e a rota `erp.macuxifdv.com.br` no túnel do FDV (`/v1` → `macuxierp-api:8100`; o resto → `macuxierp-web`) | Alexandre (~10 min) | antes das 04h30 | `secrets e rota feitos` |
| A2 | Código, em paralelo: L3 (#170 e #171, no main), plugin do conector na API (R-013902), tela Integração FDV (com a validação do design-de-marca), variáveis do conector com envio e recebimento desligados, e a automação do deploy (PR de governança, com "autorizo o merge do PR #N no commit <sha>" levado pelo PO) | engenheiro (2 sessões), engenheiro-apps | 02h20 → 04h30 | — |
| A3 | **Deploy v0.1.0**: suíte completa no SHA congelado → `producao-liberar` → **"aprovo deploy v0.1.0"** (pelo PO) → publicar. O deploy prepara a VM, o banco, os papéis e o `.env` (chaves geradas na VM uma vez só, sem log; banco e S3 do FDV reaproveitados na VM; SMTP e alerta desligados). Envio e recebimento desligados no código e endereço do Hub vazio. 1 h de folga para o primeiro uso. | gerente e engenheiro; a frase é do PO | 04h30 → 06h15 | — |
| A4 | Carga dos CSVs do kit pela tela **Cadastros > Carga** (o time não tem os CSVs; eles não passam por chat nem recado). Depois, **Desativar formas recusadas** em cada empresa. O gerente confere. | Alexandre | 06h15 → 07h00 | `carga da thathyany feita no ERP` |
| A5 | Tela **Integração FDV**: identificador `macuxierp`, ambiente produção e a chave `mxc_…` digitada **só ali**. Se a chave se perdeu: **Rotacionar chave** no BKO do FDV (a antiga vale 24 h). | Alexandre | 07h00 → 07h15 | `chave gravada no ERP` |
| A6 | **Primeiro envio real: pedidos** (com o ok do PO). PR pequeno e deploy **v0.1.1**: endereço do Hub, recebimento LIGADO e envio ligado **sem nenhuma entidade habilitada**. Os pedidos da fila chegam ao ERP, que não duplica (RN-PED-01) e devolve "integrado" ao FDV. | o PO aprova o PR e o deploy | 07h15 → 08h00 | — |

## Fase B — publicar os cadastros, uma entidade por vez
**Passos de cada linha:**
1. Ok do PO ("primeiro envio real: `<entidade>`").
2. A entidade é habilitada na tela Integração FDV do ERP (Configuração > entidades habilitadas).
3. O ERP faz a primeira carga completa em lotes de 50, com os mesmos external_id do kit.
4. Em **Integração ERP > Inativações**, no BKO do FDV:
   - se aparecer uma pendência dessa entidade, **RECUSE**;
   - mande ao PO: `inativação recusada em <entidade>`.
   O Hub segura sozinho qualquer inativação acima de 30%.
5. O gerente confere no monitor do Hub e no ERP, e manda pelo PO "pronto para a seguinte".

| # | Entidade(s) | Previsão | A partir daí, mantida no ERP |
|---|---|---|---|
| B1 | `forma_pagamento` e `prazo_pagamento` | 08h00 → 08h45 | formas e condições |
| B2 | `filial` e depois `vendedor` | 08h45 → 09h30 | filiais, equipe e carteira |
| B3 | `produto` | 09h30 → 10h00 | produtos |
| B4 | `cliente` (a carteira vai dentro) | 10h00 → 10h30 | clientes |
| B5 | `produto_unidade`, `preco` e `cliente_endereco` | depois da C-10 no cadastros (os eventos ainda levam o código do ERP, e não a chave do kit: ADR 0010); previsão do cadastros a confirmar | unidades, preços e endereços |

## Fase C — estoque, títulos e notas
Nascem do faturamento do ERP. Por isso, só entram com a F5:
- homologação real (T-0046), com o A1 e o credenciamento da thathyany;
- a frase **"aprovo produção fiscal thathyany"**.
Os passos são os mesmos da Fase B. Até lá, estoque e títulos ficam congelados no app.

## Decisões em aberto com o Alexandre (levadas pelo PO em 22/11, 02h15)
**a) Pedidos até a A7 (cerca de 08h30).**
- Opção 1: seguem na fila do Hub.
- Opção 2: religar só o "recebe pedidos" do kit até a A7.

**b) Faturamento até a F5.** Os pedidos recebidos no ERP não chegam ao sistema antigo.
- Opção 1: digitar no sistema antigo a partir da tela de pedidos do ERP.
- Opção 2: o kit fica com pedidos, estoque, títulos e notas até a F5, e o ERP fica só com a Fase B.

**c) Estoque e títulos congelados no app até a F5,** se a resposta de (b) for a Opção 1.

## O que o Alexandre faz (R-20261122-021030-alexandre)
1. Os 3 secrets: `PROD_SSH_KEY`, `PROD_HOST` e `PROD_USER`.
2. A rota `erp.macuxifdv.com.br` no túnel do FDV.
3. Os CSVs do kit, pela tela de carga do ERP (A4).
4. A chave `mxc_…`, na tela Integração FDV (A5).

Todo o resto é automático pelo deploy. As frases de governança e de deploy saem pelo PO.

## Conferido pelo time no código do FDV (22/11, 00h00)
A T-0011 conferiu por busca de código no aloirr/macuxifdv:
- **Tipo:** `nuvem` (`TIPOS_CONECTOR = ['conector', 'nuvem', 'arquivo']`). O tipo `conector` é o serviço on-premise e o `arquivo` é o portal de CSV.
- **Entidades:** o Conector precisa de pelo menos 1 entidade (`check cardinality(entidades) >= 1`). Daí a Etapa 0 acima.
- **Inativação da carga completa:** conta só os registros do próprio Conector (`registro_atual ... conector_id = $3`). A chave do registro é da empresa, `(tenant_id, entidade, external_id)`. Com os mesmos external_id do kit, o ERP atualiza o mesmo registro e não duplica. O que o ERP não mandar fica ativo, com o Conector do kit.
- **Fila de pedidos:** é da empresa, por `(tenant, pedido_uuid)`, e só é entregue a um Conector com "recebe pedidos". Na Etapa 9, os pedidos pendentes passam ao ERP.
