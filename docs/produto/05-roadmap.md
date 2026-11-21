# 05 — Roadmap, critérios de pronto e previsão

> Dono: gerente-projetos. Previsão montada **etapa por etapa**, com o tempo do **dono** de cada etapa mais 15% (regra 5 de "Entrega e previsão", doc 07). Ela só muda por motivo novo, escrito aqui com a data.
> Horários em Manaus (UTC−4). Tempos em horas de sessão do dono (trabalho efetivo, não calendário).

## Fases e critérios de pronto
| Fase | Entrega | Pronto quando |
|---|---|---|
| F0 Fundação | Repositórios, governança, guardião, recados, CI, ADRs 0001 a 0005 (0002 proposta), docs 01 a 07 | `coord.mjs verificar` limpo e CI verde num PR vazio |
| F1 Cadastros | Empresa, filial, cliente, produto, equipe e tabelas fiscais (NCM, CEST, CFOP, IBGE), com consulta de CNPJ e CEP | Testes de RN, RLS e BKO de cadastro com print revisado |
| F2 Integração FDV, ida | O ERP publica cadastros no Hub do FDV (contrato do doc 06 do FDV) | Um tenant de teste do FDV recebe tudo sem erro, de forma idempotente |
| F3 Pedidos | O FDV manda o pedido, e o ERP aprova e devolve o status | Ida e volta testadas de ponta a ponta |
| F4 Faturamento em homologação | NF-e 55 em homologação na SEFAZ-AM: autorização, cancelamento, CC-e, inutilização, DANFE, IBS/CBS | 20 notas de teste autorizadas, com o XML guardado |
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
| T-0022 | 20 notas em homologação, XML guardado | testes | 10h00 | 11h30 |
| — | Corretor, marca e revisão final | corretor, design-de-marca, engenheiro | 4h00 | 4h36 |

Esforço total: **82h48**. Caminho crítico, com T-0019 e T-0020 em paralelo: **75h54**. A fase depende de três coisas: a **decisão da ADR 0002**, o **A1 da empresa piloto** e o **credenciamento da empresa como emissora na SEFAZ-AM em homologação**.

### Resumo
| Fase | Esforço (+15%) | Caminho crítico (+15%) |
|---|---|---|
| F1 | 63h15 | 37h57 |
| F2 | 32h12 | 32h12 |
| F3 | 36h48 | 29h54 |
| F4 | 82h48 | 75h54 |
| **F1–F4** | **215h03** | **175h57** |

F2 pode começar assim que a F1 fechar `cadastros`; F3 depende de F2 (o canal com o Hub). F4 pode começar em paralelo com F2 e F3 depois da F1, porque `fiscal` depende só de `cadastros` e `faturamento` precisa só do pedido manual (T-0015). Para isso, a T-0013, a T-0014 e a T-0015 começam logo depois da F1; só a T-0016 e a T-0017 dependem da F2. Com F4 em paralelo, o caminho crítico de F1 a F4 cai para **37h57 + max(32h12 + 29h54, 75h54) = 113h51**.

## Histórico da previsão
- 21/11/2026 — versão 1 (F0, gerente-projetos).
