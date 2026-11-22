# Redundâncias — T-0045, estado do simulador no worker (rodada única, antes do push)

- **Data**: 22/11/2026 (Manaus)
- **Escopo**: worktree `/home/user/wt/T-0045-estado`, branch `nuvem/T-0045-estado-worker`, sem commit, base `69c0bcb`. Arquivos: `apps/worker/src/{faturamento,purga-simulador,config,main,modulos}.ts` e testes; `packages/platform-sdk/src/pg.ts` (`TodosTenantsPg`); `docs/desenho/T-0045.md` §9.
- **Faixa**: RD-0714 a RD-0716 (o resto foi agrupado nesses três).
- **Dono de todos os achados**: `engenheiro-software`.
- **Defeito funcional**: nenhum encontrado.

## RD-0714 — laço por tenant e listagem de tenants copiados (código, média) — ANTES do push

| Campo | Conteúdo |
|---|---|
| Onde | `apps/worker/src/purga-simulador.ts:37-50` × `apps/worker/src/alerta-a1.ts:67-84`; `packages/platform-sdk/src/pg.ts` `TodosTenantsPg` × `modules/core/api/adaptadores-worker.ts:31` `fonteTenantsSql`; `purga-simulador.ts` `FonteTodosTenants` × `alerta-a1.ts:31` `FonteTenants`; `purga-simulador.test.ts:40` |
| O que se repete | (a) o mesmo laço `for (… of await d.banco.semTenant(listar)) { r.tenants++; try { await d.banco.comTenant(…) } catch (e) { r.falhas++; d.log.warn({ rotina, tenant_id, erro: nomeDoErro(e) }, …) } }` aparece 2× nas rotinas diárias (3ª variação na `faturamento.varredura`); (b) `TodosTenantsPg.todos` é cópia de `fonteTenantsSql.ativos` trocando só o nome da função SQL, e a interface `FonteTodosTenants` repete o formato de `FonteTenants`; (c) o teste da purga reescreve à mão o SQL do `TodosTenantsPg` (`SELECT t AS id FROM plataforma.tenants_todos() t`) em vez de usar o adaptador |
| Impacto | manutenção: mudar a regra "falha de um tenant não para os outros" ou o log exige editar 2–3 lugares; o teste não cobre o adaptador real |
| Proposta | (a) em `rotinas.ts`: `export async function paraCadaTenant(banco, listar: (tx) => Promise<string[]>, rotina: string, log, fazer: (tx, tenant_id) => Promise<void>): Promise<{ tenants: number; falhas: number }>` e usar na purga e no alerta do A1 (a varredura fica como está, tem licença e dois `try`); (b) uma interface só, `FonteTenants { ativos(tx); todos?(tx) }` ou `ListarTenants = (tx) => Promise<string[]>` passada como função; (c) no teste, `tenants: new TodosTenantsPg()` no lugar do objeto escrito à mão |

## RD-0715 — exports mortos e camada de config duplicada (código, baixa) — ANTES do push

| Campo | Conteúdo |
|---|---|
| Onde | `apps/worker/src/config.ts:6-8`; `apps/worker/src/main.ts:36`; `DIA_MS = 86_400_000` em `purga-simulador.ts:16`, `alerta-a1.ts:13`, `purga-simulador.db.test.ts:17`, `modulos.db.test.ts:15` e literal em `purga-simulador.test.ts:42` |
| O que se repete | `POOL_MAXIMO_WORKER` e `POOL_PADRAO_WORKER` exportados sem uso fora de `config.ts`; `POOL_MINIMO_WORKER` só usado no teste. `main.ts` mantém `const inteiro = (…) => inteiroDoAmbiente(process.env, …)`, um apelido a mais sobre a função nova. `DIA_MS` declarado 4× (+1 literal) |
| Impacto | manutenção (knip acusa os exports); leitura |
| Proposta | tirar `export` de `POOL_MAXIMO_WORKER` e `POOL_PADRAO_WORKER` (e de `POOL_MINIMO_WORKER`, com o teste usando o número 4, que já testa); em `main.ts`, chamar `inteiroDoAmbiente(process.env, …)` direto e apagar `inteiro`. `DIA_MS`: exportar um só de `rotinas.ts` (ou do SDK) e importar nos dois arquivos de rotina; nos testes, opcional. A validação da API (`apps/api/src/config.ts`, Zod) é outro desenho: `manter?`, unificar só se o worker passar a ter config em Zod (fica fora deste PR) |

## RD-0716 — asserções e comentários repetidos (teste · doc, baixa) — ANTES do push

| Campo | Conteúdo |
|---|---|
| Onde | `config.test.ts:12`; `purga-simulador.test.ts:42-45`; `faturamento.test.ts:95,104` × `modulos.test.ts:52`; comentários em `main.ts:19-20`, `modulos.ts:17`, `modulos.ts:149-152`, cabeçalho de `purga-simulador.ts` e `faturamento.ts:13-15` × `docs/desenho/T-0045.md` §9 |
| O que se repete | `expect(POOL_MINIMO_WORKER).toBe(4)` repete `poolDoWorker('4')` e o `it.each` de abaixo de 4; na purga, o corte é conferido 3× (`RETENCAO_SIMULADOR_DIAS).toBe(400)`, a comparação com `corte` e o ISO `2025-10-18T07:00:00.000Z`); a lista de `montarRotinas` com `sefaz_simulador.purga` é conferida em 3 testes (2 em `faturamento.test.ts`, 1 em `modulos.test.ts`); "sempre, com ou sem a chave do A1, em todos os tenants" aparece em 4 comentários + §9 |
| Impacto | manutenção: trocar a hora ou a retenção quebra 3 testes e exige editar 5 textos |
| Proposta | apagar `expect(POOL_MINIMO_WORKER).toBe(4)` e `expect(RETENCAO_SIMULADOR_DIAS).toBe(400)` (o ISO do corte já fixa os 400 dias); a presença da purga em `montarRotinas` fica só em `modulos.test.ts` (nos dois `it` de `faturamento.test.ts`, voltar a conferir só as rotinas do faturamento, ex. `expect.arrayContaining([...])`); comentários: a fonte da verdade é o §9 e o cabeçalho de `purga-simulador.ts`; em `main.ts` e `modulos.ts` deixar uma linha "purga do simulador: purga-simulador.ts (T-0045 §9)" e tirar a repetição de `montarRotinas` |

## Redundância útil (manter)
- `ERRO_DE_CONFIGURACAO` com comentário explicando `SEFAZ_SIMULADOR_ESGOTADO` × `ErroEstadoSimuladorPg`: decide retentativa, fica.
- Os 4 `executor(…, estadoSim, …)`: parâmetro explícito, não é cópia de regra.
