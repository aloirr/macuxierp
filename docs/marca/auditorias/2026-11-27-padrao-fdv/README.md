# Auditoria de marca — Macuxi ERP no padrão do Macuxi FDV (SIMULAÇÃO)

> **SIMULAÇÃO para aprovação. Nenhum código foi alterado.** Autor: design-de-marca · 27/11/2026, 18h22 a 19h00 (Manaus).
> Pedido do Alexandre, 27/11/2026, por volta das 18h35 (Manaus), texto literal: "O Makushi Força de Venda, ele tem um padrão de marca. Esse padrão de marca ele tem que se repetir no ERP, em todas as tabelas, os visuais, as cores. Então, crie uma seção em paralelo que revise um corretor de marca no padrão do Makushi FDV todas as telas e tabelas e fontes e cores do Makushi ERP e corrija todas, simulando para mim aqui as correções."
> A correção só entra depois do "aprovado" do Alexandre, por recado do design-de-marca ao gerente-projetos com a lista MC-nnnn.

## 1. Referência que manda

| Fonte | O que vale |
|---|---|
| Manual da marca do FDV, §3 cores e §5 tipografia (`aloirr/macuxifdv`, `docs/marca/manual.md`) | Paleta, fontes do sistema e escala web. Usei a cópia oficial no ERP (`docs/marca/ativos/fdv-2026-11-12-v1/contraste.json`) e os tokens `packages/ui/src/tokens.ts`, que citam o manual. [SUPOSIÇÃO] O manual do FDV não foi relido nesta sessão: o guardião barra anexar o `aloirr/macuxifdv` a uma sessão de agente. Tudo o que digo do FDV vem da cópia oficial e das regras já trazidas ao ERP. |
| Config aprovada (decisão 45, 25cf42c) | h1 20, título de bloco 15, rótulo 12, texto 13, campo 34, espaço 12 e canto 8. Referência: `aloirr/macuxierp-recados`, `recados/anexos/R-20261127-181200-config-final-25cf42c/`. |
| Decisão 44 A (R-20261127-182018) | Cabeçalho de tabela na névoa #ECEEF1, em negrito, com linha azul-noite de 2 px. Linha alternada #FBFAF8, um token novo que o design-de-marca valida (§4). |
| CLAUDE.md, regra 11 (MENOS É MAIS) | A página preenche a largura antes de descer, na grade de 12 colunas, com o campo curto em 1 a 2 colunas e os tamanhos padrão. |
| CLAUDE.md, regra 12 | Os botões ficam embaixo e juntos, na barra do rodapé do bloco ou da página. |
| `docs/marca/botao-acoes.md` | Um botão "Ações" por linha, igual ao FDV. |

## 2. Como foi feito

- **Telas reais:** abri as **42 telas** de `apps/web` (todo `page.tsx`, as rotas de todos os módulos e as abas do /config) com o roteiro do `tests/e2e/render-telas.mjs`. A API real rodou com um banco efêmero e a massa fictícia do `api-render-telas.ts`.
- **Medição em 1366 px:** medi os estilos calculados de cada tela: cabeçalho de tabela, linhas, botões, rótulos, h1, cores, fontes e largura.
- **Simulação:**
  - o "depois" é **a mesma tela real**, com um CSS e um JS de correção injetados só no navegador, sem commit;
  - nas tabelas que a massa deixa vazias, injetei 5 linhas fictícias, iguais no antes e no depois;
  - todo CNPJ ou CPF do print foi trocado por `00.000.000/0001-00`;
  - os nomes são "Exemplo" ou "Fictício" e os e-mails terminam em `@exemplo.invalid`.
- **Largura das tabelas (revisão de 27/11, ~19h00, a pedido do gerente):**
  - a primeira versão do "depois" tirava a quebra de linha de todas as células, e a coluna "Pendências" de Pedidos saía cortada;
  - na versão atual, cada tabela teve a rolagem lateral medida (`scrollWidth` × `clientWidth`) no "antes" e no "depois", em 1366;
  - nenhuma tabela tem rolagem lateral: 14 de 14 no "depois", e nenhuma no "antes".
- **Prints:** PNG em 1366 × 768 e 390 × 844, só a área visível (sem rolar), deviceScaleFactor 1.
- **Telas fotografadas:** 15 telas-modelo, mais 2 abas do /config. As 42 telas usam 5 moldes (lista com filtros, formulário, detalhe com cartões, abas e entrada). A correção é no molde, então vale para todas as telas que usam o mesmo molde.

**O que está certo e não muda.**
- **Cores:** nenhuma das 42 telas tem cor fora da paleta. Todas as cores calculadas são tokens `--mx-*`.
- **Fontes:** só `system-ui` (texto) e `ui-monospace` (código e frase de confirmação), como no manual §5.1.
- **Assinatura:** a "Macuxi ERP" e o símbolo estão certos no topo e no login.
- **Menu lateral:** grafite, com o título de grupo em sol claro e a tela atual com o traço sol claro.

## 3. Achados

Gravidade: 🔴 foge da regra aprovada e aparece em muitas telas · 🟡 diverge do padrão aprovado · 🟢 ajuste fino.

| MC | Tela | O que está | O que a marca manda | Correção | Dono | Grav. |
|---|---|---|---|---|---|---|
| MC-0201 | Todas as tabelas (Usuários, Licenças, Auditoria, Pedidos, Novo pedido, Pedidos a faturar, Notas, Rejeições, Títulos, Integração FDV, Lotes, /config Empresas e aba Dados). Perfis e `/licencas` do shell estão piores. | `th` na névoa, 13/600, sem caixa-alta, com linha de 1 px `bordaTabela` (#DFE2E6). Perfis e `/licencas`: `th` transparente, em grafite 12/600. Em Pedidos, o cabeçalho sai desalinhado e com coluna vazia. | Decisão 44 A e Config 25cf42c: névoa #ECEEF1, **12/700 em caixa-alta** (`.04em`), azul-noite e **linha azul-noite de 2 px**. | `tabela.cabecalho` em `estilos.ts`, `TabelaDensa`, `globals.css:47-48` e `.matriz-perfis`. Ajustar também `docs/design/telas-horizontais.md` §2, que ainda diz "sem caixa-alta". **A tabela cabe na largura em 1366 (regra 11), sem rolagem lateral:** o cabeçalho não quebra no meio da palavra; valor, data, número e selo ficam sem quebra; texto (Cliente, Vendedor, Filial) quebra entre palavras; na matriz de Perfis, o cabeçalho quebra entre palavras. Conferido: 14 de 14 tabelas cabem em 1366 no "depois". | designer-ux + engenheiro-apps | 🔴 |
| MC-0202 | Todas as tabelas | Nenhuma linha alternada. | Decisão 44 A: linha par em **#FBFAF8**. | Token novo `linhaAlternada` = #FBFAF8 (§4) em `tbody tr:nth-child(even)`. A coluna fixa de Ações (`globals.css:66`, fundo branco) passa a seguir a linha. | designer-ux (token) + engenheiro-apps | 🔴 |
| MC-0203 | Todas as telas do BKO e do /config, exceto a entrada | h1 24/700 em **grafite** nas 37 telas (o doc das telas horizontais pede azul-noite). Texto 15. Rótulo de campo 15/600. Campo com 41 a 43 px de altura. | Config 25cf42c: h1 **20** em azul-noite, texto **13**, rótulo **12**/600 em azul-noite, campo **34**, espaço 12 e canto 8. | Escala em `tokens.ts` (`papeis`) e `globals.css`. Ver a decisão D1. | designer-ux + engenheiro-apps | 🟡 |
| MC-0204 | Todas as telas | Botão 15 px, com 41 a 43 px de altura. O "Mostrar senha" do login sai em 13,33 px, a fonte padrão do navegador, que não herda o token. | Decisão 45: botão de **13 px**, com 34 px de altura e alvo de 44 px no celular. | `botaoPrincipal()`, `botaoSecundario()` e `botoes.css`. O botão de olho herda `font: inherit`. | designer-ux | 🟡 |
| MC-0205 | Listas com filtros (Pedidos, Usuários, Notas, Títulos, Pedidos a faturar, Rejeições, Auditoria, Lotes) | Filtros em 4 colunas fixas de cerca de 220 px, com sobra à direita. "Filtrar" e "Limpar" ficam numa linha sozinhos. | Regra 11: grade de 12 colunas, campo curto em 2 colunas e os botões do filtro juntos, no fim da grade. | `form.filtros`: `grid-template-columns: repeat(12, 1fr)`, campo `span 2`, `.filtros-acoes` `span 2`. No celular, `span 6`. | engenheiro-apps | 🟡 |
| MC-0206 | Pedidos, Usuários, Notas, Títulos, Pedidos a faturar, Rejeições, Lotes e /config Empresas | "Novo pedido", "Novo usuário" e "Exportar CSV" ficam **acima** da tabela. No /config, "Criar empresa" fica no topo, à direita. | Regra 12: uma barra de botões por bloco, **no rodapé do bloco**. Fora dela, só a busca e os links de linha. A Config aprovada tem "+ Adicionar usuário" no rodapé da tabela. | `.barra-acoes` vira o rodapé do cartão da tabela, depois das linhas e antes da paginação. No /config, a busca vai para a linha do título e "+ Criar empresa" vai para o rodapé. | engenheiro-apps | 🔴 |
| MC-0207 | Telas com abas: Usuários, Perfis, Licenças, Auditoria, Empresa (4 abas), Notas e Bandeira | No BKO, as abas (`nav.secoes`) são botões de contorno. No /config, são texto com sublinhado (`.abas-texto`). São dois padrões. | Um padrão só, o da Config aprovada: texto com sublinhado azul-noite de 2 px na aba atual. | Classe `.abas-texto` também no `nav.secoes`. | engenheiro-apps | 🟡 |
| MC-0208 | Telas com cartões: Empresa do /config, Empresa do BKO, detalhe do pedido, da nota e do título | Título de cartão 20/700, em caixa normal. | Config 25cf42c: título de bloco em **caixa-alta 13/700** azul-noite (IDENTIFICAÇÃO, ENDEREÇO, USUÁRIOS). A decisão 45 fala em "título 15". [SUPOSIÇÃO] Os 15 px são do título dentro do cartão; o rótulo de seção é 13 em caixa-alta, como no print aprovado. | `papeis.tituloCartao` e `.bloco h2`. | designer-ux | 🟡 |
| MC-0209 | Todas as telas do BKO em 390 px | O menu lateral aberto ocupa a primeira tela inteira, e o conteúdo só aparece depois de rolar. O topo ocupa 4 linhas (empresa, usuário, "Trocar senha" e "Sair"). | Regra 11 e o padrão de mercado: no celular, menu recolhido. | Botão "☰ Menu" no topo, com a gaveta do menu lateral. No celular, o topo fica numa linha só (Menu, assinatura e Sair), e "Trocar senha" e o nome vão para dentro do Menu. Tudo com tokens que já existem. | engenheiro-apps | 🔴 |
| MC-0210 | Topo do BKO e do /config | No BKO, "Sair" é um botão branco. Na Config aprovada, "Sair" é um link ("Superadmin Fictício · Sair"). O BKO tem o topo em azul-noite; o /config, em grafite. | Um só jeito de sair. Ver a decisão D3. | "Sair" vira link sublinhado em `bordaCinza` nos dois. | engenheiro-apps | 🟢 |
| MC-0211 | Menu lateral, faixa de homologação e rótulos | A caixa-alta usa 3 espaçamentos: `.06em` (`globals.css:34`), `.03em` (`:125`) e `.04em`. | Um só espaçamento. | `.04em` em todos (token `--mx-espaco-letra-caixa-alta`). | designer-ux | 🟢 |
| MC-0212 | Linhas das tabelas do /config (Usuários da Config aprovada 25cf42c) | A simulação aprovada mostra os links "Editar · Redefinir senha · Excluir" soltos na linha. | `botao-acoes.md` (Alexandre, 24/11, "Igual o fdv. Padronize tudo"): um botão "Ações" e no máximo uma ação à vista. O BKO já segue a regra. | Ver a decisão D2. | designer-ux | 🟡 |
| MC-0213 | Início do BKO (`/`) | Só "Boas-vindas" e "Comece pelo menu ao lado", numa página vazia. | Regra 11: a página preenche a largura. Não é marca: vai ao gerente como pedido de UX. | Fora desta correção. Fica registrado para o gerente decidir. | gerente-projetos | 🟢 |

Observações sem MC:
- As 8 telas de Cadastros e a Empresa do BKO saíram com "Disponível em breve" nesta massa. [SUPOSIÇÃO] O `api-render-telas.ts` não carrega esses descritores. As telas usam os mesmos moldes (lista e formulário genéricos), então MC-0201 a MC-0207 valem para elas.
- O detalhe do pedido, da nota e do título abre um registro fictício que não existe, e a resposta certa é a página "não encontrada". Não fotografei esse detalhe. MC-0203, MC-0208 e MC-0209 valem para ele.

## 4. Token novo: `linhaAlternada` = #FBFAF8 (decisão 44 A; validação da marca)

| Par | Contraste | Mínimo | Resultado |
|---|---|---|---|
| grafite #16202A sobre #FBFAF8 | 15,80:1 | 4,5 | passa |
| azul-noite #1E3350 sobre #FBFAF8 | 12,24:1 | 4,5 | passa |
| textoSecundario #4A5562 sobre #FBFAF8 | 7,28:1 | 4,5 | passa |
| textoApoio #5B6673 sobre #FBFAF8 | 5,60:1 | 4,5 | passa |
| erroTexto #A8261B sobre #FBFAF8 | 6,81:1 | 4,5 | passa |
| verdeSucesso #1D6B4F sobre #FBFAF8 | 6,16:1 | 4,5 | passa |
| #FBFAF8 contra branco e contra pérola | 1,04:1 | — | é decorativa: a linha continua com a divisória `bordaTabela` |

Parecer: **validado**. O #FBFAF8 é um meio-tom entre a pérola e o branco e não é cor nova de identidade. Uso só no fundo de linha par de tabela, nunca em texto, botão ou selo. Nome: `linhaAlternada` (variável `--mx-cor-linha-alternada`). [SUPOSIÇÃO] O FDV não tem esse token. Levar o mesmo valor ao FDV é decisão de lá.

## 5. Antes × depois (PNG nesta pasta)

| Tela | 1366 | 390 | MC que aparecem |
|---|---|---|---|
| **Pedidos** (a mais usada) | `pedido-pedidos-{antes,depois}-1366.png` | `pedido-pedidos-{antes,depois}-390.png` | 0201 a 0206, 0209 |
| **Usuários** | `core-usuarios-{antes,depois}-1366.png` | `core-usuarios-{antes,depois}-390.png` | 0201 a 0207, 0209 |
| **/config Empresas** | `config-{antes,depois}-1366.png` | `config-{antes,depois}-390.png` | 0201 a 0206 |
| Notas fiscais | `faturamento-notas-…` | idem | 0201 a 0207, 0209 |
| Títulos | `faturamento-titulos-…` | idem | 0201 a 0206, 0209 |
| Pedidos a faturar | `faturamento-pedidos-a-faturar-…` | idem | 0201 a 0206, 0209 |
| Integração FDV | `integracao-fdv-integracao-fdv-…` | idem | 0201 a 0204, 0209 |
| Perfis | `core-perfis-…` | idem | 0201 (o pior caso), 0202, 0207 |
| Licenças | `core-licencas-…` | idem | 0201, 0202, 0207 |
| Auditoria | `core-auditoria-…` | idem | 0201 a 0207 |
| Novo usuário | `core-usuarios-novo-…` | idem | 0203, 0204, 0207 |
| Novo pedido | `pedido-pedidos-novo-…` | idem | 0201, 0203, 0204 |
| /config Empresa (abas Empresa, Integração e Dados) | `config-empresas-empresa-…` | só a aba Empresa | 0201 a 0204, 0207, 0208. O redesenho completo dessa tela é a Config 25cf42c, já aprovada para a v0.3.28. |
| Início | `inicio-…` | idem | 0203, 0209, 0213 |
| Login | `login-…` | idem | 0204 |

## 6. Decisões que só o Alexandre toma

**D1 — Escala da Config (texto 13, rótulo 12, h1 20, campo 34) em todo o BKO?**
- **A (recomendada):** sim, a mesma escala no BKO e no /config. Uma tabela fica igual em qualquer tela, que foi o que o Alexandre pediu ("em todas as tabelas, os visuais"). Os tokens `base` e `h1` mudam e o teste de paridade acompanha.
- **B:** o /config fica com 13 e o BKO continua com 15. São duas escalas no mesmo produto, e a regra 11 pede tamanhos iguais em todas as páginas.

**D2 — Ações na linha da tabela do /config**
- **A (recomendada):** o botão "Ações" igual ao FDV, com no máximo uma ação à vista, também na tabela de Usuários da Config. Mantém a regra de 24/11 ("Igual o fdv. Padronize tudo"). "Excluir" fica no fim do menu, em vermelho `erroTexto`.
- **B:** os links soltos da Config aprovada (Editar · Redefinir senha · Excluir), só no /config. Abre uma exceção à regra do botão "Ações".

**D3 — Cor do topo**
- **A (recomendada):** o BKO fica em azul-noite (manual: faixa do cabeçalho) e o /config fica em grafite, como na Config aprovada. A diferença mostra a área da plataforma. Só o "Sair" é igualado (MC-0210).
- **B:** o topo em azul-noite nos dois.

Não há cor nova nem fonte nova a decidir. A única cor que entra é o #FBFAF8, já decidido (44 A) e validado na §4.

## 7. Depois do "aprovado"

O design-de-marca manda um recado ao `gerente-projetos` com a lista MC aprovada, separada por dono:
- **designer-ux:** MC-0201 (token e `estilos.ts`), MC-0202 (token), MC-0203, MC-0204, MC-0208, MC-0211 e MC-0212;
- **engenheiro-apps:** MC-0201 (`globals.css`), MC-0202, MC-0205, MC-0206, MC-0207, MC-0209 e MC-0210.

Ordem: tokens primeiro (designer-ux) e o shell depois. A marca confere de novo nos mesmos PNG, em 1366 e 390.
