# Revisão de marca — prints do botão "Ações" (T-0099, etapa 4)

> Autor: design-de-marca · 24/11/2026, 23h47 (Manaus) · Tarefa T-0099.
> Prints do PR #639 (head `0413192`, agente testes), em `docs/testes/prints/T-0099/`: três telas, cada uma em 1280 e em 390, com o menu aberto. Os PNGs não entram neste PR.
> Regra conferida: [botao-acoes.md](botao-acoes.md) (#605, R-20261124-224843).
> **Veredito geral: APROVADO COM RESSALVA.** O botão "Ações" e o menu seguem a regra nos seis prints. A única ressalva (R-01) é de voz, fora do componente, e não segura a entrega.

## 1. Conferência de cor no pixel
Amostras tiradas dos próprios prints:

| Parte | Cor no print | Token | Situação |
|---|---|---|---|
| Item de perigo ("Inativar", "Zerar") | `#A8261B` | `erroTexto` | ✅ |
| Borda do menu e traço separador | `#DFE2E6` | `bordaTabela` | ✅ |
| Fundo do menu | `#FFFFFF` | `branco` | ✅ |
| Item comum ("Redefinir senha", "Modelo") | `#16202A` | `grafite` (16,48:1 sobre branco) | ✅ |
| Borda de "Ações", "Editar", "Log", "Importar" | `#7A8593` | `bordaCampo` do `botaoSecundario` (3,75:1) | ✅ |
| Contorno de foco do "Ações" aberto | `#1E3350` (2 px) | `azulNoite` | ✅ |
| Item desativado ("Ligar", "Reprocessar") | `#7E8489` | `grafite` com opacidade, o mesmo tratamento de "Testar conexão" e "Salvar" desativados na tela; nenhum hex novo. 3,78:1 (texto desativado fica fora da exigência de contraste) | ✅ |

Nenhum laranja do sol (`solLaranja`) nem verde (`verdeSucesso`) no menu. O verde só aparece nos selos de situação ("Ativo", "Carregado"), no papel certo.

## 2. Tabela por print
Legenda: ✅ conforme · 🟡 ressalva · 🔴 fere a regra.

| Print | Rótulo "Ações" | Ação principal à vista | Perigo por último | Menu inteiro | Tokens (borda, botão, sem laranja/verde) | Alvo 44 px (390) | Tipografia e espaço | Veredito |
|---|---|---|---|---|---|---|---|---|
| `bko-core-usuarios-1280.png` | ✅ inteiro, sem "⋯" | ✅ só "Editar" | ✅ "Inativar" depois do traço, `#A8261B` | ✅ abre abaixo, por cima da página | ✅ | — | ✅ mesma fonte e escala dos botões da tabela | **Aprovado** |
| `bko-core-usuarios-390.png` | ✅ | ✅ só "Editar" | ✅ | ✅ abre para cima, por cima de "Exportar CSV", sem corte pelo quadro | ✅ | ✅ botão ~44 px; itens 52 px | ✅ | **Aprovado** |
| `config-empresa-aba-integracao-1280.png` | ✅ em todas as linhas | ✅ só "Log" (todas "Desligada", sem falha) | ✅ "Zerar" depois do traço, `#A8261B`; "Ligar" e "Reprocessar" desativados acima | ✅ por cima das linhas seguintes | ✅ | — | ✅ | **Aprovado com ressalva** (R-01) |
| `config-empresa-aba-integracao-390.png` | ✅ | ✅ só "Log" | ✅ | ✅ | ✅ | ✅ botões ~44 px; itens ~45 a 52 px | ✅ | **Aprovado com ressalva** (R-01) |
| `config-empresa-aba-dados-1280.png` | ✅ | ✅ só "Importar" | — (sem ação de perigo: o menu tem só "Modelo", sem traço, certo) | ✅ | ✅ | — | ✅ | **Aprovado** |
| `config-empresa-aba-dados-390.png` | ✅ | ✅ só "Importar" | — | ✅ | ✅ | ✅ item "Modelo" ~52 px | ✅ | **Aprovado** |

## 3. Ressalva
| ID | Onde | Tipo | Fere | Gravidade | Correção | Dono |
|---|---|---|---|---|---|---|
| **R-01** | Aba Integração do /config (prints `config-empresa-aba-integracao-1280.png` e `-390.png`): `apps/web/src/app/config/(portal)/empresas/[id]/aba-integracao.tsx:163`; o mesmo título no BKO em `apps/web/src/components/integracao-fdv/vista.tsx:17` (e as asserções em `vista.test.tsx` e `clientes-recebidos.test.tsx`) | voz | Tom de voz da marca: o produto é sempre "Macuxi FDV", nunca "FDV" solto (M-04 da [revisao-F1-prints.md](revisao-F1-prints.md)) | baixa | Antes: "Cadastros enviados ao FDV". Depois: "Cadastros enviados ao Macuxi FDV" (o cartão de cima já diz "Conexão com o Macuxi FDV") | engenheiro-apps |

Fora do escopo da marca, só registrado: em `config-empresa-aba-integracao-390.png` a tabela aparece rolada até a coluna "Ações" e o nome do cadastro da linha fica fora da tela; em `bko-core-usuarios-390.png` e `config-empresa-aba-dados-390.png` a primeira coluna também aparece cortada pela rolagem. Não fere a marca; o leiaute da tabela em 390 é do designer-ux.

## 4. Veredito
- **Geral: aprovado com ressalva.** Rótulo "Ações" inteiro nas três telas, no máximo uma ação principal à vista, perigo por último depois do traço em `erroTexto` #A8261B, menu inteiro e por cima do quadro, borda `bordaTabela`, botão `botaoSecundario`, nenhuma cor nova, alvos de 44 px ou mais em 390.
- R-01 é texto de cartão, não do componente; entra no próximo lote do engenheiro-apps, com reteste no print.

## 5. Pedido ao dono
Cópia ao `gerente-projetos`.

**Para engenheiro-apps — R-01 (baixa)**
| Contexto | O que preciso | Pronto quando |
|---|---|---|
| Revisão de marca dos prints da T-0099 (`docs/marca/revisao-T-0099-prints.md`) | Trocar o título "Cadastros enviados ao FDV" por "Cadastros enviados ao Macuxi FDV" em `aba-integracao.tsx:163` e `components/integracao-fdv/vista.tsx:17`, com os testes que conferem o texto | Print da aba Integração refeito e revalidado pelo design-de-marca |
