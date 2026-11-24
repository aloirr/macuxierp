# Plano de testes da v0.3.12 (T-0085, T-0086, T-0087, T-0088, T-0059)

Dono: `testes`. Escrito em 24/11/2026, ~17h20 (Manaus). Os desenhos (ADR 0020, `docs/desenho/T-0085.md` e `T-0086.md`,
commit b131bbc do engenheiro-software) ainda não estão em branch publicado; a base são as tarefas em `.coord/tarefas/` e
os pedidos R-20261124-202954 (banco), -202958 (cadastros), -203003 (integracao-fdv), -203008 (pedido) e -203011 (apps),
mais a decisão R-20261124-170915-alexandre (Zerar apaga no ERP e inativa no FDV). Quando o desenho chegar, este plano é
conferido contra ele.

Situação: **feito** = teste no branch e verde na sessão; **pendente** = depende de código ainda não escrito. Pendente fica
só aqui, sem `it.skip` nem `it.todo` para ficar verde. Cada caso vira teste no PR do `testes` que segue o merge do dono.

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
| P-1 | 3 | `parcelas_dias` em lista: o C-6 (`PrazoPagamentoHub`) e o oráculo do Hub no dublê aceitam e recusam os mesmos 12 valores (lista, à vista `[0]`, 999, texto "28/56", número solto, vazia, fração, negativo, 1000, texto na lista, nulo). | `tests/ponta-a-ponta-fdv/prazo-contrato.test.ts` | feito |
| P-2 | 3, 4 | O prazo que `mapearCondicao` monta (28/56, à vista, legado sem parcela) passa no C-6 e no oráculo do Hub. | `tests/ponta-a-ponta-fdv/prazo-contrato.test.ts` | feito |
| P-3 | 3 | Massa e dublê do Hub com a lista (lote 1). | `tests/ponta-a-ponta-fdv/apoio/{duble-hub,massa}.ts` | feito (PR do lote 1) |
| P-4 | 3 | Teto de parcelas: o pedido R-20261124-203003 diz `.max(36)`; o C-6 do main não tem teto. Quando o teto entrar, P-1 ganha o caso 36 aceito e 37 recusado, nos dois lados (o dublê segue o guia do FDV). | `prazo-contrato.test.ts` | pendente (integracao-fdv; confirmar 36 no guia do FDV) |
| P-5 | 1 | Prazo sem parcela ou sem prazo médio: 422 com `campo` (`prazos_dias` / `prazo_medio_dias`) no domínio (RN-CAD-15) e na API; o legado sem prazo médio continua gravado (nulo). | `tests/integracao/rn/rn-cadastros.test.ts` + API com Postgres | pendente (cadastros, R-202958) |
| P-6 | 1 | Banco (0052): `prazo_medio_dias` 1000 e -1 caem; à vista (tPag 01, 04, 17) com 5 cai; legado nulo grava. | `db/` (banco-dados) e conferência em `tests/integracao/banco/` | pendente (banco, R-202954) |
| P-7 | 2 | RN-PED-07 no pedido manual: prazo com prazo médio acima do do cliente → 422 `codigo: RN-PED-07`, `campo: condicao_pagamento_id`; igual → aceito; cliente sem prazo médio → aceito; prazo incompleto → recusado. | `tests/integracao/rn/` + rota do pedido com Postgres | pendente (pedido, R-203008) |
| P-8 | 2 | RN-PED-07 no pedido do FDV: o mesmo caso volta ao FDV como `rejeitado_erp` com o motivo; o pedido não é gravado. | `tests/ponta-a-ponta-fdv/volta-fdv-erp.db.test.ts` | pendente (pedido + integracao-fdv) |
| P-9 | 3 | Lote 2: `descricao` e `prazo_medio_dias` obrigatórios no prazo do Hub; `ClienteHub.prazo_medio_max_dias` = `cliente.prazo_medio_dias` (nulo omite o campo); conferência C-6 × oráculo como no P-1. | `prazo-contrato.test.ts` (estende) | pendente (integracao-fdv lote 2) |
| P-10 | 3 | Prazo incompleto (sem prazo médio) não sai ao Hub: nenhum lote do dublê traz o registro; quando o cadastro é completado, sai no envio seguinte. | `tests/ponta-a-ponta-fdv/ida-erp-fdv.test.ts` | pendente (lote 2) |
| P-11 | 4 | CSV: `condicoes_pagamento.csv` sem "Nx" e com prazo médio; `cliente.csv` com prazo médio; carga pelo /config grava o prazo médio (banco: funções 0040 a 0044). | `tests/integracao/plataforma/carga-config.db.test.ts` | pendente (cadastros + banco) |
| P-12 | 5 | Rotas novas ou alteradas do prazo e do cliente: perfil, tenant e licença (X-5). | ver X-5 | pendente |
| P-13 | 6 | Depois do deploy: Reprocessar de Condições de pagamento leva os prazos ao FDV sem carga nova. | fumaça manual pelo Alexandre (via PO), registrada no `producao-publicar` | pendente |
| P-14 | — | Valor × regra: o prazo médio é digitado (não calculado); nenhuma tela, CSV ou payload recalcula. | revisão nos PRs de cadastros e integracao-fdv | pendente |

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
| D-2 | Ambiente fiscal: a tela mostra homologação/produção; a troca para produção só pela rota da T-0030, nunca pela tela de cadastro (a rota de edição recusa o campo). | pendente |
| D-3 | Perfil, tenant e licença (X-5); limites 200/30 da ADR 0019 (C-4). | pendente |
| D-4 | O "Corrigir" do Log (I-4) abre a tela certa do registro. | pendente |
| D-5 | Fumaça (X-1, X-2) e prints 1280/390. | pendente |

## T-0059 — pré-cadastro de cliente FDV → ERP

| # | Caso | Situação |
|---|---|---|
| F-1 | `GET /integracao/v1/clientes/pendentes` no dublê com o payload do FDV v1.0.27 (hub-api §6.6b, RN-INT-22); o ERP valida e responde `vinculado` ou `rejeitado_erp` com motivo por campo. | pendente (respostas do FDV às 6 perguntas) |
| F-2 | Reenvio depois de `rejeitado_erp` atualiza a mesma linha em "Clientes recebidos do FDV" (sem duplicar). | pendente |
| F-3 | Tela do BKO: documento mascarado; sem CPF/CNPJ inteiro na resposta nem no log (LGPD). | pendente |
| F-4 | Aceito vira cliente no ERP com o `external_id` do FDV e volta como `vinculado`; perfil, tenant e licença (X-5). | pendente |

## Comandos da sessão

- `bash db/scripts/pg-local.sh` e `bash tests/scripts/rodar-antes-do-push.sh` (com código, já roda `scripts/`).
- `pnpm exec vitest run --config tests/vitest.config.ts tests/integracao/rotas tests/ponta-a-ponta-fdv`.
- `node --test scripts/*.test.mjs scripts/*/*.test.mjs .github/scripts/*.test.mjs`.
