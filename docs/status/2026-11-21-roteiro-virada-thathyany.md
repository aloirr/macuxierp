# Roteiro da virada da thathyany para o Macuxi ERP (replanejado em 22/11, 02h15)

> Dono: gerente-projetos. Primeira versão: 21/11/2026, 23h50 (Manaus). Replanejado em 22/11, 02h15 (Manaus).
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

## Fase A — o mínimo para voltar a receber pedidos
| # | O que | Quem | Previsão (Manaus) | Devolva |
|---|---|---|---|---|
| A1 | Secrets do GitHub, `.env` de produção, VM e banco, DNS e rota `erp.macuxifdv.com.br` (lista abaixo) | Alexandre | 02h30 → 03h30 | `infra pronta` |
| A2 | **Deploy 1** (o main do dia): `producao-liberar` com a suíte completa → issue → **"aprovo deploy vX.Y.Z"** → publicar. O pacote vem pronto do gerente pelo PO. | gerente e engenheiro; a frase é do Alexandre | 03h30 → 04h15 | a frase |
| A3 | Carga dos CSVs do kit pela tela **Cadastros > Carga** (os external_id do kit ficam guardados). Depois, **Desativar formas recusadas** em cada empresa (administrador). O gerente confere. | Alexandre ou thathyany | 04h15 → 05h15 | `carga da thathyany feita no ERP` |
| A4 | Código, em paralelo desde já: L3a da T-0011 (rotas C-7 de configuração do Conector), o integracao-fdv montado na API (R-013902) e a tela Integração FDV, com a validação do design-de-marca | T-0011, engenheiro, engenheiro-apps | 02h15 → 06h45 | — |
| A5 | **Deploy 2** com o A4 | gerente; a frase é do Alexandre | 06h45 → 07h45 | a frase |
| A6 | Tela **Integração FDV** do ERP: identificador `macuxierp`, ambiente produção e a chave `mxc_…` digitada **só ali**. Se a chave se perdeu: **Rotacionar chave** no Conector `macuxierp` do BKO do FDV (a antiga vale 24 h). O botão **Testar conexão** tem de dar certo. | Alexandre | 07h45 → 08h00 | `conector configurado no ERP` |
| A7 | **Primeiro envio real: pedidos** (com o ok do PO). No `.env`, `MACUXIERP_FDV_RECEBIMENTO=ligado`, e reiniciar o worker. Os pedidos da fila chegam ao ERP, que não duplica (RN-PED-01) e devolve o status ao FDV. | o PO aprova; o Alexandre liga | 08h00 → 08h30 | `recebimento ligado` |

## Fase B — publicar os cadastros, uma entidade por vez
**Passos de cada linha:**
1. Ok do PO ("primeiro envio real: `<entidade>`").
2. O gerente habilita a entidade na tela Integração FDV do ERP.
3. O ERP faz a primeira carga completa em lotes de 50, com os mesmos external_id do kit.
4. Em **Integração ERP > Inativações**, no BKO do FDV:
   - se aparecer uma pendência dessa entidade, **RECUSE**;
   - mande ao PO: `inativação recusada em <entidade>`.
   O Hub segura sozinho qualquer inativação acima de 30%.
5. O gerente confere no monitor do Hub e no ERP, e manda pelo PO "pronto para a seguinte".

| # | Entidade(s) | Previsão | A partir daí, mantida no ERP |
|---|---|---|---|
| B1 | `forma_pagamento` e `prazo_pagamento` | 08h30 → 09h15 | formas e condições |
| B2 | `filial` e depois `vendedor` | 09h15 → 10h00 | filiais, equipe e carteira |
| B3 | `produto` e depois `produto_unidade` | 10h00 → 10h45 | produtos |
| B4 | `preco` | 10h45 → 11h15 | tabelas de preço |
| B5 | `cliente` e depois `cliente_endereco` | 11h15 → 12h00 | clientes |

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

## Lista do Alexandre para a A1 (só nomes; valores nunca em chat, recado ou repositório)
1. **Secrets do GitHub** (`aloirr/macuxierp` > Settings > Secrets and variables > Actions): os da seção 2.1 de `docs/status/2026-11-21-decisoes-alexandre.md`.
2. **VM e DBaaS:**
   - rodar o `preparar-vm.sh` da T-0024 (`/opt/macuxierp` e a trava);
   - criar o banco `macuxierp` e os papéis `macuxierp_app`, `macuxierp_worker` e `macuxierp_leitura`.
3. **`/opt/macuxierp/.env`** (modo 600), pelo `env.modelo` da T-0024:
   - `MACUXIERP_BANCO`;
   - `MACUXIERP_CHAVE_A1`: `openssl rand -hex 32`. Guarde fora do servidor: se ela se perder, o A1 cifrado não abre mais;
   - `MACUXIERP_CHAVE_INTEGRACAO`: outra chave, também com `openssl rand -hex 32`. Ela cifra a chave do Conector;
   - `MACUXIERP_JWT_SEGREDO`;
   - `MACUXIERP_HUB_URL_PRODUCAO` e `MACUXIERP_HUB_URL_TESTE` (o engenheiro confirma os valores);
   - `MACUXIERP_FDV_RECEBIMENTO=desligado`, que só vira `ligado` na A7;
   - a configuração com padrão no modelo, mais S3 e SMTP.
4. **Cloudflare:** o hostname público `erp.macuxifdv.com.br` no túnel do FDV:
   - `/v1` → `macuxierp-api`;
   - o resto → `macuxierp-web`.

## Conferido pelo time no código do FDV (22/11, 00h00)
A T-0011 conferiu por busca de código no aloirr/macuxifdv:
- **Tipo:** `nuvem` (`TIPOS_CONECTOR = ['conector', 'nuvem', 'arquivo']`). O tipo `conector` é o serviço on-premise e o `arquivo` é o portal de CSV.
- **Entidades:** o Conector precisa de pelo menos 1 entidade (`check cardinality(entidades) >= 1`). Daí a Etapa 0 acima.
- **Inativação da carga completa:** conta só os registros do próprio Conector (`registro_atual ... conector_id = $3`). A chave do registro é da empresa, `(tenant_id, entidade, external_id)`. Com os mesmos external_id do kit, o ERP atualiza o mesmo registro e não duplica. O que o ERP não mandar fica ativo, com o Conector do kit.
- **Fila de pedidos:** é da empresa, por `(tenant, pedido_uuid)`, e só é entregue a um Conector com "recebe pedidos". Na Etapa 9, os pedidos pendentes passam ao ERP.
