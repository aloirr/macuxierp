# Fumaça das rotas: telas × API (T-0065)

Escrito em 2026-11-23, 17:34 (Manaus), pelo agente `testes`.

## Motivo
A v0.3.5 saiu com a aba Cargas do `/config` chamando um GET que a API não tinha (404 genérico), visto pelo Alexandre em produção. Nenhum teste cruzava "o que o web chama" com "o que a API registra".

## Camada (a): no CI e na suíte completa
`tests/integracao/rotas/fumaca-telas.db.test.ts` (Postgres local; sem Postgres pula, com `MACUXI_PG_EXIGIR=1` falha).
- **Lista extraída do fonte, sem cópia à mão**: varre `apps/web/src` e `modules/<m>/web` (sem `*.test.*`) atrás de `chamar('GET', x)`, `getValidado`, `buscarRegistro`, `buscarPagina`, `baixarCsv` e `baixarArquivo`. Caminho literal vira rota (`${...}` de segmento inteiro vira `:id`; consulta cai). Caminho não literal tem de estar em `NAO_EXTRAIVEIS`, que diz de onde vem; somam-se as telas do shell (`PAGINAS_REGISTRADAS` → `telaDaRota`), os downloads da nota (`urlDoXml`/`urlDoDanfe`) e as constantes do portal (`CAMINHOS_CARGAS_PLATAFORMA`, `CAMINHOS_INTEGRACAO_FDV_PLATAFORMA`).
- **Como confere**: cada GET vai à API montada com os módulos de produção; falha se cair no 404 genérico do `setNotFoundHandler` (`NAO_ENCONTRADO`, "Rota não encontrada") ou der 5xx. 200 e 4xx de regra (inclusive 404 de registro inexistente) passam.
- **Tela nova**: use as funções acima com caminho literal, ou registre a tela em `PAGINAS_REGISTRADAS`/descritor; chamada com caminho não literal exige uma linha em `NAO_EXTRAIVEIS` (sem ela o teste cai, de propósito). Rota nova na API precisa existir antes da tela no mesmo lote.

## Camada (b): depois de todo publicar, contra produção (proposta)
Passo novo no `.github/workflows/producao-publicar.yml`, job de deploy, logo depois de "conferir pelo domínio" (health check `/v1/saude` com a versão e `/login`).
- **Mesma lista**: o teste da camada (a) exporta a lista de GETs em `tests/integracao/rotas/fumaca-rotas.json` (`rotas[]` com `metodo`, `caminho` com `:id` e `area` `bko`|`plataforma`; 53 rotas em 2026-11-23: 38 do BKO e 15 da plataforma). Um caso do teste (sem Postgres) falha se o JSON commitado divergir da extração, para não ficar velho. Regenerar: `MACUXI_FUMACA_GERAR=1 pnpm exec vitest run --config tests/vitest.config.ts tests/integracao/rotas/fumaca-telas.db.test.ts`. O passo só lê esse JSON do SHA da tag e preenche os parâmetros.
- **Usuário**: uma empresa de teste em produção, com todos os módulos licenciados, e um usuário com perfil `leitura` (RN-CORE-01). Os `:id` usam UUID fictício (404 de regra aceito); a filial é a da empresa de teste.
- **Rotas `/v1/plataforma`**: hoje **não existe superadmin só de leitura** (`plataforma.superadmin`, migração 0033, não tem papel nem escopo). Até existir, **só as rotas do BKO entram**; as do portal ficam cobertas só pela camada (a).
- **Secrets** (environment `PRODUCAO`, só o Alexandre cria): `FUMACA_EMAIL`, `FUMACA_SENHA` e `FUMACA_EMPRESA_ID`; depois, `FUMACA_SA_EMAIL` e `FUMACA_SA_SENHA` para o superadmin de leitura.
- **Só GET**, nunca escrita; o login usa a rota de sessão existente e a sessão é encerrada ao fim.
- **Tempo**: 10 s por rota e 3 min no total (`timeout-minutes` do passo).
- **Critério**: 404 genérico (`NAO_ENCONTRADO`/"Rota não encontrada") ou 5xx = falha; 200 e 4xx de regra passam.
- **Na falha**: o publicar fica vermelho e abre ou comenta a issue "Aprovar deploy <tag>" com a lista das rotas que caíram. **Sem rollback automático**: a volta segue o procedimento atual do publicar.
- **Log sem dado pessoal**: só método, caminho com `:id` e status; nada de corpo, token, e-mail ou ID real.

## Quem faz
- `engenheiro-software`: o passo no `producao-publicar.yml` e o script que lê o JSON, em **PR de governança** (`.github/**`, `Agente: alexandre`); merge só com "autorizo o merge do PR #N no commit <sha>" do Alexandre.
- `testes`: gerar e conferir o JSON a partir do teste da camada (a).
- `banco-dados` e `modulo-core`: a empresa de teste e o usuário `leitura` em produção (seed idempotente, por `external_id`); o superadmin só de leitura, se aprovado (precisa de ADR, porque muda a 0033 e o ADR 0012).
- Alexandre: criar os secrets e aprovar o superadmin de leitura.

## Pendências abertas
1. Decidir se haverá superadmin só de leitura (sem ele, `/v1/plataforma` fica fora da camada b).
2. Empresa de teste em produção: nome, licenças e se conta no faturamento da Macuxi.
3. Secrets `FUMACA_*` ainda não criados.
4. Rotas com parâmetro de cadastro ou entidade: valores fixos válidos do SDK, a conferir com a empresa de teste.
