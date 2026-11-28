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
2026-11-22 — T-0021 — shell: redirects com Location relativo (defeito do ERR_FAILED atrás do túnel) e origem do envio-carga e tela de filial sem filiais
2026-11-23 — T-0051 — shell: carga por entidade (botões na ordem do D13, modelo, prévia com erros por linha e dependência)
2026-11-23 — T-0051 — rodada final F2: proxyDeDownload único, rótulos do cadastros, timeout de 130 s na carga, CARGA_GRANDE_DEMAIS, input desligado enviando.
2026-11-23 — T-0051 — 2º push do PR #297: atalho da dependência pelo entidade_faltante do cadastros (#296); regex do nome do campo removida (cadastros sempre preenche); junta o main
2026-11-23 — T-0051 — shell: teste de perfis da carga lê a matriz (pronto para o analista)
2026-11-23 — T-0051 — shell: ajustes de marca na carga, RegiaoErros única e .mx-radio na filial
2026-11-23 — T-0051 — revisões do shell: região de erros do cabeçalho com itens (paliativo), textarea com aria, coluna Arquivo fora da tabela de erros, concordância dos omitidos.
2026-11-23 — T-0051 — região de erros única com temErroExterno do FormularioItens (#302); paliativo removido; errosIniciais mantida (único jeito de testar SSR sem DOM)
2026-11-23 — T-0050 — shell do portal /config (E4): sessão de superadmin, empresas, módulos, 1º admin, suspender/reativar e redefinir senha Revisão final: cookie Strict, Sair por POST (GET encerrar só apaga com 401 confirmado), guarda em empresas/nova, buscarNaApi comum, CSS sobre .conteudo/.topo.
2026-11-23 — T-0050 — 2º push do PR #310: linha da lista de empresas vira link para /config/empresas/:id (slug) e tabela com sombra de rolagem em 390 px.
2026-11-23 — T-0050 — 3º push do #310: marca (C 24 px, senha 20 px/600, títulos de cartão, borda de tabela), DialogoMotivo semTexto, Carregar mais acumulado (#309); mx-checkbox ainda não existe no main
2026-11-23 — T-0050 — 4º push: checkboxes de módulo do detalhe da empresa com .mx-checkbox (#311), teste de render
2026-11-23 — T-0051 — shell: teste do menu do analista, margem do login em 390 px e token do menu lateral, e Código no lugar de slug no portal
2026-11-23 — T-0051 — corretor: RD-1007 (menu.test) e RD-1008 (regex do CSS em identidade.test); RD-1006 é do designer-ux
2026-11-23 — T-0050 — portal /config: dados da empresa, e-mail do 1º admin mascarado com "Mostrar" auditado
2026-11-23 — T-0050 — revisões RD-1025 e RD-1026: revelação pelo resultado do executarConfig, 404 próprio do e-mail, testes sem repetição
2026-11-23 — T-0058 — aba Cargas no /config (Adicionar e Substituir tudo), carga fora do BKO (v0.3.5a); contrato provisório em lib/config/cargas-provisorio.ts
2026-11-23 — T-0058 — Zerar dados no /config (botão, janela com frase, rota) e "Nenhum cadastro ligado" na Integração (v0.3.5b)
2026-11-23 — T-0058 — Zerar com escolha de cadastros (RN-CAD-10: prévia por seleção, leva junto, mantidos, anulados, bloqueios, 422/409) e RDs 1206-1208 (ConfirmarComFrase comum) (v0.3.6)
2026-11-23 — T-0058 — v0.3.7: Zerar dados com aviso fixo no rodapé do Dialogo, .mx-checkbox, 409 do zerar pelos 4 códigos
2026-11-23 — T-0058 — v0.3.7: web com a lista de 8 cadastros do SDK (sem dependência entre cargas, ROTULO_ZERAR do nome do SDK, CODIGOS_ESTADO_MUDOU_ZERAR do SDK) e RDs 1255-1257
2026-11-23 — T-0070 — v0.3.8: endereços inativados no Substituir tudo de clientes (confirmação, "e nenhum cliente" e resultado; tipos do SDK) e RDs 1278-1280
2026-11-24 — T-0086 — /config: Monitor, Reprocessar, Zerar por cadastro, Log, Atualizar e aba Dados (apps/web)
2026-11-24 — T-0099 — botão Ações (MenuAcoes) nas linhas do BKO e do /config (#619)
2026-11-25 — T-0101 — aba Empresa do /config com a ficha da Receita (Atualizar pela Receita, Revelar e-mail/telefone, erros da fonte)
2026-11-25 — T-0101/T-0093 — ajustes dos prints da v0.3.14 (cidade/UF, vazio único, zerar com N=0)
2026-11-25 — T-0101 — v0.3.15: cidade/UF só no bloco Dados (RD-2200) e ficha consultada sem dados (RD-2201)
2026-11-25 — T-0106 — CNAE com descrição e nome do município na ficha; 3 estados da ficha; prévia vazia do zerar
2026-11-25 — T-0109 — Log: legenda dos registros não enviados ao FDV e Corrigir cadastro (2b)
2026-11-26 — T-0111 — conta bloqueada, Recuperar a senha e Conta desbloqueada na entrada
2026-11-26 — T-0111 — login: conta bloqueada só no 423/CODIGO_CONTA_BLOQUEADA do SDK; 429 volta a Muitas tentativas
2026-11-26 — T-0111 — /config: 423 vira ConfigContaBloqueada (mesmo ponto de login-regras); 429 segue Muitas tentativas
2026-11-26 — T-0110 — Log: seção Recebidos do FDV e saída da seção antiga de clientes recebidos
2026-11-26 — T-0111 — logos do e-mail servidos como estáticos em /email/ (public/email) com teste de existência, assinatura PNG e ausência de middleware
2026-11-26 — T-0057 A1 — bloco 'Integração via API' no /config (chave uma vez, trocar/revogar, lotes recebidos), lib pura e testes
2026-11-27 — v0.3.18 — ResultadoAcao logo abaixo do botão em todas as telas do apps/web (36 A): /config, login, esqueci/troca de senha, formulário e ações do BKO; pendências do #758 (licença)
2026-11-27 — v0.3.19 — sobras da aba Integração: RD-2338/2339, respiro Log/Ações, textos de retorno no formato do README
2026-11-27 — v0.3.28 — web: shell no padrão da marca (MC-0201 a MC-0210, decisão 54); MC-0212 sem tabela a converter
2026-11-27 — v0.3.28 — tela de Clientes ligada no BKO (lista, novo, edição por PATCH) e h1 a 4 px da saudação (MC-0216)
2026-11-28 — T-0134 — lista de Empresas: coluna Macuxi FDV, Ações ▾ (suspender/reativar, redefinir senha), busca, CNAE sem duplicata, Nova empresa/Criar/Salvar
2026-11-28 — T-0135 — selos de Integrações (4 situações), selo da licença com o vocabulário do core, temFdv sem cast, um botão por linha, coluna Cadastro, marca ERP → Macuxi FDV, Nova empresa à esquerda
2026-11-28 — T-0126 — Editar pedido no shell: PUT com If-Match, itens preenchidos, 412/409/422 com Recarregar, Editar no detalhe e na linha da lista; 3 testes de rota ajustados
2026-11-28 — v0.3.32 itens web — e2e config-usuarios com o texto do contrato e sem corpo no log; Salvar/Criar sem repetir o h1 (RD-2429); CNAE principal uma vez (RD-2425); frase única sem chave no ERP→FDV (RD-2423)
2026-11-28 — T-0129 — Formulário só leitura quando paginaEditavel é falso (campos em texto, selo, só Voltar) e 403 da API com a mensagem da rota
