# Plano de testes da v0.3.12 (T-0085, T-0086, T-0087, T-0088, T-0059)

Dono: `testes`. Escrito em 24/11/2026, ~17h20 (Manaus). Os desenhos (ADR 0020, `docs/desenho/T-0085.md` e `T-0086.md`,
commit b131bbc do engenheiro-software) ainda não estão em branch publicado; a base são as tarefas em `.coord/tarefas/` e
os pedidos R-20261124-202954 (banco), -202958 (cadastros), -203003 (integracao-fdv), -203008 (pedido) e -203011 (apps),
mais a decisão R-20261124-170915-alexandre (Zerar apaga no ERP e inativa no FDV). Quando o desenho chegar, este plano é
conferido contra ele.

Situação: **feito** = teste no branch e verde na sessão; **pendente** = depende de código ainda não escrito. Pendente fica
só aqui, sem `it.skip` nem `it.todo` para ficar verde. Cada caso vira teste no PR do `testes` que segue o merge do dono.

Códigos de erro (decisão do gerente, 24/11/2026): validação de entrada (campo ausente ou formato errado) = **400 do Zod com
o campo**, aceito; **422** fica para regra de negócio (RN).

Decisões de R-20261124-210726-alexandre: casos P-15 a P-18, I-11 a I-13, F-12 a F-14.

## Regras transversais (todas as tarefas)

| # | Caso | Onde | Situação |
|---|---|---|---|
| X-1 | Todo caminho de toda constante `CAMINHOS_*` do SDK que o web importa existe na API de produção, em algum método (GET, POST, PUT, PATCH, DELETE), sem sessão e sem corpo; controles: caminho inventado dá o 404 genérico nos 5 métodos, rota real não. A lista vem do SDK e do import do web (regra 1 e 2 da T-0066): as chaves novas da T-0086 (monitor, reprocessar, log, `CAMINHOS_INTEGRACAO_FDV_TENANT`) entram sozinhas quando o web as importar. | `tests/integracao/rotas/contrato-caminhos.db.test.ts` | feito |
| X-2 | Todo GET das telas novas (T-0086, T-0087, T-0088, T-0059) na fumaça; `fumaca-rotas.json` regenerado; `NAO_EXTRAIVEIS` classificado. | `tests/integracao/rotas/fumaca-telas.db.test.ts` | pendente (cada tela, no PR do `testes` que segue o web) |
| X-3 | O ensaio antes do push roda os testes de `scripts/` sempre que há código, não só no `--tudo` (regra 6). | `tests/scripts/rodar-antes-do-push.sh`, `docs/testes/antes-do-push.md` | feito |
| X-4 | Ensaio com API real (Postgres local) e print com dados fictícios de cada tela nova, 1280 e 390 (regra 3). | `docs/testes/prints/` | pendente (por tela) |
| X-5 | Rota nova: perfil (403), tenant (RLS: o tenant B não lê nem altera o do A) e licença do módulo (403 sem licença). | `tests/integracao/rotas/autorizacao-rotas.test.ts`, `tests/integracao/plataforma/isolamento.db.test.ts` | pendente (por rota) |

## T-0085 — formas e prazos

| # | Critério | Caso | Onde | Situação |
|---|---|---|---|---|
| P-1 | 3 | `parcelas_dias` em lista: o C-6 (`PrazoPagamentoHub`) e o oráculo do Hub no dublê aceitam e recusam os mesmos valores (lista, à vista `[0]`, 999 recusado pelos dois, texto "28/56", número solto, vazia, fração, negativo, texto na lista, nulo; tetos: ver P-4); a massa traz o prazo completo (`descricao` e `prazo_medio_dias`, lote 2, #556). | `tests/ponta-a-ponta-fdv/prazo-contrato.test.ts` | feito |
| P-2 | 3, 4 | O prazo que `mapearCondicao` monta (28/56, à vista, legado sem parcela) passa no C-6 e no oráculo do Hub. | `tests/ponta-a-ponta-fdv/prazo-contrato.test.ts` | feito |
| P-3 | 3 | Massa e dublê do Hub com a lista (lote 1). | `tests/ponta-a-ponta-fdv/apoio/{duble-hub,massa}.ts` | feito (PR do lote 1) |
| P-4 | 3 | Teto do contrato do Hub (C-6: 1 a 24 parcelas de 0 a 365 dias): 24 parcelas e 365 dias aceitos; 25 parcelas e 366 dias recusados, inclusive os dois tetos juntos (24 de 365 aceito, 23×365 + 366 recusado), com o mesmo veredito no C-6 e no oráculo do dublê. O prazo entre 366 e 999 dias (antes à espera de decisão) agora é recusado já no cadastro (R-20261124-210726, decisão 1): não chega ao Hub; ver P-15 a P-18. | `prazo-contrato.test.ts` | feito |
| P-5 | 1 | Prazo sem parcela ou sem prazo médio: 400 com `campo` (`prazos_dias` / `prazo_medio_dias`) na API, e o domínio (RN-CAD-15) recusa com o campo; o legado sem prazo médio continua gravado (nulo). | `tests/integracao/rn/rn-cadastros.test.ts` + API com Postgres | pendente (cadastros, R-202958) |
| P-6 | 1 | Banco (0052): `prazo_medio_dias` 1000 e -1 caem; à vista (tPag 01, 04, 17) com 5 cai; legado nulo grava. | `db/` (banco-dados) e conferência em `tests/integracao/banco/` | pendente (banco, R-202954) |
| P-7 | 2 | RN-PED-07 no pedido manual: prazo com prazo médio acima do do cliente → 422 `codigo: RN-PED-07`, `campo: condicao_pagamento_id`; igual → aceito; cliente sem prazo médio → aceito; prazo incompleto → recusado. | `tests/integracao/rn/` + rota do pedido com Postgres | pendente (pedido, R-203008) |
| P-8 | 2 | RN-PED-07 no pedido do FDV: prazo médio acima do do cliente leva o pedido a `em_analise`, com o motivo; não vai a `rejeitado_erp`. | `tests/ponta-a-ponta-fdv/volta-fdv-erp.db.test.ts` | pendente (P-7 e P-8 esperam o lote B do pedido, depois da migração 0056) |
| P-9 | 3 | Lote 2: `descricao` e `prazo_medio_dias` obrigatórios no prazo do Hub; `ClienteHub.prazo_medio_max_dias` = `cliente.prazo_medio_dias` (nulo omite o campo); conferência C-6 × oráculo como no P-1. | `prazo-contrato.test.ts` (estende) | pendente (integracao-fdv lote 2) |
| P-10 | 3 | Prazo incompleto (sem prazo médio) não sai ao Hub: nenhum lote do dublê traz o registro; quando o cadastro é completado, sai no envio seguinte. | `tests/ponta-a-ponta-fdv/ida-erp-fdv.test.ts` | pendente (lote 2) |
| P-11 | 4 | CSV: `condicoes_pagamento.csv` sem "Nx" e com prazo médio; `cliente.csv` com prazo médio; carga pelo /config grava o prazo médio (banco: funções 0040 a 0044). | `tests/integracao/plataforma/carga-config.db.test.ts` | pendente (cadastros + banco) |
| P-12 | 5 | Rotas novas ou alteradas do prazo e do cliente: perfil, tenant e licença (X-5). | ver X-5 | pendente |
| P-13 | 6 | Depois do deploy: Reprocessar de Condições de pagamento leva os prazos ao FDV sem carga nova. | fumaça manual pelo Alexandre (via PO), registrada no `producao-publicar` | pendente |
| P-14 | — | Valor × regra: o prazo médio é digitado (não calculado); nenhuma tela, CSV ou payload recalcula. | revisão nos PRs de cadastros e integracao-fdv | pendente |
| P-15 | 1 (R-210726, decisão 1) | **API com Postgres + unitário do domínio.** Prazo com uma parcela de 366 dias, com 25 parcelas, ou com `prazo_medio_dias` 366: 400 do Zod com o `campo` (`prazos_dias` / `prazo_medio_dias`), nada gravado (contagem igual); vale na criação e na edição do prazo e no `prazo_medio_dias` do cliente. Hoje o contrato do cadastros ainda tem `MAX_DIAS = 999` e `MAX_PARCELAS = 36`. | `tests/integracao/rn/rn-cadastros.test.ts` + `tests/integracao/rotas/` (API com Postgres) | pendente (cadastros) |
| P-16 | 4 (R-210726, decisão 1) | **Banco/carga.** Carga CSV (`condicoes_pagamento.csv` e `cliente.csv`) com uma linha de 366 dias, uma de 25 parcelas e uma de prazo médio 366, entre linhas válidas: cada uma é recusada na própria linha, com o número da linha, o campo e o motivo ("0 a 365 dias" / "1 a 24 parcelas"); as válidas são gravadas. | `tests/integracao/plataforma/carga-config.db.test.ts` | pendente (cadastros + banco-dados, se a recusa ficar na função de carga) |
| P-17 | 1 (R-210726, decisão 1) | **Tela** (e2e do BKO ou ensaio com API real e print). O formulário do prazo e o do cliente mostram o limite (0 a 365 dias, até 24 parcelas); "+ Parcela" não passa da 24ª; 366 no campo mostra o erro no próprio campo, sem chamar a API, e o 400 da API (P-15) também cai no campo. | `tests/e2e/` + `docs/testes/prints/` | pendente (cadastros) |
| P-18 | 1, 3 (R-210726, decisão 1) | **API com Postgres + pa-p.** Os tetos são aceitos: o prazo com 24 parcelas de 365 dias e prazo médio 365 grava na API e na carga e sai ao Hub (C-6: ver P-4). | API com Postgres em `tests/integracao/rotas/` + `tests/ponta-a-ponta-fdv/ida-erp-fdv.test.ts` | pendente (cadastros + integracao-fdv) |

## T-0086 — integração no /config e no BKO

| # | Critério | Caso | Onde | Situação |
|---|---|---|---|---|
| I-1 | 1 | Reprocessar reenvia só falha e pendente; registro integrado não sai (domínio e banco: nenhuma linha integrada muda de estado nem vai ao dublê); sem carga completa nem inativação. | domínio (integracao-fdv) + `tests/ponta-a-ponta-fdv/ida-erp-fdv.test.ts` | pendente |
| I-2 | 1 | Reprocessar com lote em voo: resposta indica `lote_em_voo`; um segundo clique não duplica envio (idempotência por `Idempotency-Key`). | `tests/integracao/plataforma/integracao-fdv-portal.db.test.ts` | pendente |
| I-3 | 2 | Log do /config sem dado de negócio: a resposta de `LogCadastroFdvPlataforma` com massa que tem nome, CNPJ, CPF, e-mail e telefone fictícios não contém nenhum deles (só códigos, campos e contagens, ADR 0013); o teste falha se aparecer. | `integracao-fdv-portal.db.test.ts` | pendente |
| I-4 | 2 | Log do BKO (admin da empresa) completo: external_id, nome curto, campo, motivo, ação, link "Corrigir" para a tela da T-0088; "Baixar erros (.csv)" com o mesmo conteúdo. Outro perfil: 403. | `tests/integracao/rotas/` + e2e do BKO | pendente |
| I-5 | 3 | Zerar: só superadmin (admin de empresa e outros: 403) e só com a frase "autorizo zerar os dados" (sem ou com outra: 422). | `carga-config.db.test.ts` | pendente (o Zerar atual já tem; muda de aba) |
| I-6 | 3 | Zerar (R-20261124-170915): apaga no ERP e manda ao Hub a inativação dos mesmos registros (no dublê ficam `ativo: false`, não somem); os mantidos (RN-CAD-10) não são apagados nem inativados; auditoria registrada; o resultado aparece no Log com falha por registro e o Reprocessar a reenvia. | `tests/ponta-a-ponta-fdv/` + `carga-config.db.test.ts` | pendente |
| I-7 | 3 | Monitor, Reprocessar e Log: perfil, tenant e licença (X-5); o tenant B não vê o Log do A. | `isolamento.db.test.ts` | pendente |
| I-8 | 4 | Monitor: situação Em dia, Atrasado e Desativado conforme o último sinal (relógio de teste); fila em lotes e linhas. | domínio (integracao-fdv) + rota com Postgres | pendente |
| I-9 | 4 | Prints 1280 e 390 com dados fictícios do /config (abas Integração e Dados) e do Log do BKO, com API real. | `docs/testes/prints/` | pendente |
| I-10 | — | Aba Dados: última carga com data, hora, registros e origem Conector/CSV; Modelo e Importar continuam na fumaça (X-2). | fumaça + e2e | pendente |
| I-11 | 1 (R-210726, decisão 2) | **pa-p.** Hoje o C-6 aceita fracionário: `ProdutoUnidadeHub.fator` é `Quantidade.positive()` (número finito, pode ter casas) e `RetornoErp.itens_faturados[].quantidade` é `z.number()`; o Hub do FDV ainda só aceita inteiro. Massa com uma unidade de fator 2,5 entre unidades de fator inteiro, e um pedido faturado com um item de quantidade 1,5 entre pedidos com quantidades inteiras: só a unidade e só o retorno daquele pedido são recusados (falha com o motivo, nada no dublê); as outras unidades e os outros retornos chegam ao dublê no mesmo envio, e o lote não cai inteiro. Controle: fator 12 e quantidade 3 saem. | `tests/ponta-a-ponta-fdv/ida-erp-fdv.test.ts` + `volta-fdv-erp.db.test.ts` (retorno do faturado) | pendente (integracao-fdv) |
| I-12 | 2 (R-210726, decisão 2) | **API com Postgres + tela.** A recusa do I-11 aparece no Log com o campo (`fator` / `quantidade`) e o motivo "quantidade fracionária: o FDV ainda não aceita decimal" (`produto_unidade` e o retorno do pedido); /config como no I-3; no BKO, com o "Corrigir" (D-4). | `tests/integracao/plataforma/integracao-fdv-portal.db.test.ts` + e2e do BKO | pendente (integracao-fdv + apps/web) |
| I-13 | 1 (R-210726, decisão 2) | **pa-p.** Reprocessar depois do I-11: reenvia só os registros recusados (que continuam recusados enquanto fracionários, sem duplicar a linha do Log); integrados: I-1. Corrigido o fator para inteiro, o registro sai no Reprocessar seguinte. | `tests/ponta-a-ponta-fdv/ida-erp-fdv.test.ts` | pendente (integracao-fdv) |

## T-0087 — telas do core no BKO

| # | Caso | Situação |
|---|---|---|
| C-1 | Só o administrador da empresa gerencia usuários, perfis e permissões; os outros perfis levam 403 na API e não veem o menu. | pendente |
| C-2 | Redefinir senha gera temporária (RN-CORE-10) e não a devolve em log; auditoria sem dado pessoal além do necessário. | pendente |
| C-3 | Tenant isolado: o admin do tenant A não lista nem altera usuário do B (RLS e API). Licenças só leitura no tenant. | pendente |
| C-4 | Listas pelo SDK (filtros na URL, CSV, cursor); limites da ADR 0019 nos campos que vão ao Hub (`external_id` até 200, `forma_pagamento.codigo` até 30): 200 e 30 aceitos, 201 e 31 recusados com campo. | pendente |
| C-5 | Fumaça (X-1, X-2) e prints 1280/390. | pendente |

## T-0088 — telas de cadastro no BKO

| # | Caso | Situação |
|---|---|---|
| D-1 | Edição pela API revalida as RN; escrita idempotente (mesmo `external_id` duas vezes = um registro); evento com versão crescente (T-0034). | pendente |
| D-2 | Ambiente fiscal: a tela mostra homologação/produção; a troca para produção só pela rota da T-0030, nunca pela tela de cadastro (`PATCH /v1/cadastros/filiais/:id` com `ambiente`). | feito: ambiente fora do contrato da filial, descartado; o ambiente segue homologação (`filial-sem-ambiente.db.test.ts`); recusa 400 avaliada na v0.3.13 |
| D-3 | Perfil, tenant e licença (X-5); limites 200/30 da ADR 0019 (C-4). | pendente |
| D-4 | O "Corrigir" do Log (I-4) abre a tela certa do registro. | pendente |
| D-5 | Fumaça (X-1, X-2) e prints 1280/390. `GET /v1/cadastros/tabelas-preco` fica fora da fumaça enquanto a tela não o chama: as páginas de cadastros não têm descritor em `apps/web/src/lib/telas.ts` (mostram "Disponível em breve"); quando a tela entrar, a fumaça pega a rota sozinha pelo `pagina.api`. | pendente (até a tela existir) |

## T-0059 — pré-cadastro de cliente FDV → ERP

Tipos: **unitário** (sem banco), **banco** (Postgres local), **pa-p** (ponta a ponta com o dublê do Hub, worker real e
Postgres local), **tela** (fumaça, e2e do BKO ou ensaio com API real e print).

| # | Critério verificável (desenho) | Tipo | Onde (previsto) | Dono do código validado | Situação |
|---|---|---|---|---|---|
| F-1 | Pendente válido da v1.0.28 (sem `revisao`): o cliente é criado uma vez; o dublê recebe o `vinculado` antes de qualquer `POST /lotes` com o cliente; o lote só sai depois do 200; o `external_id` do lote é igual ao do retorno e é a `chaveHub` do cliente, nunca o `codigo_fdv` (§4 "Aceito", §5.4, §3.3). | pa-p | `tests/ponta-a-ponta-fdv/cliente-fdv-erp.db.test.ts` | integracao-fdv (+ cadastros na criação, banco no `aguarda_vinculo`) | pendente |
| F-2 | Pendente com CNPJ de DV errado e município inexistente: `cliente_recebido` em `recusado` com exatamente 2 erros (`documento_invalido`, `municipio_nao_encontrado`), sem cliente criado. Opção desligada: o corpo no dublê tem só `motivo` (sem `revisao` nem `erros`); ligada: leva `revisao` (quando o pendente trouxe) e `erros` (§2, §4, §7 caso 2). Também no domínio: todas as recusas saem juntas, mensagem do catálogo sem o valor recusado. | unitário + pa-p | `tests/integracao/rn/rn-cadastros.test.ts` (domínio `pre-cadastro-fdv`) + `cliente-fdv-erp.db.test.ts` | cadastros (validação) + integracao-fdv (retorno) | pendente |
| F-3 | Mesmo pendente de novo (`tentativa` 2, mesma revisão): não chama `decidir` de novo, `tentativas_fdv` = 2, um único cliente, o retorno volta a `pendente` e sai de novo; o dublê responde `repetido: true` e a linha de retorno fica `enviado`, sem segunda linha em `cliente_retorno` (§5.1 passo 1, §3.2 `UNIQUE`). | pa-p | `cliente-fdv-erp.db.test.ts` | integracao-fdv (+ banco no `UNIQUE`) | pendente |
| F-4 | Reenvio corrigido (revisão 2) de um recusado: linha nova em `reenviado` e depois `aceito`; a revisão 1 continua `recusado` (histórico); a rota do BKO mostra uma linha por `cliente_uuid`, a da revisão 2, com Revisão "2" (§5.1, §5.5, §6). | pa-p + banco | `cliente-fdv-erp.db.test.ts` | integracao-fdv (+ banco) | pendente |
| F-5 | 422 `external_id_divergente` no retorno: `cliente_retorno` em `falhou`, `conflito_chave` aberto com `vinculo_divergente`, o cliente segue com `aguarda_vinculo = true` (cliente e endereços) e nenhum lote do dublê o traz; aparece no Monitor e no Log (§5.3, §5.4 passo 3). | pa-p | `cliente-fdv-erp.db.test.ts` | integracao-fdv (+ banco) | pendente |
| F-6 | 5xx (e 429 com `Retry-After`) e depois 200: o retorno continua `pendente`, há nova tentativa no prazo do relógio de teste, o dublê recebe o mesmo corpo e grava um único retorno; 401/403 pausam por `credencial` (§5.3). | pa-p | `cliente-fdv-erp.db.test.ts` | integracao-fdv | pendente |
| F-7 | Documento já cadastrado (cliente ativo no tenant): recusa com `documento_ja_cadastrado`, a mensagem não contém o documento e a contagem de clientes não muda (§4 tabela). | unitário + pa-p | `rn-cadastros.test.ts` + `cliente-fdv-erp.db.test.ts` | cadastros | pendente |
| F-8 | Rota `clientesRecebidos` (X-5), com RLS em `cliente_recebido` e `cliente_retorno` e 403 sem `integracao-fdv.ver`. | banco + rota | `tests/integracao/plataforma/isolamento.db.test.ts`, `tests/integracao/rotas/autorizacao-rotas.test.ts` | banco (RLS) + integracao-fdv (rota) | pendente |
| F-9 | LGPD: a resposta da rota, com massa fictícia de CPF, CNPJ, e-mail e telefone, não contém nenhum deles inteiro (só `DocumentoMascaradoFdv`); o log capturado do worker não leva o payload; `payload` nulo no `aceito`; o `CHECK` recusa `recusado` sem payload dentro do prazo (§3.1, §5.5, §6). | banco + pa-p | `cliente-fdv-erp.db.test.ts` + `tests/integracao/banco/` | integracao-fdv (rota e log) + banco (`CHECK`) | pendente |
| F-10 | Contrato: as fixtures do `cliente-erp.ts` do FDV (v1.0.28 e v1.0.30), copiadas para `tests/` (o FDV é só leitura), passam em `ClientesPendentesFdv`; o corpo que o ERP monta passa no `RetornoClienteFdv` e no oráculo do Hub no dublê, nos dois estados da opção; os 200 (`repetido`, `obsoleto`) passam em `RetornoClienteAceitoFdv` (§2, §7 caso 10). | unitário | `tests/ponta-a-ponta-fdv/cliente-fdv-contrato.test.ts` | engenheiro-software (SDK) + integracao-fdv | pendente |
| F-11 | Tela: filtro por situação e cursor; recusado abre os erros por campo; aceito leva "Abrir cliente"; fumaça e prints 1280/390 (X-2, X-4). | tela | `tests/e2e/`, `docs/testes/prints/` | apps/web (+ integracao-fdv na rota) | pendente |
| F-12 | Pendente válido com `telefone` (R-20261124-210726, decisão 3): o cliente criado pela porta `CriadorClienteFdv` tem um contato (`Contato` do cadastros) com o telefone só com dígitos (10 a 13) e o nome do contato do pré-cadastro ou "Contato do FDV" se não vier nenhum; um único contato mesmo com o pendente repetido (F-3). | banco + pa-p | `modules/cadastros/api/criador-cliente-fdv.db.test.ts` (dono cadastros) + `tests/ponta-a-ponta-fdv/cliente-fdv-erp.db.test.ts` | cadastros (porta `CriadorClienteFdv`) + integracao-fdv | pendente |
| F-13 | Telefone ausente (nulo ou vazio): o cliente é criado sem contato. Telefone inválido (fora de 10 a 13 dígitos depois de tirar a máscara): o cliente é criado sem contato e o pré-cadastro fica `aceito`, sem erro de recusa; o comportamento escolhido pelo cadastros (descartar ou outro) fica descrito no README do módulo e o teste confere esse comportamento. | banco + pa-p | `cliente-fdv-erp.db.test.ts` | cadastros + integracao-fdv | pendente |
| F-14 | LGPD: com telefone fictício na massa, o log capturado da API e do worker durante a criação (válido e inválido) não contém o telefone, nem inteiro nem só os dígitos; rota: F-9. | pa-p | `cliente-fdv-erp.db.test.ts` | cadastros + integracao-fdv | pendente |

Notas:
- Apoio de teste (dono `testes`): o dublê ganha `GET /clientes/pendentes` (marca `enviado`, volta à fila em 10 min com
  `tentativa + 1`) e `POST /clientes/{uuid}/retorno` (200, `repetido`, `obsoleto`, os 422 de
  `CODIGOS_RECUSA_RETORNO_CLIENTE_FDV`, falha injetável 5xx/429); a trava de escrita passa a contar o GET de pendentes
  de clientes como escrita, como o de pedidos.
- O que dá para escrever só contra o SDK do #526 (sem código de módulo): F-10 e a parte do dublê acima. Fica para
  depois do merge do #526 no main, no PR do `testes` que antecede o de validação.
- Previsão do `testes` (dono + 15%), contada da entrada do último PR (integracao-fdv e apps): 132 min, com o dublê e o
  F-10 prontos antes (~40 min fora do caminho crítico); sem isso, 172 min.

## Comandos da sessão

- `bash db/scripts/pg-local.sh` e `bash tests/scripts/rodar-antes-do-push.sh` (com código, já roda `scripts/`).
- `pnpm exec vitest run --config tests/vitest.config.ts tests/integracao/rotas tests/ponta-a-ponta-fdv`.
- `node --test scripts/*.test.mjs scripts/*/*.test.mjs .github/scripts/*.test.mjs`.
