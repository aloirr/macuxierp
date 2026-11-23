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
Sem rótulo de severidade visível (T-0056): o texto diz o problema e a ação; o leitor de tela ouve "Erro:" ou "Aviso:". 'bloqueante' só para falha que o usuário resolve na tela.

## DialogoMotivo
`titulo`, `motivos?: { codigo, rotulo }[]` (se houver, escolher um é obrigatório), `textoObrigatorio?` (padrão opcional), `rotuloTexto?`, `rotuloConfirmar?`, `rotuloFechar?` (texto do botão que chama `aoCancelar`; padrão "Cancelar", ex.: "Manter a nota"), `destrutivo?` (só sinal: `data-destrutivo="true"` no botão de confirmar; nenhuma cor muda, o vermelho fica para a próxima versão), `aviso?: string | null` (texto fixo do módulo, ex.: `avisoDoMotivo(origem, codigo)`; sem aviso nada aparece e não há `aria-describedby`), `validar?(r) => string | null` (regra do módulo, roda depois da checagem básica de escolha e texto), `aoConfirmar(r: { motivo?, texto })`, `aoCancelar()`. Renderize só quando aberto. `role="dialog"`, `aria-modal`, foco preso, Esc e clique no fundo cancelam, foco volta ao elemento anterior. Erro de campo conforme MC-0015 (abaixo).

## FormularioItens<T extends ItemLinha>
`itens: T[]` (mínimo `{ chave, produtoId, quantidade, precoUnitarioCentavos, descontoCentavos }`; o módulo pode estender), `aoMudar(itens)`, `novoItem(chave) => T` (linha vazia no formato do módulo), `renderSeletorProduto({ valor, aoEscolher, rotulo }) => ReactNode` (injetado), `formatarCentavos(c) => string`, `calcularTotal(item) => centavos` (**obrigatória**: a função do domínio do pedido; a API revalida), `desabilitado?`, `legenda?` (`<caption>` da tabela, ex.: "Itens do pedido"), `erros?: Record<chave, string | ErrosItem>`.
Erros: `ErrosItem = { produtoId?, quantidade?, precoUnitarioCentavos?, descontoCentavos? }`. Erro de campo conforme MC-0015 (abaixo). A string simples continua valendo e aparece abaixo do seletor de produto. O seletor é injetado: ele recebe `idErro?` (id da mensagem do produto) para ligar ao seu `aria-describedby`. O texto inválido digitado tem prioridade sobre o erro de fora.
`temErroExterno?`: o chamador soma erros de fora dos itens (cabeçalho) ao aviso único; não ponha outra RegiaoErros na tela.
Colunas: Qtd. 88 px e Preço unit., Desconto e Total 120 px; "Produto" fica com o resto, para não cortar a descrição.
Campos: quantidade em texto local (aceita "1,5", até 4 casas); preço e desconto digitados em reais ("1.234,56"), convertidos por string a centavos inteiros, sem ponto flutuante; texto inválido marca `aria-invalid` e não publica valor.

## Tipos
`packages/ui/src/index.ts` exporta só componentes e tipos (helpers como `ordenarLinhas`, `exigeEscolha` e as conversões de `entradas.ts` ficam nos arquivos, para teste). `react` e `react-dom` são peerDependencies. Contrato estável: mudança de prop obrigatória avisa o `engenheiro-apps` por recado.

## Ajustes de marca (T-0015, MC-0006 a MC-0017)
Valores em `packages/ui/src/estilos.ts` e `tokens.ts`; aqui só o que vale para quem usa.
- **Desabilitado (MC-0014):** `renderSeletorProduto` recebe `desabilitado`; o seletor injetado deve respeitá-lo.
- **Erro de campo (MC-0015), padrão do pacote (FormularioItens, DialogoMotivo); o shell passa a usar o mesmo (`RegiaoErros` e span no lugar de `role="alert"`) — uma região única por tela:** a mensagem é um `span` (estilo `mensagemErro`, já `display: block`, sem `role`) logo abaixo do campo, ligada por `aria-describedby` (id de `useId`), com `aria-invalid` e borda de erro no campo; o texto traz o problema e a ação. Cada tela tem uma região única e sempre presente, o componente `<RegiaoErros temErro={...} />` (`<p role="status" aria-live="polite">` oculta; o shell o usa no lugar da frase escrita à mão), com o aviso quando há erro e vazia quando não há. Nenhum `role="alert"` em erro de campo. No `FormularioItens` a região também conta o texto inválido digitado (`CampoNumerico` avisa o formulário por `aoInvalido`); no `DialogoMotivo`, o erro da confirmação.
- **Foco visível (MC-0011):** regra global no `globals.css` (bloco abaixo); `botoes.css` traz a mesma regra para `.mx-botao*`, gerada de `focoVisivel`. Para o `engenheiro-apps`, o `globals.css` deve ter:
  ```css
  :focus-visible { outline: 2px solid var(--mx-cor-azul-noite); outline-offset: 2px; }
  ```
  Sem `outline: none` em outro lugar.
- **Densidade e canto (ressalvas do `design-de-marca` no #242, T-0021):** Campos do pacote em 13 px (tabela densa), botões em 15 px (MC-0008); canto de 6 px nos dois (`campoBase` e `botao*`).
- **Foco e hover dos botões internos:** Os botões internos dos componentes (DialogoMotivo, FormularioItens) e os rádios usam estilo inline; o foco visível vem da regra global `:focus-visible` do shell (globals.css), e o hover só existe nas classes do `botoes.css`.
- **Foco em fundo escuro:** o contêiner escuro (azul-noite, grafite) leva `.mx-fundo-escuro` e o foco sai branco (`focoVisivelEscuro`, gerado em `botoes.css`); só no contêiner escuro imediato: superfície clara dentro dele (diálogo, cartão) não fica sob a classe.
- **Legenda:** a `<caption>` da tabela fica em 15 px, como os rótulos do formulário (`tabela.legenda`).
- **Erro do `DialogoMotivo` (MC-0015):** o erro de motivo fica logo abaixo dos rádios (o `fieldset` aponta para ele por `aria-describedby`); o de texto, logo abaixo do campo (`aria-invalid`, `aria-describedby`, borda `erroTexto`). O erro do `validar` do módulo vai para o campo de texto.
- **Dinheiro digitado (RD-0723):** o `FormularioItens` mostra "1.234,56" (formato do sdk, com milhar, igual ao do shell); aceita também "1234,5" e "R$ 12,50" ao colar.

## Botões (MC-0008), bordaCampo e nowrap
- Dois botões, um tamanho: `botaoPrincipal(d?)` e `botaoSecundario(d?)`, de `estilos.ts`; diferem só em cor e peso. Um principal por tela.
- **Para o shell:** `import '@macuxierp/ui/botoes.css'` e use `.mx-botao` (principal) e `.mx-botao-secundario`; `:disabled` já vem esmaecido. O arquivo é gerado de `estilos.ts` (`gerarCssBotoes`); não edite à mão.
- **bordaCampo × bordaCinza:** `bordaCampo` (`#7A8593`, decisão #232) é a borda de campo, caixa de texto e botão secundário (contraste de componente). `bordaCinza` fica para linha forte, mapa e PDF; a borda de tabela e cartão é `bordaTabela`.
- **nowrap:** células `td` de `numero` e `dinheiro` (e o total do item) usam `celulaNumerica`, sem quebra de linha. O `th` continua só alinhado à direita.

## S-01: assinatura e favicon (docs/marca/assinatura-erp.md)
- **Subpath sem hook:** `@macuxierp/ui/marca` (`marca.tsx`) traz a assinatura, o favicon e o apple-touch-icon, para o Server Component do layout; o porquê está no cabeçalho de `marca.tsx`. O `index.ts` não exporta a marca (a re-exportação de compatibilidade saiu na v0.2.1); `AssinaturaErp`, favicon e apple-touch-icon vêm só desse subpath.
- **Topo azul-noite:** `<AssinaturaErp altura={24} />`; a altura fica entre 20 e 32 px; `alt="Macuxi ERP"`.
- **Variante C** (`<AssinaturaErp variante="C" />`): cabeçalho do cartão de login e seleção de filial.
- **Ícones:** `import { AssinaturaErp, faviconDataUri, appleTouchIconDataUri } from '@macuxierp/ui/marca'` e, no layout do Next: `export const metadata = { icons: { icon: faviconDataUri, apple: appleTouchIconDataUri } }`. PNG 180×180 do favicon (geração e SHA-256 em `marca.tsx`). O mesmo subpath tem `faviconSvg`, `paraDataUri`, `assinaturaANegativoAzulNoite` e `simboloNegativo`, cópia fiel dos ativos oficiais (o teste confere o SHA-256).
- **Hover dos botões (`botoes.css`):** principal vira fundo e borda grafite; secundário vira fundo névoa. Só cor da paleta, nunca `filter: brightness`; não vale para `:disabled`.
- **`'use client'`:** `TabelaDensa`, `DialogoMotivo` e `FormularioItens` usam hook e levam a diretiva; `FaixaPendencias` fica sem. Um Server Component não pode passar função (como `celula`) à `TabelaDensa`: a página que a usa vira cliente. O `package.json` declara `sideEffects: ["*.css"]` para o tree-shaking.

## Ações na linha da lista
Proposta, à espera da decisão do PO (tira uma ação da lista de pedidos a faturar); o engenheiro-apps só aplica depois dela.
- Na linha, uma ação só: a principal ("Emitir nota").
- A ação parcial ("Emitir nota parcial") fica no detalhe do pedido, porque é a exceção e exige escolher itens.
- Sem menu na linha: o menu exige teclado e foco próprios, e a lista é densa.
- **Rádio `.mx-radio` e caixa `.mx-checkbox`:** o shell importa `@macuxierp/ui/botoes.css` e põe a classe no `input`; marcado em azul-noite (ponto ou visto branco); vêm de `radio*`/`checkbox*` em `estilos.ts`.

## Portal /config (T-0050)

**DialogoMotivo, `semTexto`**: sem campo de texto (ex.: redefinir senha, desligar módulo). Não renderiza textarea nem rótulo, ignora `textoObrigatorio` e `aoConfirmar` recebe `{ motivo, texto: '' }`. Com `motivos`, a escolha continua obrigatória; sem motivos vira confirmação simples (título, aviso opcional, botões). O `validar` segue rodando.

**TabelaDensa, carregar mais**: props `temMais`, `carregandoMais` e `aoCarregarMais`. Com `temMais` e `aoCarregarMais`, aparece o botão secundário "Carregar mais" abaixo da tabela ("Carregando…" e desabilitado durante a busca). Um `role="status"` só para leitor de tela diz "{n} registros carregados." Mantenha `aoCarregarMais` fixo e controle o botão só por `temMais` (a região viva desmonta sem ele).

**`acumularPagina(atuais, pagina, chave)`** (`@macuxierp/ui/paginacao`): soma sem duplicar pela chave, mantém a ordem e, em chave repetida, a versão nova substitui a antiga na mesma posição; não muta a entrada. Uso: com `proximo_cursor`, `setLinhas(acumularPagina(linhas, resp.itens, chave))` (a resposta vem de `paginaDe`, em `platform-sdk/listas.ts`) e `temMais = resp.proximo_cursor != null`; regra no JSDoc.

Paginação: "Próxima página" (com a página na URL) nas listas de negócio grandes; "Carregar mais" (TabelaDensa + acumularPagina) só nas listas curtas do portal /config. (RD-0974)

Tamanho do rótulo do menu: `--mx-tamanho-rotulo-menu` (o `--mx-tamanho-titulo-grupo` é alias e vai sair); não use em título de bloco.
