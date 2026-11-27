2026-11-21 — T-0028 — tokens da marca em packages/ui (cores, tipografia, --mx-*); Azul suave e Névoa pendentes (manual do FDV inacessível na sessão)
2026-11-21 — T-0028 — tokens da marca ampliados (cores §3, fontes §5.1, pesos, escala, aliases); valores vieram de outra sessão: AINDA FALTA conferir com o manual do FDV (add_repo indisponível)
2026-11-21 — T-0028 — correções da validação do design-de-marca e do corretor (azulClaro #9AA3B0, sem azulSuave/azulSerra, pesos 500/600 por papel, aviso, título 20/24, exports nomeados); NÃO conferido com o manual do FDV (add_repo indisponível): valores vieram da tarefa
2026-11-21 — T-0028 — ajuste dos comentários de papel das cores e dos pesos 600 (abaAtiva, rotuloPequeno) em tokens.ts; tokens.css regenerado
2026-11-22 — T-0021 — bordaCampo, botões únicos (MC-0008), DialogoMotivo rotuloFechar/destrutivo, erros por campo, nowrap, legenda 600 e S-01 (AssinaturaErp + favicon) em packages/ui; 897c12c (#242); corretor RD-0725–0732 sem 🔴, engenheiro aprovado.
2026-11-22 — T-0021 — 2º PR: foco visível nos botões, erro junto do campo no diálogo, campoBase (canto 6 px), contorno do rádio e dinheiro pelo formatar do sdk (RD-0723); 4a18223 (#248); corretor RD-0753–0760 sem 🔴, engenheiro liberado.
2026-11-22 — T-0021 — 3º PR: hover dos botões, apple-touch-icon 180, 'use client' nos componentes com hook, assinatura e ícones pelo subpath marca, rádio sem anel duplo; 58eccc4 (#250); corretor RD-0761–0766 sem 🔴, engenheiro aprovado.
2026-11-22 — T-0021 — assinatura C (negativo azul-noite, ≥ 62 px) em @macuxierp/ui/marca para o login e a seleção de filial; a4951a9 (#255); corretor RD-0775–0778 sem 🔴, engenheiro aprovado.
2026-11-22 — T-0021 — v0.2.1: doc do erro de campo (#270), barrel sem a marca, legenda em 15 px, foco em fundo escuro, ação parcial só no detalhe (R-055226); corretor RD-0844–0848.
2026-11-23 — T-0021 — MC-0015 na ui (span + região role=status única, soLeitor) e .mx-radio no botoes.css
2026-11-23 — T-0021 — regraCss com px, RegiaoErros, mensagemErro com display:block, testes enxutos (RD-a..g)
2026-11-23 — T-0050 (E5, ressalvas da marca) — selo sem solClaro (borda azulClaro, texto branco), ativos A grafite e C positivo em marca.tsx com SHA, AssinaturaErp com fundo (união discriminada), doc ajustado
2026-11-23 — T-0050 — correções da spec do portal /config após revisão do engenheiro
2026-11-23 — T-0021 — temErroExterno no FormularioItens (região única na tela do pedido); RD-0960 (RD-0961 manter?)
2026-11-23 — T-0050 — DialogoMotivo semTexto e TabelaDensa com carregar mais (acumularPagina) para o portal /config; RD-0970–0974
2026-11-23 — T-0050 — TabelaDensa: região viva sempre montada; AnuncioLeitor; CfgEscolha; doc
2026-11-23 — T-0050 — `.mx-checkbox`; regra de paginação (RD-0974); RD-0982–0984
2026-11-23 — T-0021 — token rotuloMenu (alias tituloGrupo por uma versão); login do portal no cartão branco
2026-11-23 — T-0053 — prints A0 (390 px) e folha docs/design/a0-prints.md para aprovação do Alexandre
2026-11-23 — T-0056 — FaixaPendencias sem o rótulo 'Bloqueia'/'Atenção' (prefixo só para leitor de tela); RD-1144–1146
2026-11-23 — T-0058 — Chip, CaixaResumo e Dialogo base (DialogoMotivo usa); RD-1176–1178
2026-11-23 — T-0058 — RD-1176/1177/1178: seloBase e tons em estilos.ts, teste de hex sem duplicidade, proximoFoco só em Dialogo, doc enxuto
2026-11-23 — T-0058 — Chip, CaixaResumo e Dialogo base (border-box, canto 8); prints da marca em docs/design/cargas/; RD-1176–1178
2026-11-23 — T-0058 — Dialogo com altura máxima 90vh e corpo rolável (v0.3.6); RD-1215–1217
2026-11-23 — T-0058 — botão destrutivo em vermelho (opção B) no DialogoMotivo e .mx-botao-destrutivo; RD-1217–1218
2026-11-23 — T-0058 — Dialogo com aviso fixo, respiro de foco e altura 100dvh−48 (v0.3.7)
2026-11-23 — T-0058 — Dialogo: tomAviso (aviso|erro), corpo com padding 4px nos quatro lados, altura calc(100dvh - 48px) fixada; prints do Zerar em tom erro, rolagem no fim e foco no último botão
2026-11-23 — T-0058 — Dialogo: fallback 100vh/dvh por estado, teste do aviso no DialogoMotivo, docs
2026-11-23 — T-0058 — Dialogo: 8px entre aviso e corpo (marginBottom) e prints regenerados com botão da marca em foco
2026-11-23 — T-0068 — aviso do Dialogo em 15 px/600 e AlertaBloqueante (ícone, barra 4 px, role=alert, foco) com doc em docs/design/alerta-bloqueante; RD-1262–1265; foco verificado no Chromium
2026-11-23 — T-0076 — desenho do login único (molde FDV), esqueci a senha com temporária; RD-1311–1313 reservados
2026-11-23 — T-0076 — correção: senha do superadmin na regra única de 8; portal-config §1 remete ao login-unico
2026-11-23 — T-0076 — correção: olho = botão de texto do CampoSenha na v0.3.10 (ícone na versão seguinte); título trocado no painel do esqueci
2026-11-24 — T-0076 — correção: README do login-unico cita TROCAR_SENHA (código do SDK), não SENHA_A_TROCAR
2026-11-24 — v0.3.12 — desenho da entrada do cenário B (config via Conector/via API, chave uma vez, dono por cadastro, trava 30%, BKO 'Vem do servidor do cliente'); RD-1460–1462 reservados
2026-11-24 — v0.3.11 — correção: entrada do cenário B volta a ser a v0.3.11 (decisão do Alexandre); README atualizado
2026-11-24 — T-0099 — MenuAcoes em packages/ui (botão Ações padronizado, perigo por último, menu fixed, teclado, alvo 44 px) com testes e docs/design/menu-acoes.md
2026-11-24 — T-0099 — MenuAcoes: Enter, Espaço, ↓ e ↑ no gatilho abrem e levam o foco ao item; Esc fecha com o foco no gatilho; e2e menu-acoes.mjs (#618) verde
2026-11-24 — T-0099 — MenuAcoes: Tab fecha e devolve o foco ao gatilho; aria-controls só com o menu aberto
2026-11-24 — T-0099 — MenuAcoes sem redundâncias (RD-1879 a RD-1883): fecharComEsc, só ' ', tecla única, onClick simples, título do teste
2026-11-25 — T-0099 — MenuAcoes: desabilitado aceita texto (motivo visível, aria-describedby, item focável); doc e testes (v0.3.15)
2026-11-25 — T-0099 — AcaoPrincipal aceita motivo (tipo Desabilitado compartilhado), aria-disabled e aria-describedby; corrige o build do #689
2026-11-25 — T-0099 — hover de botão não muda com aria-disabled (#689)
2026-11-26 — T-0111 — modelo do e-mail de senha temporária (claro/escuro, placeholders, textos exatos) em docs/design/emails/redefinir-senha/
2026-11-27 — v0.3.18 36 A — ResultadoAcao ganha margem inferior de 8 px (ficha da Receita no 1280); teste, README e prints atualizados
