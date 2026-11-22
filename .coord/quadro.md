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
| [T-0009](tarefas/T-0009.md) | Desenho do mapeamento ERP → Hub do FDV | F2 | engenheiro-software | concluida | PR #29 → 570566c; P-2 = opção A (21h45) |
| [T-0010](tarefas/T-0010.md) | Banco: schema integracao_fdv | F2 | banco-dados | em_revisao | PR #38 (fd25789); corretor e engenheiro sem 🔴 |
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
| [T-0023](tarefas/T-0023.md) | Assinatura "Macuxi ERP" da marca (proposta ao Alexandre) | F1 | design-de-marca | em_revisao | PR #5: A principal e C vertical (decisão de 21/11, 21h29); design-de-marca ajusta |
| [T-0024](tarefas/T-0024.md) | Deploy do ERP na VM do FDV com trava compartilhada (ADR 0003) | F1 | engenheiro-software | em_revisao | PR #31 (e47492d, só engenheiro-software); web (cc8ab81) e corretor (657afa7) esperam autorização de push do Alexandre na sessão; o #31 entra junto com o PR do web |
| [T-0025](tarefas/T-0025.md) | coord.mjs: gravar recado por git quando a API recusar a escrita na nuvem | F1 | concluida | PR #27 → 31b7253 (R-20261121-213740-alexandre); ADR 0004 no PR #30 |
| [T-0026](tarefas/T-0026.md) | Carga inicial dos cadastros da thathyany pelos CSVs do kit | F1 | modulo-cadastros | em_andamento | PR #26 → 6552f49 e #28 → 7df1c24; etapa 2 em 3 PRs: banco 0010, SDK e CLI (engenheiro-software), cadastros |
| [T-0027](tarefas/T-0027.md) | Virada do conector da thathyany: kit do FDV sai, conector nativo do ERP entra | F3 | modulo-integracao-fdv | aberta | — |
| [T-0028](tarefas/T-0028.md) | Tokens da marca em packages/ui (cores, situação, escala tipográfica) | F1 | designer-ux | concluida | PR #12 → 4c4d46f |
| [T-0029](tarefas/T-0029.md) | Integração de plataforma da F1 (módulos na API, multipart, worker, helpers comuns) | F1 | engenheiro-software | concluida | PR #19 → 64ca207 |
| [T-0030](tarefas/T-0030.md) | Troca da filial para produção fiscal só com a aprovação do Alexandre conferida (regra 7) | F1 | engenheiro-software | em_andamento | PR #24 → 377cad8 e #25 → a17ebc1; etapa 2 (core, banco 0008, script) em andamento |
| [T-0031](tarefas/T-0031.md) | Core: resíduos da revisão do PR #14 (RD-0008, RD-0009, lint e teste de banco da concorrência) | F1 | modulo-core | concluida | PR #18 → 65a25f3 |
| [T-0032](tarefas/T-0032.md) | Banco: updated_at estritamente crescente por linha (token de concorrência) | F1 | banco-dados | concluida | PR #20 → ee17b80 |
| [T-0034](tarefas/T-0034.md) | Cadastros: versão crescente por agregado nos eventos (D6; hoje tudo sai com versao 1) | F1 | engenheiro-software | em_revisao | PR #39 (fe4bbd2; opção c: contador por agregado na outbox, sem ADR e sem migração); a sessão segue na T-0037 e nos contratos C-1 a C-4 |
| [T-0036](tarefas/T-0036.md) | coord.mjs: melhorias da revisão do PR #27 (credencial na URL do erro, GIT_TERMINAL_PROMPT, 403 de limite, leitura atrasada) | F1 | alexandre | aberta | quando o Alexandre pedir |
| [T-0037](tarefas/T-0037.md) | Cadastros pelo SDK: cursor, CSV, filtros, naoEncontrado e ExportadorModulo LGPD (ligação da F1) | F1 | modulo-cadastros | em_andamento | sessão da T-0034, branch nuvem/T-0037-cadastros-sdk |
| [T-0038](tarefas/T-0038.md) | Testes: MACUXI_DB_MIGRACOES no rodar-antes-do-push (ligação da F1) | F1 | testes | em_andamento | sessão da T-0008, branch nuvem/T-0038-db-migracoes |
| [T-0039](tarefas/T-0039.md) | Shell do BKO: listas pelo platform-sdk/listas (CSV, filtros na URL, proximo_cursor) | F1 | engenheiro-apps | em_revisao | PR #37 (7b91a87); lacunas a e b aceitas pelo gerente (22h08); a lacuna c virou a T-0041 |
| [T-0040](tarefas/T-0040.md) | Core e worker: multipart do A1, listas pelo SDK, exportação LGPD, avisos e rotinas reais (ligação da F1) | F1 | modulo-core | em_andamento | sessão da T-0035 |
| [T-0035](tarefas/T-0035.md) | Alerta do A1: adaptadores SQL de FonteCertificados.vencendoAte (limite exclusivo) e DestinoAvisos (UNIQUE certificado e dia) | F1 | modulo-core | em_andamento | PR #34 (banco 0009, c392790) aprovado pelo engenheiro sem 🔴 (3 🟡 para ajuste depois), na fila de merge; core e worker com a T-0040 (session_019xHEXqAV3pSJoKMm5TmEWq) |
| [T-0041](tarefas/T-0041.md) | SDK: descritor comum de página de lista (lacuna c do PR #37, RD-0121) | F1 | engenheiro-software | em_andamento | sessão nova no ambiente do engenheiro-software |
| [T-0033](tarefas/T-0033.md) | Core: expor lerChaveA1 e as funções de validade do A1 pela api (destrava o PR #19) | F1 | modulo-core | concluida | PR #22 → cba7f5f |

## Travado pela nuvem (21/11, 21h46)
| Sessão | Caminhos |
|---|---|
| nuvem/T-0024-deploy, PR #31 (engenheiro-software, session_019xHEXoK7AspqQTPJNMcz1h) | `compose.yml`, `apps/api/Dockerfile`, `.dockerignore`, `scripts/deploy/producao/`, `scripts/ci/producao-conferir*`; web e corretor em PRs próprios |
| nuvem/T-0030-producao-fiscal-impl (session_019xHEXqu48yEhqy1UTdHw8c) | `modules/core/` (ambiente fiscal), `db/migrations/0008_*`, `scripts/plataforma/` |
| nuvem/T-0010-schema-integracao (banco-dados, session_019xHEXsJDwtbfrqPb59WRhi) | `db/migrations/0007_integracao_fdv.sql`, `modules/integracao-fdv/db/` |
| nuvem/T-0026-carga-csv-impl (session_019xHEXs2e5KztsidbXc31AK) | `modules/cadastros/` (carga), `db/migrations/0010_*` |
| nuvem/T-0034-versao-eventos (modulo-cadastros, session_019xHEXqYBXehDiTnkhpMnq5) | `modules/cadastros/api/` (eventos) |
| nuvem/T-0035-alerta-a1-sql (session_019xHEXqAV3pSJoKMm5TmEWq) | `db/migrations/0009_*`, `modules/core/` (adaptadores do A1), `apps/worker/src/main.ts` |
| nuvem/T-0008-testes-f1 (testes, session_019xHEXqAcErk9EQAtPnDHCk) | `tests/`, `docs/testes/` |
| nuvem/T-0023-assinatura-erp, PR #5 (design-de-marca, session_019xHEXsi68pkRSBNcRmrmW9) | `docs/marca/` |

## Reservas
- ADR: 0001–0005 usadas; 0006 reservada para a T-0030 (21/11). Migrações: 0007 T-0010, 0008 T-0030, 0009 T-0035, 0010 T-0026; próxima livre: 0011.
- Tarefas: T-0001–T-0041 usadas; próxima livre: T-0042.
- Achados do corretor (RD): reservados pelo gerente antes de numerar. RD-0020–0022 T-0033 (PR #22); RD-0023–0026 T-0030 (PRs #24 e #25); RD-0027–0033 T-0026 (PR #26, renumerar os RD-0025–0031); RD-0034–0040 T-0029; RD-0041–0047 T-0024; RD-0048–0054 T-0009; RD-0055–0061 T-0010; RD-0062–0068 T-0008; RD-0069–0072 T-0023; RD-0073–0079 T-0034; RD-0080–0086 T-0035; RD-0087–0089 ADR 0004 (T-0025); RD-0090–0096 T-0030 etapa 2; RD-0097–0105 T-0026 etapa 2; RD-0106–0110 T-0040; RD-0111–0115 T-0037; RD-0116–0118 T-0038; RD-0119–0123 T-0039; RD-0124–0128 T-0041; próxima livre: RD-0129. Sessão que vai numerar pede a faixa ao gerente por send_message.

## Regras de operação (21/11, 21h51)
- PR comum entra por merge do gerente pela regra do doc 07 (CI do PR e do main verdes, verificar OK, corretor e engenheiro sem 🔴, squash com Head-SHA e Agente), sem autorização do Alexandre (decisão de 21h51). Governança, deploy e produção fiscal continuam com a frase literal dele.
- PR não toca no `.coord/diario/<dono>.md`: a linha vai no corpo do PR ("Linha do diário") e o dono grava em lote num PR só de diário quando a fila esvaziar.
- Faixas de RD e números de migração são reservados no quadro antes de usar.

## Depende do Alexandre
> Decisão de 21/11, 21h29 (Manaus): "SEGUIR COM O RECOMENDADO" (`docs/status/2026-11-21-decisoes-alexandre.md`).
- Secrets do GitHub, `.env` de produção (com `MACUXIERP_CHAVE_A1`, 32 bytes, obrigatória), DNS e rota `erp.` no túnel: preparar agora (lista na seção 2). O deploy só sai com "aprovo deploy vX.Y.Z".
- Pedido ao time do FDV: tenant de teste com conector e `flock` no `implantar.sh` (texto na seção 3).
- Credenciamento da thathyany na SEFAZ-AM e A1 de homologação pela tela do BKO (seção 4).
- Ambientes por papel (decisão de 21h47, opção A): MacuxiERP-engenheiro-software, -banco-dados, -testes, -corretor-redundancias e -design-de-marca criados. Faltam 8 (designer-ux, engenheiro-apps e os 6 módulos), que seguem no MacuxiERP-GP até o Alexandre liberar espaço.
- Governança: MACUXI_DB_MIGRACOES no job de testes do CI, junto com o PR do `producao-publicar.yml`.
- T-0024: autorizar, na sessão dela, o push dos branches nuvem/T-0024-web e nuvem/T-0024-corretor.
- PR de governança do `producao-publicar.yml` (compose no sparse-checkout e scp; sem túnel, FCM, recados e build-args do web), descrito no PR #31.
- Pendência aberta: aceitar ou não um "produto incompleto" (sem NCM) na carga da T-0026. Se aceitar, muda o contrato e pede ADR.


## Próximos lotes (ordem do doc 05)
> 21/11, 21h46 (Manaus): o #19 entrou (64ca207). Decisões do Alexandre: "SEGUIR COM O RECOMENDADO" (21h29) e "Hub do FDV: opção A (compatibilidade 1.4.0)" (21h45).
1. Fila de merge (22h08): #34 (aprovado; espera o CI do main), #35 (falta tirar o diário do PR), #37, #38, #39, #31 junto com o PR do web (T-0024) e #5 (marca).
   - Esta sessão de gerente (session_019xHEXrreZKw3nSfBdLrz5r, desde 21h56) e as filhas não têm create_pull_request, add_repo nem send_later, e os recados dão 403.
   - Os PRs saem pela sessão antiga do gerente enquanto ela estiver viva. Incluir essas ferramentas é governança e vai ao Alexandre pelo PO.
2. Em andamento: etapa 2 da T-0030 e da T-0026, T-0034, T-0035, T-0010, T-0008 (parte 2) e ligações da F1 (lista pedida à sessão da T-0029).
3. Fecha a F1: T-0008 + corretor, marca e revisão final. Depois: F3 (T-0013, T-0014, T-0015) e F4 (T-0019, T-0020), pela ordem do doc 05; a F2 segue com a T-0011 depois da T-0010 e dos contratos C-1 a C-4.
4. Depois da F3 e da T-0024: T-0027.
