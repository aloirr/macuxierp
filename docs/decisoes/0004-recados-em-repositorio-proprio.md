# ADR 0004 — Recados no repositório `aloirr/macuxierp-recados`, direto pelo GitHub

- **Status:** aceita
- **Data:** 21/11/2026
- **Dono:** engenheiro-software
- **Base:** prompt de abertura, seção 6; mesmo desenho das ADRs 0035 e 0039 do Macuxi FDV

## Decisão
- Os recados e os lidos do time Macuxi ERP ficam no repositório privado **`aloirr/macuxierp-recados`** (`recados/<destino>/R-AAAAMMDD-HHMMSS[-n]-<autor>.md`, `lidos/<agente>.txt`, `recados/anexos/`), com o mesmo formato do FDV (cabeçalho YAML; seções Contexto, O que preciso / o que mudou e Pronto quando).
- O `scripts/coord.mjs` (copiado do FDV) grava (`enviar` e `lido`) e lê (`caixa`, `pendencias`, `ler` e `fio`) **direto no GitHub, pela API REST**. A GraphQL é barrada nas sessões da nuvem. O token é o do `gh` ou o `MACUXI_RECADOS_TOKEN` (fine-grained, só Contents do repositório de recados). "Enviado" só aparece com o commit confirmado.
- O Alexandre escreve pelo formulário de issue **Recado** do repositório de recados (`.github/workflows/issue-recado.yml` e `.github/ISSUE_TEMPLATE/recado.yml` no `aloirr/macuxierp-recados`, copiados do FDV).
- O Telegram não entra na F0. Ele só entra com "backlog" do Alexandre e com os secrets criados por ele.
- Recados e lidos ficam fora dos commits do repositório de código (`/.coord/recados` e `/.coord/lidos` no `.gitignore`).
- O chat do Alexandre vira recado `aviso` para `todos`, com o texto literal.

## Consequências
- A autorização de merge de governança e de deploy é lida do GitHub pelo guardião (`guarda-merge`), sempre no repositório `aloirr/macuxierp-recados`.
- Nenhum agente cria recado em nome do Alexandre: o guardião barra.

## Adendo — 21/11/2026 (horário de Manaus) — escrita por git quando a API responde 403
Pedido do Alexandre em R-20261121-212900-alexandre (T-0025). A decisão acima continua valendo: a API REST segue como caminho principal; a implementação está no PR #27.
- **Troca:** quando a API REST recusa a escrita com **HTTP 403** (o proxy da nuvem barra escrita na API), o `coord.mjs` grava por git: clone raso do `main` numa pasta temporária, conferência de que o topo é o mesmo lido pela API, commit e `git push` para `main` **sem force**. O remoto pode ser trocado por `MACUXI_RECADOS_GIT_URL`.
- **Concorrência:** push recusado por avanço do remoto relê e tenta de novo no laço que já existe, até 6 tentativas com espera crescente; antes de dizer "não enviado", confere no GitHub, por leitura, se o arquivo já está lá com o mesmo hash.
- **Credencial:** a do git do ambiente; nenhum token passa por esse caminho.
- **Escopo:** só o status 403 cai no git, sem ler a mensagem. Um limite de uso (rate limit) devolvido como 403 também vai pelo git, sem dano, porque o caminho é idempotente e conferido. Os outros erros, inclusive o 429, seguem como antes.

## Limites conhecidos
Decisão do gerente-projetos em 21/11/2026 (horário de Manaus): opção A da revisão do PR #48, seguida pelo PO no PR #48 (commit bb886c3).
- **Identidade não é autorização:** o campo `de: alexandre` (ou de qualquer agente) num recado é defesa em profundidade, não autorização. Um agente com shell consegue forjar a identidade do processo, por exemplo com um processo órfão via `setsid` ou com `eval`, e assim passar pela conferência de identidade do `coord.mjs` ou do guardião.
- **Nenhuma ação sensível se autoriza só por recado:**
  - o merge de governança e o deploy não saem por agente na nuvem: saem só pela execução direta na sessão do PO (R-20261121-223923-alexandre), com as frases literais do Alexandre (CLAUDE.md, "Nuvem, PR e git");
  - a produção fiscal só sai pelo script do operador, com o "aprovo produção fiscal <empresa>" conferido pela sessão do PO (ADR 0006).
- **Consequência:** o recado continua sendo o canal de coordenação e o registro do time. As consequências acima ("lida do GitHub pelo guardião" e "o guardião barra") ficam no mesmo limite da identidade.
