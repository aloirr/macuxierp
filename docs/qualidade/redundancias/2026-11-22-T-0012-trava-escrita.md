# Redundâncias — T-0012/T-0017, trava de escrita no Hub real (22/11/2026)

Escopo: diff sem commit do branch `nuvem/T-0012-trava-escrita` (worktree `/home/user/erp-trava`, base `origin/main` 372e71c),
rodada única antes do push. Foco: código repetido entre as duas barreiras, testes repetidos e texto repetido nos docs.
Dono de todos os caminhos: `testes`.

**Manter (redundância útil):** a trava conferida duas vezes (configuração e transporte) e, no transporte, o
`exigirLeitura` antes do SDK mais o `guardarFetch` no `fetch` são barreiras distintas, de propósito. O teste do
`ehChaveMacuxierp` em `trava-escrita.test.ts` (unidade) e o de `lerConfigHub` com o Conector `macuxierp` em
`config.test.ts` (ligação) cobrem camadas diferentes; idem o "dublê não muda" nos dois arquivos.

## RD-0555 — código: literal da trava e cálculo repetidos (baixa)

| Campo | Conteúdo |
|---|---|
| Onde | `tests/ponta-a-ponta-fdv/apoio/config.ts:231`, `:299` e `:384`; `apoio/adaptador-conector.ts:55`; `apoio/emissor-minimo.ts:89`; `apoio/trava-escrita.ts:20` e `:83` |
| Tipo | código |
| O que se repete | (a) o prefixo "Recusado pela trava de escrita no Hub real (recado …, 22/11/2026 02h08 de Manaus)" em `trava-escrita.ts:83` e `config.ts:231`, com a data literal na segunda, em vez do `QUANDO_TRAVA` (2×); (b) `motivoTravaEscrita(env.MACUXI_HUB_LIBERA_ESCRITA?.trim(), perfil, conectorId)` calculado 2× para a mesma configuração (`config.ts:299` e `:384`); (c) `!ehDubleLocal(url) && !credencial.escritaLiberada` 2× (adaptador e emissor) |
| Impacto | manutenção: mudar a data, o texto ou a regra exige lembrar de 2 lugares; o par (b) pode divergir |
| Proposta | (a) em `trava-escrita.ts:83`, exportar `export const PREFIXO_TRAVA = \`Recusado pela trava de escrita no Hub real (recado ${RECADO_TRAVA_ESCRITA}, ${QUANDO_TRAVA})\`;` e usar `${PREFIXO_TRAVA}: ` em `mensagemTrava` e em `config.ts:231` (`\`${PREFIXO_TRAVA}: o cenário "${nome}" …\``). (b) em `config.ts:384`, trocar o segundo cálculo por um só: `lerCredencial` passa a devolver `{ credencial, travaEscrita }` (calcula em `:299`) e `lerConfigHub` usa esse `travaEscrita`. (c) em `trava-escrita.ts`, `export const travaAtiva = (url: string, c: { escritaLiberada: boolean }) => !ehDubleLocal(url) && !c.escritaLiberada;` e usar em `adaptador-conector.ts:55` (`const travado = travaAtiva(base, o.credencial);`) e `emissor-minimo.ts:89` (`const travado = travaAtiva(o.url, o.credencial);`) |
| Dono | testes |
| Status | corrigido no #182 (reteste no head bf43a56) |

## RD-0556 — teste: trava do thathyany-seguro conferida 2× em `config.test.ts` (baixa)

| Campo | Conteúdo |
|---|---|
| Onde | `tests/ponta-a-ponta-fdv/config.test.ts:374` (título) e `:390-392` |
| Tipo | teste |
| O que se repete | `cenarioPermitido(seguro, …) == []` e `exigirCenario(seguro, 'carga-identica')` lança a trava: já garantidos pelo `travaTodos` do novo `describe` ("real com MACUXI_HUB_LIBERA_ESCRITA=1 e o perfil thathyany-seguro", que cobre todo cenário do perfil, com e sem `=1`) |
| Impacto | manutenção; título do teste com parêntese que descreve outro teste |
| Proposta | apagar as linhas 390-392 (comentário e as duas asserções) e voltar o título de `:374` a "cenários: o perfil thathyany-seguro só cabe "carga idêntica" e "reenvio idempotente"; nada de inativação, carga completa, dado novo, ordem quebrada ou Retry-After forçado" (sem "(e, com a trava de 22/11, nem esses rodam)") |
| Dono | testes |
| Status | corrigido no #182 (reteste no head bf43a56) |

## RD-0557 — doc: a regra da trava reescrita em vários lugares (média)

| Campo | Conteúdo |
|---|---|
| Onde | `docs/testes/T-0012.md:210-215` (citação na "Rodada real") e `:322-324` (parágrafo do `vitest list`); `tests/ponta-a-ponta-fdv/apoio/config.ts:34-38` (cabeçalho) |
| Tipo | doc |
| O que se repete | a regra completa (chave macuxierp, `LIBERA_ESCRITA=1`, "até o ERP estar em produção, a carga conferida e o ok do PO", outro Conector) aparece na seção "Trava de escrita no Hub real" (fonte da verdade), na linha "Escrita" da tabela de perfis, na tabela de variáveis, na citação de `:210-215` e de novo em `:322-324`: 5× no mesmo doc; o cabeçalho de `config.ts` repete o de `trava-escrita.ts` |
| Impacto | leitura; cinco cópias para manter quando a trava for levantada |
| Proposta | `T-0012.md:210-215` → `> **Trava de escrita (recado R-20261122-020834-gerente-projetos):** os comandos abaixo são recusados no real; ver "Trava de escrita no Hub real".` · `T-0012.md:322-324` → apagar o trecho "; com a trava de escrita (22/11, 02h08), todos eles são recusados pelo `exigirCenario` (nenhum é só de leitura), salvo o `tenant-teste` com `MACUXI_HUB_LIBERA_ESCRITA=1` e outro Conector" e fechar a frase em "3 no `thathyany-seguro`." · `config.ts:34-38` → ` * Trava de escrita no real: \`travaEscrita\` e \`exigirCenario\` (regras em \`trava-escrita.ts\`).` |
| Dono | testes |
| Status | corrigido no #182 (reteste no head bf43a56) |

## Parecer

Aprovado com ressalvas: 3 achados, nenhum alto, nenhum bloqueia o push. Aplicar na mesma rodada, antes do único push.
Nenhum defeito funcional encontrado.

## Reteste (22/11/2026, no diff do PR #182, head bf43a56)

- **RD-0555 corrigido:** `PREFIXO_TRAVA` exportado em `trava-escrita.ts:23` e usado em `:80` e `config.ts:241`; `motivoTravaEscrita` calculado uma vez (`config.ts:312`, devolvido por `lerCredencial` e usado em `:394`); `travaAtiva` em `trava-escrita.ts:106`, usado em `adaptador-conector.ts:56` e `emissor-minimo.ts:90`.
- **RD-0556 corrigido:** `config.test.ts:374` voltou ao título sem o parêntese e as asserções repetidas saíram (a trava fica no `travaTodos`).
- **RD-0557 corrigido:** `T-0012.md:215` virou a remissão curta à seção-fonte; `:322-323` fecha em "3 no `thathyany-seguro`."; `config.ts:34` com a linha única que aponta para `trava-escrita.ts`.
