# Quadro — Macuxi ERP

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada). Horários de Manaus.
> Fase atual: **F1 Cadastros** (F0 no `main` em 7e6c055, PR #1, 20/11 23h20). Previsão: doc 05.
> Empresa piloto: **thathyany** (R-20261120-231848-gerente-projetos). Biblioteca NF-e: ADR 0002 opção A (R-20261120-231934-gerente-projetos).

| Tarefa | Título | Fase | Dono | Status | Onde |
|---|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | F0 Fundação: estrutura, governança, guardião, recados, CI, docs 01–07, ADRs 0001–0005 | F0 | alexandre | concluida | PR #1 → 7e6c055 |
| [T-0002](tarefas/T-0002.md) | Desenho da F1 e contratos de core e cadastros (e ADR 0002 → aceita) | F1 | engenheiro-software | concluida | PR #4 → 165c5db |
| [T-0003](tarefas/T-0003.md) | Banco: papéis, schemas, RLS e tabelas oficiais (NCM, CEST, CFOP, CST, IBGE, cClassTrib) | F1 | banco-dados | concluida | PR #10 → 820cd28 |
| [T-0004](tarefas/T-0004.md) | API (Fastify), autenticação, licenças e worker base | F1 | engenheiro-software | concluida | PR #7 → 6e9ba49; PR #13 → 8a1d221 |
| [T-0005](tarefas/T-0005.md) | Shell do BKO (Next.js) com menu pelos manifestos | F1 | engenheiro-apps | concluida | PR #8 → 880b5f8 |
| [T-0006](tarefas/T-0006.md) | Core: empresa, usuários, perfis e certificado A1 (ADR 0005) | F1 | modulo-core | concluida | PR #14 → abcf95f |
| [T-0007](tarefas/T-0007.md) | Cadastros: clientes, produtos, preços, estoque, filiais, equipe e carteira, consultas CNPJ/CEP/IE | F1 | modulo-cadastros | concluida | PR #15 → 52c7b7e |
| [T-0008](tarefas/T-0008.md) | Testes da F1: RN, RLS e prints do BKO de cadastro | F1 | testes | em_andamento | nuvem/T-0008-testes-f1 |
| [T-0009](tarefas/T-0009.md) | Desenho do mapeamento ERP → Hub do FDV | F2 | engenheiro-software | em_andamento | nuvem/T-0009-mapa-hub |
| [T-0010](tarefas/T-0010.md) | Banco: schema integracao_fdv | F2 | banco-dados | em_andamento | nuvem/T-0010-schema-integracao |
| [T-0011](tarefas/T-0011.md) | Conector nativo: lotes, cursor, fila, sinal e monitor | F2 | modulo-integracao-fdv | aberta | — |
| [T-0012](tarefas/T-0012.md) | Integração ida de ponta a ponta com tenant de teste do FDV | F2 | testes | aberta | — |
| [T-0013](tarefas/T-0013.md) | Desenho do pedido e do retorno ao FDV | F3 | engenheiro-software | aberta | — |
| [T-0014](tarefas/T-0014.md) | Banco: schema pedido | F3 | banco-dados | aberta | — |
| [T-0015](tarefas/T-0015.md) | Pedido: manual, validações e aprovação | F3 | modulo-pedido | aberta | — |
| [T-0016](tarefas/T-0016.md) | Receber pedidos do FDV e devolver status | F3 | modulo-integracao-fdv | aberta | — |
| [T-0017](tarefas/T-0017.md) | Pedidos: ida e volta de ponta a ponta | F3 | testes | aberta | — |
| [T-0018](tarefas/T-0018.md) | Spike da biblioteca NF-e em homologação AM (ADR 0002) | F4 | engenheiro-software | bloqueada | — |
| [T-0019](tarefas/T-0019.md) | Banco: fiscal, faturamento, numeração sem buraco e XML imutável | F4 | banco-dados | aberta | — |
| [T-0020](tarefas/T-0020.md) | Fiscal: motor ICMS, ST, IPI, PIS, COFINS, IBS, CBS e IS | F4 | modulo-fiscal | aberta | — |
| [T-0021](tarefas/T-0021.md) | Faturamento: NF-e 55, eventos, DANFE, contingência, títulos | F4 | modulo-faturamento | aberta | — |
| [T-0022](tarefas/T-0022.md) | 20 notas em homologação na SEFAZ-AM com o XML guardado | F4 | testes | aberta | — |
| [T-0023](tarefas/T-0023.md) | Assinatura "Macuxi ERP" da marca (proposta ao Alexandre) | F1 | design-de-marca | em_revisao | PR #5 (escolha do Alexandre: A, B ou C) |
| [T-0024](tarefas/T-0024.md) | Deploy do ERP na VM do FDV com trava compartilhada (ADR 0003) | F1 | engenheiro-software | em_andamento | nuvem/T-0024-deploy |
| [T-0025](tarefas/T-0025.md) | coord.mjs: gravar recado por git quando a API recusar a escrita na nuvem | F1 | alexandre | bloqueada | — |
| [T-0026](tarefas/T-0026.md) | Carga inicial dos cadastros da thathyany pelos CSVs do kit | F1 | modulo-cadastros | em_andamento | PR #26 (desenho da carga, 6f34859); implementação em nuvem/T-0026-carga-csv-impl depois do #19 |
| [T-0027](tarefas/T-0027.md) | Virada do conector da thathyany: kit do FDV sai, conector nativo do ERP entra | F3 | modulo-integracao-fdv | aberta | — |
| [T-0028](tarefas/T-0028.md) | Tokens da marca em packages/ui (cores, situação, escala tipográfica) | F1 | designer-ux | concluida | PR #12 → 4c4d46f |
| [T-0029](tarefas/T-0029.md) | Integração de plataforma da F1 (módulos na API, multipart, worker, helpers comuns) | F1 | engenheiro-software | em_revisao | PR #19 |
| [T-0030](tarefas/T-0030.md) | Troca da filial para produção fiscal só com a aprovação do Alexandre conferida (regra 7) | F1 | engenheiro-software | em_andamento | PR #24 (desenho e ADR 0006, 1753312) e PR #25 (corretor); etapa 2 em nuvem/T-0030-producao-fiscal-impl depois do #19 |
| [T-0031](tarefas/T-0031.md) | Core: resíduos da revisão do PR #14 (RD-0008, RD-0009, lint e teste de banco da concorrência) | F1 | modulo-core | concluida | PR #18 → 65a25f3 |
| [T-0032](tarefas/T-0032.md) | Banco: updated_at estritamente crescente por linha (token de concorrência) | F1 | banco-dados | concluida | PR #20 → ee17b80 |
| [T-0033](tarefas/T-0033.md) | Core: expor lerChaveA1 e as funções de validade do A1 pela api (destrava o PR #19) | F1 | modulo-core | concluida | PR #22 → cba7f5f |

## Travado pela nuvem (retomada de 21/11, 21h15)
| Sessão | Caminhos |
|---|---|
| nuvem/T-0029-integracao-f1 (engenheiro-software, session_019xHEXpYmU4MzrgksrNchfF) | `apps/api`, `apps/worker`, `packages/platform-sdk`, `scripts/plataforma/` |
| nuvem/T-0024-deploy (engenheiro-software, session_019xHEXoK7AspqQTPJNMcz1h) | `compose.yml`, `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `scripts/implantacao/` (sem `.github/**`; Dockerfile do web por pedido ao engenheiro-apps) |
| nuvem/T-0030-producao-fiscal (engenheiro-software, desenho, session_019xHEXqu48yEhqy1UTdHw8c) | `docs/decisoes/0006-*`, `docs/desenho/T-0030.md` |
| nuvem/T-0009-mapa-hub (engenheiro-software, desenho, session_019xHEXphmDDE9abQJxH7PT3) | `docs/desenho/T-0009.md` |
| nuvem/T-0010-schema-integracao (banco-dados, session_019xHEXsJDwtbfrqPb59WRhi) | `db/migrations/0007_integracao_fdv.sql`, `db/` testes, `modules/integracao-fdv/db/` |
| nuvem/T-0026-carga-csv (engenheiro-software, desenho, session_019xHEXs2e5KztsidbXc31AK) | `docs/desenho/T-0026.md` (implementação do modulo-cadastros depois do #19) |
| nuvem/T-0008-testes-f1 (testes, session_019xHEXqAcErk9EQAtPnDHCk) | `tests/`, `docs/testes/` |
| nuvem/T-0023-assinatura-erp (PR #5) | `docs/marca/` |

## Reservas
- ADR: 0001–0005 usadas; 0006 reservada para a T-0030 (21/11). Migrações: 0007 reservada para a T-0010 e 0008 para a T-0030, se precisar.
- Tarefas: T-0001–T-0033 usadas; próxima livre: T-0034.
- Achados do corretor (RD): reservados pelo gerente antes de numerar. RD-0020–0022 T-0033 (PR #22); RD-0023–0026 T-0030 (PRs #24 e #25); RD-0027–0033 T-0026 (PR #26, renumerar os RD-0025–0031); próxima livre: RD-0034. Sessão que vai numerar pede a faixa ao gerente por send_message.

## Depende do Alexandre
- Secrets do GitHub e `.env` de produção (banco `macuxierp`, `MACUXIERP_CHAVE_A1` (32 bytes, obrigatória), S3, SMTP); DNS e rota `erp.` no túnel.
- A1 de homologação da thathyany pela tela do BKO (ADR 0005); credenciamento da thathyany na SEFAZ-AM.
- T-0025 (governança): abrir uma sessão com `MACUXI_AGENTE=alexandre` (só o Alexandre define), porque a sessão aberta rodou como gerente-projetos e o guardião bloqueou `scripts/coord*.mjs`; depois, autorizar o merge do PR dela. É ela que destrava a gravação de recados na nuvem.
- Pedir ao time do FDV: tenant de teste com conector (F2) e a trava `flock` no `implantar.sh` do FDV (ADR 0003); depois da F3, a virada do kit-thathyany (T-0027).

## Próximos lotes (ordem do doc 05)
> Retomada em 21/11/2026, 21h15 (Manaus): as sessões da T-0029 e da T-0033 caíram por volta das 18h50. Sessões novas abertas para os mesmos branches.
1. Caminho crítico: T-0033 no main (PR #22, cba7f5f) → T-0029 troca as cópias pelos exports do core → merge do #19.
2. Em paralelo, sem depender do #19: T-0030 (desenho e ADR 0006), T-0024 (deploy, sem publicar), T-0009 e T-0010 (F2, liberada pelo doc 05 com `cadastros` fechado), T-0026 (desenho da carga) e T-0008 (plano e testes da F1 sobre o `main`).
3. Depois do #19: ligações do core, do cadastros (cursor, CSV, LGPD), do banco-dados (tenants ativos, avisos) e do engenheiro-apps (listas no shell); implementação da T-0030 e da T-0026.
4. Depois da F3 e da T-0024: T-0027.

## Regra provisória de recados (até a T-0025)
A sessão da nuvem que não consegue gravar recado (a API dá 403 e o guardião bloqueia o link de `.coord/recados`) registra o que enviaria no corpo do PR e no próprio diário. O guardião não se contorna.
