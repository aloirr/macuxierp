# Revisão de marca e UX — ficha da Receita na aba Empresa do /config (T-0101)

> Autor: design-de-marca · 25/11/2026, 05h09 (Manaus) · Tarefa T-0101.
> PR #646 (engenheiro-apps): ficha da Receita na aba Empresa do /config. Parecer conjunto da marca e da UX.
> **Veredito geral: APROVADO.** Os 🟡 da 1ª revisão foram resolvidos no próprio #646. Ficam três pedidos para a v0.3.15.

## 1. Revisões
| Revisão | Head | Base da leitura | Veredito |
|---|---|---|---|
| 1ª | `c014a935` | só o código | Aprovado com 🟡 |
| 2ª | `9b5844e5` | diff `c014a935..9b5844e5` | Aprovado |

## 2. Aprovado
- **RD-2033:** a ficha não repete razão social, CNPJ nem cidade/UF do bloco Dados.
- IE com o rótulo "Inscrição estadual".
- Nenhuma cor nova; o botão secundário é o aprovado (`botaoSecundario`).
- Sem "⋯".
- Os `aria` do mostrar/ocultar do e-mail.

## 3. 🟡 resolvidos no #646
| Ponto | Situação |
|---|---|
| CSS do `h3` e da `.lista-cnae` | Só com tokens ✅ |
| `.erro-campo` no `revelar-mascarado` | Aplicado ✅ |
| Estado vazio | Com a ação ✅ |
| Botão Atualizar | No `.cabecalho-ficha` ✅ |
| Alvo de 44 px em 390 | Medido em 40,5 px num print equivalente. O gerente mandou o ajuste ao engenheiro-apps às 05h20; o merge sai sem nova revisão. |

## 4. Pedidos para a v0.3.15
O gerente registra as tarefas no quadro.

| # | Pedido | Dono | Situação |
|---|---|---|---|
| 1 | CNAE com a descrição: "4781-4/00 · Comércio varejista…". O contrato plano `FichaReceitaPlanaMascarada` hoje entrega só o código. | modulo-core e engenheiro-apps | A UX considerou bloqueante; a marca aceitou na v0.3.14. O gerente levou ao PO e a decisão foi a v0.3.15. |
| 2 | Um verbo só para mostrar ou ocultar valor mascarado. Hoje: "Revelar" no e-mail e "Mostrar/Ocultar" na senha. | Decisão do PO | Recomendação da marca e da UX: **"Mostrar"**. |
| 3 | `RevelarMascarado` vai para `packages/ui`, com estilo próprio em `estilos.ts`, como o `CampoSenha`, e o verbo como constante única. | designer-ux; engenheiro-apps troca o import | Depois do pedido 2. |

## 5. Observação
O `.erro` de bloco em `ficha-receita.tsx:59`, na falha da Receita, fica como está: é intencional.
