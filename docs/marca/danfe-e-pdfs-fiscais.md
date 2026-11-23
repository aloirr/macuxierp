# DANFE e PDFs fiscais — REGRA de marca

> **REGRA derivada** do manual da marca do FDV (`aloirr/macuxifdv`, `docs/marca/manual.md`) e da [assinatura-erp.md](assinatura-erp.md). Não é decisão nova do Alexandre: aplica ao DANFE o que já está aprovado. Origem do pedido: T-0021 (lote 3 do faturamento), com a nota simulada de R-20261122-022626-alexandre. Autor: design-de-marca · 22/11/2026 (Manaus).
> Vale para o DANFE da NF-e 55 e para todo PDF fiscal impresso em preto (por exemplo, a impressão da CC-e). Dono da aplicação: `modulo-faturamento`.
> Revisões 22/11/2026 (Manaus), T-0021: ajustes de redação e lacunas após a validação das amostras (fd5c177) e as revalidações (9f006ea e bcec8d3); sem mudança de marca; 23/11/2026 (Manaus), T-0021: §6 margem e aviso de topo, após as amostras de contingência do #269 (c740458).

O leiaute é o do **Manual de Orientação do Contribuinte (MOC), Anexo II**. A marca não muda campo, ordem, tamanho de quadro nem texto legal do MOC. Quando o MOC pedir algo diferente do que está aqui (tamanho de fonte, aviso, posição), **vale o MOC**.

Premissas técnicas (do gerente, T-0021): PDF montado com `pdf-lib`, fonte Helvetica, folha A4 em retrato, impressão em preto e branco.

## 1. Logo do emitente (o do cliente)
- O quadro do emitente é **da marca do cliente** (empresa do tenant). O logo da Macuxi **nunca** entra nesse quadro: nem como logo do emitente, nem quando o cliente não tem logo, nem como enfeite.
- **Caixa do logo:** lado esquerdo do quadro do emitente, com no máximo **1/3 da largura do quadro**, contado a partir do eixo da linha esquerda (o recuo fica dentro desse terço); começa **1,5 mm (4,25 pt) para dentro** desse eixo e tem a **altura do quadro menos 1,5 mm (4,25 pt) de margem em cima e embaixo**. O quadro continua com o tamanho do MOC: o logo se ajusta à caixa, nunca o contrário.
- **Proporção:** escala uniforme até o primeiro lado da caixa bater ("caber inteiro"). Nunca esticar, achatar, recortar, girar nem pôr borda ou sombra.
- **Alinhamento:** logo centrado na vertical e encostado à esquerda da caixa. Os dados do emitente (razão social, endereço, telefone) ficam centralizados no espaço que sobra à direita.
- **Sem logo:** o quadro fica só com os dados do emitente, centralizados na largura toda do quadro. Não se deixa espaço vazio reservado.
- **Folhas 2 em diante:** o logo se repete no cabeçalho, que é completo como no MOC, com as mesmas regras desta seção.
- **Preto e branco:** se o arquivo do cliente for colorido, o PDF leva o logo em **tons de cinza pela luminância** (0,2126 R + 0,7152 G + 0,0722 B), sem virar preto chapado. Transparência compõe sobre branco. O cinza dentro do logo do cliente é permitido: é a marca dele.
- **Nitidez:** no tamanho impresso, no mínimo **150 dpi** efetivos. Se o arquivo for pequeno, o logo sai menor, com o alinhamento acima; nunca ampliado além disso.

## 2. Cores
- **Preto `preto` #000000** em todo texto, linha, quadro, código de barras e na assinatura do rodapé.
- **Cinza só na marca d'água** (§5): tinta de preto a **15%**, que no papel branco dá **#D9D9D9**. Não é cor nova da paleta; é a tinta do `preto` só para esse uso. Qualquer outro cinza no DANFE **não é permitido**, exceto dentro do logo do cliente (§1): título de quadro sem fundo e itens sem zebrado.
- **Contraste conferido** (WCAG 2.x, mesma conta do FDV): texto preto sobre a marca d'água = **14,88:1** (mínimo 4,5:1). Os dados continuam legíveis onde a marca d'água passa por baixo.

## 3. Tipografia
- **Helvetica regular e Helvetica negrito** (`StandardFonts.Helvetica` e `StandardFonts.HelveticaBold` do `pdf-lib`). É **exceção registrada** à IBM Plex Sans da marca, por restrição técnica do `pdf-lib`, e vale **só nos PDFs fiscais**. BKO e e-mail seguem a tipografia do manual do FDV.
- Nenhuma outra família, itálico nem peso.
- **Tamanhos mínimos da marca** (onde o MOC pedir maior, vale o MOC):
  - rótulos de campo e texto do canhoto ("RECEBEMOS DE … INDICADA AO LADO"): **6 pt**, regular, caixa alta. São os únicos textos em 6 pt;
  - conteúdo de campo, legendas e os demais textos fixos (por exemplo, "Documento Auxiliar da Nota Fiscal Eletrônica", "Consulta de autenticidade…", "Folha x/y"): **7 pt**, regular;
  - títulos de quadro: **7 pt**, negrito, caixa alta;
  - destaques (número, série, chave de acesso e valor total da nota, `vNF`): **8 pt**, negrito. Todo outro valor, inclusive o `vProd`, é conteúdo de campo;
  - texto do rodapé "Emitido pelo": conforme §4.
- **Texto que não cabe:**
  - nunca reduzir a fonte abaixo do mínimo nem cortar com reticências;
  - quebrar em quantas linhas precisar (descrição do item e valor alinhado à direita);
  - o rótulo pode usar a abreviação do MOC ou quebrar em 2 linhas;
  - respiro mínimo de **1,5 pt** entre o texto e a linha do quadro, até o eixo da linha. Na vertical, conta a caixa da fonte (FontBBox da Helvetica: regular +0,931 e −0,225 do corpo; negrito +0,962 e −0,228), que cobre descendentes e acentos (Ç, g, É). Na horizontal, conta a soma das larguras de avanço dos glifos, sem kerning (é o que o `drawText` desenha). Isso vale para o texto alinhado à esquerda e para o valor alinhado à direita. O texto nunca cruza a linha;
  - o símbolo `R$` é uniforme em todos os campos de valor do mesmo quadro: ou todos têm, ou nenhum; nunca some só porque o número é grande;
  - o "item extremo" das amostras de teste é o máximo do leiaute: `qCom` com 11 inteiros e 4 decimais; `vProd` do item e os totais `vProd` e `vNF` com 13 inteiros e 2 decimais; descrição com exatamente 120 caracteres.
- A Helvetica do `pdf-lib` só tem os caracteres do WinAnsi. Acentos do português funcionam; símbolos fora dele (por exemplo, o sinal de menos U+2212) saem trocados por equivalente simples ("-"), nunca por outra fonte.

## 4. Rodapé "Emitido pelo Macuxi ERP"
- **Composição:** texto **"Emitido pelo"** (Helvetica regular, 7 pt, preto) seguido da **assinatura A mono preto**. O logo completa a frase: o texto **acompanha** o logo e não repete "Macuxi ERP" escrito ao lado. É proibido redigitar "Macuxi" ou "ERP" em Helvetica no lugar do logotipo.
- **Arquivo:** `ativos/2026-11-22-v1/macuxi-erp-a-mono-preto.svg`. O `pdf-lib` não desenha esse SVG inteiro (tem `clipPath`, `circle` e `transform`), então use o PNG gerado dele: **`ativos/2026-11-22-v1/macuxi-erp-a-mono-preto-400.png`** (ficha em [ativos/LEIA-ME.md](ativos/LEIA-ME.md)). Não gere outro PNG nem redesenhe à mão.
- **Altura do logo:** **24 pt (8,47 mm)**, a altura de leitura do "ERP" da [assinatura-erp.md](assinatura-erp.md) §4 (32 px). Largura que resulta: **111,4 pt (39,3 mm)**. Nem maior (é rodapé discreto) nem menor (o "ERP" vira letras soltas). Nessa altura o PNG fica com cerca de 1.200 dpi.
- **Área de proteção:** **14,9 pt (5,25 mm)** livres em volta da caixa do logo (altura do "M"). Isso vale entre o texto "Emitido pelo" e o logo, entre o logo e o último quadro do DANFE e entre o logo e a borda do papel.
- **Posição:** em **todas as folhas**, no mesmo lugar: abaixo do último quadro, com a borda direita da caixa do logo alinhada à margem direita dos quadros. A linha de base de "Emitido pelo" fica a **8,3 pt acima da base da caixa do logo** (a mesma linha de base de "Macuxi").
- **Fora do leiaute do MOC:** o rodapé não entra em quadro nem em campo do MOC, nem em "Dados adicionais" ou "Reservado ao fisco".
- **Metadado do PDF:** em texto corrido, o nome é "Macuxi ERP" (assinatura-erp.md §6, item 3); use essa grafia no `Creator`/`Producer` do PDF, se for preenchido.

## 5. Marca d'água "SEM VALOR FISCAL" (homologação)
- **Quando:** só em nota de **homologação** (`tpAmb` = 2 no XML), o que inclui a nota simulada de R-20261122-022626-alexandre. **Nunca em produção** (`tpAmb` = 1). Decida pelo `tpAmb` do XML que gera o DANFE, não por configuração solta.
- **Texto exato:** `SEM VALOR FISCAL`, em caixa alta, numa linha só.
- **Fonte:** Helvetica negrito, **60 pt**.
- **Cor:** tinta de preto a 15% (**#D9D9D9** no papel branco, §2). Desenhe **por baixo do conteúdo** (antes dos quadros e textos), em cor sólida `rgb(0,85; 0,85; 0,85)`. Se precisar desenhar por cima, use preto #000000 com **opacidade 0,15**, que dá o mesmo tom.
- **Ângulo e posição:** **45°**, subindo da esquerda para a direita, com o centro do texto no centro da folha (tolerância de **± 2 mm**).
- **Folhas:** em **todas** as folhas do DANFE.
- **Não substitui** nenhum aviso legal do MOC para homologação: os textos exigidos continuam nos campos próprios. A marca d'água é um reforço visual.
- Se o DANFE precisar de outra marca d'água de texto (por exemplo, nota cancelada), ela segue o mesmo padrão visual: fonte, tom, ângulo e centro.

## 6. Margem e aviso de topo
- **Área de impressão:** nenhuma tinta a menos de **5 mm (14,2 pt)** da borda do papel, em todos os lados. Muitas impressoras não imprimem essa faixa.
- **Quadros:** começam na margem de **10 mm (28,35 pt)**. Na faixa entre 5 e 10 mm só entram o aviso de topo (abaixo) e o rodapé "Emitido pelo" (§4).
- **Aviso de topo:** **uma linha só**, Helvetica negrito, **8 pt**, centralizada na largura dos quadros, com a linha de base a **22 pt** do topo da folha. Medido pela FontBBox, ela fica entre 14,3 e 23,8 pt, com 4,5 pt de respiro até o primeiro quadro. Em todas as folhas.
  - Homologação: "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL".
  - Contingência (tpEmis 6 ou 7): "DANFE EM CONTINGÊNCIA".
  - Os dois juntos: "DANFE EM CONTINGÊNCIA – EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL", numa linha só. Nunca duas linhas empilhadas na margem.
- **Detalhes da contingência** (modalidade, entrada e justificativa) vão nos dados adicionais, em 7 pt, uma frase por item, cada uma terminada em ponto.
