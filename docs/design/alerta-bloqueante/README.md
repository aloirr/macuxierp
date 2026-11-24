# Alerta bloqueante e aviso fixo do diálogo (T-0068)

Componente: `AlertaBloqueante` em `packages/ui/src/AlertaBloqueante.tsx`. Só tokens existentes: `erroTexto` (#A8261B) e `erroFundo` (#FDE8E6), o vermelho destrutivo do #426. Nenhuma cor nova.

Lista de pendências por regra: `FaixaPendencias` (componentes-pedido.md). Um bloqueio só, com título e ação: `AlertaBloqueante`. Nunca os dois na mesma tela.

## Aviso fixo do Dialogo (prop `tomAviso`)
15 px (`base`), peso 600 (`rotulo-campo`), nos dois tons (`aviso` e `erro`). Premissa: a fila anterior não limitava a `erro`; manter os dois tons com a mesma tipografia evita um aviso amarelo menor que o vermelho.

## Quando aparece
- **Bloqueante**: a ação não segue até a pessoa resolver (ex.: emitir NF-e sem IE do destinatário, faturar pedido sem estoque, filial sem certificado válido). O botão da ação fica desabilitado ou a gravação é recusada, e o alerta diz o motivo.
- **Aviso comum** (`tons.aviso`, `Dialogo aviso`): a pessoa pode seguir, só precisa saber (ex.: "Esta ação não tem volta"). Não use o bloqueante para isso.
- Um alerta bloqueante por tela, no topo da área afetada. Some quando a causa é resolvida; nunca some sozinho por tempo.

## Visual
Ícone circular cortado (decorativo, `aria-hidden`) em `erroTexto`, barra lateral de 4 px em `erroTexto`, fundo `erroFundo`, canto de 6 px, texto de 15 px. Título em peso 600 e `erroTexto`; o texto fica em grafite (contraste). A cor nunca é o único sinal: ícone e título dizem "bloqueado".
Em telas fiscais, o ambiente (homologação ou produção) continua visível fora do alerta.

## Texto
Português, curto, no padrão de texto de `componentes-pedido.md`, em duas partes: **título** = o que foi bloqueado ("Nota não emitida"); **corpo** = o que fazer ("Informe a IE do destinatário ou marque como isento."). Sem código técnico, sem culpar a pessoa, sem dado pessoal. A ação de resolução (botão ou link) vem depois do texto.

## Foco e leitor de tela
- `role="alert"` (equivale a `aria-live="assertive"` e `aria-atomic`): o leitor anuncia ao aparecer. Não adicionar `aria-live` por cima.
- Ao aparecer, o alerta recebe o foco (`tabIndex=-1`) para teclado e leitor chegarem nele.
- **Não rouba o foco de digitação**: se o foco está em `input`, `textarea`, `select` ou campo editável, o foco fica onde está (o leitor ainda anuncia pelo `role="alert"`); se já está dentro do alerta, não muda. Para desligar de vez: `focar={false}`.
- Ordem de tabulação: o alerta em si não entra na ordem normal (`-1`); seus controles internos (a ação) seguem a ordem do DOM, logo depois do texto e antes do formulário que ele bloqueia, quando está acima dele.
- Dentro de `Dialogo`: o foco preso continua valendo; o alerta fica antes do corpo.

## Verificação no navegador
Chromium (Playwright), página mínima fora do repositório, dados fictícios, 23/11/2026.
- (a) Clique no botão faz o alerta aparecer: `document.activeElement` é o alerta (ou está dentro dele). **PASSOU**
- (b) Foco no campo e digitando, o alerta aparece pelo timer: o foco continua no campo e o texto digitado ("abcdef") não se perde. **PASSOU**
- (c) `role="alert"` presente (um só). **PASSOU**
- (d) Aviso do `Dialogo` nos tons `aviso` e `erro`: 15px e peso 600; barra do alerta: `border-left` 4px solid. **PASSOU**

Prints (escala 2x): `alerta-1280x800.png`, `alerta-390x800.png` (alerta visível) e `dialogo-avisos-1280x700.png` (os dois tons).
