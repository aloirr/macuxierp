# Parecer da marca: shell web da v0.3.28, rodada final (27/11/2026, 20h19 de Manaus)

- **O que foi conferido:** branch `agente/v0328-web-shell-marca` no head `2b2e9e4`, com o `agente/v0328-web-inicio` (`ccc3127`) juntado só na sessão, sem commit. O `globals.css` deu conflito de texto, com dois blocos independentes, e os dois foram mantidos.
- **Como:** `next build` + `next start`, API real local e banco efêmero (`pg-local.sh`), já apagado. A massa é fictícia: 9 clientes, 4 pedidos, 3 notas e 3 empresas. Chromium com `deviceScaleFactor` 1 e página inteira. Nenhum host de produção foi chamado.
- **Parecer: liberado com ajustes.** Ficou um 🟡 (o espaço do h1). Nada fere o manual da marca.

## Veredito por item

| # | Item | Veredito | Medida no print |
|---|---|---|---|
| A1 | "Emitido em" de Pedidos sem quebra | 🟢 | `27/11/2026 20:14` numa linha só em 1366, 1920, 801 e 390 |
| A2 | Filtros com input e select em 13 px; data sem corte em 801 | 🟢 | os 8 campos têm 13 px e 34 px de altura; em 801 cada um tem 124 px e nenhum está cortado |
| A3 | Rótulos do login em 12 px | 🟢 | "Código da empresa", "E-mail" e "Senha" estão todos em 12 px / 600; os campos, em 13 px / 34 px |
| A4 | Ficha `/config/empresas/[id]`: rótulo de 12 px e campo de 34 px / 13 px | 🟢 | os 8 primeiros rótulos estão em 12 px / 600 e os campos em 13 px / 34 px |
| B1 | `.conteudo` sem max-width | 🟢 | `max-width: none`; o conteúdo vai de 260 a 1920 px, com 32 px de respiro (era ~560 px vazios) |
| B2 | Texto corrido em 72ch | 🟢 | `.apoio` = 590 px (72ch de 13 px); o `p.erro` = 681 px |
| B3 | `.formulario` na grade de 12 colunas | 🟢 | Novo pedido: 12 colunas; Filial, Cliente e Condição em `span 4` (médio) e Observação em 12. No CSS, até 1100 px fica 3/6/12 e abaixo de 640 px, coluna única |
| B4 | `.dados` em auto-fit | 🟢 (pelo CSS) | `repeat(auto-fit, minmax(200px, 1fr))`. Não há print: a massa local não monta o retrato do cliente e o detalhe do pedido não abre |
| B5 | h1 em azul-noite (MC-0216) | 🟢 | `rgb(30, 51, 80)` = #1E3350 em todas as telas |
| B6 | h1 a 4 px da saudação (MC-0216) | 🟡 | **13 px** no Início, em Clientes e no aviso de Pedidos. O h1 tem 4 px embaixo, mas o `p.apoio` traz a margem de 13 px do navegador e as duas se sobrepõem, então vale a maior. Com bloco que não é `p` (filtros, formulário), o espaço fica em 16 px, como previsto |

## Correção do 🟡 (dono: `engenheiro-apps`)
`apps/web/src/app/globals.css:46-47` (head 2b2e9e4). Logo depois da regra `.conteudo h1`, acrescentar:
`.conteudo h1 + p { margin-top: 0; }` → o espaço fica em 4 px.

## Fora do pedido, para o PO
- **Clientes** não tem lista no shell neste head. A tela mostra "Disponível em breve.", e o atalho "Clientes" do Início leva a ela. Os 9 clientes existem na API, mas não há tela de lista em `apps/web/src/lib/telas/`. Não é defeito de marca: é escopo de tela.
- Na ficha do `/config`, "Atualizar pela Receita" fica no cabeçalho do cartão, e "Trocar CNPJ" e "Mostrar" ficam no meio do bloco. Isso fere a regra 12 (botões embaixo e juntos). O problema já existia antes desta rodada e fica registrado para a próxima.
- O campo de data aparece como `mm/dd/yyyy` porque o Chromium do teste roda sem o idioma pt-BR. No navegador em pt-BR aparece `dd/mm/aaaa`, com o mesmo comprimento.

## Prints (todos de 1×, página inteira)
`inicio-1366.png` · `inicio-1920.png` · `clientes-1366.png` · `clientes-1920.png` · `config-empresas-1366.png` · `config-empresas-1920.png` · `config-ficha-1366.png` · `config-ficha-1920.png` · `pedido-novo-1366.png` · `pedido-novo-1920.png` · `pedidos-1366.png` · `pedidos-1920.png` · `pedidos-801.png` · `pedidos-390.png` · `login-801.png` · `login-390.png`
