# Assinatura "Macuxi ERP" (T-0023)

> **APROVADA COM CONDIÇÃO — conformidade com o FDV pendente.** Ainda **não é REGRA**: nenhum agente aplica a assinatura em tela, PDF, e-mail ou ícone até a versão final estar em `docs/marca/ativos/` e este arquivo virar regra.
> Decisão do Alexandre em 21/11/2026, 21h29 (Manaus): "SEGUIR COM O RECOMENDADO" — A principal, C vertical de apoio, B descartada; reforçada às 21h31 (Manaus): "Decisoes de 1 a 6 : seguir com o recomendado" (recado R-20261121-213141-alexandre) ([decisoes.md](decisoes.md)). O reforço não escolhe entre "ponta a ponta" e "à esquerda": o §6 continua em aberto.
> Autor: design-de-marca · atualizado em 21/11/2026 (Manaus) · Tarefa T-0023.

## 1. Regra da assinatura
O ERP **não ganha marca nova**. Usa a mesma marca Macuxi do FDV: mesmo símbolo (Monte Roraima), mesma escrita "Macuxi", mesma paleta e mesma composição. **Só o descritor muda**: "ERP" entra no lugar de "FORÇA DE VENDAS".

Por quê: o cliente do ERP é o mesmo cliente do FDV. Vendo a mesma marca no celular do vendedor, no BKO e no DANFE, ele entende que é um produto só, da mesma empresa.

## 2. Versões aprovadas (com condição)
- **A — principal (horizontal):** símbolo à esquerda; "Macuxi" em cima; "ERP" embaixo, no lugar do "FORÇA DE VENDAS". Para cabeçalho e menu do BKO, quadro do emitente do DANFE e e-mail.
- **C — vertical de apoio (empilhado):** símbolo em cima, escrita embaixo, centralizada. Equivale ao empilhado do FDV ("splash e materiais quadrados"): login, capa e avatar quadrado.

## 3. Cores de cada versão (as do FDV, pelos tokens)
| Versão | Fundo | Símbolo | Sol | Escrita "Macuxi" | Descritor "ERP" | Contraste do descritor |
|---|---|---|---|---|---|---|
| Positivo | `branco` | `azulNoite` | `solLaranja` | `grafite` | `textoSecundario` | 7,59:1 (7,03:1 sobre `perola`) |
| Negativo azul-noite | `azulNoite` | `branco` | `solClaro` | `branco` | `bordaCinza` | 8,07:1 |
| Negativo grafite (menu do BKO) | `grafite` | `azulClaro` | `solClaro` | `branco` | #C9D0D8 do FDV (sem token no ERP) | 10,59:1 |
| Mono preto / mono branco | liso | uma cor | uma cor | uma cor | uma cor | — |

- O laranja é **só do sol** do logo e dos gráficos. O descritor **nunca** é laranja.
- O #C9D0D8 só existe dentro do arquivo SVG oficial do FDV. No ERP, o menu usa o arquivo, não um hex no código. Se o `designer-ux` precisar dele como token, é cor nova e vai ao Alexandre. Não vale trocar por `bordaCinza` (#C9CED5, quase igual não é igual).

## 4. Conferência com o FDV (21/11/2026)
Feita pelo gerente contra o `aloirr/macuxifdv` (só leitura, busca de código). O conteúdo integral dos SVGs oficiais não estava acessível nesta sessão.

| Item | FDV (`docs/marca/manual.md` e `gerar-ativos.mjs`) | Proposta de 21/11 | Resultado | Correção (segue o FDV) |
|---|---|---|---|---|
| Símbolo | Monte Roraima: tepui de topo plano, sol nascendo atrás, linha do lavrado; fresta entre o sol e o topo da serra, também no mono | Quadro tracejado "SÍMBOLO FDV" | Bate (lugar reservado, sem redesenho) | Entrar o SVG oficial na versão final |
| Escrita e tipografia | "Macuxi" em caixa alta e baixa, Archivo ExtraBold, em contorno nos ativos. A fonte do sistema vale só para texto de interface (R-20261115-110600) | "MACUXI" em caixa alta, fonte do sistema | Diverge | "Macuxi", Archivo ExtraBold, convertida em curvas |
| Paleta | As da tabela do §3 | Escrita `azulNoite`; descritor `solLaranja`/`solClaro` | Diverge | Cores da tabela do §3 |
| Posição do descritor | Embaixo da escrita; linha do lavrado na base do "FORÇA DE VENDAS"; topo do sol na linha do topo do "M" | Embaixo (A) e empilhado (C) | Bate | Manter; alinhar topo do sol e base do descritor como no FDV |
| Largura do descritor | Regra 3: "FORÇA DE VENDAS" vai de ponta a ponta da tinta de "Macuxi" | "ERP" curto, à esquerda | Diverge | — |
| Espaço símbolo–escrita | 0,3 da altura do logo; no empilhado, símbolo com 0,62 da largura da tinta da escrita e espaço de 0,3 da altura do símbolo | Espaço livre | Diverge | Usar as proporções do FDV |
| Área de proteção | Altura do "M" | Altura do "M" | Bate | — |
| Tamanho mínimo | 20 px de altura com a escrita; abaixo disso, só o símbolo, a partir de 16 px | 120/80 px de largura | Diverge | 20 px de altura com a escrita; 16 px só o símbolo (favicon) |
| Versões | Positivo, negativo azul-noite, negativo grafite, mono preto, mono branco, empilhado positivo/negativo, símbolo (positivo, negativo, mono) | Clara, escura, mono | Diverge (falta o negativo grafite) | Mesmas versões do FDV, com "ERP"; empilhado positivo/negativo para a C |

## 5. Arquivos desta pasta (simulação)
`assinatura-erp-opcao-a-{clara,escura,mono}.svg` e `assinatura-erp-opcao-c-{clara,escura,mono}.svg` são **simulação da posição**, não ativo final. Já seguem o FDV em caixa ("Macuxi") e nas cores do §3 ("clara" = positivo, "escura" = negativo azul-noite). Ainda usam fonte do sistema, o quadro tracejado no lugar do símbolo e o "ERP" curto, até a versão final. Todos passam no `xmllint --noout`.

## 6. Decisão em aberto (aguarda o Alexandre): "ERP" de ponta a ponta
**AGUARDA O ALEXANDRE.** A pergunta "o 'seguir com o recomendado' de 1 a 6 (R-20261121-213141-alexandre) cobre o §6?" foi levada ao Agente PO pelo gerente em 22/11/2026, às 00h52 (Manaus).

A regra 3 do FDV manda o descritor ir de ponta a ponta da tinta de "Macuxi". Com "FORÇA DE VENDAS" (15 caracteres) isso sai natural; com "ERP" (3 letras), não.

| Opção | Como fica | A favor | Contra |
|---|---|---|---|
| **(1) "ERP" espaçado de ponta a ponta** — RECOMENDADA | "E" alinhado ao início de "Macuxi" e "P" ao fim, letras com espaçamento aberto, na mesma altura de letra do "FORÇA DE VENDAS" | Mantém a regra do FDV intacta: as duas assinaturas têm a mesma caixa e o mesmo desenho; reconhecimento igual em tela, DANFE e e-mail | Espaçamento muito aberto entre 3 letras; em tamanho pequeno, o "ERP" pode ler como letras soltas |
| (2) "ERP" à esquerda, como exceção escrita | Mesma altura de letra do "FORÇA DE VENDAS", alinhado à esquerda com "Macuxi", sem esticar | Lê como uma palavra só | Abre exceção à regra 3 do FDV; a assinatura do ERP fica com outra silhueta |

**Recomendação: (1).** Consistência antes de novidade: a regra do FDV fica igual para os dois produtos. Resposta esperada do Alexandre: "aprovo ERP ponta a ponta" (1) ou "aprovo ERP à esquerda" (2).

## 7. Usos proibidos
1. Descritor em laranja ou fora das cores do §3.
2. Esticar, girar, inclinar, pôr sombra, contorno ou degradê.
3. Escrever "MACUXI ERP", "Macuxi Erp", "MacuxiERP" ou "ERP Macuxi". Em texto corrido, o nome é "Macuxi ERP".
4. Usar "FORÇA DE VENDAS" e "ERP" juntos, ou criar descritor novo (por exemplo, "FISCAL") sem aprovação.
5. Pôr a assinatura do ERP no mesmo nível do logo do cliente (tenant). No DANFE, a marca do cliente fica no quadro do emitente; a Macuxi aparece no máximo como rodapé discreto, fora dos campos do leiaute do Manual da NF-e.
6. Redesenhar o símbolo ou trocar a tipografia do logo.
7. Grafismo de inspiração macuxi junto da assinatura sem origem registrada e sem a validação do manual do FDV.

## 8. Próximos passos
1. Alexandre decide o §6 (opção 1 ou 2).
2. Anexar o `aloirr/macuxifdv` à sessão (só leitura) para pegar os SVGs oficiais de `docs/marca/ativos/2026-11-12-v1/` e o `docs/marca/ativos/gerar-ativos.mjs`.
3. Gerar os SVGs finais em `docs/marca/ativos/` (nova pasta com data e versão), com o símbolo oficial e o texto em curvas, nas versões do §4.
4. Reescrever este arquivo como **REGRA** e registrar em [decisoes.md](decisoes.md).
5. Avisar por recado o `designer-ux` (cabeçalho e menu do BKO com o negativo grafite, login com a C, favicon só com o símbolo) e o `modulo-faturamento` (quadro do emitente e rodapé do DANFE, e-mail). Eles aplicam; o design-de-marca valida no print.
