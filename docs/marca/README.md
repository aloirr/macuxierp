# Marca — Macuxi ERP

O Macuxi ERP usa **a mesma marca Macuxi do FDV**. A fonte única é o manual da marca do FDV (`aloirr/macuxifdv`, `docs/marca/manual.md`, aprovado pelo Alexandre em 12/11/2026). Os tokens de cor do BKO estão em `packages/ui/src/tokens.ts`. Decisões do Alexandre: [decisoes.md](decisoes.md).

- **REGRA (22/11/2026):** assinatura "Macuxi ERP" em todo o ERP, em [assinatura-erp.md](assinatura-erp.md); arquivos em [ativos/](ativos/LEIA-ME.md). Dono: design-de-marca.
- **REGRA (22/11/2026):** DANFE e PDFs fiscais (logo do emitente, preto, Helvetica, rodapé e marca d'água de homologação), em [danfe-e-pdfs-fiscais.md](danfe-e-pdfs-fiscais.md). Dono da aplicação: modulo-faturamento.
- **REGRA (22/11/2026, opção B):** confirmar ação destrutiva usa o vermelho `erroTexto` #A8261B com texto branco (7,10:1); nenhum vermelho mais escuro sem o Alexandre; o aviso fixo do `Dialogo` usa o tom de erro quando a ação é destrutiva. Registro em [decisoes.md](decisoes.md). Dono da aplicação: designer-ux.
- **REGRA (24/11/2026):** botão "Ações" nas linhas de tabelas e listas do /config e do BKO, igual ao FDV (uma ação principal à vista, perigo por último em `erroTexto` #A8261B depois de um traço, menu sem corte, teclado, 44 px no celular, componente único `MenuAcoes`), em [botao-acoes.md](botao-acoes.md). T-0099, R-20261124-224843. Dono da aplicação: designer-ux.
