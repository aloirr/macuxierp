# Botão "Ações" nas linhas de tabelas e listas — REGRA

> **REGRA em vigor** desde 24/11/2026 (T-0099, v0.3.13). Vale em **todas as tabelas e listas do /config e do BKO**.
> Decisão do Alexandre, 24/11/2026, 22h48 (Manaus), R-20261124-224843, texto literal: **"Coloque A so que no lugar dois ... mude pada Ações. Igual o fdv. Padronize tudo"**. Registro em [decisoes.md](decisoes.md).
> Referência: o `MenuAcoes` do Macuxi FDV (`aloirr/macuxifdv`, `packages/ui/src/web/menu-acoes.tsx`). Copia-se a regra, não o código. Autor: design-de-marca · 24/11/2026 (Manaus).

## 1. Por quê
O cliente usa o FDV e o ERP. A linha da tabela tem que se comportar igual nos dois: o mesmo botão, o mesmo nome e o mesmo lugar para o perigo. Botão "⋯" não diz nada a quem não é do ramo de software, e fileira de botões grandes polui a linha e esconde o que é perigoso no meio do que é rotina.

## 2. Regras
1. **Um botão "Ações" por linha.** Rótulo escrito "Ações", com acento. Nunca "⋯", "…", ícone sozinho, "Mais" ou fileira de botões grandes. O botão abre o menu com as ações daquela linha.
2. **No máximo uma ação principal à vista**, ao lado do "Ações", e ela **muda com a situação da linha**. Exemplo: integração com falha → "Reprocessar"; nos demais casos → "Log". Nenhuma linha mostra duas ações soltas além do "Ações".
3. **Perigo por último.** Zerar, Desativar, Excluir, Cancelar e afins ficam no fim do menu, **depois de um traço separador**, com o texto no vermelho **`erroTexto` = `#A8261B`** (variável CSS `--mx-cor-erro-texto`). Contraste sobre `branco` #FFFFFF: 7,10:1; sobre `perola` #F8F6F1: 6,57:1. Sem vermelho novo nem "quase igual" (decisão da opção B, T-0058). A ação de perigo continua pedindo a confirmação do `Dialogo` com o botão destrutivo.
4. **Rótulo inteiro, nunca cortado** (nem com reticências) no botão e nos itens do menu.
5. **O menu não é cortado pelo quadro**: abre em posição fixa na viewport, por cima da tabela, da rolagem e do cartão.
6. **Teclado e fechamento**: fecha com Esc, clique fora ou rolagem da página; navega com ↑ ↓ Home End; ao fechar, o foco volta ao botão "Ações".
7. **Alvo de toque de no mínimo 44 px** no celular (390 px de largura), no botão e em cada item do menu.
8. **Componente único** em `packages/ui`: nenhuma tela faz o próprio menu.

## 3. Cores e tipografia (tokens existentes, nada novo)
| Parte | Token |
|---|---|
| Botão "Ações" e a ação principal à vista | o botão secundário que já existe (`botaoSecundario()`, `.mx-botao-secundario`): fundo `branco`, texto `grafite` #16202A, borda `bordaCampo` #7A8593 (3,75:1) |
| Fundo do menu | `branco` #FFFFFF, borda `bordaTabela` #DFE2E6 |
| Item comum | texto `grafite` #16202A; foco e hover em `nevoa` #ECEEF1 (14,18:1) |
| Traço separador | `bordaTabela` #DFE2E6 |
| Item de perigo | texto `erroTexto` #A8261B; hover em `erroFundo` #FDE8E6 (6,04:1) |
| Fonte | `fontes.texto`, na escala já usada nos botões das tabelas |

`solLaranja` não entra no menu (não é cor de botão) e `verdeSucesso` não vira decoração de item.

## 4. Como a marca confere
Só a marca: rótulo "Ações" inteiro, perigo em `erroTexto` #A8261B depois do traço, e só os tokens da §3 (nenhuma cor nova). Achados vão ao dono da tela por recado.

## 5. Ordem e donos
T-0099.
