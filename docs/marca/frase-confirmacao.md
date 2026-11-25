# Frase de confirmação digitada — fonte mono

**REGRA derivada do manual (25/11/2026, T-0101), não é decisão nova do Alexandre.** Pedido do gerente: parecer sobre exibir em fonte monoespaçada a frase que o usuário digita para confirmar ação destrutiva. O manual do FDV (§5.1) já tem a família "Código" (`fontes.codigo`); aqui só se define o uso dela nesta peça. Só tokens existentes, sem cor nova. O Alexandre pode vetar.

Vale para **toda frase de confirmação digitada**: hoje `FRASE_ZERAR_DADOS` ("autorizo zerar os dados", no Zerar por cadastro e no Zerar pedidos) e `FRASE_SUBSTITUIR_TUDO` ("autorizo substituir tudo", no Substituir tudo), as duas em `packages/platform-sdk/src/portal-cargas.ts`. Frase nova entra no mesmo componente, sem regra nova.

## 1. Decisão

**Usa mono.** A frase é um texto exato para copiar letra por letra. A fonte de código separa a frase do resto da instrução e mostra os espaços com clareza. É o mesmo uso que o manual já dá à família "Código" (código da empresa, senha provisória). Não é decoração.

## 2. Como fica

| Item | Regra | Token |
|---|---|---|
| Família | pilha de código do manual, **sem pilha solta** | `--mx-fonte-codigo` (`fontes.codigo`, já existe; nenhum token novo) |
| Tamanho | o do texto do diálogo, 15 px | `--mx-tamanho-base` |
| Peso | 600, o mesmo do rótulo do campo (a frase se destaca pela fonte e pelo fundo, não pelo negrito 700) | `--mx-peso-rotulo-campo` |
| Cor do texto | grafite #16202A. **Não** usar o vermelho: o `erroTexto` fica no botão destrutivo e no aviso fixo (decisão de 22/11, opção B); a frase não é erro | `--mx-cor-grafite` |
| Fundo | névoa #ECEEF1, como selo de código | `--mx-cor-nevoa` |
| Borda | 1 px #DFE2E6, decorativa | `--mx-cor-borda-tabela` |
| Canto e recuo | 4 px de canto; 1 px em cima e embaixo, 6 px nas laterais | — |
| Letra | sem `letter-spacing`, sem `text-transform`, sem itálico | — |
| Campo de digitar | continua na fonte de texto, igual a todo campo do BKO | `--mx-fonte-texto` |

O manual não tem um estilo próprio de `<kbd>`/`<code>`. O que existe no ERP é o `.segredo` (bloco grande de senha) e o `.codigo` (só troca a família). A frase usa o desenho acima, de selo em linha, e não o bloco do `.segredo`.

**Contraste (WCAG, calculado):** grafite #16202A sobre névoa #ECEEF1 **14,18:1**; sobre o branco do diálogo, 16,48:1. Passa 4,5:1 e 7:1. A borda #DFE2E6 sobre branco dá 1,30:1, o que vale porque é **só decorativa**: a frase não é controle (WCAG 1.4.11 não se aplica) e o fundo névoa já separa o selo.

## 3. 390 px

- A frase **quebra nos espaços**, nunca no meio da palavra e nunca é cortada: sem `white-space: nowrap`, sem `overflow: hidden`, sem reticências.
- O selo se repete em cada linha quebrada (`box-decoration-break: clone`, com o prefixo `-webkit-`), para o recuo e a borda não sumirem na quebra.
- Proteção para palavra maior que a linha: `overflow-wrap: break-word` (não `anywhere`, que parte palavra comum).
- Nada de rolagem horizontal no diálogo a 390 px.

## 4. Leitor de tela

- A frase fica no DOM como **texto corrido**, igual à constante: o leitor lê "autorizo zerar os dados" como palavras, **sem soletrar**.
- Proibido: uma letra por `<span>`, espaço trocado por `·` ou `␣`, `aria-label` com outra grafia, `text-transform` ou `letter-spacing` que levem o leitor a soletrar.
- O ponto final fica **fora** do selo ("digite **autorizo zerar os dados**."), porque não faz parte do que se digita; o `fraseConfere` já aceita com ou sem ponto.
- O rótulo continua ligado ao campo (`<label htmlFor>`), como hoje.

## 5. Um componente só

O desenho mora no `FraseConfirmacao` (`apps/web/src/components/frase-confirmacao.tsx`), usado pelo `ConfirmarComFrase`, com **uma classe própria** (sugestão: `.frase-confirmar`) em `globals.css`. Nenhuma tela estiliza a frase por conta própria. Se o componente subir para `packages/ui`, a regra vai junto e o dono passa a ser o designer-ux.

## 6. Situação hoje e ajustes

Hoje: `<strong className="codigo">{frase}</strong>` (`frase-confirmacao.tsx:12`), com o `.codigo` de `globals.css:125`, que só troca a família. Família certa; faltam o peso, o fundo, a borda e a quebra, e a classe é a mesma do código da empresa.

| ID | Onde | Ajuste | Dono |
|---|---|---|---|
| MC-0101-1 | `apps/web/src/components/frase-confirmacao.tsx:12` | `className="codigo"` → `className="frase-confirmar"` (pode manter o `<strong>`; ponto final fora do selo, como já está) | engenheiro-apps |
| MC-0101-2 | `apps/web/src/app/globals.css` (perto da linha 125) | nova regra: `.frase-confirmar { font-family: var(--mx-fonte-codigo); font-size: var(--mx-tamanho-base); font-weight: var(--mx-peso-rotulo-campo); color: var(--mx-cor-grafite); background: var(--mx-cor-nevoa); border: 1px solid var(--mx-cor-borda-tabela); border-radius: 4px; padding: 1px 6px; overflow-wrap: break-word; -webkit-box-decoration-break: clone; box-decoration-break: clone; }` | engenheiro-apps |
| RD-2205 | `apps/web/src/app/globals.css:280` (`.segredo`) | pilha solta `ui-monospace, monospace` → `var(--mx-fonte-codigo)`: a família de código tem um token e não ganha segunda grafia | engenheiro-apps |

Nenhum pedido ao designer-ux: o token `fontes.codigo` já existe e nenhuma cor nova entra. Reteste da marca nos prints a 1280 e a 390 px do Zerar por cadastro, do Zerar pedidos e do Substituir tudo.
