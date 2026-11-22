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
| `textoVazio?`, `legenda?` | `string` | vazio: o problema e a ação (MC-0016). A legenda é um `<caption>` em peso 600 |

## FaixaPendencias
`itens: Pendencia[]`, com `Pendencia = { nivel: 'bloqueante' \| 'aceitavel'; codigoRn: string; texto: string }`. Bloqueante primeiro, fundo/texto de erro, `role="alert"`; aceitável em aviso, `role="status"`. Lista vazia não renderiza. O código da regra (`codigoRn`) vai só para o atributo `data-regra` (para teste e suporte); não aparece na tela (MC-0006).

## DialogoMotivo
`titulo`, `motivos?: { codigo, rotulo }[]` (se houver, escolher um é obrigatório), `textoObrigatorio?` (padrão opcional), `rotuloTexto?`, `rotuloConfirmar?`, `rotuloFechar?` (texto do botão que chama `aoCancelar`; padrão "Cancelar", ex.: "Manter a nota"), `destrutivo?` (só sinal: `data-destrutivo="true"` no botão de confirmar; nenhuma cor muda, o vermelho fica para a próxima versão), `aviso?: string | null` (texto fixo do módulo, ex.: `avisoDoMotivo(origem, codigo)`; sem aviso nada aparece e não há `aria-describedby`), `validar?(r) => string | null` (regra do módulo, roda depois da checagem básica de escolha e texto), `aoConfirmar(r: { motivo?, texto })`, `aoCancelar()`. Renderize só quando aberto. `role="dialog"`, `aria-modal`, foco preso, Esc e clique no fundo cancelam, foco volta ao elemento anterior. O erro tem `role="alert"` e o campo de texto aponta para ele (`aria-invalid`, `aria-describedby`).

## FormularioItens<T extends ItemLinha>
`itens: T[]` (mínimo `{ chave, produtoId, quantidade, precoUnitarioCentavos, descontoCentavos }`; o módulo pode estender), `aoMudar(itens)`, `novoItem(chave) => T` (linha vazia no formato do módulo), `renderSeletorProduto({ valor, aoEscolher, rotulo }) => ReactNode` (injetado), `formatarCentavos(c) => string`, `calcularTotal(item) => centavos` (**obrigatória**: a função do domínio do pedido; a API revalida), `desabilitado?`, `legenda?` (`<caption>` da tabela, ex.: "Itens do pedido"), `erros?: Record<chave, string | ErrosItem>`.
Erros: `ErrosItem = { produtoId?, quantidade?, precoUnitarioCentavos?, descontoCentavos? }`. Cada mensagem aparece abaixo do seu campo (`role="alert"`, `aria-describedby`, `aria-invalid`, borda de erro). A string simples continua valendo e aparece abaixo do seletor de produto. O seletor é injetado: ele recebe `idErro?` (id da mensagem do produto) para ligar ao seu `aria-describedby`. O texto inválido digitado tem prioridade sobre o erro de fora.
Colunas: Qtd. 88 px e Preço unit., Desconto e Total 120 px; "Produto" fica com o resto, para não cortar a descrição.
Campos: quantidade em texto local (aceita "1,5", até 4 casas); preço e desconto digitados em reais ("1.234,56"), convertidos por string a centavos inteiros, sem ponto flutuante; texto inválido marca `aria-invalid` e não publica valor.

## Tipos
`packages/ui/src/index.ts` exporta só componentes e tipos (helpers como `ordenarLinhas`, `exigeEscolha` e as conversões de `entradas.ts` ficam nos arquivos, para teste). `react` e `react-dom` são peerDependencies. Contrato estável: mudança de prop obrigatória avisa o `engenheiro-apps` por recado.

## Ajustes de marca (T-0015, MC-0006 a MC-0017)
Valores em `packages/ui/src/estilos.ts` e `tokens.ts`; aqui só o que vale para quem usa.
- **Desabilitado (MC-0014):** `renderSeletorProduto` recebe `desabilitado`; o seletor injetado deve respeitá-lo.
- **Campo numérico inválido (MC-0015):** mensagem abaixo do campo (`role="alert"`, ligada por `aria-describedby`), com o problema e a ação.
- **Foco visível (MC-0011):** regra global no `globals.css` (bloco abaixo); `botoes.css` traz a mesma regra para `.mx-botao*`, gerada de `focoVisivel`. Para o `engenheiro-apps`, o `globals.css` deve ter:
  ```css
  :focus-visible { outline: 2px solid var(--mx-cor-azul-noite); outline-offset: 2px; }
  ```
  Sem `outline: none` em outro lugar. Em fundo escuro (menu grafite) o shell usa `--mx-cor-branco` no mesmo seletor.
- **Densidade e canto (ressalvas do `design-de-marca` no #242, T-0021):** Campos em 13 px (tabela densa), botões em 15 px (MC-0008); canto de 6 px nos dois (`campoBase`).
- **Erro do `DialogoMotivo` (MC-0015):** o erro de motivo fica logo abaixo dos rádios (o `fieldset` aponta para ele por `aria-describedby`); o de texto, logo abaixo do campo (`aria-invalid`, `aria-describedby`, borda `erroTexto`). O erro do `validar` do módulo vai para o campo de texto.
- **Dinheiro digitado (RD-0723):** o `FormularioItens` mostra "1.234,56" (formato do sdk, com milhar, igual ao do shell); aceita também "1234,5" e "R$ 12,50" ao colar.

## Botões (MC-0008), bordaCampo e nowrap
- Dois botões, um tamanho: `botaoPrincipal(d?)` e `botaoSecundario(d?)`, de `estilos.ts`; diferem só em cor e peso. Um principal por tela.
- **Para o shell:** `import '@macuxierp/ui/botoes.css'` e use `.mx-botao` (principal) e `.mx-botao-secundario`; `:disabled` já vem esmaecido. O arquivo é gerado de `estilos.ts` (`gerarCssBotoes`); não edite à mão.
- **bordaCampo × bordaCinza:** `bordaCampo` (`#7A8593`, decisão #232) é a borda de campo, caixa de texto e botão secundário (contraste de componente). `bordaCinza` fica para linha forte, mapa e PDF; a borda de tabela e cartão é `bordaTabela`.
- **nowrap:** células `td` de `numero` e `dinheiro` (e o total do item) usam `celulaNumerica`, sem quebra de linha. O `th` continua só alinhado à direita.

## S-01: assinatura e favicon (docs/marca/assinatura-erp.md)
- **Topo azul-noite:** `<AssinaturaErp altura={24} />` (de `@macuxierp/ui`); a altura fica entre 20 e 32 px; `alt="Macuxi ERP"`.
- **Favicon:** `import { faviconDataUri } from '@macuxierp/ui/marca'` e, no layout do Next: `export const metadata = { icons: { icon: faviconDataUri } }`. O mesmo subpath tem `faviconSvg`, `paraDataUri`, `assinaturaANegativoAzulNoite` e `simboloNegativo`, cópia fiel dos ativos oficiais (o teste confere o SHA-256 dos ativos oficiais).
