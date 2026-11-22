# Assinatura "Macuxi ERP" — REGRA

> **REGRA em vigor** desde a versão `2026-11-22-v1` dos ativos (T-0049). Vale em **todo o ERP**: BKO, login, DANFE e PDFs, e-mails, ícones e materiais.
> Decisões de 21 e 22/11/2026: texto literal em [decisoes.md](decisoes.md).
> Fonte da marca: manual do Macuxi FDV (`aloirr/macuxifdv`, `docs/marca/manual.md`). Autor: design-de-marca · 22/11/2026 (Manaus) · T-0023 e T-0049.

## 1. O que é
O ERP **não tem marca nova**. Usa a mesma marca Macuxi do FDV: o mesmo símbolo (Monte Roraima), a mesma escrita "Macuxi", a mesma paleta e a mesma composição. **Só o descritor muda**: "ERP" no lugar de "FORÇA DE VENDAS", na mesma fonte, no mesmo tamanho e na mesma linha, de ponta a ponta da tinta de "Macuxi" (regra 3 do FDV).

Por quê: o cliente do ERP é o mesmo do FDV. Vendo a mesma marca no celular do vendedor, no BKO e no DANFE, ele entende que é um produto só, da mesma empresa.

## 2. Arquivos finais (use só estes)
Pasta: [`ativos/2026-11-22-v1/`](ativos/2026-11-22-v1/). O símbolo e o "Macuxi" são **os mesmos paths** dos SVGs oficiais do FDV (cópia sem alteração em [`ativos/fdv-2026-11-12-v1/`](ativos/fdv-2026-11-12-v1/)); o gerador confere isso byte a byte ([`ativos/LEIA-ME.md`](ativos/LEIA-ME.md)). Texto em curvas: os arquivos não dependem de fonte instalada.

| Versão | A — horizontal (principal) | C — vertical de apoio | Fundo permitido |
|---|---|---|---|
| Positivo | `macuxi-erp-a-positivo.svg` | `macuxi-erp-c-positivo.svg` | `branco` #FFFFFF ou `perola` #F8F6F1 |
| Negativo azul-noite | `macuxi-erp-a-negativo-azul-noite.svg` | `macuxi-erp-c-negativo-azul-noite.svg` | `azulNoite` #1E3350 |
| Negativo grafite | `macuxi-erp-a-negativo-grafite.svg` | `macuxi-erp-c-negativo-grafite.svg` | `grafite` #16202A (menu do BKO) |
| Mono preto | `macuxi-erp-a-mono-preto.svg` | `macuxi-erp-c-mono-preto.svg` | `branco` ou `perola`; impressão em preto (DANFE) |
| Mono branco | `macuxi-erp-a-mono-branco.svg` | `macuxi-erp-c-mono-branco.svg` | `azulNoite` ou `grafite`, ou foto escura liberada pelo design-de-marca |
| Só o símbolo | `fdv-2026-11-12-v1/macuxi-simbolo.svg`, `-negativo.svg`, `-mono.svg` | — | favicon, ícone, avatar |

Guias de consulta (não aplicar): `guia-area-de-protecao-a.svg` e `guia-area-de-protecao-c.svg`.

## 3. Cores de cada versão (tokens do FDV)
| Versão | Símbolo | Sol | "Macuxi" | "ERP" |
|---|---|---|---|---|
| Positivo | `azulNoite` #1E3350 | `sol` #C2540A | `grafite` #16202A | `ink2` (texto secundário) #4A5562 |
| Negativo azul-noite | `branco` | `solClaro` #F59A52 | `branco` | `claroNoAzul` #C9CED5 |
| Negativo grafite | `azulClaro` #9AA3B0 | `solClaro` | `branco` | #C9D0D8 (só dentro do SVG oficial) |
| Mono preto / branco | uma cor | uma cor | uma cor | uma cor |

- O laranja é **só do sol**. O "ERP" nunca é laranja.
- O #C9D0D8 existe só dentro do SVG. No código, o menu usa o arquivo, não um hex. Se o `designer-ux` precisar dele como token, é cor nova e vai ao Alexandre. Não vale trocar por `claroNoAzul` #C9CED5 (quase igual não é igual).

**Contraste conferido** (WCAG 2.x, mesma conta do FDV; detalhe em `ativos/2026-11-22-v1/contraste.json`, 32 pares, todos passam). Mínimo: 4,5:1 para "Macuxi" e "ERP"; 3:1 para símbolo e sol.

| Versão · fundo | "Macuxi" | "ERP" | Símbolo | Sol |
|---|---|---|---|---|
| Positivo · branco | 16,48 | 7,59 | 12,77 | 4,60 |
| Positivo · pérola | 15,26 | 7,03 | 11,82 | 4,26 |
| Negativo · azul-noite | 12,77 | 8,07 | 12,77 | 5,85 |
| Negativo · grafite | 16,48 | 10,59 | 6,47 | 7,56 |
| Mono preto · branco / pérola | 21,00 / 19,44 | idem | idem | idem |
| Mono branco · azul-noite / grafite | 12,77 / 16,48 | idem | idem | idem |

## 4. Tamanho mínimo e área de proteção
- **A:** no mínimo **20 px de altura** (a caixa do arquivo). Abaixo disso, só o símbolo.
- **C:** no mínimo **62 px de altura** total (o bloco "Macuxi ERP" fica com os mesmos 20 px da A). Esse é o mínimo para a C aparecer como marca. Para o "ERP" ser lido, veja a regra de leitura abaixo.
- **Só o símbolo:** a partir de **16 px** (favicon).
- **Leitura do "ERP":** como o "FORÇA DE VENDAS" no FDV, abaixo de cerca de 32 px de altura (A) o "ERP" vira letras soltas. Onde o nome do produto precisa ser lido (login, e-mail, rodapé do PDF), use a A com 32 px ou mais, ou a C com **100 px ou mais** (é a mesma escala: 62 × 32 / 20 ≈ 99; na C de 62 px o "ERP" fica com cerca de 3,7 px e vira pontos, como se viu no login da T-0021). No menu do BKO, 20 a 32 px está liberado.
- **Área de proteção:** em volta de toda a caixa do arquivo, um espaço livre igual à **altura do "M"** de "Macuxi" (68,7 em 110,85 da altura da A, ou seja, cerca de 62% da altura da A). Nada entra ali: texto, borda, outro logo ou a dobra do papel. As guias mostram o espaço.
- A caixa (`viewBox`) dos arquivos é a mesma dos logos do FDV, horizontal e empilhado: trocar o arquivo do FDV pelo do ERP não muda o leiaute.

## 5. Onde se aplica (todo o ERP)
| Aplicação | Versão | Dono |
|---|---|---|
| Topo do BKO (fundo azul-noite) | A negativo azul-noite (20 a 32 px), com a área de proteção da §4 | `designer-ux` (componente) · `engenheiro-apps` (aplicação) |
| Menu lateral do BKO (fundo grafite), se a assinatura for para lá | A negativo grafite (20 a 32 px) | `designer-ux` |
| Login e telas de marca | C positivo sobre pérola, ou C negativo azul-noite | `designer-ux` |
| Favicon e ícone da aba | só o símbolo (negativo sobre `azulNoite`, como o favicon do FDV) | `designer-ux` |
| DANFE e PDFs | A mono preto, **só como rodapé discreto**, fora dos campos do leiaute do Manual da NF-e. O quadro do emitente é da marca do cliente (tenant). Medidas, cores, fonte e marca d'água: [danfe-e-pdfs-fiscais.md](danfe-e-pdfs-fiscais.md) | `modulo-faturamento` |
| E-mail transacional | A positivo sobre branco, com 32 px ou mais, no topo ou na assinatura | `modulo-faturamento` (e quem enviar e-mail) |

## 6. Usos proibidos
1. "ERP" em laranja ou fora das cores do §3; qualquer cor fora da paleta.
2. Esticar, girar, inclinar, recortar, pôr sombra, contorno ou degradê.
3. Escrever "MACUXI ERP", "Macuxi Erp", "MacuxiERP" ou "ERP Macuxi". Em texto corrido, o nome é "Macuxi ERP".
4. Usar "FORÇA DE VENDAS" e "ERP" juntos, ou criar descritor novo (por exemplo, "FISCAL") sem aprovação do Alexandre.
5. Pôr a assinatura do ERP no mesmo nível do logo do cliente. No DANFE, a marca do cliente fica no quadro do emitente; a Macuxi só no rodapé discreto.
6. Redesenhar o símbolo, trocar a fonte, redigitar "Macuxi" ou "ERP" em fonte do sistema, ou mudar o espaçamento do "ERP".
7. Usar versão no fundo errado (por exemplo, positivo sobre `azulNoite`) ou abaixo do tamanho mínimo.
8. Grafismo de inspiração macuxi junto da assinatura sem origem registrada e sem a validação prevista no manual do FDV.
9. Usar as propostas antigas da T-0023 (`assinatura-erp-opcao-*.svg`), removidas em 22/11/2026.

## 7. Aplicação
Os avisos do recado **R-20261122-005555** (ao `designer-ux`, com cópia ao `modulo-faturamento`) **passam a valer com estes arquivos**, depois do merge: o dono aplica pelo §5, usando o arquivo SVG (nunca hex solto nem texto redigitado; no DANFE, o PNG gerado do SVG oficial, conforme [danfe-e-pdfs-fiscais.md](danfe-e-pdfs-fiscais.md) §4), e o design-de-marca valida no print do navegador, do DANFE e do e-mail antes do lote.
