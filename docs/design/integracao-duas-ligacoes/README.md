# Aba Integração com duas ligações (v0.3.24)

Pedido do Alexandre em 27/11/2026, às 10h19 de Manaus (R-20261127-101915-alexandre): *"Meu ERP só precisa de um conector ou api conectado ao banco do cliente e um conector ou api para conectar ao fdv."*

Este documento é um rascunho do designer-ux. O código da tela fica com o engenheiro-apps. A validação é do design-de-marca e do corretor-redundancias.

Os prints usam dados fictícios, em escala 2x:
- `integracao-1280.png` e `integracao-390.png`;
- `integracao-sem-chave-1280.png` e `integracao-sem-chave-390.png`;
- `dados-1280.png` e `dados-390.png`.

O desenho estático que gerou os prints está em `rascunho/`. Ele usa o CSS real do shell e os componentes reais do `packages/ui`.

## Regra

1. A aba **Integração** tem só duas ligações. No computador, elas ficam **lado a lado**, ocupando a largura toda. No celular (abaixo de 900 px), uma fica embaixo da outra.
   - **Sistema do cliente → ERP**: a API de entrada, que hoje se chama "Integração via API".
   - **ERP → Macuxi FDV**: junta os blocos de hoje "Conexão com o Macuxi FDV" e "Monitor".
2. Cada ligação mostra uma ficha só, com:
   - **Situação**;
   - **Último contato**;
   - **Código**;
   - **Chave**, só o começo;
   - **Ambiente**, só na ligação do FDV.

   Os botões da ligação ficam logo abaixo da ficha. Dentro do cartão, os rótulos são só "Código" e "Chave": o título com a seta já diz de qual ligação se trata (RD-1106).
3. As tabelas vão para a aba **Dados**, divididas pelos dois sentidos, com os mesmos títulos das ligações:
   - **Sistema do cliente → ERP** recebe "Cadastros recebidos", uma tabela só: a de cargas de hoje com as colunas "Registros" e "Com erro", que vêm do último lote. A tabela "Lotes recebidos" sai, porque repetia linha a linha o mesmo fato (RD-1103);
   - **ERP → Macuxi FDV** recebe "Registros por lote", "Cadastros enviados" e o botão "Zerar pedidos não faturados".
4. Os nomes dizem a direção. "API" ou "conector" nunca aparecem soltos, sem dizer de onde para onde.
5. O erro de campo só aparece **depois** de a pessoa agir. Ele fica embaixo do campo (`.erro-campo`), e o erro geral fica no `ResultadoAcao`, logo abaixo do botão (36 A). Antes do primeiro envio, nenhum campo mostra erro.

## Título da ligação

O título é montado como "De → Para":

```html
<h2>Sistema do cliente <span class="seta" aria-hidden="true">→</span><span class="sr-only"> para o </span> ERP</h2>
```

- A seta fica na cor `texto-secundario`, com peso normal. O leitor de tela ouve "Sistema do cliente para o ERP".
- **Decisão 49 (outros FDVs):** o nome "Macuxi FDV" vem de **uma constante só**, `ROTULO_DESTINO_FDV`, em `apps/web/src/lib/config/integracao-textos.ts`.
- Essa constante alimenta o título da ligação, o título da seção na aba Dados, os diálogos e a legenda da tabela. Se a resposta do Alexandre mudar o nome, a troca é uma linha.
- Fica proibido escrever "Macuxi FDV" direto nesses quatro lugares.

## Ligação "Sistema do cliente → ERP"

| Estado | Ficha | Botões |
|---|---|---|
| Sem chave | Sem ficha: só o formulário (RD-1108) | Campo "Código" com a ajuda "Letras, números, ponto, hífen e sublinhado. Até 100.", depois **Gerar chave** (principal) |
| Com chave | Situação, Último contato, Código, Chave `mxe_…` | **Trocar chave** e **Revogar chave** (secundários) |

**Situação:** `Recebendo` (sucesso) quando chegou lote nas últimas 24 h; `Sem envio` (neutro) quando há chave, mas nenhum lote nas últimas 24 h. O texto sempre acompanha a cor.

**Saem desta ligação:**
- o campo "Código do conector" somente leitura quando já existe chave, porque o código já está na ficha;
- "Versão";
- "Criada em";
- o segundo "Último sinal";
- a tabela "Lotes recebidos": os números do último lote passam para "Cadastros recebidos", na aba Dados;
- o texto "Nenhuma chave gerada. Informe o código e gere a chave.": o formulário já diz isso.

Sem link para a aba Dados no pé: a aba já está na barra, a um toque (RD-1104).

Diálogos:
- "Trocar a chave do sistema do cliente?" (hoje "…de Integração via API?");
- "Revogar a chave do sistema do cliente?";
- a chave nova abre com o título "Chave do sistema do cliente".

## Ligação "ERP → Macuxi FDV"

| Estado | Ficha | Botões |
|---|---|---|
| Sem chave | Sem ficha: só o formulário (RD-1108) | Formulário com "Código", "Chave" e "Ambiente", depois **Salvar chave** (principal) |
| Com chave | Situação, Último contato, Código, Chave `mxf_…` e Ambiente | **Trocar chave** e **Testar conexão** (secundários) |

**O Monitor vira a Situação.** Os estados continuam os de hoje:
- `Em dia` (sucesso);
- `Atrasado` (aviso);
- `Desativado` (neutro);
- `Indisponível` (neutro), quando a leitura do Monitor falha, com o apoio "Não foi possível ler a situação agora." (substitui "Monitor indisponível agora.").

Embaixo do selo, em texto de apoio, vêm "Fila: N lotes" só quando N > 0 (RD-1107) e, quando houver, "Código da última recusa: `XXX`". A ligação não repete a frase "O FDV recusou…" da coluna Falha.

**Saem desta ligação:**
- o bloco "Monitor";
- "Identificador", que é o próprio código do conector;
- "Versão";
- o segundo "Último sinal";
- "Criada em";
- o formulário sempre aberto quando já existe chave;
- "Nenhuma chave salva. Informe o código e a chave do conector.": o formulário já diz isso.

**Trocar chave**, quando já existe chave, abre um diálogo. O título é "Trocar a chave do Macuxi FDV?" e o aviso de hoje fica: "A chave atual para de funcionar agora…".
- Os campos do diálogo são "Nova chave" e "Ambiente". O código fica fixo.
- O botão de confirmação é **Trocar chave**.
- O erro de campo aparece dentro do diálogo, só depois de confirmar.

O retorno de **Testar conexão** é `Teste iniciado.` (RD-1110) Ele fica no `ResultadoAcao`, embaixo dos botões.

Se o módulo estiver sem licença, a faixa `MSG_SEM_LICENCA` aparece no topo desta ligação, e não acima das duas.

## Cabeçalho da aba

Fica um único **Atualizar**, à direita, acima das duas ligações, com "Atualizado às HH:MM" ao lado. Ele relê as duas ligações. O "Atualizar" de dentro do Monitor sai. A falha dele ("Não foi possível atualizar. Tente de novo.") aparece no `ResultadoAcao` logo abaixo desse botão.

## Aba Dados

- **Sistema do cliente → ERP**:
  - a tabela de cargas de hoje, com a legenda "Cadastros recebidos". Na coluna "Origem" (`origemDaCarga`, em `aba-dados.tsx`), o que hoje é "Conector" passa a ser `Automática`, e "CSV" passa a ser `Planilha` (RD-1105: o título da seção já diz "Sistema do cliente");
  - colunas: Cadastro · Situação · Última carga · Registros · Com erro · Origem · Ações. "Registros" e "Com erro" são do último lote recebido.
- **ERP → Macuxi FDV**:
  - "Registros por lote", com o campo e o **Salvar** na mesma linha;
  - a tabela "Cadastros enviados" (a legenda "Envio por cadastro" passa a ser esta), com as mesmas colunas e o mesmo menu Ações de hoje (Ligar/Desligar, Tentar de novo, Reprocessar, Log, Zerar);
  - **Zerar pedidos não faturados**.
- Os retornos seguem a 36 A: cada um logo abaixo do seu botão.

## Largura

- O `/config` não tem menu lateral, e o `.conteudo` limitado a 1100 px deixava 180 px vazios à direita em 1280.
- A proposta é `.casca-plataforma .conteudo { max-width: 1280px; margin: 0 auto; }`. O BKO não muda.
- CSS das ligações:

```css
.ligacoes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
@media (max-width: 900px) { .ligacoes { grid-template-columns: minmax(0, 1fr); } }
.ligacao .ficha { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.ligacao h2 .seta, .direcao h2 .seta { color: var(--mx-cor-texto-secundario); font-weight: 400; }
```

O CSS completo do rascunho está em `rascunho/montar.mjs`, na constante `proposta`.

## Antigo → novo (dono: engenheiro-apps, salvo indicação)

| Antigo | Novo |
|---|---|
| `TITULO_BLOCO_ENTRADA = 'Integração via API'` | "Sistema do cliente → ERP" (título montado; o texto puro é "Sistema do cliente para o ERP") |
| "Conexão com o Macuxi FDV" + "Monitor" | "ERP → Macuxi FDV" (com `ROTULO_DESTINO_FDV`) |
| `TITULO_TROCAR` / `TITULO_REVOGAR` / `TITULO_CHAVE` "…de Integração via API" | "…do sistema do cliente" |
| "Trocar a chave do conector do FDV?" | "Trocar a chave do Macuxi FDV?" |
| Ficha da entrada: Chave, Versão, Último sinal, Criada em | Situação, Último contato, Código do conector, Chave |
| Monitor: Identificador, Situação, Versão, Último sinal, Código da última recusa, Fila | Situação (+ Fila e Código da última recusa em texto de apoio), Último contato |
| "Nova chave do conector" sempre visível | Formulário só sem chave; com chave, abre no diálogo "Trocar chave" |
| Atualizar dentro do Monitor | Atualizar único no cabeçalho da aba |
| "Lotes recebidos" na Integração | Sai; "Registros" e "Com erro" do último lote entram em "Cadastros recebidos", na aba Dados |
| Legendas "Cargas por cadastro" / "Envio por cadastro" | "Cadastros recebidos" / "Cadastros enviados" |
| `aria-label` dos grupos "Entrada de dados do cliente" / "Macuxi FDV" | Saem: cada `section` usa `aria-labelledby` no título com a seta |
| "Nenhum cadastro ligado." | Sai: cada linha já mostra "Desligado" |
| "Monitor indisponível agora." | Selo `Indisponível` + "Não foi possível ler a situação agora." |
| "Código do conector" / "Chave do conector" / "Nova chave do conector" | "Código" / "Chave" / "Nova chave" |
| "Teste iniciado. Veja "Último sinal" no Monitor." | "Teste iniciado." |
| "Cadastros enviados ao Macuxi FDV" + "Registros por lote" + "Zerar pedidos" na Integração | Aba Dados, seção "ERP → Macuxi FDV" |
| Origem "Conector" / "CSV" na tabela de cargas (`origemDaCarga`) | `Automática` / `Planilha` |
| Erro de campo visível antes de agir | Só depois do envio (`aria-invalid` + `.erro-campo`); erro só de campo não repete "Não foi possível salvar…" no `ResultadoAcao`, que fica para erro do servidor (RD-1109) |

## Achado de passagem (engenheiro-apps)

- **O problema:** a classe `.so-leitor` está definida duas vezes no `apps/web/src/app/globals.css`, com sentidos opostos. Na linha 61, ela é o texto só para o leitor de tela. Na linha 228, é uma camada clicável que ocupa todo o elemento (`inset: 0; opacity: 0`). Por isso o rascunho usa `.sr-only`.
- **A correção:** dar um nome próprio à da linha 228.

## Rodada do corretor-redundancias

Rodada única em 27/11/2026, às 10h25 de Manaus, com os achados RD-1103 a RD-1112. Todos foram aplicados neste rascunho, menos o RD-1111: tirar o título "Ações" das colunas muda o padrão da T-0099 em todas as tabelas do BKO e fica para uma decisão à parte.

## Fora deste rascunho

O defeito de `/entrada/v1` caindo no login (no mesmo recado) é do engenheiro-software e não muda a tela.

## Validação de marca (design-de-marca)

**Ok, sem 🔴**, nos prints deste rascunho em 1280 e 390:
- cores só por token do `packages/ui` (azul-noite no botão principal, pérola no fundo, borda `#DFE2E6`);
- selos nos tons de situação, com o texto sempre junto;
- a seta em `texto-secundario`;
- o sol laranja só na assinatura do topo;
- tipografia do shell sem mudança.

A tela final do engenheiro-apps volta para validação com prints de 1280 e 390 antes do merge.
