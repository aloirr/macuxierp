# 07 — Time de agentes e protocolo de coordenação

> Mesmo protocolo do Macuxi FDV (`aloirr/macuxifdv`, doc 07). Copia a regra, não o conteúdo.

## Organograma
```
                         Alexandre (dono do produto)
                                   │  recados (aloirr/macuxierp-recados) e chat
              ┌────────────────────┴────────────────────┐
   "MacuxiERP - Agente PO" (skill agente-po)   "MacuxiERP - Gerente Projeto" (gerente-projetos)
              └──────── pedidos e decisões ────────────►│
     ┌──────────────────┬──────────────────┬────────────┴─────┬──────────────────┬───────────────┐
  Engenheiro de      Engenheiro de      Designer UX        Banco de Dados     Testes            Design de marca
  Software Sênior    Aplicativos        (packages/ui,      (macuxierp, RLS,   (integração,      (marca Macuxi;
  (API, worker, SDK, (shell web do BKO) docs/design)       tabelas fiscais)   Hub, NF-e homol.) fonte: manual do FDV)
  CI, ADR, revisão)                                                              │
                                                                     Corretor de Redundâncias
     ┌────────────┬────────────┬──────────────┬────────────┬──────────────────┐
  modulo-core  modulo-      modulo-pedido  modulo-       modulo-fiscal    modulo-integracao-fdv
               cadastros                   faturamento
```

## Papéis
| Agente | Responsabilidade | Não faz |
|---|---|---|
| **gerente-projetos** | Comanda o time: tarefas `T-nnnn`, delega (sessões filhas), acompanha recados e bloqueios, quadro, roadmap, previsão e docs de produto; faz os merges pela regra; reporta ao Alexandre | Não escreve código |
| **Agente PO** (sessão fixa, skill `agente-po`) | Conversa com o Alexandre sobre o produto; transforma pedidos em RF/RN e critérios; grava o chat como recado | Não escreve código nem arquivo do repositório |
| **engenheiro-software** | Plataforma: `apps/api`, `apps/worker`, `platform-sdk`, `config`, contratos, fronteiras, CI e deploy (`.github/`), `scripts/`, raiz; ADRs; **revisão final** | Não implementa regra de módulo |
| **engenheiro-apps** | **Só o shell web do BKO** (`apps/web`); revisão técnica das telas | Sem mobile; não mexe em `packages/ui`, API, CI ou raiz |
| **designer-ux** | `packages/ui` e `docs/design/`; revisão de visual, hierarquia e textos | Não escreve regra nem tela de módulo |
| **design-de-marca** | Guardião da marca Macuxi (a mesma do FDV; o manual da marca do FDV é a fonte); valida toda mudança de cor ou layout; `docs/marca/` | Não aprova marca (só o Alexandre) |
| **banco-dados** | Banco `macuxierp`, papéis, schemas, RLS, migrações, seeds e tabelas fiscais oficiais | Não escreve tela nem regra |
| **testes** | Plano, `tests/`, multi-tenant, Hub do FDV, NF-e em homologação, valor × regra. Defeito funcional é dele | Não corrige código de produção |
| **corretor-redundancias** | Excessos, duplicidades e redundâncias (texto, tela, código, testes, docs). Toda tarefa passa por ele, numa rodada só, antes do push. Na tela fica só o que o usuário usa para decidir ou agir: explicação de funcionamento, texto de garantia e rótulo técnico ("Core", "slug", "tenant", "Sempre ligado") saem, e o achado segura o lote (R-20261123-103734-alexandre) | Não caça defeito funcional |
| **modulo-core** | Empresa, usuários, perfis, licenças, auditoria, arquivos, A1, exportação LGPD | — |
| **modulo-cadastros** | Clientes, produtos, preços, estoque, filiais, equipe e carteira, tabelas oficiais, CNPJ/CEP/IE | — |
| **modulo-pedido** | Pedido do FDV e manual, validações, aprovação, status | — |
| **modulo-faturamento** | NF-e 55, eventos, DANFE, contingência, guarda do XML, títulos | — |
| **modulo-fiscal** | Regras e cálculo de ICMS, ST, IPI, PIS, COFINS, IBS, CBS e IS | — |
| **modulo-integracao-fdv** | Conector nativo com o Hub do FDV (ida e volta), monitor | Nunca lê tabela do FDV |

Cada agente de módulo é dono da fatia vertical do módulo (domain, contracts, api, web), exceto `db/`, que é do banco-dados. Os donos de cada caminho estão em `.coord/donos.json` (só o Alexandre altera).

## Regra de ouro
**Cada agente altera só o que é seu. Para qualquer coisa fora disso, deixa um recado.** Nunca edita arquivo de outro agente, nunca edita recado alheio, nunca apaga recado.

Garantias:
1. `.coord/donos.json` define o dono de cada caminho (primeira regra que casa vence).
2. **Guardião** (`.claude/hooks/guarda-donos.mjs`, `guarda-bash.mjs`, `guarda-mcp.mjs`, `guarda-merge*.mjs`, copiados do FDV) bloqueia Edit/Write, shell e MCP fora dos caminhos do agente, alteração em recado existente e merge fora do rito. Nunca se usa `MACUXI_GUARDA=off`.
3. `node scripts/coord.mjs verificar <agente>` confere o diff no git (pega o que passou por fora, ex.: comandos de shell).
4. O revisor final (engenheiro) recusa entrega com violação.

## Protocolo de recados (universal, igual para todos)
**Onde**: repositório privado `aloirr/macuxierp-recados`, em `recados/<destinatario>/` — um arquivo por recado, imutável. Destinatários: os 14 agentes + `alexandre` + `todos`. A CLI grava e lê direto no GitHub (API REST). Quando a API recusa a escrita (HTTP 403, proxy da nuvem), a CLI grava por git, com clone raso e push sem force (T-0025); nada muda para quem usa.
**Como criar** (sempre pela CLI, para manter o formato idêntico):
```bash
node scripts/coord.mjs enviar --de modulo-pedido --para modulo-cadastros --tipo pedido \
  --assunto "Expor limite de crédito em contracts" --tarefa T-0015 --prioridade alta \
  --corpo "Contexto: ... | Preciso: ... | Pronto quando: ..."
```
**Formato** (gerado pela CLI):
```markdown
---
id: R-20261121-140512-modulo-pedido
de: modulo-pedido
para: [modulo-cadastros]
cc: [gerente-projetos]
tipo: pedido          # pedido | pergunta | resposta | aviso | bloqueio | entrega | revisao
prioridade: alta      # alta | normal | baixa
tarefa: T-0015
responde_a: null
encerra: false        # true numa resposta = assunto resolvido
contrato: null        # ex.: pedido.pedido.aprovado@1
criado_em: 2026-11-21T14:05:12-04:00
---
# Expor limite de crédito em contracts
## Contexto
## O que preciso / o que mudou
## Pronto quando
```
**Ciclo**: recado aberto → destinatário responde com `--responde-a <id>` → quem resolve marca `--encerra`. Recado de `bloqueio` vai sempre com cópia ao gerente.
**Rotina de todo agente**:
1. Ao começar: `node scripts/coord.mjs caixa <eu>` e tratar recados abertos.
2. Durante: trabalhar só nos seus caminhos; dúvidas e pedidos → recado.
3. Ao terminar: recado `entrega` ao gerente (o que fez, testes, pendências) + linha no diário `.coord/diario/<eu>.md`.

## Frentes de trabalho: time 100% na nuvem
- Todo o time roda em **sessões do claude.ai/code** sobre `aloirr/macuxierp` (Linux, bash), cada uma num branch `nuvem/*`, `alexandre/*` ou `agente/*`, entregando **por PR**.
- **Toda sessão nova abre no ambiente da nuvem do projeto**, com o graphify no setup script, indexando **só o código, sem LLM**.
- **Sem Docker**: Postgres local na sessão por `bash db/scripts/pg-local.sh` (copiado do FDV).
- **Horário de Manaus** em texto para pessoas; UTC no banco e nos carimbos técnicos.
- **Trava de arquivos entre sessões**: o quadro tem a coluna **Onde** (a sessão) e a seção **Travado pela nuvem**. Duas sessões nunca alteram o mesmo caminho ao mesmo tempo.
- **Nome do branch**: `nuvem/T-nnnn-<assunto>`, mesmo que o ambiente indique outro (`claude/...`).
- **Início de sessão**: commit vazio com o trailer `Agente: <dono>` no último bloco (`git commit --allow-empty`); a entrega entra nele por `--amend`, e o PR sai com um commit só.

## Sessões fixas
- **"MacuxiERP - Gerente Projeto"**: rondas a cada 15–20 min — caixas, PRs `[PRONTO PARA MERGE]`, CI do `main`, quadro, vagas.
- **"MacuxiERP - Agente PO"**: conversa de produto com o Alexandre (skill `agente-po`).

## Prompt de sessão filha (regra do Alexandre no prompt de abertura, anexo do R-20261120-213835-gerente-projetos)
- Começa pela **tarefa concreta de código, com caminhos de arquivo**.
- Diz **"mande a previsão e comece já; vá até o PR sem parar"**.
- Leva no texto as decisões do Alexandre que valem para a tarefa.
- Nunca diz "antes de começar, responda" nem "você é o gerente".
- Sessão interrompida que recebe "retome" de outra sessão pode recusar: nesse caso, abra uma sessão nova.

## Git só por PR
- Cada sessão parte do `main` atual, trabalha só nos caminhos do dono, roda lint, typecheck e testes (unitários, banco e `tests/`) e faz **um commit** (`T-nnnn: <resumo>` + `Agente: <dono>`) e **um push**. Abre o PR `[PRONTO PARA MERGE] ...` com o resumo dos testes da sessão no corpo (`bash tests/scripts/rodar-antes-do-push.sh`).
- **Um PR por dono e por lote.** Recados ficam no repositório de recados, fora do PR.
- **Merge comum** (sem caminho de governança): com o CI do PR e do `main` verdes, head SHA conferido, `verificar --base origin/main` OK e o parecer do corretor no head SHA, o gerente roda `gh pr merge N -R aloirr/macuxierp --squash --match-head-commit <sha> --body "Agente: <dono>"`.
- **Merge de governança** (`.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs`, `.github/**`): PR próprio com `Agente: alexandre`; o gerente resume ao Alexandre (CI do PR e do `main`, head SHA, o que cada arquivo muda e se algum check fica mais fraco) e só faz o merge depois do recado do Alexandre **"autorizo o merge do PR #N no commit <sha>"**. Aprovação genérica não vale.
- **Main vermelho = nenhum merge** até a correção.
- **Proibido**: force push, rebase do `main`, push direto ao `main`, merge com CI vermelho, apagar histórico.

## CI e economia do Actions
- **CI do PR e do push ao `main`**: escopo, governança (testes do coord e dos guardiões, donos do PR, trailer de governança), lint, fronteiras, typecheck com `--concurrency=2` e build do BKO quando afetado.
- **Suíte completa** (pacotes com Postgres e `tests/`) **uma vez por versão**, no `producao-liberar`, no SHA da versão; antes do disparo, ela roda também na sessão, no mesmo SHA.
- **Um commit por PR, um push só, um rerun só** (e só para falha de infraestrutura). Job acima de 2× o tempo normal é cancelado e usa o rerun único.

## Deploy
`producao-liberar` → issue de aprovação → comentário "aprovado vX.Y.Z" → `producao-aprovar` → `producao-publicar`. Nenhuma tag `v*` e nenhum run de publicação sem o recado do Alexandre **"aprovo deploy vX.Y.Z"**; o gerente cita o id do recado na tag. Uma publicação por vez na VM, também entre FDV e ERP (ADR 0003).

## Fiscal: produção só com aprovação
A troca de uma empresa de homologação para produção fiscal exige o recado do Alexandre **"aprovo produção fiscal <empresa>"**. O id do recado fica na auditoria da troca (RN-CORE-08).

## Entrega e previsão (lições do FDV, valem desde o dia 1)
1–4. Ver "Git só por PR" e "CI e economia do Actions" (testes na sessão, suíte no SHA final, corretor numa rodada só, um commit e um push, job acima de 2× e rerun único).
5. A previsão é montada etapa por etapa, com o tempo do **dono** mais 15%, e muda só por motivo novo, escrito (doc 05).
6. Decisão nova com a versão em fechamento vai ao Alexandre, com o impacto em minutos e as opções "entra nesta" ou "vai para a seguinte".
7. **Massa de teste e prints** (pedido do Alexandre e decisão do PO, 23/11 11h00): toda tela que junta nomes (empresa, filial, cliente, usuário) é testada e revisada pelo corretor também com a massa "empresa = filial" (MEI), razão social longa (mais de 60 caracteres), acento e CNPJ de 14 dígitos; sem esse caso no teste ou no print do dono, o corretor abre achado. Os prints de teste e de revisão usam só dados fictícios que reproduzem os casos reais; print com dado real de cliente sai só para a aprovação do Alexandre e não é guardado em recado nem em repositório (LGPD, regra 8). Origem: o topo "empresa · filial" repetido na thathyany (PR #8, massas sempre com empresa ≠ filial).
8. **Rotas de tela** (pedido do Alexandre, R-20261123-172506-alexandre, depois da aba Cargas com 404 na v0.3.5): toda rota que o web chama está registrada na API real, conferida pela lista `CAMINHOS_*` do SDK em `tests/integracao/rotas/fumaca-telas.db.test.ts`, sem dublê e sem contagem escrita à mão; teste de servidor confere o contrato do SDK, não a si mesmo; tela nova ou alterada tem ensaio com a API real e print com dados fictícios (print com dublê não vale); fumaça das telas depois de todo publicar (até a T-0065(b), o Alexandre abre as telas alteradas); web e API da mesma tela em PRs separados são revisados juntos pelo testes; o ensaio e o `--tudo` rodam também `node --test scripts/`. Detalhe em `.claude/agents/testes.md`.

## Esteira e backlog
- Tudo o que o Alexandre pede, e o que é preciso para entregar, entra na esteira. **Backlog só com a palavra "backlog"** dele, num recado ou no chat.
- **Chat vira recado**: tudo o que o Alexandre disser no chat com o gerente vira recado `aviso` para `todos`, com o texto literal.

## O que só o Alexandre faz
- Criar repositórios, secrets do GitHub e o `.env` de produção (banco `macuxierp`, chave de criptografia do A1, S3, SMTP).
- Apontar o DNS de `erp.macuxifdv.com.br`.
- Fornecer o A1 da empresa piloto pela tela do BKO (ADR 0005), nunca em chat ou recado.
- Credenciar a empresa piloto como emissora na SEFAZ-AM.
- Autorizar merge de governança, deploy e produção fiscal.

## Contratos entre módulos
`.coord/contratos/` (dono: engenheiro-software) registra eventos e dependências. O módulo publicador é dono do schema do evento em `modules/<m>/contracts`.

## Custos
Gerente, engenheiro de software, banco, testes, corretor e design de marca usam o modelo mais forte (`opus`); agentes de módulo, engenheiro-apps e designer usam `sonnet`.
