2026-11-21 — T-0005 — shell do BKO em apps/web (Next 16): login, empresa/filial, menu pelos manifestos, licenças só leitura, API falsa até a T-0004; PR [PRONTO PARA MERGE] T-0005.
2026-11-21 — T-0005 — correções RD-1..RD-9
2026-11-21 — T-0005 — merge do main, EuResposta, marca e RD-10. (coord caixa/enviar: 403 no repositório de recados, ignorado.)
2026-11-21 — T-0005 — RD-11 (menu pela API), mensagem do 429 e ajustes da marca. (coord caixa/enviar: 403 no repositório de recados, ignorado.)
2026-11-22 — T-0011 — tela Integração FDV no shell (monitor, credencial, lotes), testes e prints
2026-11-22 — T-0021 — telas do faturamento ligadas no shell do BKO
2026-11-22 — T-0021 — shell do faturamento adaptado ao head f1e1628 do #213: páginas e rótulos do módulo, selos com dica, DANFE desabilitado, inutilizar na barra de notas, diálogo destrutivo, testes de render
2026-11-22 — T-0021 — shell no head d597599 do #213: CSV pelo /exportar da API, detalhe do título e Rejeições do módulo, histórico da nota (/eventos), sem vermelho (confirmar com texto da ação), chave em linha inteira, menu marca a lista de origem, diálogos num padrão só
2026-11-22 — T-0021 — parecer do design-de-marca no shell do faturamento: linha Ambiente nas confirmações (RN-FAT-04), minúscula após "O que fazer:", contador de caracteres, coluna # estreita
2026-11-22 — T-0021 — shell do faturamento pós-merge do #213: DANFE habilitado e principal, ambienteDaConfirmacao no Emitir/Reenviar, cancelamento_pendente no detalhe, exports de volta (páginas, rótulos, BASE_API, textoDoAmbiente); testes atualizados
2026-11-22 — T-0021 — ajustes do shell: hover, btn-sec, 1024 px, números à direita, h1, loading, filtros, "Todas", lista vazia, selo de status, rotuloDoCliente (LGPD), total do pedido, R$ sem quebra, diálogo 15 px, testTimeout
2026-11-22 — T-0021 — ajustes B do shell sobre o #242: botoes.css (mx-botao/mx-botao-secundario no lugar de .btn), AssinaturaErp no topo (invólucro cliente), favicon no metadata, bordaCampo nos campos, legenda "Itens do pedido", DialogoMotivo com rotuloFechar/destrutivo ("Manter a nota"), testes de identidade e prints; corretor RD-0749 a RD-0752 (semEspacoDuro, CSS de link e disabled, testes negativos), hover provisório com token e testTimeout de 15 s só em api.http e listas
