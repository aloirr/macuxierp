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
