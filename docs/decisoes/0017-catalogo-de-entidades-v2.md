# ADR 0017 — Catálogo de entidades v2 da integração ERP↔FDV

- **Status:** Proposta (23/11/2026). Só documento: nenhuma versão de hoje muda.
- **Data:** 23/11/2026 (Manaus)
- **Dono:** engenheiro-software
- **Tarefa:** T-0063
- **Base:** decisão do Alexandre, R-20261123-163826-alexandre (23/11, 16h38): "entidades v2: aprovo o caminho (ADR do catálogo de entidades v2 + conferência com o PO do FDV + entrada por grupo depois da T-0060) / prioridade: tributação para o pedido primeiro". O catálogo proposto pelo PO está no mesmo recado. A resposta do gerente do FDV, item por item, veio pelo gerente às 16h43.
- **Fontes:**
  - ERP: `main` 84da1f5 (`modules/*/contracts`, `db/migrations/0004_cadastros.sql`, `0013_fiscal_faturamento.sql`, `modules/integracao-fdv/domain/mapeamento.ts`).
  - FDV, só consulta: `aloirr/macuxifdv@c460e92` (`modules/integracao/contracts/{entidades,base,pedido,hub,eventos}.ts`, `modules/vendedor/domain/order.ts:20`).
- **Usa:** a ADR 0010 (`external_id`) e a ADR 0014 §2 (os payloads do Hub no SDK, `packages/platform-sdk/src/hub-v1.ts`).

## Contexto
O mecanismo da integração já segue o mercado: contrato canônico, delta por cursor, idempotência, outbox e reconciliação. O que falta é o **catálogo**.

Hoje o ERP publica 9 entidades de cadastro, todas em `@1` (`cadastros.{filial,cliente,tabela_preco,produto,preco,estoque,condicao_pagamento,vendedor,carteira}.*@1`). Elas viram 10 entidades do Hub. O Hub do FDV aceita 16. E as duas pontas não têm a tributação do pedido: o FDV deixa o imposto com o ERP (`order.ts:20`), mas o ERP só calcula imposto na emissão da nota.

Esta ADR fixa, para cada entidade:
- o nome e a chave;
- o contrato (Zod);
- o evento com a versão;
- a linha do mapa ERP↔FDV;
- o que depende do FDV.

A entrada é **por grupo, depois da T-0060**, começando pela tributação (seção 5).

## Decisão

### 1. Regras comuns
- **Chave:** toda entidade tem `external_id` (ADR 0010). As chaves naturais da tabela abaixo são só para casar na carga e na validação, nunca para identificar no Hub.
- **Contrato:** o Zod de cada entidade fica no `contracts` do módulo dono (`modules/cadastros/contracts` ou `modules/fiscal/contracts`). O payload do Hub fica no SDK, em `hub-v1.ts` (ADR 0014 §2), e só entra lá depois que o FDV publicar a entidade, citando o commit do FDV.
- **Versões:**
  - A entidade nova nasce com `@1`.
  - Campo novo **opcional** num evento existente mantém o `@N`, porque o consumidor ignora campo desconhecido, como no FDV (`base.ts:8`).
  - Campo removido, campo que vira obrigatório ou mudança de tipo pede `@N+1`, ADR e convivência de uma sprint.
  - No Hub vale a mesma regra: entidade nova e campo opcional ficam em `/integracao/v1`, e o resto exige `/v2` com ADR **no FDV** (`base.ts:7`).
- **Duas pontas:** uma entidade nova do mapa só sai do ERP quando o Hub a aceita. O ERP **não altera o FDV**. Cada mudança do lado do FDV vira tarefa aprovada pelo Alexandre **no FDV**, como consta na coluna "Lado FDV".

### 2. Catálogo e mapa ERP↔FDV, linha a linha
Legenda:
- **Estado ERP:** = (existe), **novo** (tabela e contrato novos) ou **campo** (só um campo novo).
- **Lado FDV**, conforme o gerente do FDV às 16h43: ✔ (o Hub já recebe), **campo FDV** (campo novo no payload do Hub), **entidade FDV** (entidade nova no Hub) ou **ADR FDV** (inverte uma decisão do FDV).
- ⚠ = o FDV ainda não confirmou, e o gerente confere.

| Grupo | Entidade (ERP) | Tabela e contrato ERP | Chave natural | Evento ERP | Entidade do Hub | Estado ERP | Lado FDV |
|---|---|---|---|---|---|---|---|
| Organização | Filial | `cadastros.filial` · `Filial` | `cnpj` | `cadastros.filial.alterada@1` | `filial` | = | ✔ |
| | Depósito | `cadastros.deposito` (filial, código) · `Deposito` | `(filial_id, codigo)` | `cadastros.deposito.alterado@1` | `deposito` (hoje vai embutido no `estoque`) | novo; o estoque passa a ser por `(deposito, produto)` | **entidade FDV**. Até lá, o ERP preenche `estoque.deposito_external_id` e `deposito_nome`, que hoje vão nulos |
| | Vendedor | `cadastros.vendedor` · `Vendedor` | `codigo` | `cadastros.vendedor.alterado@1` (+ `equipe_external_id` opcional) | `vendedor` | = (+ campo) | **campo FDV** `equipe_external_id` |
| | Equipe (supervisor→vendedor) | `cadastros.equipe` (pai, responsável) · `Equipe` | `codigo` | `cadastros.equipe.alterada@1` | `equipe` | novo | **entidade FDV** (o FDV tem `core.equipe`, mas o Hub não a recebe) |
| | Região | `cadastros.regiao` · `Regiao` | `codigo` | `cadastros.regiao.alterada@1` | `regiao`, ou o campo `rota.regiao` | novo | ⚠ **entidade ou campo FDV** (hoje a região é texto na rota) |
| | Rota | `cadastros.rota` + `rota_parada` · `Rota` | — | `cadastros.rota.alterada@1` | `rota` | novo (hoje em `ENTIDADES_IGNORADAS`) | ✔ (+ a região acima) |
| Cliente | Cliente + endereços | `cadastros.cliente`, `cliente_endereco` · `Cliente` | `documento` | `cadastros.cliente.alterado@1` | `cliente` + `cliente_endereco` | = | ✔ |
| | Contatos | `cadastros.cliente_contato` (já existe) · `ContatoItem` | — | dentro de `cadastros.cliente.alterado@1` (`contatos[]` opcional, até 20) | `cliente.contatos[]` | **campo** (o contato hoje não vai no evento) | ✔ (nome, cargo, telefone e email); `whatsapp` e `principal` são **campo FDV** opcional ⚠ |
| | Segmento / ramo | `cadastros.segmento` + `cliente.segmento_id` · `Segmento` | `codigo` | `cadastros.segmento.alterado@1` | `segmento` + `cliente.segmento_external_id` | novo | ⚠ **entidade FDV** (hoje só há `canal`, com de-para, e o texto `segmento`) |
| | Carteira cliente×vendedor | `cliente.vendedor_id` · `TransferenciaCarteira` | — | `cadastros.carteira.alterada@1` | `cliente.vendedor_external_id` | = | ✔ |
| Produto | Produto (genérico) | `cadastros.produto` · `Produto` | `codigo` | `cadastros.produto.alterado@1` (+ `ncm`, `cest`, `origem` e `marca_external_id`, opcionais) | `produto` | = (+ campos); o genérico é da **T-0060** | **campo FDV** `ncm`, `cest`, `origem` (tributação) e `marca_external_id` |
| | Árvore do catálogo | da **T-0060** | `codigo` | da T-0060 | `catalogo_no` | novo (T-0060) | ✔ |
| | Marca | `cadastros.marca` · `Marca` | `codigo` | `cadastros.marca.alterada@1` | `marca`; até lá, o texto `produto.marca` e `marca_codigo` | novo | **entidade FDV** |
| | Embalagem | da **T-0060** (`produto_unidade` com fator) | `(produto, unidade)` | dentro de `cadastros.produto.alterado@1` | `produto_unidade` | T-0060 | ✔ |
| Comercial | Tabela de preço (cabeçalho) | `cadastros.tabela_preco` · `TabelaPreco` | — | `cadastros.tabela_preco.alterada@1` | `tabela_preco` | = | **entidade FDV**, opcional: o FDV só cria se o ERP pedir. O ERP continua mandando `tabela_external_id` e `tabela_nome` no `preco` (tirar exigiria `/v2` no FDV) |
| | Preço (item) | `cadastros.tabela_preco_item` · `PrecoItem` | `(tabela, filial, produto)` | `cadastros.preco.alterado@1` | `preco` | = | ✔ |
| | Tabela escalonada | `cadastros.tabela_escalonada` · `TabelaEscalonada` | `(tabela?, produto, quantidade_minima)` | `cadastros.tabela_escalonada.alterada@1` | `tabela_escalonada` | novo | ✔ |
| | Política de desconto / promoção | `cadastros.politica_desconto` · `PoliticaDesconto` (escopo: produto, catálogo, marca, cliente, segmento ou tabela; tipo: limite ou promoção; vigência) | `codigo` | `cadastros.politica_desconto.alterada@1` | `promocao` (nome do FDV) | novo | ⚠ **entidade FDV** (o FDV tem só `produto.desconto_maximo_pct`; a promoção tem contrato e não tem tabela). O desenho fino fica para o grupo G2 |
| | Condição e forma de pagamento | `cadastros.condicao_pagamento` · `CondicaoPagamento` | `codigo` | `cadastros.condicao_pagamento.alterada@1` | `forma_pagamento` + `prazo_pagamento` | = | ✔ |
| | Transportadora | `cadastros.transportadora` · `Transportadora` (também serve à NF-e, grupo `transp`) | `cnpj` | `cadastros.transportadora.alterada@1` | `transportadora` | novo | ✔ (o Hub já recebe); **falta o consumidor no FDV** |
| | **Tributação para o pedido** | `fiscal.tributacao_pedido` · `TributacaoPedido` | seção 3 | `fiscal.tributacao_pedido.alterada@1` | `tributacao` (nome do FDV) | novo | ⚠ **entidade FDV + ADR FDV** (inverte `order.ts:20`). Seção 3 |
| ERP→FDV | Títulos | `faturamento` · `faturamento.titulo.gerado@1` e `faturamento.titulo.baixado@1` | `(numero, parcela)` | (já existem) | `titulo` | = (contrato do Hub na F4) | ✔ |
| | Notas | `faturamento.nota.autorizada@1` e `faturamento.nota.cancelada@1` | `(serie, numero)` | (já existem) | `nota` | = (F4) | ✔ |
| | Status do pedido | `pedido.pedido.*@1` → `POST /pedidos/{uuid}/retorno` | `pedido_uuid` | (já existem) | retorno do pedido | = | ✔ |
| FDV→ERP | Pedido | `PedidoFdvEntrada` → `pedido.pedido.recebido@1` | `pedido_uuid` | (já existe) | `GET /pedidos/pendentes` | = | ✔; com a seção 3, o item ganha os impostos estimados (**campo FDV**) |
| | Pré-cadastro de cliente | da **T-0059** (v0.3.8) | `cliente_uuid` | da T-0059 | `GET /clientes/pendentes` + retorno | T-0059 | ✔ (FDV v1.0.27) |
| | Motivo de não venda / visita (opcional) | `pedido.visita_sem_venda` (registro) · `VisitaSemVendaFdv`; o cadastro de motivos fica no FDV | `visita_uuid` | `pedido.visita.sem_venda_recebida@1` | **saída nova** `GET /visitas/pendentes` + retorno | novo | ⚠ **contrato FDV novo** (o FDV tem `core.motivo`, mas o Hub não tem saída) |

Hoje o `carteira.alterada@1` está no manifesto do `integracao-fdv` sem consumidor (`consumidor-cadastros.ts:40-47`). Ele continua sem consumidor, porque a carteira já sai no `cliente.vendedor_external_id`. O `modulo-integracao-fdv` tira a declaração do manifesto no grupo G3.

### 3. Tributação para o pedido (prioridade, grupo G1)
**Objetivo:** o vendedor vê no FDV, por item, o **IPI** e o **ICMS-ST estimados**, por produto e UF do cliente, mesmo sem rede. A nota recalcula tudo na emissão: o valor do pedido é **estimativa**, e o PDF e a tela dizem isso.

**O ERP manda a regra, não o valor.** O preço muda com o desconto no aparelho, então o ERP publica os **percentuais já resolvidos** pelo motor fiscal, e o FDV aplica a fórmula canônica abaixo. O motor (CFOP, CST e precedência das regras) fica só no ERP, e o FDV não interpreta `RegraTributaria`.

**Granularidade e chave.** O motor do ERP escolhe a regra por NCM, UF de origem e de destino, tipo de cliente, CRT e CFOP (`RegraTributaria`, `modules/fiscal/contracts/index.ts:194-263`). Ele não escolhe por produto. Por isso a linha publicada é por **(filial emissora, NCM, CEST, UF de destino, tipo de contribuinte)**, e o produto chega a ela pelo `ncm` e `cest` que passam a ir no `produto` (seção 2). Assim fica "por produto e UF", com muito menos linhas: 1 filial × 300 NCMs × 27 UFs × 2 tipos dá cerca de 16 mil linhas, ou 4 lotes, em vez de multiplicar pelo número de produtos. O CFOP é o de venda da filial, que o motor resolve.
- A chave natural é `(filial_id, ncm, cest, uf_destino, tipo_contribuinte)`.
- O `external_id` é determinístico: `trib:<filial external_id>:<ncm>:<cest ou ->:<UF>:<tipo>`.
- O `tipo_contribuinte` é o mesmo `TipoContribuinte` da `RegraTributaria`. O cliente do Hub passa a levar o tipo, pelo **campo FDV** `contribuinte`/regime. A `inscricao_estadual` já existe no Hub.

**Contrato** (`modules/fiscal/contracts`, `TributacaoPedido`; o payload do Hub vai ao `hub-v1.ts` depois do FDV):
```ts
const Pct4 = z.number().int().min(0).max(10_000_000); // percentual × 10⁴ (18% = 180000), 4 casas como no Manual da NF-e; até 1.000% (MVA pode passar de 100%)
export const TributacaoPedido = z.object({
  external_id: z.string().min(1).max(200),
  filial_external_id: z.string().min(1).max(200),
  ncm: z.string().regex(/^\d{8}$/),
  cest: z.string().regex(/^\d{7}$/).nullable(),
  uf_destino: Uf,
  tipo_contribuinte: TipoContribuinte,
  ipi: z.object({ aliquota: Pct4, valor_unidade_cents: z.number().int().min(0).nullable() }).nullable(), // null = sem IPI
  icms: z.object({ aliquota: Pct4, reducao_bc: Pct4 }),               // ICMS próprio, só para deduzir na ST
  st: z.object({
    mva: Pct4,                                                         // já ajustada quando a regra pede
    reducao_bc_st: Pct4,
    aliquota_interna_destino: Pct4,
    p_fcp_st: Pct4,
    ipi_na_base: z.boolean(),
  }).nullable(),                                                       // null = sem ST nesta UF
  vigencia_inicio: z.string().date(), vigencia_fim: z.string().date().nullable(),
  calculo_versao: z.number().int().min(1),                             // CALCULO_VERSAO do fiscal
  alterado_em: z.string().datetime(), ativo: z.boolean(),
});
```

**Fórmula canônica** (por item, em centavos; cada valor é arredondado em centavos, meio para cima, como no Manual da NF-e; `v` é o valor do item depois do desconto):
1. `ipi = ipi ? (valor_unidade_cents ? qtd × valor_unidade_cents : round(v × aliquota / 10⁶)) : 0`
2. `bc_icms = round(v × (1 − icms.reducao_bc / 10⁶))` · `icms_proprio = round(bc_icms × icms.aliquota / 10⁶)`
3. Com `st`: `bc_st = round((v + (ipi_na_base ? ipi : 0)) × (1 + mva / 10⁶) × (1 − reducao_bc_st / 10⁶))` · `icms_st = max(0, round(bc_st × aliquota_interna_destino / 10⁶) − icms_proprio)` · `fcp_st = round(bc_st × p_fcp_st / 10⁶)`
4. Total estimado do item: `v + ipi + icms_st + fcp_st`.

**Vetor de conformidade:** os dois lados testam com ele, e outros vetores vão ao teste do fiscal.
- Entrada: `v = 10000`, IPI de 10%, ICMS de 12% sem redução, MVA de 40%, alíquota interna de 18%, FCP-ST de 2% e `ipi_na_base = true`.
- Resultado: `ipi = 1000`, `icms_proprio = 1200`, `bc_st = 15400`, `icms_st = 2772 − 1200 = 1572`, `fcp_st = 308`, total de **12880**.

**Quem gera.** A função pura `tributacaoParaPedido(regras, filial, ncm, cest, uf, tipo)` fica no `domain` do `modulo-fiscal`. Ela reaproveita `domain/icms.ts` e `domain/ipi.ts`, cita RN-FIS-*, e o teste vem antes. A tabela materializada `fiscal.tributacao_pedido` guarda um hash por linha.

**Quando regenera:**
- quando uma regra muda, por `fiscal.regra.alterada@1`, que já está no manifesto e passa a ser publicado de fato;
- quando muda a UF ou o CRT da filial;
- quando surge um NCM ou CEST novo num produto ativo;
- quando vira a vigência.

Só publica `fiscal.tributacao_pedido.alterada@1` a linha cujo hash mudou. O `integracao-fdv` mapeia esse evento para a entidade `tributacao` do Hub.

**O pedido do ERP** mostra no BKO a mesma estimativa, pela mesma função do fiscal, e não por uma segunda fórmula. Ao receber o pedido do FDV, o ERP **recalcula** e guarda a sua própria estimativa. Os impostos que vêm no item do FDV (campo FDV) servem só para conferir: uma diferença acima de 1 centavo por item fica registrada no pedido, sem bloquear.

**Fora:**
- DIFAL para não contribuinte, IBS/CBS e IS no pedido (a nota calcula);
- ICMS próprio exibido como imposto (ele só entra na dedução da ST);
- regime especial por cliente. Se o PO pedir, entra como `@2` desta entidade.

**Lado FDV (ADR no FDV):**
- a tabela e o consumidor da `tributacao` no Vendedor;
- os campos `ncm`, `cest` e `origem` no produto e `contribuinte`/regime no cliente;
- a fórmula do item 3 com o vetor de conformidade;
- os impostos estimados no item enviado ao ERP e no PDF, com "estimativa; valor final na nota".

O gerente leva isso ao FDV.

### 4. Donos no ERP
| Dono | O quê |
|---|---|
| modulo-fiscal | `TributacaoPedido`, `tributacaoParaPedido`, a regeneração e o evento (seção 3) |
| modulo-cadastros | as entidades novas de cadastro da seção 2, com os eventos `@1`, o `contatos[]` no `cliente.alterado@1` e os campos novos do produto |
| banco-dados | as tabelas novas, com RLS e as colunas da regra 5; o estoque por depósito; `fiscal.tributacao_pedido` |
| modulo-integracao-fdv | o mapeamento de cada entidade nova para o Hub, só depois que o FDV a publica; tirar o `carteira.alterada@1` do manifesto |
| modulo-pedido | a estimativa no BKO e a conferência do pedido do FDV (seção 3); `VisitaSemVendaFdv` (G5) |
| engenheiro-software | os payloads do Hub no `hub-v1.ts`, por entidade, a cada commit do FDV; a revisão |
| designer-ux · engenheiro-apps | as telas de cadastro novas e a estimativa de impostos no pedido do BKO |

### 5. Ordem de entrada (por grupo, depois da T-0060)
- **G1 — Tributação para o pedido** (seção 3) e os campos fiscais do produto e do cliente. Depende da ADR no FDV.
- **G2 — Comercial:** tabela escalonada, transportadora, política de desconto/promoção e, se o FDV pedir, o cabeçalho da tabela de preço.
- **G3 — Cliente:** contatos no evento, segmento e a limpeza da carteira.
- **G4 — Organização:** depósito (com o estoque por depósito), equipe, região e rota.
- **G5 — Visita sem venda** (opcional).

O gerente monta as horas e a ordem com o Alexandre, por grupo. Esta ADR não fixa versão.

## Consequências
- O ERP passa de 9 para até 19 entidades de cadastro publicadas. As que já existem continuam em `@1`, e os campos novos são opcionais.
- O fiscal ganha a primeira publicação de evento: `fiscal.regra.alterada@1` passa a ser publicado, e o `fiscal.tributacao_pedido.alterada@1` é novo.
- O imposto do pedido passa a ter **uma fonte só**: o motor do ERP. O FDV aplica só a fórmula canônica.
- O `hub-v1.ts` cresce por entidade e sempre segue um commit do FDV.

## Riscos
- **Diferença entre a estimativa e a nota:** a fórmula é a mesma, e o vetor de conformidade fica nos dois lados. A diferença é registrada e não bloqueia, e a nota sempre recalcula.
- **Volume da tributação:** a chave é por NCM, e não por produto, e só a linha cujo hash mudou é publicada.
- **O FDV não aceitar uma entidade:** a linha fica no ERP sem mapeamento (seção 1).
- **Escopo crescendo:** a entrada é por grupo, com a aprovação do Alexandre em cada um.

## Alternativas descartadas
- (a) **O ERP publica o valor do imposto por produto, UF e preço:** não acompanha o desconto do aparelho e multiplica o volume.
- (b) **O FDV interpreta `RegraTributaria`:** o motor fiscal ficaria em dois lugares.
- (c) **O FDV consulta o ERP online por item:** o app trabalha sem rede.
- (d) **Chave por produto:** o motor resolve por NCM, e a chave por produto só multiplicaria linhas iguais.
- (e) **Tirar `tabela_nome` do `preco` agora:** quebra o `/integracao/v1` do FDV.
