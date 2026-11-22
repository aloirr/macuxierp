# Componentes do pedido no BKO (T-0015)

Pacote `@macuxierp/ui`. Todos são apresentacionais: sem dados próprios, sem fetch. Cores só por `var(--mx-cor-*)` dos tokens da marca (T-0028); o shell importa `@macuxierp/ui/tokens.css` uma vez. Dinheiro sempre em **centavos**; quem formata é o chamador. Os componentes de formulário e diálogo são de cliente (`'use client'` na página que os usa).

Espaçamentos: a marca ainda não tem tokens de espaço; os componentes usam múltiplos de 4 px (`estilos.ts`). Pedido ao `design-de-marca`: oficializar a escala 4/8/12/16/24.

## TabelaDensa<T>
| Prop | Tipo | Notas |
|---|---|---|
| `colunas` | `ColunaTabela<T>[]` | `{ id, titulo, tipo?, celula?, valorOrdem?, largura? }`. `tipo` `numero`/`dinheiro` alinha à direita. `valorOrdem` habilita ordenar (centavos como número). |
| `linhas` | `T[]` | |
| `chaveLinha` | `(l) => string` | chave única |
| `aoClicarLinha?` | `(l) => void` | linha clicável por mouse, Enter e Espaço |
| `ordem?` / `aoOrdenar?` | `OrdemTabela \| null` / `(o) => void` | controlada (URL) ou, sem `ordem`, interna |
| `textoVazio?`, `legenda?` | `string` | vazio: o problema e a ação |

## FaixaPendencias
`itens: Pendencia[]`, com `Pendencia = { nivel: 'bloqueante' \| 'aceitavel'; codigoRn: string; texto: string }`. Bloqueante primeiro, fundo/texto de erro, `role="alert"`; aceitável em aviso, `role="status"`. Lista vazia não renderiza.

## DialogoMotivo
`titulo`, `motivos?: { codigo, rotulo }[]` (se houver, escolher um é obrigatório), `textoObrigatorio?` (padrão opcional), `rotuloTexto?`, `rotuloConfirmar?`, `aoConfirmar(r: { motivo?, texto })`, `aoCancelar()`. Renderize só quando aberto. `role="dialog"`, `aria-modal`, foco preso, Esc e clique no fundo cancelam, foco volta ao elemento anterior. Mostra `AVISO_LGPD` ("Não escreva dado pessoal"). Validação: `validarMotivo`.

## FormularioItens
`itens: ItemLinha[]` (`{ chave, produtoId, quantidade, precoUnitarioCentavos, descontoCentavos }`), `aoMudar(itens)`, `renderSeletorProduto({ valor, aoEscolher, rotulo }) => ReactNode` (injetado), `formatarCentavos(c) => string`, `calcularTotal?(item) => centavos` (use a função do domínio do pedido; padrão `totalItemCentavos` = round(qtd × preço) − desconto, mín. 0, só exibição, a API revalida), `desabilitado?`, `erros?: Record<chave, string>`. Adicionar/remover linha estão incluídos; `novoItem(chave)` cria linha vazia.

## Tipos
Exportados em `packages/ui/src/index.ts`. Contrato estável: mudança de prop obrigatória avisa o `engenheiro-apps` por recado.
