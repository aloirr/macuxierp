# Assinatura "Macuxi ERP": PROPOSTA (T-0023)

> **PROPOSTA, não aprovada.** Nada deste arquivo entra no manual da marca sem o "aprovo" do Alexandre, dado em recado ou no chat. Até lá, nenhum agente aplica a assinatura em tela, PDF, e-mail ou ícone.
> Autor: design-de-marca · 21/11/2026 (horário de Manaus) · Tarefa T-0023 (F1).

## 1. Regra da assinatura
O ERP **não ganha marca nova**. Ele usa a mesma marca Macuxi do FDV: mesmo símbolo, mesma palavra MACUXI, mesma paleta e mesma tipografia. **Só o descritor muda**: "ERP" entra no lugar de "FORÇA DE VENDAS".

Por quê, em linguagem de negócio: o cliente do ERP é o mesmo cliente do FDV. Quando ele vê a mesma marca no celular do vendedor, no BKO e no DANFE, entende que é um produto só, da mesma empresa. Uma segunda marca dividiria o reconhecimento que o FDV já construiu.

| Elemento | Origem | Situação |
|---|---|---|
| Símbolo | Manual do FDV (`aloirr/macuxifdv`, `docs/marca/manual.md`) | **A conferir (§6).** Nos SVGs, ele aparece como um quadro tracejado "SÍMBOLO FDV", só para marcar o lugar. Não foi redesenhado. |
| Palavra MACUXI | Manual do FDV | Peso, caixa e espaçamento **a conferir (§6)**. Na simulação, caixa alta, peso 800 e fonte genérica do sistema. |
| Descritor | Específico do ERP | "ERP", em caixa alta. Essa é a proposta. |
| Paleta | Tokens de `packages/ui/src/index.ts` (que citam o manual do FDV, §3) | Só tokens existentes, nenhuma cor nova. |
| Tipografia | Manual do FDV | **A conferir (§6).** Os tokens do ERP ainda não têm família tipográfica. |

## 2. Cores de cada versão (só tokens)
| Versão | Fundo | MACUXI e símbolo | Descritor "ERP" | Contraste do descritor |
|---|---|---|---|---|
| Clara | `branco` | `azulNoite` (12,77:1 sobre `branco`) | `solLaranja` | 4,60:1 (passa 4,5:1) |
| Escura | `azulNoite` | `perola` (11,82:1) | `solClaro` | 5,85:1 (passa 4,5:1) |
| Monocromática | transparente | `grafite` | `grafite` | 16,48:1 sobre `branco` |

Cuidados encontrados no cálculo:
- `solLaranja` sobre `perola` dá **4,26:1**. Passa só como texto grande (3:1). Na versão clara, o fundo recomendado é `branco`. Sobre `perola`, o descritor só pode ser usado acima do tamanho mínimo do item 4 (ERP com altura de 14 px ou mais).
- `solLaranja` sobre `azulNoite` dá **2,78:1**: **proibido**. No fundo escuro, o descritor é sempre `solClaro`.
- A monocromática serve para carimbo, fax, impressão em uma cor e o quadro do emitente quando o DANFE sai em preto. Ela também pode sair em `branco` sobre fundo escuro (versão negativa a uma cor).

## 3. Opções de composição
A posição do "FORÇA DE VENDAS" na assinatura do FDV está **a conferir (§6)**. A recomendação abaixo parte da regra "muda só o descritor": a opção certa é a que repete a composição do FDV.

### Opção A: descritor embaixo, alinhado à esquerda (RECOMENDADA)
Símbolo à esquerda; MACUXI em cima; "ERP" embaixo, alinhado à esquerda com a palavra, em caixa alta espaçada, na cor de destaque.
Arquivos: `assinatura-erp-opcao-a-clara.svg`, `-escura.svg` e `-mono.svg`.
- **A favor:** é a composição clássica de marca com descritor, a mais provável de bater com a do FDV, em que o descritor fica embaixo da palavra. Funciona no cabeçalho do BKO, no login e no quadro do emitente do DANFE, onde a altura é curta.
- **Contra:** "ERP" é curto e ocupa pouco da largura da palavra. Isso é proposital, mas o espaçamento precisa ser ajustado com a fonte final.

### Opção B: em linha, com fio separador
Símbolo, MACUXI, fio vertical fino e "ERP" na mesma altura, com peso regular, na cor de destaque.
Arquivos: `assinatura-erp-opcao-b-*.svg`.
- **A favor:** é a mais legível em tamanho pequeno, porque o "ERP" fica grande, e serve para faixa estreita (barra do topo e rodapé do e-mail).
- **Contra:** ocupa mais largura e se afasta da composição do FDV se lá o descritor fica embaixo. Aí o ERP pareceria um produto separado.

### Opção C: vertical, centralizada
Símbolo em cima; MACUXI e "ERP" centralizados embaixo.
Arquivos: `assinatura-erp-opcao-c-*.svg`.
- **A favor:** serve para a tela de login, capa de apresentação e avatar quadrado.
- **Contra:** não cabe no cabeçalho do BKO nem no quadro do emitente do DANFE. É uma versão de apoio, não a principal.

**Recomendação:** aprovar a **A como assinatura principal** e a **C como versão vertical de apoio** (login e capas), **desde que** as duas batam com a composição do FDV quando forem conferidas. A B fica como alternativa se o Alexandre preferir o "ERP" mais visível em tamanho pequeno.

## 4. Área de proteção, tamanho mínimo e fundos
Valores propostos, a conferir (§6). Se o manual do FDV tiver valores próprios, valem os do FDV.
- **Área de proteção:** espaço livre em volta de toda a assinatura igual à altura da letra "M" de MACUXI. Nada entra nessa área: texto, borda ou logo do cliente.
- **Tamanho mínimo em tela:** opção A com 120 px de largura (o "ERP" fica perto de 6 px de altura); opção B com 140 px; opção C com 80 px. **Em impressão:** A com 30 mm e C com 20 mm.
- **Abaixo do mínimo** (favicon e ícone de 16 a 24 px): só o símbolo do FDV, sem a palavra e sem o descritor.
- **Fundos permitidos:** clara sobre `branco` (ou `perola`, respeitando o item 2); escura sobre `azulNoite`; monocromática sobre fundo liso que dê pelo menos 4,5:1. Nunca sobre foto ou grafismo sem uma área lisa por baixo.

## 5. Usos proibidos
1. Cor do descritor fora dos tokens ou fora da tabela do §2.
2. Esticar, girar, inclinar, pôr sombra, contorno ou degradê.
3. Escrever "Macuxi Erp", "MacuxiERP" ou "ERP Macuxi", ou mudar a ordem dos elementos. O nome por extenso em texto corrido é "Macuxi ERP".
4. Usar "FORÇA DE VENDAS" e "ERP" juntos na mesma assinatura, ou criar descritor novo (por exemplo, "FISCAL" ou "NF-e") sem aprovação.
5. Pôr a assinatura do ERP no mesmo nível do logo do cliente (tenant). No DANFE, a marca do cliente fica no quadro do emitente; a Macuxi aparece no máximo como rodapé discreto, fora dos campos do leiaute do Manual da NF-e.
6. Redesenhar o símbolo ou trocar a tipografia do FDV para o ERP.
7. Pôr grafismo de inspiração macuxi junto da assinatura sem origem registrada e sem a validação da seção de grafismos do manual do FDV.

## 6. Pendências antes do "aprovo"
1. **Conferir contra o manual do FDV** (`aloirr/macuxifdv`, `docs/marca/manual.md`), que não estava acessível nesta sessão (o clone pediu login): o desenho do **símbolo**, a **tipografia** (família, peso e espaçamento da palavra MACUXI), a **paleta** (se os tokens de `packages/ui` batem com o §3) e a **posição do "FORÇA DE VENDAS"**, que decide entre A e B.
2. Trocar o quadro tracejado pelo símbolo oficial e o texto por curvas na fonte oficial. Os SVGs de hoje são simulação: usam fonte do sistema, e a largura muda de uma máquina para outra.
3. Confirmar a área de proteção e os tamanhos mínimos com os do FDV.
4. Depois do "aprovo": registrar em `docs/marca/decisoes.md` (data e ID do recado), passar os arquivos finais para `docs/marca/ativos/` e avisar por recado o `designer-ux` (BKO, login e favicon) e o `modulo-faturamento` (quadro do emitente no DANFE e e-mail). Eles aplicam; o design-de-marca valida no print.

## 7. Como ver
Abra os nove SVGs no navegador: `assinatura-erp-opcao-{a,b,c}-{clara,escura,mono}.svg`, nesta pasta. Todos passaram no `xmllint --noout` e usam só os tokens de `packages/ui/src/index.ts`.
