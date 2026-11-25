# Plano de testes da v0.3.13 (T-0100, T-0101, T-0099, T-0093, T-0096, T-0097, T-0098, T-0102, T-0103)

Dono: `testes`. Escrito em 24/11/2026, ~23h (Manaus); conferido com o main `603192f` (#598). Base: as tarefas T-0093 e
T-0096 a T-0103 em `.coord/tarefas/`, a seção "24/11 noite" do `.coord/quadro.md`, a decisão R-20261124-225456-alexandre
(ordem A: ficha da empresa e T-0099 em paralelo; depois T-0093, T-0096, T-0097 e T-0098; por fim o log do "Esqueci a
senha" e a lista de superadmins) e as respostas do gerente às dúvidas deste plano.

Situação e comandos: os do plano da v0.3.12 (`docs/testes/plano-v0.3.12.md`); os comandos novos estão no fim.

Tipos: **unitário** (sem banco), **banco** (Postgres local), **rota** (API de produção montada com Postgres local),
**pa-p** (ponta a ponta com o dublê do Hub, worker real e Postgres local), **tela** (X-6, e2e no Chromium ou ensaio com
API real e print 1280/390), **estático** (leitura do código-fonte, sem executar), **script** (`node --test` ou o
operador.sh com o `docker` falso).

## Códigos de erro

Valem os do plano da v0.3.12 (`docs/testes/plano-v0.3.12.md`, parágrafo "Códigos de erro"), sem mudança.

## Regras transversais

As regras X-1 a X-6 do plano da v0.3.12 continuam valendo para toda tela e rota nova desta versão. Cada tarefa abaixo
diz em que caso ela entra.

## Previsão (dono `testes` + 15%)

Base de hoje: validação de um lote 15–20 min; teste de banco novo 20–30 min; e2e com tela 30–45 min; X-6 ~1 min por
rodada. A conta de cada item é a soma das etapas (tempo do `testes`) × 1,15, arredondada para cima. Os minutos contam da
entrada do PR do dono no main; o teste não começa antes do código que ele valida, exceto onde a etapa diz "antes".

| Item | Etapas (min, sem os 15%) | Soma | Com +15% |
|---|---|---|---|
| T-0100 core.empresa | E-1 banco 25 · E-2 backfill 25 · E-3 tela e print 30 · X-6 1 · validação 15 | 96 | **111** |
| T-0101 ficha da Receita | R-1 rota 25 · R-2 falha da fonte 20 · R-3 máscara e tela 30 · R-4 Revelar 25 · R-5 log 20 · X-6 1 · validação 15 | 136 | **157** |
| T-0099 botão Ações | A-1/A-2 e2e de teclado e posição 50 · A-3 alvo 44 px 10 · A-4 prints 30 · X-6 1 · A-6 estático 20 · validação 20 | 131 | **151** |
| T-0093 Zerar pedidos | Z-1/Z-2 perfil e frase 25 · Z-3 mantidos 25 · Z-4 lote 15 · Z-5 integração e reenvio 30 · Z-6 auditoria 10 · validação 15 | 120 | **138** |
| T-0096 latitude e longitude | G-1 domínio 15 · G-2/G-3 conversão 30 · G-4 log 15 · G-5 tela 30 · validação 15 | 105 | **121** |
| T-0097 fração em KG e M | K-1 cadastro 20 · K-2 pedido 20 · K-3 carga 20 · K-4 FDV 30 · K-5 valor × regra 15 · K-6 I-11 a I-13 20 · validação 20 | 145 | **167** |
| T-0098 expurgo em 180 dias | V-1 limites 25 · V-2 revisão 15 · V-3 o que fica 20 · V-4 reexecução 10 · V-5 worker 15 · validação 15 | 100 | **115** |
| T-0102 log do esqueci | S-1 a S-3 banco 25 · validação 15 | 40 | **46** |
| T-0103 `--listar` | O-1/O-2 script 25 · validação 15 | 40 | **46** |
| **Subtotal das tarefas** | | 913 | **1052** |
| PF-1/PF-2: e2e F-1 a F-6, F-10 e F-8 | dublê de clientes 30 · fixtures do FDV e F-10 20 · F-1 a F-6 90 · F-8 20 | 160 | **184** |
| PF-3: roteiros e2e portal-integracao e bko-cadastro | 2 × 40 | 80 | **92** |
| PF-4: P-4 no banco | banco 25 | 25 | **29** |
| PF-5: rota clientes-recebidos | 3 casos de rota 25 | 25 | **29** |
| PF-6: motivo da carga | troca da asserção do P-16 10 | 10 | **12** |
| **Subtotal das pendências** | | 300 | **346** |
| **Total** | | 1213 | **1398** |

Fora da soma: o `--tudo` no SHA final antes do liberar (Definição de pronto, item 2), cujo tempo depende do número de
PRs da versão. PF-1 pode começar antes (~58 min).

## T-0100 — core.empresa a partir da filial padrão (opção B)

Origem do defeito: a aba Empresa lê `plataforma.empresa_json` (0035), que busca razão social e CNPJ em `core.empresa`;
nenhum fluxo de produção insere nessa tabela, então todo tenant mostra "—" (R-20261124-224709).

| # | Critério verificável (critério da tarefa) | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| E-1 | (2) Tenant novo: criada a 1ª filial padrão, o core recebe o evento do cadastros e grava exatamente uma `core.empresa` com razão social, nome fantasia, CNPJ e IE dessa filial; a 2ª filial (não padrão) não cria outra; o evento repetido não duplica. Tenant B não lê a empresa do A. O core não lê `cadastros.*` (lint de fronteiras do CI). | pa-p (API e worker reais) | `tests/integracao/banco/core-empresa.db.test.ts` | modulo-core | pendente (etapa 2 do core ainda fora do main em 24/11, 23h50) |
| E-2 | (1) Backfill: num banco com o legado (tenant com filial padrão e sem `core.empresa`, tenant sem filial padrão, tenant que já tem `core.empresa`), depois da migração o 1º ganha a empresa com razão social, fantasia, CNPJ e IE da filial padrão, o 2º fica sem empresa e o 3º não muda (nem `updated_at`); rodar de novo não muda nada; a contagem registrada por tenant não leva dado pessoal. Depois: nenhum tenant com filial padrão sem `core.empresa`. | banco | `core-empresa.db.test.ts` (com `MACUXI_DB_MIGRACOES`) | banco-dados | feito: `db/testes/empresa-backfill-0059.db.test.ts` (banco-dados, #609), 7/7 verdes; cobre legado, sem filial, só não padrão, já com empresa (igual, `updated_at` incluído), excluída, tenant excluído, RN-CORE-14 sem dados mínimos, NOTICE só com contagens e reexecução. Sem complemento em `tests/` |
| E-3 | (2, 3) Aba Empresa do /config e tela Empresa/fiscal do BKO (T-0088) mostram razão social e CNPJ formatado, nunca "—", no tenant novo e no legado; o contrato do `empresa_json` não muda (mesmas chaves). | tela | `docs/testes/prints/T-0100/` | apps/web + core | pendente |

## T-0101 — ficha da empresa pela Receita (opção C; depende da T-0100)

A fonte é a pública do RF-CAD-02 (BrasilAPI ou base aberta; a escolha final sai na emenda de ADR do engenheiro). No
teste a fonte é um dublê da porta, nunca a rede.

Etapa 2 (25/11, 05h08 de Manaus, main c921c7c com o #661, o #666, o #665 e a 0063). A divergência core × cadastros do
R-20261125-032933 não existe mais na API nova: a regra dos cadastros vale na ficha. O 42501 da porta real dos cadastros
na transação do portal foi corrigido no #666 (rota por etapa, consulta no `comTenant`): os casos de rota usam a porta
real (`criarConsultaCnpjParaCore`) com a fonte HTTP dublê. A porta foi ligada na montagem de produção no #665; o caso
da montagem de produção com a porta ligada fica com a testes-2.

| # | Critério verificável (critério da tarefa) | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| R-1 | (1) "Atualizar pela Receita" no /config (só superadmin; outro perfil: 403) grava a ficha completa: razão social, nome fantasia, CNPJ, situação, abertura, natureza jurídica, porte, CNAE principal e secundários, endereço, e-mail e telefone, com a data e a fonte da consulta; a leitura devolve todos os campos. | rota | `tests/integracao/plataforma/empresa-ficha.db.test.ts` | modulo-core (+ cadastros pela consulta CNPJ) + banco-dados | feito na rota (etapa 2): `empresa-ficha.db.test.ts` grava a ficha plana completa, devolve só os nomes dos campos, audita `atualizar_receita` sem valores e com o `request_id`; perfil (401, 403 sem CSRF, 403 troca pendente, função sem EXECUTE no papel do BKO), 404, idempotência do `request_id`; contrato plano 9/9 em `ficha-receita-contrato.test.ts` |
| R-2 | (1) Falha da fonte (tempo esgotado, CNPJ não encontrado, 5xx, resposta fora do formato): a ficha gravada não muda (nem a data da consulta), a resposta traz o motivo do catálogo (sem o CNPJ nem o corpo da fonte) e a tela mostra a mensagem no lugar, sem "Algo deu errado". | rota + tela | `empresa-ficha.db.test.ts` + e2e | modulo-core + apps/web | rota feita (etapa 2): fonte fora e não encontrado devolvem o motivo e a mensagem do catálogo, sem CNPJ, com a linha da `core.empresa` (data incluída) e a auditoria intactas; tela e e2e pendentes |
| R-3 | (2) E-mail e telefone mascarados na resposta de leitura e na tela; a resposta não contém o e-mail nem o telefone da massa inteiros (nem só os dígitos). | rota + tela | `empresa-ficha.db.test.ts` + `docs/testes/prints/T-0101/` | modulo-core + apps/web | rota feita (etapa 2): resposta do atualizar, das falhas e do detalhe (`GET /empresas/:id`) com `co****@...` e `(92) ****-4567`, sem e-mail, telefone (inteiro ou só dígitos) nem CPF; no-store; print pendente |
| R-4 | (2) "Revelar" no /config, só superadmin (admin de empresa e outros: 403 e nenhuma linha): devolve o valor inteiro e grava a auditoria igual à do `plataforma.admin.revelar_email` (ADR 0012): ação própria, superadmin, entidade e campo, sem o valor. | banco + rota | `empresa-ficha.db.test.ts` | modulo-core + banco-dados | feito (etapa 2): valor inteiro com no-store, auditoria `revelar_contato` só com o campo, superadmin e `request_id`; sem cookie 401, sem CSRF 403, campo fora 400, inexistente 404, sem o dado `valor: null` sem auditoria |
| R-5 | (2) LGPD: o log capturado da API durante R-1, R-2 e R-4 não contém e-mail, telefone, CPF do MEI nem o corpo da fonte. | rota | `empresa-ficha.db.test.ts` | core | feito (etapa 2): log pino capturado durante atualizar, falhas e revelar sem e-mail, telefone, CPF, máscaras nem razão social |
| R-6 | Tenant sem `core.empresa`: "Atualizar pela Receita" responde 409 `CONFLITO` com "Cadastre a filial padrão antes", e nada é gravado (ADR 0012, emenda da ficha). | rota | `empresa-ficha.db.test.ts` | modulo-core | feito (etapa 2): 409 `CONFLITO` com `MENSAGEM_SEM_CNPJ` (texto do core: "Esta empresa ainda não tem CNPJ...") no atualizar e no revelar, sem consultar a fonte nem gravar |

Conferência do ADR 0012, emenda da ficha (#613, 24/11, 23h50 de Manaus): R-2 a R-5 batem com o ADR (máscara
"do****@gmail.com" e "(92) ****-1234", revelar com `plataforma.empresa.revelar_contato` só com o campo e o
`request_id`, nada em log). Diferenças:
- R-1: o ADR não tem abertura, natureza jurídica, porte nem CNAE secundários. Decisão do gerente (24/11, ~23h45 de
  Manaus): vale a tarefa; o engenheiro emenda o ADR e banco e core incluem os campos. O R-1 fica com a ficha completa,
  mais o que o ADR já traz (regime pela Receita, situação com a data, `municipio_ibge`, `receita_fonte`,
  `receita_consultada_em`). A IE e o CRT não mudam pela Receita, e o CNPJ nunca muda por essa rota.
- R-1 (auditoria): `plataforma.empresa.atualizar_receita` só com os **nomes** dos campos que mudaram, a fonte e o
  `request_id`; a data e a fonte são gravadas mesmo sem mudança (só na consulta que deu certo; na falha, R-2).
- R-6 (novo, do ADR): 409 sem `core.empresa`.

## T-0099 — botão Ações nas linhas (R-20261124-224843)

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| A-1 | Em cada tela com tabela do /config e do BKO (lista tirada do X-6), o botão "Ações" da 1ª linha abre o menu com Enter e Espaço, navega por setas, fecha com Esc (foco volta ao botão), com clique fora e com rolagem da página. | tela | `tests/e2e/menu-acoes.mjs` (no runner do X-6) | designer-ux (componente) + engenheiro-apps e módulos | pendente |
| A-2 | Menu não cortado: com o botão na última linha visível e dentro de quadro com `overflow`, a caixa do menu fica inteira dentro da janela (1280 e 390); rótulos inteiros, sem reticências; perigo por último, em vermelho, depois do traço. | tela | `menu-acoes.mjs` | designer-ux | pendente |
| A-3 | Alvo de no mínimo 44 × 44 px no 390, no botão e em cada item do menu (medido pela caixa do elemento). | tela | `menu-acoes.mjs` | designer-ux | pendente |
| A-4 | Menu aberto em cada tela, para a validação do `design-de-marca`. | tela | `docs/testes/prints/T-0099/` | design-de-marca (validação) | pendente |
| A-6 | Nenhum "⋯" (U+22EF), "…" isolado em botão ou fileira de botões de linha sobrando em `apps/web` e `modules/*/web`; o componente vem só de `packages/ui` (nenhuma cópia local). | estático | `tests/integracao/web/menu-acoes-estatico.test.ts` | engenheiro-apps e módulos | pendente |

## T-0093 — Zerar pedidos não faturados (padrão do Zerar da T-0086, I-5 e I-6)

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| Z-1 | Só superadmin (admin de empresa e outros perfis: 403), como o I-5. | rota | `tests/integracao/plataforma/carga-config.db.test.ts` | modulo-pedido | pendente |
| Z-2 | Só com a frase "autorizo zerar os dados" (sem ou com outra: 422, nada apagado). | rota | `carga-config.db.test.ts` | modulo-pedido | pendente |
| Z-3 | Apaga só pedido sem nota e sem título; pedido com nota (qualquer situação) ou com título fica, e nota autorizada, XML e evento fiscal não mudam (contagem e hash antes e depois). A prévia conta o mesmo que o zerar apaga. | banco | `carga-config.db.test.ts` + `tests/integracao/banco/` | banco-dados + modulo-pedido | pendente |
| Z-4 | Com lote do Hub em andamento: recusa com o motivo e nada apagado, como o Zerar da T-0086. | rota | `carga-config.db.test.ts` | modulo-pedido | pendente |
| Z-5 | Critério 3 (default do gerente, vai ao PO): o Zerar de pedidos não manda nada ao FDV (nenhuma chamada no dublê durante o zerar, com a integração ligada); o pedido do FDV zerado não volta sozinho (o recebimento seguinte, com o dublê sem reenvio, não o recria); volta só quando o FDV o reenvia (dublê com o pendente de novo); integração desligada: o zerar funciona igual. | pa-p | `tests/ponta-a-ponta-fdv/volta-fdv-erp.db.test.ts` | modulo-pedido + integracao-fdv | pendente |
| Z-6 | Auditoria com uma linha só com as contagens (apagados e mantidos), sem número, cliente nem valor do pedido. | banco | `carga-config.db.test.ts` | modulo-pedido | pendente |

## T-0096 — latitude e longitude do pré-cadastro (RN-INF-08)

Pendente: código fora do main (24/11, 23h50 de Manaus).

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| G-1 | Domínio do cadastros: latitude −90 e 90 aceitas, −90,000001 e 90,000001 recusadas; longitude −180 e 180 aceitas, −180,000001 e 180,000001 recusadas; só uma das duas, `NaN` ou texto: recusa com o campo. A API revalida (400 com o campo). | unitário + rota | `tests/integracao/rn/rn-cadastros.test.ts` + `tests/integracao/rotas/` | modulo-cadastros + banco-dados (CHECK) | pendente |
| G-2 | Pré-cadastro com latitude e longitude: o cliente criado pela conversão tem o endereço com os mesmos valores (sem perder casas além da precisão da coluna); o pendente repetido (F-3) não muda a localização. | pa-p | `tests/ponta-a-ponta-fdv/cliente-fdv-erp.db.test.ts` | modulo-cadastros + integracao-fdv | pendente |
| G-3 | Pré-cadastro sem localização: cliente criado com a localização nula. Latitude ou longitude fora da faixa (default do gerente, vai ao PO): grava nulo só nesse campo (o outro, válido, fica), o pré-cadastro segue `aceito` e o Log leva o motivo com o campo, sem o valor. | pa-p | `cliente-fdv-erp.db.test.ts` | modulo-cadastros + integracao-fdv | pendente |
| G-4 | LGPD (a localização de cliente PF é dado pessoal): o log capturado da API e do worker não contém a latitude nem a longitude. | pa-p | `cliente-fdv-erp.db.test.ts` | modulo-cadastros + integracao-fdv | pendente |
| G-5 | Tela do cliente mostra os dois campos. | tela | `docs/testes/prints/T-0096/` | apps/web + cadastros | pendente |

## T-0097 — fração só em KG e M (RN-CAD-17, RN-INF-07)

Ligação com a v0.3.12: I-11 a I-13 (fracionário recusado por registro no envio ao Hub) continuam até o FDV aceitar
decimal; esta tarefa acrescenta a recusa antes, no ERP, para unidade que não seja KG ou M.

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| K-1 | Cadastro (produto e unidade): fator fracionário em unidade KG ou M aceito; em UN, CX e outras, recusa com o campo e o motivo claro; inteiro em qualquer unidade aceito. Domínio e API (400/422 conforme "Códigos de erro"). | unitário + rota | `rn-cadastros.test.ts` + `tests/integracao/rotas/` | modulo-cadastros | pendente |
| K-2 | Pedido manual: quantidade 1,5 em item KG ou M aceita; em UN recusada com o campo do item; nada gravado. | rota | `tests/integracao/rotas/` | modulo-pedido | pendente |
| K-3 | Carga CSV: a linha com fração em unidade imprópria é recusada na própria linha (número, campo, motivo); as válidas gravam. | banco | `carga-config.db.test.ts` | modulo-cadastros | pendente |
| K-4 | Pedido do FDV com quantidade fracionária em unidade que não é KG nem M: vai a `rejeitado_erp` com o motivo (RN-PED-01) e o retorno ao dublê leva esse motivo; em KG ou M é aceito. | pa-p | `volta-fdv-erp.db.test.ts` | modulo-pedido + integracao-fdv | pendente |
| K-5 | Valor × regra: o total do item é `valorItem` do SDK (preço × quantidade, centavo, meio para cima): 1,5 × R$ 3,33 = R$ 5,00 (4,995 → 5,00) e 0,333 × R$ 10,00 = R$ 3,33, iguais na tela, na API e no pedido gravado. | unitário + rota | `tests/integracao/rn/` + `tests/integracao/rotas/` | modulo-pedido | pendente |
| K-6 | Enquanto o envio fracionário ao FDV não for ligado (ADR 0076 do FDV no ar, aviso do PO do FDV), os casos I-11, I-12 e I-13 da v0.3.12 seguem verdes com KG e M; o teste de contrato do envio fracionário fica para quando o envio ligar. | pa-p | `ida-erp-fdv.test.ts` + `volta-fdv-erp.db.test.ts` | integracao-fdv | pendente (o contrato do envio fracionário não entra na conta) |

## T-0098 — expurgo do pré-cadastro sem decisão (RN-INF-06)

Base: RN-INF-06 com a emenda do #592; `integracao_fdv.expurgar_pre_cadastro_recusado` (0057) e a rotina do worker
(#589). Referência: o recebimento no `recebido`; a última revisão recebida no `reenviado`. Relógio de teste; "dia" = 24 h
em UTC. A comparação é a mesma do expurgo do recusado (ver a divergência em "Critérios não claros").

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| V-1 | Limites com a comparação do recusado (`referência < corte`, corte = agora − 180 dias − folga de 5 min, `corteDoExpurgoPreCadastro`): em `recebido` e em `reenviado`, 179 dias fica; referência igual ao corte fica; 1 ms antes do corte expurga; 181 dias expurga. Se o banco passar a `≥ referência + 180 dias`, o caso troca: 180 dias exatos expurga. | banco | `tests/integracao/banco/expurgo-pre-cadastro.db.test.ts` | banco-dados + integracao-fdv | pendente |
| V-2 | `reenviado` conta da última revisão recebida: recebido há 200 dias e com a última revisão há 10 dias fica; com a última revisão há 181 dias expurga. `recebido` sem revisão conta do recebimento. | banco | `expurgo-pre-cadastro.db.test.ts` | banco-dados | pendente |
| V-3 | O que não expurga: `aceito`; `recusado` já expurgado; outro tenant (RLS); corte mais novo que 180 dias recusado, como hoje. O expurgado fica só com códigos e contagens (payload, razão social e documento mascarado nulos); auditoria só com contagens. | banco | `expurgo-pre-cadastro.db.test.ts` | banco-dados | pendente |
| V-4 | Reexecução no mesmo dia não muda nada (contagem 0 na segunda). | banco | `expurgo-pre-cadastro.db.test.ts` | banco-dados | pendente |
| V-5 | Rotina diária do worker chama a função para os novos estados e não leva dado pessoal ao log. | pa-p | `expurgo-pre-cadastro.db.test.ts` (worker real) | modulo-integracao-fdv | pendente |

## T-0102 — log do motivo do "Esqueci a senha" (origem R-20261124-222933 a 224050; branch `agente/esqueci-log-motivo`)

Os testes da API são do dono (critério 1); o `testes` confere de fora, pela API montada.

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| S-1 | Cada caminho do esqueci (tenant e superadmin) grava uma linha de log com o motivo do não envio (conta inexistente, inativa, bloqueada, limite) ou com o aceite do SMTP; a linha leva só o motivo ou o identificador interno. | rota | `tests/integracao/auth/esqueci-log.db.test.ts` | engenheiro-software | feito (motivos que leem o banco; e-mail desligado, falha do SMTP e limite no `apps/api/src/esqueci-senha.test.ts` do dono) |
| S-2 | O log capturado não contém o e-mail digitado (nem parte dele, nem o domínio isolado), a senha temporária nem o código da empresa digitado. | rota | `esqueci-log.db.test.ts` | engenheiro-software | feito |
| S-3 | A resposta continua o 202 neutro em todos os motivos, sem diferença de corpo (RN-CORE-13). | rota | `esqueci-log.db.test.ts` | engenheiro-software | feito |

## T-0103 — `operador.sh superadmin --listar` (R-20261124-225456, item 4)

O teste do script na suíte de scripts é do dono (critério 2); o `testes` confere o operador.sh real.

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| O-1 | (1) `--listar` mostra cada superadmin com o e-mail mascarado, a situação (ativo ou inativo) e a data do último acesso; nem a saída nem o log capturado contêm um e-mail inteiro da massa. | script | `tests/integracao/plataforma/operador-superadmin-listar.db.test.ts` (operador.sh real com o `docker` falso) | engenheiro-software | feito (mais o `scripts/deploy/superadmin-listar.test.mjs` do dono) |
| O-2 | É só leitura (nenhuma linha muda em `plataforma.superadmin`) e registra quem pediu (`--operador`), sem e-mail; sem `--operador`, recusa como as outras ações; sem superadmin, lista vazia e saída 0. | script | `operador-superadmin-listar.db.test.ts` | engenheiro-software | feito (#638) |

## Pendências da v0.3.12 (entram se couberem)

| # | Critério verificável | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| PF-1 | e2e F-1 a F-6 e F-10 em `tests/` (critérios no plano da v0.3.12), com o dublê de clientes do Hub (`GET /clientes/pendentes`, `POST /clientes/{uuid}/retorno`, falha injetável) e as fixtures do `cliente-erp.ts` do FDV copiadas para `tests/`. | pa-p | `tests/ponta-a-ponta-fdv/cliente-fdv-erp.db.test.ts`, `cliente-fdv-contrato.test.ts`, `apoio/duble-hub.ts` | integracao-fdv | pendente (coberto no módulo na v0.3.12) |
| PF-2 | F-8 em `tests/`: rota `clientesRecebidos` no `isolamento` e no `autorizacao-rotas`. | banco + rota | `isolamento.db.test.ts`, `autorizacao-rotas.test.ts` | integracao-fdv + banco-dados | pendente |
| PF-3 | Roteiros e2e `portal-integracao.mjs` e `bko-cadastro.mjs` atualizados para as telas da v0.3.12 (aba Integração, Dados, Log, Clientes recebidos e cadastros da T-0088). | tela | `tests/e2e/portal-integracao.mjs`, `tests/e2e/bko-cadastro.mjs` | apps/web | pendente |
| PF-4 | P-4 no banco: o CHECK 365/24 recusa 366 dias e 25 parcelas; o levantamento do legado 366–999 por tenant é conferido antes da migração (contagem esperada) e a migração não falha com o legado. | banco | `tests/integracao/banco/` | banco-dados | pendente (depende do CHECK do banco) |
| PF-5 | Rota clientes-recebidos (R-20261124-211940-testes): cursor inexistente ou de outro tenant → 400 com o campo `cursor`; `exportar` recusa (400) ou não declara cursor e limite; o CSV acima de 10.000 linhas avisa. | rota | `tests/integracao/rotas/` | integracao-fdv | pendente |
| PF-6 | Motivo da carga (R-20261124-213746-testes): a asserção do P-16 passa ao texto com o limite ("Prazo acima de 365 dias", "Mais de 24 parcelas" e o do prazo médio). | banco | `carga-config.db.test.ts` | modulo-cadastros | pendente |

## Critérios não claros

- **T-0098, dia 180 exato (divergência):** o gerente respondeu "o dia 180 exato já expurga (≥ referência + 180 dias),
  com a mesma comparação do recusado". O expurgo do recusado não é `≥`: a 0057 apaga quando `ultima_recusa_em < p_corte`
  (estrito) e o corte é `agora − 180 dias − 5 min` (`corteDoExpurgoPreCadastro`, `FOLGA_CORTE_MS`); ou seja, expurga
  só quando `agora > referência + 180 dias + 5 min`. Com a rotina diária, um pré-cadastro com exatamente 180 dias não
  sai naquela rodada, só na seguinte. O V-1 segue o código até o gerente escolher entre manter (`>`, com a folga) ou
  pedir ao banco-dados a troca para `≥` nos dois expurgos.

## Divisão entre sessões

Cada sessão faz um PR por lote e roda o corretor antes do push. Faixa de RD (1860–1869): `testes` 1864–1865, `testes-2`
1866–1867, `testes-3` 1868–1869.

| Sessão | Itens | Previsão (+15%) |
|---|---|---|
| `testes` (principal, caminho crítico) | T-0100, T-0101, T-0096, T-0102, T-0103 e a suíte final no SHA da versão | 111 + 157 + 121 + 46 + 46 = **481** (mais a suíte final, fora da soma) |
| `testes-2` | T-0099, T-0097, PF-3 (roteiros e2e portal-integracao e bko-cadastro) | 151 + 167 + 92 = **410** |
| `testes-3` | T-0093, T-0098, PF-1/PF-2 (e2e F-1..F-6, F-10, F-8), PF-4, PF-5, PF-6; o dublê de clientes e o F-10 começam já | 138 + 115 + 184 + 29 + 29 + 12 = **507** |
| **Total** | | **1398** |

## Comandos da sessão

Os da v0.3.12, mais:
- `pnpm exec vitest run --config tests/vitest.config.ts tests/integracao tests/ponta-a-ponta-fdv`.
- `bash tests/e2e/rodar-render-telas.sh` (X-6) e o runner de prints.
