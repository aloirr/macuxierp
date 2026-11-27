# T-0057 — roteiro da sessão "Thathyany simulada" (API de entrada `/entrada/v1`)

> Autor: `testes` · criado em 26/11/2026, 21h15 (Manaus) · revisto em 27/11/2026, 00h13 (Manaus), com o código do `main` cccc4f2 (E1 #747, C1/C2 #748, E2 #749, C3/C4 #763, E3 #764) · branch `nuvem/t0057-testes`.
> Base: ADR 0014 §1 a §4 (`docs/decisoes/0014-cenario-b-entrada-de-dados.md`), roteiro da VM (`docs/banco/vm-cenario-b.md`) e decisões 33 B e 34 B do Alexandre (R-20261126-210816-alexandre): **só delta**; a carga completa responde **422 `CARGA_COMPLETA_NAO_SUPORTADA`**; a trava de 30% (RN-INT-06), o Conector on-premise, as colunas "via Conector/via API" e a mão dupla ficam para depois.
> **Status:** pronto para rodar depois da migração 0072 (GRANTs do `macuxierp_worker` para gravar os cadastros; sem ela, toda linha que o worker grava sai `falha_processamento`). O teste automático equivalente é `tests/ponta-a-ponta-fdv/entrada-v1.db.test.ts`, com o código de produção de ponta a ponta. Quatro defeitos conhecidos (recados ao gerente de 27/11/2026, 00h09 e 00h12), que este roteiro contorna e marca:
> - **D1:** filial nova não entra pela entrada (o `FilialHub` não tem `crt`);
> - **D2:** produto novo não entra (o `ProdutoHub` não tem NCM, RN-CAD-04);
> - **D3:** o 1º prazo de uma forma nova não entra (o lote de formas não grava, e o prazo busca a forma numa condição que já existe);
> - **D4:** registro mais antigo que o gravado é aplicado e faz o cursor voltar, em vez de contar como `obsoletas`.

## 1. Objetivo

Uma sessão faz o papel do ERP da Thathyany chamando direto a `/entrada/v1` (o "via API" da ADR 0014 §4), com `curl`, contra o ERP (local ou de produção, na empresa de teste indicada pelo gerente). Ela prova, com **dados fictícios**, que:

1. os 10 cadastros da F2 entram por lote delta e aparecem no ERP e, para o tenant com o `integracao-fdv`, saem ao Hub do FDV como os cadastrados pelo BKO;
2. a `Idempotency-Key` segura o reenvio (mesma chave e mesmo corpo = mesmo lote; outro corpo = 409);
3. o resultado do lote e o cursor por entidade dizem ao cliente de onde continuar;
4. a carga completa é recusada com 422, sem lote;
5. nada de chave, corpo ou dado pessoal aparece em log ou na resposta.

**Não é:** carga do banco real da Thathyany, teste do Conector on-premise nem da VM do SQL Server.

## 2. Preparação

| Item | Como |
|---|---|
| Base | `BASE=https://erp.macuxifdv.com.br` (produção, empresa de teste) ou `http://127.0.0.1:<porta>` (API local com `bash db/scripts/pg-local.sh`). |
| Servidor | O `MACUXIERP_PEPPER_ENTRADA` (32 bytes em hex, 64 caracteres) é gerado na VM pelo `ambiente-vm.sh`. Sem ele, ou fora do formato, toda a `/entrada/v1` responde **503**. |
| Credencial | Gerada pelo superadmin no `/config` (`POST /v1/plataforma/empresas/:id/entrada/credencial` com `{"conector_id":"tha-api-teste"}`). A resposta (`CredencialEntradaCriada`: `conector_id`, `chave`, `prefixo`, `criada_em`) é **a única vez** em que a chave aparece: 43 caracteres base64url (`ChaveEntrada`). O mesmo POST troca a chave (a anterior para na hora); `DELETE ...?conector_id=` revoga. A leitura `GET /v1/plataforma/empresas/:id/entrada` mostra só o prefixo (8). Quem copia a chave guarda só na variável da sessão; **nunca** em doc, recado, commit, print ou chat. |
| Variáveis | `CONECTOR=tha-api-teste` (exemplo; `ConectorIdEntrada`: começa por letra ou dígito, até 100, `[A-Za-z0-9._-]`) e `CHAVE` lida do prompt (`read -rs CHAVE`), nunca escrita no comando. |
| Relógio | Carimbos em UTC com `Z` (`date -u +%Y-%m-%dT%H:%M:%S.000Z`). Texto para pessoas em Manaus. |
| BKO antes (D1 a D3) | Pelo BKO do tenant, com o `external_id` da massa: a filial (com CRT), o produto (com NCM e CEST) e uma condição de pagamento da forma `BOLETO` ligada ao `external_id` da forma (`forma_external_id`, `forma_codigo`, `forma_nome`; a ligação não tem campo no BKO e vai pelo `banco-dados`). A entrada passa a atualizar a filial e o produto e cria os outros. |

Cabeçalhos de toda chamada (autenticação de máquina, sem JWT, ADR 0014 §3):

```bash
H=(-H "Authorization: Bearer $CHAVE" -H "X-Macuxi-Conector-Id: $CONECTOR" -H 'Content-Type: application/json')
```

Os cabeçalhos são `CABECALHO_CONECTOR_ID_ENTRADA` (`x-macuxi-conector-id`) e `CABECALHO_IDEMPOTENCIA_ENTRADA` (`idempotency-key`) do SDK. Rotas (`PREFIXO_ENTRADA` + `CAMINHOS_ENTRADA` do SDK):

| Método e caminho | Para quê |
|---|---|
| `POST /entrada/v1/lotes` | Envia um lote de uma entidade. `Idempotency-Key` obrigatória. Responde 202. |
| `GET /entrada/v1/lotes/:id?limite_erros=n` | Lê o resultado do lote (estado, contagens, erros por linha). |
| `GET /entrada/v1/cursores/:entidade` | Lê de onde continuar o delta da entidade. |
| `POST /entrada/v1/sinal` | Sinal de vida e versão do cliente. |

## 3. Envelope (formato hub-v1)

O corpo é o `CorpoLote` de `packages/platform-sdk/src/hub-v1.ts` (o mesmo do Hub `/integracao/v1` do FDV, `aloirr/macuxifdv@c460e92`):

```json
{
  "versao_contrato": "v1",
  "entidade": "filial",
  "modo": "delta",
  "enviado_em": "2026-11-27T12:00:00.000Z",
  "cursor": null,
  "registros": [ { "external_id": "THA-FIL-1", "alterado_em": "2026-11-27T11:59:00.000Z", "ativo": true, "...": "campos da entidade" } ],
  "linhas_invalidas": [],
  "linhas_invalidas_omitidas": 0
}
```

Regras do envelope:
- **Um lote, uma entidade**; até 5.000 registros (`LIMITE_REGISTROS_LOTE`).
- `modo` só `delta` nesta etapa. `modo: "completo"` (com `sessao`) responde 422 (passo 8).
- `alterado_em` em UTC com `Z`; dinheiro em centavos inteiros (`_cents`); quantidade é número (pode ser fracionária), nunca texto.
- `external_id` é a chave do registro no sistema do cliente (1 a 200 caracteres), estável entre envios.
- `cursor` é o último cursor que a entrada devolveu para a entidade (passo 6), ou `null` no primeiro envio.
- Campo desconhecido é descartado (compatibilidade para frente).

### 3.1 Um registro de cada cadastro (ordem de envio)

Mande na ordem abaixo: cada um só referencia os anteriores. Tudo fictício (o CNPJ da filial tem de ter DV válido e a raiz da empresa de teste; o CPF do cliente é gerado com DV válido, nunca de pessoa real).

| # | `entidade` | Registro de exemplo (além de `external_id`, `alterado_em`, `ativo`) |
|---|---|---|
| 1 | `filial` | `"codigo":"0002","nome":"Filial Teste","cnpj":"<CNPJ fictício da raiz da empresa, ordem 0002>","logradouro":"Avenida Ficticia","numero":"100","bairro":"Centro","cep":"69301000","cidade":"Boa Vista","uf":"RR"` |
| 2 | `vendedor` | `"nome":"Vendedora Ficticia","filial_external_id":"THA-FIL-1"` |
| 3 | `forma_pagamento` | `"codigo":"BOLETO","nome":"Boleto"` (o código é o do dicionário do tPag, RN-CAD-09: `BOLETO`, `PIX`, `DINHEIRO`, `CARTAO`...; fora dele o prazo sai `regra_invalida` em `forma_tpag`) |
| 4 | `prazo_pagamento` | `"forma_external_id":"THA-FOR-1","codigo":"28-56","parcelas_dias":"28/56","descricao":"Boleto 28/56"` |
| 5 | `produto` | `"sku":"SKU-0001","nome":"Arroz Ficticio 5 kg","unidade":"UN","marca":"Marca Teste"` (sem custo nem preço) |
| 6 | `produto_unidade` | `"produto_external_id":"THA-PRO-1","unidade":"CX","fator":6,"padrao":false` |
| 7 | `preco` | `"tabela_external_id":"THA-TAB-1","tabela_nome":"Tabela Varejo","vigencia_inicio":"2026-11-01","produto_external_id":"THA-PRO-1","preco_cents":2899,"filial_external_id":"THA-FIL-1"` |
| 8 | `estoque` | `"deposito_external_id":"THA-DEP-1","deposito_nome":"Depósito Central","produto_external_id":"THA-PRO-1","saldo":120,"filial_external_id":"THA-FIL-1"` (saldo fracionário só em KG e M, RN-CAD-17) |
| 9 | `cliente` | `"razao_social":"Mercearia Ficticia","documento":"<CPF fictício com DV>","vendedor_external_id":"THA-VEN-1","filial_external_id":"THA-FIL-1","limite_credito_cents":150000,"formas_pagamento":["BOLETO"],"prazo_medio_max_dias":42,"endereco":{"logradouro":"Rua Ficticia das Palmeiras","numero":"45","bairro":"Centro","cidade":"Boa Vista","uf":"RR","cep":"69301000"}` (o cliente novo precisa do endereço principal, RN-CAD-03) |
| 10 | `cliente_endereco` | `"cliente_external_id":"THA-CLI-1","logradouro":"Travessa Ficticia do Porto","numero":"12","bairro":"Centro","cidade":"Boa Vista","uf":"RR","cep":"69301000","tipo":"entrega","principal":false` |

A mesma massa, gerada com DV válido e sufixo por execução, está em `massaEntrada()` de `tests/ponta-a-ponta-fdv/apoio/entrada-v1.ts`.

## 4. Passo a passo

Para cada passo: o comando, o **esperado** e uma linha no relatório (seção 6) com o **obtido**. Nada de colar a chave, o corpo do cliente ou o CPF no relatório: só status, `lote_id`, contagens e códigos.

### Passo 1 — envio do lote (filial)

```bash
CHAVE_IDEM="tha-filial-$(date -u +%Y%m%dT%H%M%SZ)"
curl -sS -X POST "$BASE/entrada/v1/lotes" "${H[@]}" -H "Idempotency-Key: $CHAVE_IDEM" --data @lote-filial.json
```
Esperado: **202** com `{"lote_id":"<uuid>","status":"recebido","entidade":"filial","modo":"delta","recebidos":1,"consulta":"/entrada/v1/lotes/<uuid>"}` (o `LoteAceito` do hub-v1; `repetido` só aparece no reenvio).

A `Idempotency-Key` segue o `PADRAO_CHAVE_IDEMPOTENCIA` do SDK (8 a 128 caracteres de `[A-Za-z0-9_.:-]`), uma por lote lógico. Reenvio por queda de rede usa **a mesma** chave e **o mesmo** arquivo.

### Passo 2 — reenvio idempotente

Repita o passo 1 com a mesma `CHAVE_IDEM` e o mesmo arquivo.
Esperado: **202** com o **mesmo** `lote_id` e `"repetido":true`; nenhum lote novo.

### Passo 3 — mesma chave, outro corpo

Mude só o `nome` da filial no arquivo e reenvie com a mesma `CHAVE_IDEM`.
Esperado: **409**; o corpo de erro não traz o corpo enviado nem a chave. O lote do passo 1 não muda.

### Passo 4 — resultado do lote

```bash
curl -sS "$BASE/entrada/v1/lotes/$LOTE_ID?limite_erros=100" "${H[@]}"
```
Esperado: primeiro `recebido` ou `processando`; depois de alguns segundos, `concluido`. Com a filial já cadastrada no BKO (D1), a linha conta em `atualizadas`; o exemplo abaixo é o de um cadastro novo:

```json
{
  "lote_id": "3f2b6c1e-0000-4000-8000-000000000001",
  "entidade": "filial",
  "modo": "delta",
  "status": "concluido",
  "contagens": { "recebidas": 1, "duplicadas_no_lote": 0, "com_erro": 0, "novas": 1, "atualizadas": 0, "inalteradas": 0, "obsoletas": 0 },
  "erros": [],
  "avisos": [],
  "cursor": { "alterado_em": "2026-11-27T11:59:00.000Z", "external_id": "THA-FIL-1" },
  "erros_total": 0,
  "erros_omitidos": 0,
  "inativadas": 0,
  "recebido_em": "2026-11-27T12:00:01.000Z",
  "concluido_em": "2026-11-27T12:00:03.000Z"
}
```
Como ler: `novas` + `atualizadas` + `inalteradas` + `obsoletas` + `com_erro` = linhas distintas; `cursor` só avança em `concluido` e `concluido_com_erros`. Lote de outro conector ou de outro tenant responde **404**.

### Passo 5 — linha com erro

Envie um `vendedor` com `filial_external_id` que não existe (`THA-FIL-NAO-EXISTE`) e outro vendedor válido no mesmo lote.
Esperado: `concluido_com_erros`; `contagens.com_erro=1`, `novas=1`; em `erros[]` uma linha `{"indice":1,"external_id":"THA-VEN-ERR","campo":"filial_external_id","codigo":"referencia_ausente","mensagem":"Cadastro referenciado ainda não existe no ERP","reprocessavel":true,"origem":"hub"}`, **sem o valor** do campo. O vendedor válido grava. Com `?limite_erros=1` e mais de uma linha com erro, `erros[]` traz uma e `erros_omitidos` conta o resto.

### Passo 6 — cursor

```bash
curl -sS "$BASE/entrada/v1/cursores/filial" "${H[@]}"
```
Esperado: `{"entidade":"filial","cursor":{"alterado_em":"2026-11-27T11:59:00.000Z","external_id":"THA-FIL-1"},"atualizado_em":"..."}`. Antes do primeiro lote, `cursor: null`. O próximo delta da entidade manda só o que mudou depois desse ponto e repete o `cursor` no envelope.

### Passo 7 — os outros 8 cadastros

Repita os passos 1, 4 e 6 para `forma_pagamento`, `prazo_pagamento`, `produto`, `produto_unidade`, `preco`, `estoque`, `cliente` e `cliente_endereco`, na ordem da seção 3.1. Esperado em cada um: 202 → `concluido` com uma linha contada → cursor no registro enviado. A contagem:
- `novas=1`: vendedor, prazo, unidade, preço, estoque e cliente;
- `atualizadas=1`: produto (já no BKO, D2) e `cliente_endereco` (o endereço é uma linha do cliente; o de entrega novo conta como cliente atualizado);
- `inalteradas=1`: `forma_pagamento` (não tem tabela própria: as válidas só conferem o formato).

No BKO do tenant, cada cadastro aparece com o `external_id` do cliente; no tenant com o `integracao-fdv` ligado, o registro sai ao Hub como o cadastrado pelo BKO (a entrada não fala com o FDV).

Reenvie o `vendedor` com outra `Idempotency-Key` e o mesmo conteúdo: `inalteradas=1`, nada novo ao Hub. Reenvie com `alterado_em` mais antigo: o esperado é `obsoletas=1`, nada grava e o cursor não volta. **Hoje falha (D4):** sai `atualizadas=1`, o nome antigo grava e o cursor recua; anote no relatório como D4.

### Passo 8 — carga completa (decisão 34 B)

Mesmo arquivo da filial com `"modo":"completo"` e `"sessao":{"id":"<uuid novo>","parte":1,"ultimo":true}`.
Esperado: **422** com o código `CARGA_COMPLETA_NAO_SUPORTADA` (`CODIGO_CARGA_COMPLETA_NAO_SUPORTADA` do SDK); nenhum lote criado (o `GET /cursores/filial` não muda) e nada inativado. A mensagem que a rota devolve é a do domínio do cadastros ("Carga completa não aceita: envie só as alterações (delta)"), não o `MENSAGEM_CARGA_COMPLETA_NAO_SUPORTADA` do SDK ("carga completa ainda não suportada"): confira o código, não o texto.

### Passo 9 — recusas de autenticação e escopo

O 401 da autenticação é sempre o mesmo corpo, `{"codigo":"NAO_AUTENTICADO","mensagem":"Credencial de conector inválida"}`, seja qual for o motivo.

| Chamada | Esperado |
|---|---|
| `POST /entrada/v1/lotes` com o JWT do BKO (`Authorization: Bearer <token do login>`), com ou sem o `X-Macuxi-Conector-Id` | 401 neutro |
| Sem `Authorization`, sem `X-Macuxi-Conector-Id`, chave errada ou conector inexistente | 401 neutro em todos, sem dizer qual falhou |
| Chave de um tenant com o `X-Macuxi-Conector-Id` de outro | 401 neutro, sem lote em nenhum |
| `GET /entrada/v1/lotes/<lote de outro tenant>` | 404 (nem 403) |
| A chave em uma rota do BKO (`GET /v1/cadastros/filiais`) | 401 |
| Chave antiga depois de trocar no `/config` | 401 na hora |
| Empresa sem o `cadastros` licenciado | 403 `MODULO_INATIVO` (RN-CORE-02) |
| Empresa suspensa | 403 `EMPRESA_INATIVA` |
| 20 falhas em 15 min do mesmo IP e conector | 429 com `Retry-After`, mesmo com a chave certa (o outro conector segue entrando) |
| Servidor sem `MACUXIERP_PEPPER_ENTRADA` | 503 em tudo |
| Entidade fora da F2 (`"entidade":"titulo"`) ou `versao_contrato` errada | 400 ou 422, sem lote (o `CorpoLote` recusa antes da regra `ENTIDADE_FORA_DA_FASE`) |
| Sem `Idempotency-Key` | 400, sem lote |
| Mais de 5.000 registros | 400/413/422, sem lote |

### Passo 10 — sinal

```bash
curl -sS -X POST "$BASE/entrada/v1/sinal" "${H[@]}" --data '{"versao_contrato":"v1","conector_id":"tha-api-teste","versao_conector":"1.5.0","em":"2026-11-27T12:10:00.000Z","fila":[],"entidades":[]}'
```
Esperado: 200 com `RespostaSinal` (`conector_id` e `recebido_em`), sem `politica_versao` (o ERP ainda não tem política de versão) e sem pacote de atualização automática. Com o `conector_id` de outro conector no corpo: 400.

### Passo 11 — LGPD e segredos

- Logs da API e do worker do período (`journalctl` na VM, pelo gerente, ou o log local): procurar a razão social, o CPF e o logradouro fictícios da seção 3.1 e o começo da chave. Esperado: **zero** ocorrências; só `lote_id`, entidade, contagens e códigos.
- Nenhuma resposta de erro ecoa o corpo nem a chave.
- Depois do `concluido`, o corpo do lote fica nulo no banco (o `banco-dados` confere por consulta, sem copiar dado).

## 5. Critério de pronto da sessão

Todos os passos com o obtido igual ao esperado; os 10 cadastros visíveis no BKO; zero ocorrência de dado sensível em log; o relatório da seção 6 entregue ao gerente por recado (sem chave, sem corpo, sem CPF).

## 6. Relatório (modelo)

| Passo | Critério | Esperado | Obtido | Resultado |
|---|---|---|---|---|
| 1 | envio do lote | 202 `recebido` | | |
| 2 | mesma chave, mesmo corpo | mesmo `lote_id`, `repetido=true` | | |
| 3 | mesma chave, outro corpo | 409 | | |
| 4 | resultado | `concluido`, `novas=1`, cursor | | |
| 5 | linha com erro | `concluido_com_erros`, erro sem valor | | |
| 6 | cursor | último registro aplicado | | |
| 7 | 8 cadastros + inalterada + obsoleta | uma linha contada em cada (seção do passo 7); `inalteradas=1`; `obsoletas=1` (hoje falha: D4) | | |
| 8 | carga completa | 422, sem lote | | |
| 9 | recusas | 401/400/422 da tabela | | |
| 10 | sinal | 200 `RespostaSinal` | | |
| 11 | LGPD | zero ocorrência | | |

## 7. Nomes do contrato

Além dos nomes das seções 2 e 3 (E1 `packages/platform-sdk/src/entrada.ts`, E2/E3 `apps/api/src/entrada/`, C3/C4 `modules/cadastros/api/entrada-*.ts` e as migrações 0071 e 0072):
- `TRABALHO_ENTRADA_LOTE = 'cadastros.entrada_lote'` e `ENTIDADES_ENTRADA` (as 10 da F2);
- portal: `CAMINHOS_ENTRADA_PLATAFORMA` (`/empresas/:id/entrada` e `/empresas/:id/entrada/credencial`) e `PortalEntradaLeitura`;
- servidor: o HMAC-SHA256 (`hmacChaveEntrada`), guardado em `bytea` de 32 bytes;
- banco: `cadastros.entrada_credencial`, `entrada_lote`, `entrada_cursor` e `entrada_sinal`, e a função `cadastros.entrada_autenticar`;
- respostas: `LoteAceito`, `LoteResultado`, `CursorEntidade` e `RespostaSinal` do hub-v1, sempre com `status`.
