---
name: protocolo-recados
description: Protocolo de recados e donos do time Macuxi ERP — como ler a caixa, enviar, responder, encerrar e checar donos de arquivos. Use sempre que precisar falar com outro agente, pedir algo fora dos seus caminhos ou entregar uma tarefa.
---

# Protocolo de recados (universal)

**Regra de ouro**: altere só seus caminhos (`.coord/donos.json`); para o resto, deixe recado. Recados são imutáveis.

| Quero... | Comando |
|---|---|
| Ver minha caixa | `node scripts/coord.mjs caixa <eu>` |
| Saber o dono de um arquivo | `node scripts/coord.mjs dono <caminho>` |
| Pedir algo | `node scripts/coord.mjs enviar --de <eu> --para <dono> --tipo pedido --tarefa T-nnnn --assunto "..." --corpo "Contexto \| O que preciso \| Pronto quando"` |
| Perguntar | `... --tipo pergunta ...` |
| Responder | `... --tipo resposta --responde-a <id> ...` |
| Responder e dar por resolvido | `... --tipo resposta --responde-a <id> --encerra ...` |
| Avisar todos (mudança de contrato, decisão) | `... --para todos --tipo aviso ...` |
| Sinalizar bloqueio | `... --tipo bloqueio ...` (gerente recebe cópia automática) |
| Entregar tarefa | `... --para gerente-projetos --tipo entrega --tarefa T-nnnn ...` |
| Marcar informativo como lido | `node scripts/coord.mjs lido <eu> <id>` |
| Ler um recado / a conversa | `node scripts/coord.mjs ler <id>` · `node scripts/coord.mjs fio <id>` |
| Conferir se só mexi no que é meu | `node scripts/coord.mjs verificar <eu>` |

Corpo com 3 partes separadas por `|` vira as seções Contexto / O que preciso / Pronto quando. Para textos longos, escreva num arquivo temporário fora do repo e use `--arquivo`.

Boas práticas: um assunto por recado; cite arquivos, contratos (`modulo.entidade.fato@vN`), extensões e regras (`RN-...`); diga o critério de pronto; responda rápido, mesmo que seja "recebido, entrego até o fim da tarefa".

## Lições herdadas do Macuxi FDV (valem desde o dia 1)
- **Antes de cada push:** `node scripts/coord.mjs verificar <eu> --base origin/main` sai 0, e todo commit de `git log origin/main..HEAD` traz `Agente: <eu>` no último bloco da mensagem. Arquivo de outro dono vai por recado, nunca no seu branch.
- **Nada só na máquina:** nunca termine o turno com commit sem push (`git status -sb` sem `ahead`). Antes do lote pronto, o push vai para o PR em rascunho, que não roda CI. Fora do rascunho vale "1 push por PR" (skill `entrega`).
- **Um dono por branch:** `nuvem/*` e `agente/*` levam um agente só no trailer de todos os commits. PR com mais de um dono só em `alexandre/*`.
- **Grafo do turbo:** antes do push, `node scripts/ci/grafo-turbo.mjs` sai 0. Teste lê só o próprio pacote ou uma pasta declarada nos inputs do `turbo.json`, que se pede por recado ao `engenheiro-software`.
- **Lista do corretor antes do PR:** passe no seu diff a lista "Antes do PR" de `.claude/agents/corretor-redundancias.md`. O corretor revisa numa rodada só, antes do push.
- **CI vermelho no seu PR:** leia o log, corrija no mesmo branch e escreva no PR o teste que caiu e a correção. "Pronto" só com o CI verde no head SHA. Rerun só para falha de infraestrutura, uma vez.
- **Fiscal:** nada de certificado A1, senha, chave ou XML de cliente em recado, anexo, commit ou log.
