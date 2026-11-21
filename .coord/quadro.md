# Quadro — Macuxi ERP

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada). Horários de Manaus.
> Fase atual: **F1 Cadastros** (F0 no `main` em 7e6c055, PR #1, 20/11 23h20). Previsão: doc 05.
> Empresa piloto: **thathyany** (R-20261120-231848-gerente-projetos). Biblioteca NF-e: ADR 0002 opção A (R-20261120-231934-gerente-projetos).

| Tarefa | Título | Fase | Dono | Status | Onde |
|---|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | F0 Fundação: estrutura, governança, guardião, recados, CI, docs 01–07, ADRs 0001–0005 | F0 | alexandre | concluida | PR #1 → 7e6c055 |
| [T-0002](tarefas/T-0002.md) | Desenho da F1 e contratos de core e cadastros (e ADR 0002 → aceita) | F1 | engenheiro-software | concluida | PR #4 → 165c5db |
| [T-0003](tarefas/T-0003.md) | Banco: papéis, schemas, RLS e tabelas oficiais (NCM, CEST, CFOP, CST, IBGE, cClassTrib) | F1 | banco-dados | concluida | PR #10 → 820cd28 |
| [T-0004](tarefas/T-0004.md) | API (Fastify), autenticação, licenças e worker base | F1 | engenheiro-software | em_andamento | PR #7 → 6e9ba49; falta nuvem/T-0004b-adaptadores-pg |
| [T-0005](tarefas/T-0005.md) | Shell do BKO (Next.js) com menu pelos manifestos | F1 | engenheiro-apps | em_andamento | nuvem/T-0005-shell-bko |
| [T-0006](tarefas/T-0006.md) | Core: empresa, usuários, perfis e certificado A1 (ADR 0005) | F1 | modulo-core | em_andamento | nuvem/T-0006-core |
| [T-0007](tarefas/T-0007.md) | Cadastros: clientes, produtos, preços, estoque, filiais, equipe e carteira, consultas CNPJ/CEP/IE | F1 | modulo-cadastros | em_andamento | nuvem/T-0007-cadastros |
| [T-0008](tarefas/T-0008.md) | Testes da F1: RN, RLS e prints do BKO de cadastro | F1 | testes | aberta | — |
| [T-0009](tarefas/T-0009.md) | Desenho do mapeamento ERP → Hub do FDV | F2 | engenheiro-software | aberta | — |
| [T-0010](tarefas/T-0010.md) | Banco: schema integracao_fdv | F2 | banco-dados | aberta | — |
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
| [T-0024](tarefas/T-0024.md) | Deploy do ERP na VM do FDV com trava compartilhada (ADR 0003) | F1 | engenheiro-software | aberta | — |
| [T-0025](tarefas/T-0025.md) | coord.mjs: gravar recado por git quando a API recusar a escrita na nuvem | F1 | alexandre | bloqueada | — |
| [T-0026](tarefas/T-0026.md) | Carga inicial dos cadastros da thathyany pelos CSVs do kit | F1 | modulo-cadastros | aberta | — |
| [T-0027](tarefas/T-0027.md) | Virada do conector da thathyany: kit do FDV sai, conector nativo do ERP entra | F3 | modulo-integracao-fdv | aberta | — |
| [T-0028](tarefas/T-0028.md) | Tokens da marca em packages/ui (cores, situação, escala tipográfica) | F1 | designer-ux | em_andamento | nuvem/T-0028-tokens-ui |

## Travado pela nuvem
| Sessão | Caminhos |
|---|---|
| nuvem/T-0006-core (session_0157qAhmWwkaVNSg41AjkyW1) | `modules/core/` |
| nuvem/T-0007-cadastros (session_0157qAhnRcYrbCerCKphE24r) | `modules/cadastros/` |
| nuvem/T-0004b-adaptadores-pg (session_0157qAhkgLGRkSx2rwXEmSkd) | `apps/api`, `apps/worker`, `packages/platform-sdk`, `scripts/plataforma/` |
| nuvem/T-0005-shell-bko (session_0157qAhn9q2n4Me1UWDeCknD) | `apps/web` |
| nuvem/T-0028-tokens-ui (session_0157qAhmhBPnt9CYRYb1A47Y) | `packages/ui` |
| nuvem/T-0023-assinatura-erp (PR #5) | `docs/marca/` |
| nuvem/quadro-lote3 (gerente) | `.coord/quadro.md`, `.coord/tarefas/T-0028.md`, `docs/produto/05-roadmap.md`, `docs/status/` |

## Reservas
- ADR: 0001–0005 usadas; próxima livre: 0006.
- Tarefas: T-0001–T-0028 usadas; próxima livre: T-0029.

## Depende do Alexandre
- Secrets do GitHub e `.env` de produção (banco `macuxierp`, chave do A1, S3, SMTP); DNS e rota `erp.` no túnel.
- A1 de homologação da thathyany pela tela do BKO (ADR 0005); credenciamento da thathyany na SEFAZ-AM.
- T-0025 (governança): abrir uma sessão com `MACUXI_AGENTE=alexandre` (só o Alexandre define), porque a sessão aberta rodou como gerente-projetos e o guardião bloqueou `scripts/coord*.mjs`; depois, autorizar o merge do PR dela. É ela que destrava a gravação de recados na nuvem.
- Pedir ao time do FDV: tenant de teste com conector (F2) e a trava `flock` no `implantar.sh` do FDV (ADR 0003); depois da F3, a virada do kit-thathyany (T-0027).

## Próximos lotes (ordem do doc 05)
1. Em andamento (21/11, 17h25): T-0004b (adaptadores PostgreSQL), T-0005 (espera a T-0028), T-0006, T-0007 e T-0028.
2. Depois: T-0024 (engenheiro-software, deploy, quando a API e o web buildarem) e T-0008 (testes da F1).
3. Depois da T-0007: T-0026. Depois da F3 e da T-0024: T-0027.

## Regra provisória de recados (até a T-0025)
A sessão da nuvem que não consegue gravar recado (a API dá 403 e o guardião bloqueia o link de `.coord/recados`) registra o que enviaria no corpo do PR e no próprio diário. O guardião não se contorna.
