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
| `rotuloLinha?` | `(l) => string` | rótulo acessível da linha clicável (ex.: "Abrir pedido 123") |
| `ordem?` / `aoOrdenar?` | `OrdemTabela \| null` / `(o) => void` | controlada (URL) ou, sem `ordem`, interna |
| `textoVazio?`, `legenda?` | `string` | vazio: o problema e a ação |

## FaixaPendencias
`itens: Pendencia[]`, com `Pendencia = { nivel: 'bloqueante' \| 'aceitavel'; codigoRn: string; texto: string }`. Bloqueante primeiro, fundo/texto de erro, `role="alert"`; aceitável em aviso, `role="status"`. Lista vazia não renderiza.

## DialogoMotivo
`titulo`, `motivos?: { codigo, rotulo }[]` (se houver, escolher um é obrigatório), `textoObrigatorio?` (padrão opcional), `rotuloTexto?`, `rotuloConfirmar?`, `aviso?: string | null` (texto fixo do módulo, ex.: `avisoDoMotivo(origem, codigo)`; sem aviso nada aparece e não há `aria-describedby`), `validar?(r) => string | null` (regra do módulo, roda depois da checagem básica de escolha e texto), `aoConfirmar(r: { motivo?, texto })`, `aoCancelar()`. Renderize só quando aberto. `role="dialog"`, `aria-modal`, foco preso, Esc e clique no fundo cancelam, foco volta ao elemento anterior. O erro tem `role="alert"` e o campo de texto aponta para ele (`aria-invalid`, `aria-describedby`).

## FormularioItens<T extends ItemLinha>
`itens: T[]` (mínimo `{ chave, produtoId, quantidade, precoUnitarioCentavos, descontoCentavos }`; o módulo pode estender), `aoMudar(itens)`, `novoItem(chave) => T` (linha vazia no formato do módulo), `renderSeletorProduto({ valor, aoEscolher, rotulo }) => ReactNode` (injetado), `formatarCentavos(c) => string`, `calcularTotal(item) => centavos` (**obrigatória**: a função do domínio do pedido; a API revalida), `desabilitado?`, `erros?: Record<chave, string>`.
Campos: quantidade em texto local (aceita "1,5", até 4 casas); preço e desconto digitados em reais ("1.234,56"), convertidos por string a centavos inteiros, sem ponto flutuante; texto inválido marca `aria-invalid` e não publica valor.

## Tipos
`packages/ui/src/index.ts` exporta só componentes e tipos (helpers como `ordenarLinhas`, `exigeEscolha` e as conversões de `entradas.ts` ficam nos arquivos, para teste). `react` e `react-dom` são peerDependencies. Contrato estável: mudança de prop obrigatória avisa o `engenheiro-apps` por recado.
