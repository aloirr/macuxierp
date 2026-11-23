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
2026-11-22 — T-0021 — shell: colunas Pedido e Filial de volta na lista de notas e no cabeçalho do detalhe (acompanha o #251)
2026-11-22 — T-0021 — ajustes do shell: hover, btn-sec, 1024 px, números à direita, h1, loading, filtros, "Todas", lista vazia, selo de status, rotuloDoCliente (LGPD), total do pedido, R$ sem quebra, diálogo 15 px, testTimeout
2026-11-22 — T-0021 — ajustes B do shell sobre o #242: botoes.css (mx-botao/mx-botao-secundario no lugar de .btn), AssinaturaErp no topo (invólucro cliente), favicon no metadata, bordaCampo nos campos, legenda "Itens do pedido", DialogoMotivo com rotuloFechar/destrutivo ("Manter a nota"), testes de identidade e prints; corretor RD-0749 a RD-0752 (semEspacoDuro, CSS de link e disabled, testes negativos), hover provisório com token e testTimeout de 15 s só em api.http e listas
2026-11-22 — T-0021 — shell: nota parcial, ambiente no inutilizar, foco do Sair, tabelas em 1024 e ui (marca, ícones, hover); assinatura C no login e na seleção de filial (header azul-noite, área de proteção no padding); correção do milhar no campo da nota parcial (saldoCampo); corretor RD-0779, RD-0781 a RD-0784
2026-11-22 — T-0021 — nota parcial com a regra do PO (vazio = fora; botão desligado sem itens), ponto de troca no validarParcial (R-20261122-055826)
2026-11-22 — T-0021 — shell: formularioParcial do módulo, urlDaConfiguracaoDaFilial, vazio com e sem filtro, assinatura C 100 px, rádio azul-noite e textos da parcial
2026-11-22 — T-0021 — PR D, 2º commit: aviso da parcial sem "(ou 0)", lista só conta filtro real (limite preservado no Limpar filtros), RD do corretor (testes repetidos, FUSO, erro do item)
2026-11-22 — T-0021 — 3º push do PR #265: junta o main (#264) e mostra o erro do item como vem do formularioParcial; testes comparam com a saída do módulo
2026-11-22 — T-0021 — 4º push do PR #265: erro de saldo da nota parcial sem o número do item duplicado (descrição crua no ItemDoDialogo, rótulo separado)
2026-11-22 — T-0021 — shell v0.2.1: vazio das páginas, hora do módulo, erro da parcial junto do campo e coluna de ações no diálogo
2026-11-22 — T-0021 — shell: nota de fuso onde há horário (inclusive nas baixas do título), erro da parcial sem o rótulo na tela (errosPartes) e IdLista do módulo
2026-11-22 — T-0021 — shell: redirects com Location relativo (defeito do ERR_FAILED atrás do túnel) e origem do envio-carga
2026-11-23 — T-0021 — #275: nota de fuso no detalhe da nota e nas listas com horário; coluna Item fixa na parcial
2026-11-23 — T-0021 — shell: topo e cabeçalho do cartão com .mx-fundo-escuro (regra .topo duplicada removida)
