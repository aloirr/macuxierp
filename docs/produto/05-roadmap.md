# 05 — Roadmap, critérios de pronto e previsão

> Dono: gerente-projetos. Previsão montada **etapa por etapa**, com o tempo do **dono** de cada etapa mais 15% (regra 5 de "Entrega e previsão", doc 07). Ela só muda por motivo novo, escrito aqui com a data.
> Horários em Manaus (UTC−4). Tempos em horas de sessão do dono (trabalho efetivo, não calendário).

## Fases e critérios de pronto
| Fase | Entrega | Pronto quando |
|---|---|---|
| F0 Fundação | Repositórios, governança, guardião, recados, CI, ADRs 0001 a 0005 (0002 proposta), docs 01 a 07 | `coord.mjs verificar` limpo e CI verde num PR vazio |
| F1 Cadastros | Empresa, filial, cliente, produto, equipe e tabelas fiscais (NCM, CEST, CFOP, IBGE), com consulta de CNPJ e CEP | Testes de RN, RLS e BKO de cadastro com print revisado |
| F2 Integração FDV, ida | O ERP publica cadastros no Hub do FDV (contrato do doc 06 do FDV) | T-0012 verde contra o dublê do Hub **e** Etapa 2 do roteiro da virada (forma_pagamento na thathyany) conferida, sem erro e com reenvio idempotente (decisão do gerente, 22/11, 00h10, pela decisão do Alexandre de 23h22) |
| F3 Pedidos | O FDV manda o pedido, e o ERP aprova e devolve o status | Ida e volta testadas de ponta a ponta |
| F4 Faturamento em homologação | NF-e 55 contra o simulador da SEFAZ-AM em homologação (T-0045, ADR 0008): autorização, rejeição, cancelamento, CC-e, inutilização, consulta, contingência, DANFE, IBS/CBS/IS | 20 notas autorizadas no simulador, com o XML guardado (decisão do Alexandre, 21/11, 22h59) |
| Homologação real (antes da F5) | As mesmas operações na homologação real da SEFAZ-AM, com o A1 e o credenciamento da thathyany (T-0046) | Notas autorizadas na homologação real, com o XML guardado; etapa obrigatória antes da F5 |
| F5 Produção piloto | Primeira empresa em produção fiscal | "aprovo produção fiscal <empresa>" do Alexandre |

## Previsão F1 a F4 (21/11/2026, versão 1)
**Base da previsão:** o ERP ainda não tem tempo medido de nenhum dono. A base é o porte de tarefas equivalentes no FDV (cadastro, Hub, pedido), estimado pelo gerente. Ao fim da F1, a previsão de F2 a F4 é refeita com o tempo real medido dos donos. Esse é o motivo novo já previsto.

### F1 — Cadastros
| Tarefa | Etapa | Dono | Base | +15% |
|---|---|---|---|---|
| T-0002 | Desenho da F1 e contratos | engenheiro-software | 3h00 | 3h27 |
| T-0003 | Banco: papéis, schemas, RLS, tabelas oficiais | banco-dados | 8h00 | 9h12 |
| T-0004 | API, auth, licenças e worker base | engenheiro-software | 8h00 | 9h12 |
| T-0005 | Shell do BKO (Next.js) | engenheiro-apps | 6h00 | 6h54 |
| T-0006 | Core: empresa, usuários, perfis, A1 | modulo-core | 8h00 | 9h12 |
| T-0007 | Cadastros completos + CNPJ/CEP/IE | modulo-cadastros | 14h00 | 16h06 |
| T-0008 | Testes de RN, RLS e prints do BKO | testes | 5h00 | 5h45 |
| — | Corretor, marca e revisão final | corretor, design-de-marca, engenheiro | 3h00 | 3h27 |

Esforço total: **63h15**. Caminho crítico, com T-0003, T-0004 e T-0005 em paralelo e depois T-0006 e T-0007 em paralelo: **37h57**.

T-0023 (assinatura da marca) e T-0024 (deploy na VM, ADR 0003) ficam fora desta conta: não estão no caminho crítico da F1 e entram na versão 2 da previsão, com a base dos donos.

### F2 — Integração FDV, ida
| Tarefa | Etapa | Dono | Base | +15% |
|---|---|---|---|---|
| T-0009 | Desenho do mapeamento ERP → Hub | engenheiro-software | 3h00 | 3h27 |
| T-0010 | Banco: schema `integracao_fdv` | banco-dados | 3h00 | 3h27 |
| T-0011 | Conector nativo: lotes, cursor, fila, monitor | modulo-integracao-fdv | 14h00 | 16h06 |
| T-0012 | Ponta a ponta com tenant de teste do FDV | testes | 6h00 | 6h54 |
| — | Corretor e revisão final | corretor, engenheiro | 2h00 | 2h18 |

Esforço e caminho crítico, que aqui são iguais porque a fase é sequencial: **32h12**. A fase depende de **um tenant de teste no FDV com credencial de conector**, que o time do FDV cria a pedido do Alexandre.

### F3 — Pedidos
| Tarefa | Etapa | Dono | Base | +15% |
|---|---|---|---|---|
| T-0013 | Desenho do pedido e do retorno | engenheiro-software | 2h00 | 2h18 |
| T-0014 | Banco: schema `pedido` | banco-dados | 4h00 | 4h36 |
| T-0015 | Pedido: manual, validações, aprovação | modulo-pedido | 12h00 | 13h48 |
| T-0016 | Receber pedidos do FDV e devolver status | modulo-integracao-fdv | 6h00 | 6h54 |
| T-0017 | Ida e volta de ponta a ponta | testes | 6h00 | 6h54 |
| — | Corretor, marca e revisão final | corretor, design-de-marca, engenheiro | 2h00 | 2h18 |

Esforço total: **36h48**. Caminho crítico, com T-0015 e T-0016 em paralelo: **29h54**.

### F4 — Faturamento em homologação
| Tarefa | Etapa | Dono | Base | +15% |
|---|---|---|---|---|
| T-0018 | Spike da biblioteca NF-e em homologação AM | engenheiro-software | 6h00 | 6h54 |
| T-0019 | Banco: fiscal, faturamento, numeração, XML imutável | banco-dados | 6h00 | 6h54 |
| T-0020 | Fiscal: motor ICMS/ST/IPI/PIS/COFINS + IBS/CBS/IS | modulo-fiscal | 16h00 | 18h24 |
| T-0021 | Faturamento: NF-e, eventos, DANFE, contingência, títulos | modulo-faturamento | 30h00 | 34h30 |
| T-0045 | Simulador da SEFAZ-AM em homologação e A1 de teste (nova, 21/11) | engenheiro-software | 10h00 | 11h30 |
| T-0022 | 20 notas no simulador, XML guardado | testes | 10h00 | 11h30 |
| — | Corretor, marca e revisão final | corretor, design-de-marca, engenheiro | 4h00 | 4h36 |

Esforço total: **82h48**. Caminho crítico, com T-0019 e T-0020 em paralelo: **75h54**. A fase depende de três coisas: a **decisão da ADR 0002** (tomada em 20/11: opção A, R-20261120-231934-gerente-projetos), o **A1 de homologação da empresa piloto, a thathyany** (R-20261120-231848-gerente-projetos), e o **credenciamento da thathyany como emissora na SEFAZ-AM em homologação**.

### Empresa piloto e tarefas da thathyany (20/11/2026)
A empresa piloto é a **thathyany**, que já usa o Macuxi FDV pelo kit do Conector. Entram duas tarefas fora do caminho crítico, sem mudar os números acima:
- **T-0026**, carga inicial dos cadastros da thathyany com os CSVs do kit, depois da T-0007.
- **T-0027**, virada do conector com o time do FDV: o kit sai das entidades que o ERP publicar, depois da F3 e da T-0024.

A base das duas entra na versão 2 da previsão, medida no fim da F1.

~~Os testes da F2 e da F3 continuam num tenant de teste do FDV.~~ Substituído em 21/11, 23h22: "O TESTE É NA EMPRESA DA THATHYANY E PONTO FINAL". A rodada real da F2 e da F3 é a virada entidade por entidade na thathyany (`docs/status/2026-11-21-roteiro-virada-thathyany.md`); o dublê do Hub fica só nos testes unitários.

### Resumo
| Fase | Esforço (+15%) | Caminho crítico (+15%) |
|---|---|---|
| F1 | 63h15 | 37h57 |
| F2 | 32h12 | 32h12 |
| F3 | 36h48 | 29h54 |
| F4 | 82h48 | 75h54 |
| **F1–F4** | **215h03** | **175h57** |

F2 pode começar assim que a F1 fechar `cadastros`; F3 depende de F2 (o canal com o Hub). F4 pode começar em paralelo com F2 e F3 depois da F1, porque `fiscal` depende só de `cadastros` e `faturamento` precisa só do pedido manual (T-0015). Para isso, a T-0013, a T-0014 e a T-0015 começam logo depois da F1; só a T-0016 e a T-0017 dependem da F2. Com F4 em paralelo, o caminho crítico de F1 a F4 cai para **37h57 + max(32h12 + 29h54, 75h54) = 113h51**.

## Previsão F2 a F4 (21/11/2026, 23h00, versão 2: tudo em paralelo)
**Motivo novo:** decisão do Alexandre de 21/11, 22h59: "Abre tudo ao mesmo tempo. Sobre o certificado e homologação, simule elas para nao depender da thathyany." Com isso:
- F2, F3 e F4 começam juntas, sem esperar o fechamento da F1;
- a homologação real sai do caminho e vira a T-0046, obrigatória antes da F5;
- entra o simulador (T-0045).
**Base:** a mesma da versão 1, o tempo do dono mais 15%. Na F1, o real ficou abaixo da previsão (T-0026: cerca de 5h35 contra 13h22; T-0008: cerca de 2h contra 5h45). Por isso as datas abaixo são o teto. A base nova, com o tempo medido, entra na versão 3, quando os primeiros lotes de cada dono fecharem.
**Início:** todas as sessões abriram entre 22h56 e 22h58 de 21/11. As datas supõem sessões rodando sem parar e merge a cada lote.

| Tarefa | Dono | +15% | Depende de | Fim previsto (teto) |
|---|---|---|---|---|
| T-0011 | modulo-integracao-fdv | 16h06 | — (em andamento desde 22h15) | 22/11 14h20 |
| T-0012 | testes | 6h54 | T-0011 (dublê do Hub até o tenant do FDV) | 22/11 17h00 (rodada real pendente do tenant) |
| T-0014 | banco-dados | 4h36 | T-0013 (no main) | 22/11 03h35 |
| T-0015 | modulo-pedido | 13h48 | T-0014 para o lote 2 | 22/11 12h50 |
| T-0016 | modulo-integracao-fdv | 6h54 | contratos da T-0015 | 22/11 06h00 |
| T-0017 | testes | 6h54 | T-0015 e T-0016 | 22/11 16h00 (rodada real pendente do tenant) |
| T-0045 | engenheiro-software | 11h30 | — | 22/11 10h30 |
| T-0018 | engenheiro-software | 6h54 | T-0045, em paralelo | 22/11 06h00 |
| T-0019 | banco-dados | 6h54 | — | 22/11 06h00 |
| T-0020 | modulo-fiscal | 18h24 | — | 22/11 17h30 |
| T-0021 | modulo-faturamento | 34h30 | contratos das T-0015, T-0019, T-0020 e T-0045 (dublês até chegarem) | 23/11 09h30 |
| T-0022 | testes | 11h30 | T-0021 | 23/11 12h00 |

**Marcos:**
- Primeira nota autorizada no simulador a partir de um pedido manual: **22/11, por volta das 14h00 (Manaus)**, com teto às 18h00. O caminho é o lote 1 da T-0021 (emissão e autorização), o lote 2 da T-0015 (pedido manual aprovado pela API), o contrato e os grupos obrigatórios da T-0020 e a autorização do simulador (T-0045).
- F3 com ida e volta testada contra o dublê: 22/11, 16h00. Com o tenant real do FDV, mais 2h a partir da entrega da credencial.
- F4 pelo critério novo (20 notas no simulador): 23/11, 12h00.
- Homologação real (T-0046): depende do credenciamento da thathyany na SEFAZ-AM e do A1 dela. Sem data até isso existir.

## Histórico da previsão
- 21/11/2026 — versão 1 (F0, gerente-projetos).
- 20/11/2026, 23h30 — versão 1 mantida. Motivo: piloto thathyany e ADR 0002 opção A (seção "Empresa piloto").
- 21/11/2026, 23h00 — versão 2. Motivo: decisão do Alexandre de 22h59 (tudo em paralelo; certificado e homologação simulados). A F4 passa a ter o critério das 20 notas no simulador, a T-0045 entra e a homologação real vira a T-0046.
- 21/11/2026, 23h50 — versão 2 mantida nas datas do ERP. Motivo: decisões de 23h10, 23h12 e 23h22 (pedido do FDV entra aprovado; virada na thathyany; external_id). A T-0011 passa de 16h06 para 18h41 e a T-0016 ganha 1h21; a primeira nota simulada não muda. A rodada real da F2/F3 passa a depender do deploy (T-0024) e da carga da thathyany no ERP (Etapa 1 do roteiro).
- 22/11/2026, 00h40 — versão 2 mantida. Motivos: T-0020 ganha o lote 4 (CST 60/CSOSN 500 com ST retido e CST 51 com diferimento), de 18h24 para 20h42; T-0015 de 14h57 para 15h43 (decisões de 23h55 e 00h30); a primeira nota simulada não muda.
