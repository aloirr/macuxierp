# Telas horizontais e destaque nos cabeçalhos (v0.3.24)

Regra de UX do designer-ux para o **BKO inteiro e o `/config` inteiro**. Origem: pedido do Alexandre em 27/11/2026 às 11h03 (Manaus), R-20261127-110345-alexandre:

> "Acabe com esses modelos de telas verticais. vamos usar mais os espaços horizontais. coloque essa regra no corretor de marca, e ux design. precisamos tambem de destaque no cabeçalho para diferencia do texto"

Tokens em `packages/ui/src/tokens.ts` (variáveis `--mx-*` em `tokens.css`). A cor de destaque do rótulo (`rotuloDestaque` = azul-noite) aguarda a validação do `design-de-marca`, que também leva a regra ao manual da marca. A parte de `.claude/agents` (designer-ux, design-de-marca e corretor-redundancias) é governança e fica fora deste doc.

## 1. Regra de layout

1. **Largura toda da janela.** O conteúdo não tem `max-width` nem `margin: 0 auto`. Sai a coluna estreita centralizada com sobra vazia à direita:
   - BKO: `.conteudo { max-width: 1100px }` → sem `max-width`;
   - `/config`: `.casca-plataforma .conteudo { max-width: 1280px; margin: 0 auto }` → sem `max-width` e sem centralizar.
   - Exceções: o cartão de login (`.cartao-central`, 420 px), os diálogos e o parágrafo corrido (texto de ajuda e aviso, até `75ch` no próprio `p`, nunca no contêiner).
2. **No computador, blocos lado a lado:** 2 a 4 colunas de cartões; a tabela ocupa a largura cheia da grade.
3. **Um embaixo do outro só no celular** (abaixo de 768 px).
4. **Nada de pilha vertical de cartões quando cabem lado a lado.** Dois ou mais cartões seguidos na mesma tela entram na grade de blocos.
5. Campo de formulário curto (CNPJ, CEP, UF, telefone) não ocupa a linha inteira: no computador, 2 a 4 campos por linha, na mesma grade.

### Pontos de quebra e colunas

| Quebra | Largura da janela | Colunas de cartões | Tabela | Margem do conteúdo |
|---|---|---|---|---|
| `celular` | 390 (até 767) | 1 | largura cheia, colunas de apoio escondidas; ações sempre à vista | 16 px |
| `tablet` | 768 a 1279 | 2 | largura cheia | 24 px |
| `notebook` | 1280 a 1439 | 3 | largura cheia | 24 px 32 px |
| `monitor` | 1440 ou mais | 4 | largura cheia | 24 px 32 px |

Vão entre cartões: 16 px (`espaco.lg`). Cartão nunca abaixo de `--mx-grade-cartao-minimo` (280 px): se não couber, a grade cai para menos colunas. Media query não lê variável CSS; as telas escrevem estes números (390, 768, 1280, 1440) em `@media (min-width: …)`, e esta tabela é a fonte única deles. As quebras antigas do shell (480, 800, 900 e 1100 px) migram para estas quando a tela for tocada.

### Grade de blocos (receita para o shell)

```css
.grade-blocos {
  display: grid;
  gap: 16px;                                       /* espaco.lg */
  grid-template-columns: minmax(0, 1fr);            /* celular: 1 coluna */
  align-items: start;
}
@media (min-width: 768px)  { .grade-blocos { grid-template-columns: repeat(2, minmax(var(--mx-grade-cartao-minimo), 1fr)); } }
@media (min-width: 1280px) { .grade-blocos { grid-template-columns: repeat(3, minmax(var(--mx-grade-cartao-minimo), 1fr)); } }
@media (min-width: 1440px) { .grade-blocos { grid-template-columns: repeat(4, minmax(var(--mx-grade-cartao-minimo), 1fr)); } }
.grade-blocos > .bloco-largo   { grid-column: span 2; }   /* cartão com muitos dados (a partir de 768) */
.grade-blocos > .bloco-inteiro { grid-column: 1 / -1; }   /* tabela e formulário longo: largura cheia */
@media (max-width: 767px) { .grade-blocos > .bloco-largo { grid-column: auto; } }
```

No BKO com menu lateral (208 px até 1100, 260 px acima), a área útil em 1280 é ~956 px (1280 − 260 − 64 de margem): 3 colunas de 280 px cabem; se o cartão pedir mais, use `bloco-largo`.

## 2. Regra de hierarquia

O rótulo e o cabeçalho ficam **visivelmente diferentes do valor**; o valor fica em texto normal; o título de bloco tem destaque claro. Só tokens do `packages/ui`.

| Papel | Tamanho | Peso | Cor | Forma |
|---|---|---|---|---|
| Título da tela (h1) | `--mx-tamanho-h1` (24) | `--mx-peso-titulo` (700) | `--mx-cor-azul-noite` | normal |
| **Título de bloco** (h2 do cartão) — reaproveitado | `--mx-tamanho-titulo-cartao` (20) | `--mx-peso-titulo` (700) | `--mx-cor-rotulo-destaque` | 12 px abaixo; linha `1px solid var(--mx-cor-borda-tabela)` embaixo, 8 px de respiro |
| **Rótulo de dado** (`dt`, rótulo de campo só leitura) — novo | `--mx-tamanho-rotulo-dado` (13) | `--mx-peso-rotulo-dado` (600) | `--mx-cor-rotulo-destaque` | caixa-alta, `letter-spacing: .04em` |
| **Valor** (`dd`) — reaproveitado | `--mx-tamanho-base` (15) | `--mx-peso-normal` (400) | `--mx-cor-grafite` | normal; números com `--mx-fonte-numeros` |
| Cabeçalho de tabela (`th`) — ajustado | `--mx-tamanho-pequeno` (13) | `--mx-peso-cabecalho-tabela` (600) | `--mx-cor-rotulo-destaque` | normal (sem caixa-alta, para não pesar a coluna) sobre `nevoa` |
| Rótulo de campo editável (`label`) | o tamanho atual do componente | `--mx-peso-rotulo-campo` (600) | `--mx-cor-rotulo-destaque` | normal |

- O `TabelaDensa` e o `FormularioItens` já saem com o `th` em azul-noite (`tabela.cabecalho` em `estilos.ts`).
- O rótulo **não** usa `textoApoio`/`textoSecundario` (cinza): cinza fica para texto de ajuda e data de consulta.
- O destaque nunca depende só da cor: o rótulo mantém tamanho, peso e caixa-alta diferentes do valor. O rótulo nunca é sublinhado; o link continua sublinhado, para o rótulo azul-noite não parecer clicável.
- O laranja do sol continua fora do texto sobre fundo claro (manual da marca).
- Contraste: azul-noite `#1E3350` sobre branco 12,77:1, sobre pérola 11,82:1 e sobre névoa (fundo do `th`) 10,99:1 (mínimo 4,5:1).

```css
.dados { display: grid; gap: 12px 24px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); margin: 0; }
.dados dt { font-size: var(--mx-tamanho-rotulo-dado); font-weight: var(--mx-peso-rotulo-dado); color: var(--mx-cor-rotulo-destaque); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 2px; }
.dados dd { font-size: var(--mx-tamanho-base); font-weight: var(--mx-peso-normal); color: var(--mx-cor-grafite); margin: 0; overflow-wrap: anywhere; min-width: 0; }
.bloco h2 { font-size: var(--mx-tamanho-titulo-cartao); font-weight: var(--mx-peso-titulo); color: var(--mx-cor-rotulo-destaque); margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--mx-cor-borda-tabela); }
```

## 3. Exemplos do `/config` (dado fictício)

### Aba Empresa — cabeçalho com os dados da empresa + Ficha da Receita (editável, T-0101)

Nome, slug, selo de situação e fuso ficam só no cabeçalho da tela (portal-config.md §4); nenhum cartão repete esses dados.

- **1440 / 1280:** grade de blocos. "Ficha da Receita" como `bloco-largo` (2 colunas), com os pares rótulo/valor em 3 a 4 colunas dentro do cartão; "Módulos", "1º administrador" e "Situação" ao lado, sem pilha. O botão "Salvar" da Ficha fica no rodapé do próprio cartão.
- **768:** 2 colunas; a Ficha em `bloco-inteiro`.
- **390:** 1 coluna, nesta ordem: Ficha, Módulos, 1º administrador, Situação.

```
1440 Distribuidora Exemplo · exemplo · [Ativa] · Manaus                         (cabeçalho)
     ┌ Ficha da Receita (bloco-largo) ──────────────────────┐ ┌ Módulos ──────┐ ┌ 1º administrador ┐
     │ CNPJ                RAZÃO SOCIAL       SITUAÇÃO       │ │ ☑ Cadastros   │ │ Ativo            │
     │ 00.000.000/0001-91  Exemplo Ltda       Ativa          │ │ ☑ Pedido      │ │ [Redefinir senha]│
     │ CNAE PRINCIPAL      PORTE              NATUREZA JUR.  │ │ [Salvar]      │ └──────────────────┘
     │ ...                                        [Salvar]   │ └───────────────┘
     └───────────────────────────────────────────────────────┘ ┌ Situação ─────┐
```

Rótulos (CNPJ, RAZÃO SOCIAL…) em caixa-alta pequena azul-noite; valores em texto normal grafite. Na Ficha editável, o campo (`label` no tamanho atual do componente, peso 600, azul-noite + `input`) ocupa a mesma célula da grade que o par rótulo/valor ocupava.

### Aba Integração — duas ligações e envio ao FDV

- **1280 / 1440:** "Sistema do cliente → ERP" e "ERP → Força de vendas" lado a lado (já é assim acima de 900 px; passa a valer a partir de 768). As tabelas "Cadastros enviados" e as da aba Dados vêm embaixo, em `bloco-inteiro`, na largura cheia. Dentro de cada ligação, os dados (Situação, Ambiente, Código, Última troca) em pares rótulo/valor com o `dt` em destaque.
- **768:** as duas ligações ainda lado a lado (2 colunas).
- **390:** uma embaixo da outra.

## 4. Os dois 🟡 da decisão B da PO (R-20261127-120735) — engenheiro-apps na v0.3.24

**(a) 390 — nada cortado.** Na aba Dados, tabela "Sistema do cliente → ERP": o "Importar" sai cortado ("Importa") e o menu "Ações" fica fora da vista; na tabela "ERP → Força de vendas", o fim (coluna Falha, Log e Ações) também corta.
- Em 390, a coluna Ações fica **sempre inteira na vista**, sem rolagem horizontal: esconda as colunas de apoio (Registros, Com erro, Origem; na "ERP → Força de vendas", as de contagem e a Falha vão para o Log) e, se ainda faltar, leve "Última carga" para baixo do nome do cadastro.
- Os botões da linha mantêm o alvo de 44 px (`.mx-acoes-alvo`); empilhe "Importar" e "Ações" em coluna se não couberem lado a lado. Não reduza a fonte abaixo de 13 px.
- Pronto quando: print de 390 mostra Importar e Ações inteiros nas duas tabelas, sem barra de rolagem lateral.

**(b) Diálogo "Trocar chave".**
- Campo vazio ao confirmar: a mensagem é **"Informe a chave."** (a de espaços só quando houver espaço).
- No aviso (`AVISO_TROCAR`, `apps/web/src/lib/config/entrada-textos.ts`), "para de funcionar" vira **"deixa de funcionar"** (evita a leitura "pára/para").
- Prints: um **antes de confirmar** (sem erro aparecendo cedo) e um depois, com o campo vazio.

## 5. Prints e conferência

Prints de 390 e 1440 das abas Empresa e Integração (mais 768 e 1280 quando a grade mudar de colunas) vão à PO antes do merge. O designer-ux confere os prints da Ficha no PR do engenheiro-apps; o `corretor-redundancias` confere que nenhuma tela nova volta à coluna estreita nem à pilha vertical.

Prints deste lote (cabeçalho de tabela em azul-noite, `TabelaDensa` do `packages/ui` com dados fictícios): `docs/design/prints/v0324-tabela-cabecalho-390.png` e `docs/design/prints/v0324-tabela-cabecalho-1440.png`. Em 390 a tabela de exemplo ainda rola para o lado: as colunas de apoio que somem no celular e as Ações à vista são a correção do §4 (a), no PR do engenheiro-apps.
