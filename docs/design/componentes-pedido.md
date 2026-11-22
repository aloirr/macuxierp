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
| `textoVazio?`, `legenda?` | `string` | vazio: o problema e a ação; padrão "Nenhum registro. Ajuste os filtros ou crie o primeiro." (MC-0016) |

## FaixaPendencias
`itens: Pendencia[]`, com `Pendencia = { nivel: 'bloqueante' \| 'aceitavel'; codigoRn: string; texto: string }`. Bloqueante primeiro, fundo/texto de erro, `role="alert"`; aceitável em aviso, `role="status"`. Lista vazia não renderiza. O código da regra (`codigoRn`) vai só para o atributo `data-regra` (para teste e suporte); não aparece na tela (MC-0006). Aviso em 13 px.

## DialogoMotivo
`titulo`, `motivos?: { codigo, rotulo }[]` (se houver, escolher um é obrigatório), `textoObrigatorio?` (padrão opcional), `rotuloTexto?`, `rotuloConfirmar?`, `aviso?: string | null` (texto fixo do módulo, ex.: `avisoDoMotivo(origem, codigo)`; sem aviso nada aparece e não há `aria-describedby`), `validar?(r) => string | null` (regra do módulo, roda depois da checagem básica de escolha e texto), `aoConfirmar(r: { motivo?, texto })`, `aoCancelar()`. Renderize só quando aberto. `role="dialog"`, `aria-modal`, foco preso, Esc e clique no fundo cancelam, foco volta ao elemento anterior. O erro tem `role="alert"` e o campo de texto aponta para ele (`aria-invalid`, `aria-describedby`).

## FormularioItens<T extends ItemLinha>
`itens: T[]` (mínimo `{ chave, produtoId, quantidade, precoUnitarioCentavos, descontoCentavos }`; o módulo pode estender), `aoMudar(itens)`, `novoItem(chave) => T` (linha vazia no formato do módulo), `renderSeletorProduto({ valor, aoEscolher, rotulo }) => ReactNode` (injetado), `formatarCentavos(c) => string`, `calcularTotal(item) => centavos` (**obrigatória**: a função do domínio do pedido; a API revalida), `desabilitado?`, `erros?: Record<chave, string>`.
Campos: quantidade em texto local (aceita "1,5", até 4 casas); preço e desconto digitados em reais ("1.234,56"), convertidos por string a centavos inteiros, sem ponto flutuante; texto inválido marca `aria-invalid` e não publica valor.

## Tipos
`packages/ui/src/index.ts` exporta só componentes e tipos (helpers como `ordenarLinhas`, `exigeEscolha` e as conversões de `entradas.ts` ficam nos arquivos, para teste). `react` e `react-dom` são peerDependencies. Contrato estável: mudança de prop obrigatória avisa o `engenheiro-apps` por recado.

## Ajustes de marca (T-0015, MC-0006 a MC-0017)
- **Tipografia (MC-0007 a 0009):** `texto(tamanho, peso)` aceita todos os papéis dos tokens (`titulo-dialogo`, `rotulo-campo`, `botao-principal`, `rotulo-pequeno` etc.). Botão principal 600; botão secundário e "Remover" 500; rótulos de campo 600; título do diálogo 20 px / 700; aviso 13 px.
- **Remover (MC-0010):** grafite, sem vermelho; vermelho fica só para erro de validação.
- **Tabelas (MC-0013):** `TabelaDensa` e a tabela do `FormularioItens` usam o mesmo `tabela` de `estilos.ts` (cabeçalho, célula, vazio).
- **Datas (MC-0012):** colunas `tipo: 'data'` ficam à esquerda com `tabular-nums`.
- **Desabilitado (MC-0014):** `desabilitadoEstilo`: opacidade 0,55 e cursor `not-allowed`; campos numéricos ganham fundo névoa. O `renderSeletorProduto` recebe `desabilitado`; o seletor injetado deve respeitá-lo.
- **Campo numérico inválido (MC-0015):** mensagem abaixo do campo (`role="alert"`, ligada por `aria-describedby`), com o problema e a ação.
- **Rádio e ordenar (MC-0011):** rádio com `accent-color` azulNoite; o botão de ordenar do cabeçalho não usa `all: unset`, para manter o foco nativo.
- **Foco visível único (MC-0011), para o `engenheiro-apps`:** os componentes não desenham foco. A regra global em `apps/web/.../globals.css` deve ser:
  ```css
  :focus-visible { outline: 2px solid var(--mx-cor-azul-noite); outline-offset: 2px; }
  ```
  Sem `outline: none` em outro lugar. Em fundo escuro (menu grafite) o shell usa `--mx-cor-branco` no mesmo seletor.
