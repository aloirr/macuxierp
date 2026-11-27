# Macuxi ERP — guia do repositório para o Claude Code

ERP **100% na nuvem**, multiempresa (SaaS), integrado direto ao **Macuxi FDV** (força de vendas). Roda em **https://erp.macuxifdv.com.br**, na mesma VM, no mesmo servidor PostgreSQL e com as mesmas conexões de produção do FDV, mas com **banco, papéis, serviço e prefixo de arquivos próprios**.
Tudo em **português do Brasil** (respostas, recados, commits, docs). Código segue o padrão já existente.

Mesmos moldes do `aloirr/macuxifdv` (recados, agentes, regras, guardião, CI, PR, deploy com aprovação, ADRs e quadro). **Copie a regra, não o conteúdo:** onde o FDV fala de vendedor, promotor ou app Android, o ERP fala de cadastro, pedido, faturamento e fiscal. O FDV é só consulta e cópia: nenhum agente altera o `aloirr/macuxifdv`.

## Documentos de referência
`docs/produto/` — 01 visão e escopo · 02 módulos e requisitos (RF) · 03 regras e permissões (RN) · 04 arquitetura e dados · 05 roadmap e previsão · 06 integração com o Macuxi FDV · 07 agentes e coordenação. Decisões: `docs/decisoes/` (ADR). Status: `docs/status/`.

## Estrutura
```
apps/web (BKO do ERP, Next.js) · apps/api (Fastify, monólito modular) · apps/worker (filas: SEFAZ, integração FDV)
modules/<core|cadastros|pedido|faturamento|fiscal|integracao-fdv>/{manifest.ts,domain,contracts,api,web,db}
packages/{platform-sdk,ui,config} · db/ (migrações, RLS, seeds, tabelas fiscais) · tests/ · .coord/ · .claude/
docs/produto/01..07 · docs/decisoes/ (ADR)
```

## Comandos
`pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm --filter <pacote> test`
Postgres local na sessão, sem Docker: `bash db/scripts/pg-local.sh`. Antes do push: `bash tests/scripts/rodar-antes-do-push.sh`.
Coordenação: `node scripts/coord.mjs` (caixa, enviar, pendencias, ler, fio, lido, dono, verificar).
**Graphify antes de ler código** (pedido do Alexandre, R-20261122-035710; vale para subagentes também): primeiro `graphify-out/GRAPH_REPORT.md`; depois `graphify explain "<símbolo>"`, `graphify path "A" "B"` e `graphify section "docs/x.md#Seção"` para achar o arquivo e o trecho; `Read` só do trecho necessário (offset/limit). Se o "Built from commit" do relatório não for o HEAD (por exemplo, depois de juntar o main), rode `graphify update .`, que não usa LLM nem tem custo.
Repositório: `aloirr/macuxierp`. Recados: `aloirr/macuxierp-recados`. **Time 100% na nuvem** (sessões do claude.ai/code, Linux, bash), com PR e CI no GitHub. **Sem Docker** nos agentes.
**Horário de Manaus** (UTC−4) em texto para pessoas (recados, docs, relatórios); banco e carimbos técnicos em UTC. Confira com `TZ=America/Manaus date` antes de escrever a hora; o relógio do container é UTC.

## Regras inegociáveis
1. **Fronteiras**: módulo importa só `packages/*` e `modules/*/contracts`; nunca lê tabela de outro schema. O ERP **nunca lê tabela do FDV**: fala com o FDV só pela API do Hub (`/integracao/v1`).
2. Regra de negócio no `domain` do módulo, função pura, teste antes, citando `RN-...`. A API sempre revalida.
3. Tipos só de `contracts` (Zod). Eventos `<modulo>.<entidade>.<fato>@vN`; mudança incompatível = nova versão + ADR.
4. Dinheiro em centavos, com o arredondamento do Manual da NF-e; datas UTC (exibição no fuso do tenant); UUID; escrita idempotente.
5. Toda tabela: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`; RLS ligado.
6. Toda rota checa perfil, tenant e **licença do módulo**.
7. **Fiscal:**
   - numeração da NF-e sequencial por série e filial, **sem buraco** (buraco só por inutilização);
   - nota autorizada **nunca é editada** (só evento);
   - homologação e produção **separadas por tenant e filial emissora**; a troca para produção só com "aprovo produção fiscal <empresa>" do Alexandre;
   - o XML autorizado é **guardado antes de qualquer outra coisa**, imutável, por no mínimo 5 anos.
8. **LGPD** (a Macuxi ERP é operadora dos dados do cliente): sem dado pessoal em log; o cliente exporta os próprios dados a qualquer hora; a exclusão segue o prazo fiscal de guarda.
9. **Segredos**: nada em código, recado ou log. O certificado A1 e a senha dele ficam criptografados no banco, com a chave no secret do servidor. Secret do GitHub e `.env` de produção só o Alexandre cria. O A1 nunca é colado em chat ou recado.
10. Commit, push e PR só pelo fluxo de PR: um PR por dono e por lote.
11. **MENOS É MAIS** (Alexandre, 27/11/2026, R-20261127-174851):
   - toda página preenche a largura antes de descer, na grade de 12 colunas, com o campo curto em 1 a 2 colunas e os cartões lado a lado;
   - os tamanhos padrão vêm dos tokens do `packages/ui` e são iguais em todas as páginas;
   - a tela segue o padrão de mercado e de marca, sem redundância;
   - a regra vale para quem **monta** a tela (`engenheiro-apps` e módulos), não só para quem revisa;
   - a simulação sai em 1366 e 1920 px.
12. **Botões embaixo e juntos** (Alexandre, 27/11/2026 17h58, regra de marca e design): uma barra de botões por bloco, no rodapé do bloco; as ações da página ficam na barra do rodapé da página; fora dela, só a busca e os links de linha.

## Time de agentes
A sessão principal roda como **`gerente-projetos`** (`.claude/settings.json`), que comanda: `engenheiro-software` (plataforma, API, worker, SDK, contratos, CI, ADRs, revisão final), `engenheiro-apps` (só o shell web do BKO, sem mobile), `designer-ux` (`packages/ui`, `docs/design/`), `design-de-marca` (a mesma marca Macuxi do FDV; o manual da marca do FDV é a fonte), `banco-dados`, `testes`, `corretor-redundancias` e os agentes `modulo-core`, `modulo-cadastros`, `modulo-pedido`, `modulo-faturamento`, `modulo-fiscal`, `modulo-integracao-fdv`.
**Cada agente altera só os próprios caminhos (`.coord/donos.json`) e fala com os outros por recados** (skill `protocolo-recados`). O guardião (`.claude/hooks/`) bloqueia o resto. **Nunca use `MACUXI_GUARDA=off`.**
Sessões fixas: **"MacuxiERP - Gerente Projeto"** (rondas a cada 15–20 min) e **"MacuxiERP - Agente PO"** (skill `agente-po`).
**Sessões de agente** (Alexandre, R-20261124-173112): toda sessão nova que o gerente abre usa **Opus 5.5 com esforço médio** (`model: claude-opus-5-5`, `effort: medium`). A sessão trabalha como o dono da tarefa: não abre outras sessões e não faz merge (merge comum é do gerente).
Skills: `/status`, `/feature <RF ou descrição>`, `/entrega`, `/design-de-marca`.
**Chat do Alexandre vira recado** `aviso` para `todos`, com o texto literal, a data e a hora de Manaus.
**Backlog só com a palavra "backlog"** escrita pelo Alexandre. Fora da v1: compras, contas a pagar completo, contabilidade, SPED, NFC-e, NFS-e, produção e app mobile.

## Nuvem, PR e git
Toda tarefa roda numa sessão da nuvem, num branch `nuvem/*`, `alexandre/*` ou `agente/*`, com o trailer `Agente: <dono>` no último bloco de todo commit.
- **Só por PR**. Título `[PRONTO PARA MERGE] ...` quando estiver pronto. Merge (squash) depois do CI do PR verde, com o `main` verde.
- **Governança** (`.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs`, `.github/**`): PR próprio com `Agente: alexandre`; o merge só sai com "autorizo o merge do PR #N no commit <sha>" do Alexandre.
- **CI**: o do PR roda escopo, governança, lint, fronteiras, typecheck (`--concurrency=2`) e build; a suíte completa roda uma vez por versão, no `producao-liberar`, no SHA da versão.
- **Deploy**: `producao-liberar` → issue → comentário "aprovado vX.Y.Z" → `producao-aprovar` → `producao-publicar`, só com "aprovo deploy vX.Y.Z" do Alexandre. Uma publicação por vez na VM (ADR 0003).
- **Proibido**: force push, rebase do `main`, push direto ao `main`, merge com CI vermelho, apagar histórico.

## Definição de pronto
1. Nenhum PR sem testes verdes na sessão: unitários, banco e `tests/`, mais lint e typecheck, com o resumo no corpo do PR.
2. A suíte completa roda na sessão, no SHA final, antes do liberar.
3. O corretor revisa numa rodada só, antes do push. Um commit e um push por PR.
4. Job acima de 2× o tempo normal é cancelado e usa o rerun único, só para falha de infraestrutura.
5. A previsão é montada etapa por etapa, com o tempo do **dono** mais 15%, e muda só por motivo novo, escrito.
6. Decisão nova com a versão em fechamento vai ao Alexandre, com o impacto em minutos e as opções "entra nesta" ou "vai para a seguinte".
7. Revisão do engenheiro sem 🔴; validação do `design-de-marca` em mudança de cor ou layout; `node scripts/coord.mjs verificar` sem violações; quadro e docs atualizados.
