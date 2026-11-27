# Marca — Macuxi ERP

O Macuxi ERP usa **a mesma marca Macuxi do FDV**. A fonte única é o manual da marca do FDV (`aloirr/macuxifdv`, `docs/marca/manual.md`, aprovado pelo Alexandre em 12/11/2026). Os tokens de cor do BKO estão em `packages/ui/src/tokens.ts`. Decisões do Alexandre: [decisoes.md](decisoes.md).

- **REGRA (22/11/2026):** assinatura "Macuxi ERP" em todo o ERP, em [assinatura-erp.md](assinatura-erp.md); arquivos em [ativos/](ativos/LEIA-ME.md). Dono: design-de-marca.
- **REGRA (22/11/2026):** DANFE e PDFs fiscais (logo do emitente, preto, Helvetica, rodapé e marca d'água de homologação), em [danfe-e-pdfs-fiscais.md](danfe-e-pdfs-fiscais.md). Dono da aplicação: modulo-faturamento.
- **REGRA (22/11/2026, opção B):** confirmar ação destrutiva usa o vermelho `erroTexto` #A8261B com texto branco (7,10:1); nenhum vermelho mais escuro sem o Alexandre; o aviso fixo do `Dialogo` usa o tom de erro quando a ação é destrutiva. Registro em [decisoes.md](decisoes.md). Dono da aplicação: designer-ux.
- **REGRA (24/11/2026):** botão Ações nas linhas, em [botao-acoes.md](botao-acoes.md). T-0099, R-20261124-224843. Dono da aplicação: designer-ux.
- **REGRA derivada (25/11/2026):** frase de confirmação digitada, em [frase-confirmacao.md](frase-confirmacao.md). T-0101. Dono da aplicação: engenheiro-apps.
- **REGRA (27/11/2026):** telas horizontais e destaque nos cabeçalhos, na seção abaixo. Pedido do Alexandre, R-20261127-110345. T-0101, v0.3.24. Registro em [decisoes.md](decisoes.md). Detalhe de aplicação em [docs/design/telas-horizontais.md](../design/telas-horizontais.md). Dono da aplicação: designer-ux (tokens e regra de UX) e engenheiro-apps (shell).

## Telas horizontais e destaque nos cabeçalhos (REGRA, 27/11/2026)

1. **Largura toda.**
   - No computador, o conteúdo usa a largura toda da janela, com blocos lado a lado: de 2 a 4 colunas, cartão de no mínimo 280 px.
   - Um bloco embaixo do outro só abaixo de 768 px (celular).
   - Não se usa coluna estreita centralizada nem pilha vertical de cartões que caberiam lado a lado.
   - Exceções: o cartão de login, os diálogos e o parágrafo corrido (até 75ch).
2. **Destaque nos cabeçalhos.**
   - Título de bloco, rótulo e cabeçalho de tabela usam a cor de destaque `rotuloDestaque`, alias do Azul noite #1E3350 (sem cor nova). Contraste: 12,77:1 no branco, 11,82:1 na pérola e 10,99:1 na névoa, fundo do cabeçalho de tabela.
   - O valor fica em grafite 15/400. O rótulo de dado é 13/600, em caixa-alta.
   - O destaque nunca depende só da cor: o rótulo mantém tamanho, peso e caixa-alta diferentes do valor (entre azul-noite e grafite o contraste é de só 1,29:1).
   - O rótulo nunca é sublinhado. O link continua sublinhado, para o rótulo azul-noite não parecer clicável.
   - O laranja do sol não é cor de rótulo.
3. **Só tokens do `packages/ui`** (`--mx-*`), sem hex solto. Conferência: designer-ux, design-de-marca e corretor-redundancias.

Observação para a auditoria da versão (não é ajuste agora): a caixa-alta usa hoje três espaçamentos de letra — menu lateral `.06em` (`apps/web/src/app/globals.css:34`), faixa de homologação `.03em` (`globals.css:125`) e rótulo de dado `.04em` (`docs/design/telas-horizontais.md:58`).
