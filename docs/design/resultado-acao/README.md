# Resultado logo abaixo do botão (`ResultadoAcao`)

Decisão 36 A do Alexandre (v0.3.17). Vale para **todas** as telas do `/config` e do BKO. Componente: `ResultadoAcao` em `packages/ui` (designer-ux). Quem aplica nas telas é o `engenheiro-apps` (shell e `/config`) e o dono de cada módulo nas telas dele.

## Regra

1. O resultado de uma ação aparece **logo abaixo do botão que a disparou**, na mesma coluna, ocupando a linha inteira. Não vai para o topo da página, para um toast nem para o rodapé.
2. **Um resultado por botão.** O próximo clique no mesmo botão troca o resultado anterior. Um clique em outro botão não apaga o resultado do primeiro.
3. **Não some sozinho** (sem tempo; WCAG 2.2.1). Sai quando a pessoa clica de novo, sai da tela ou a tela recarrega os dados.
4. **No celular fica visível**: se o resultado nasce fora da área visível (botão no pé da tela, teclado aberto), a tela rola só o necessário para mostrá-lo. O foco **fica no botão**; quem usa leitor de tela ouve o resultado pela região viva.
5. Enquanto a ação roda, o botão mostra o estado de espera do próprio botão (texto com reticências e desabilitado, como já é hoje). O `ResultadoAcao` só aparece com o resultado.
6. Erro de **campo** continua embaixo do campo (`.erro-campo`). Erro que **bloqueia** a tela continua no `AlertaBloqueante`. Confirmação antes de agir continua no `DialogoMotivo`. O `ResultadoAcao` é só o retorno de uma ação já feita.

## Tons e textos

| Tom | Quando | Molde do texto | Região |
|---|---|---|---|
| `sucesso` | A ação deu certo. | O fato, no particípio: "Conexão testada. O FDV respondeu." / "Chave revogada." | `role="status"` |
| `aviso` | Deu certo com ressalva ou só em parte. | O fato + a ressalva: "Enviado. 3 registros voltaram com erro." + link "Ver no Log" no `detalhe` | `role="status"` |
| `erro` | Não deu. | "Não foi possível <ação>. <o que fazer>." Ex.: "Não foi possível testar a conexão. Tente de novo em instantes." | `role="alert"` |

- Uma frase (duas no máximo). Sem código técnico, sem nome de variável, sem dado pessoal (LGPD).
- A cor nunca é a única pista: o texto diz se deu certo ou não.
- Cores só por token: `tons` do `packages/ui` (sucesso = verde de situação sobre ativo-fundo; aviso = aviso-texto sobre aviso-fundo; erro = erro-texto sobre erro-fundo), borda de 1 px na cor do texto, canto 6 px, 8 px acima e 8 px abaixo do resultado. É o mesmo visual de `.aviso-sucesso`, `.faixa-aviso` e `.erro` do shell, agora num lugar só.

## Uso

```tsx
import { ResultadoAcao, useResultado } from '@macuxierp/ui';

const [resultado, chave, mostrar] = useResultado();

<div className="acoes">            {/* fila de botões com flex-wrap: o resultado ocupa a linha de baixo */}
  <button className="mx-botao-secundario" onClick={async () => mostrar(await testar())}>Testar conexão</button>
  <ResultadoAcao resultado={resultado} chave={chave} />
</div>
```

- Coloque o `ResultadoAcao` **logo depois** do botão no DOM (mesma ordem de leitura e de tabulação).
- Fila com vários botões: um `ResultadoAcao` (e um `useResultado`) por botão, cada um logo após o seu; ou um só após a fila, se só um botão dela tiver retorno.
- `useResultado()` devolve `[resultado, chave, mostrar(r), limpar()]`; `mostrar` sempre avança a `chave`, e a tela rola até o resultado mesmo quando o texto se repete. A rolagem é do componente: nenhuma tela escreve a própria.
- A `chave` só dispara a rolagem; a região não remonta (o leitor de tela não perde o anúncio).
- As duas regiões (`role="status"` e `role="alert"`) ficam sempre montadas, vazias sem resultado; renderiza igual em `renderToStaticMarkup`.
- `id` opcional, se o botão quiser `aria-describedby` apontando para o resultado.

## O que sai

Nas telas que hoje mostram o retorno da ação no topo da página, num `<p role="status">` solto ou num `.aviso-sucesso`/`.erro` longe do botão, o retorno passa para o `ResultadoAcao` ao lado do botão. A lista das telas e a troca ficam com o `engenheiro-apps` (shell e `/config`) e com os donos dos módulos; o designer-ux revisa os prints de cada PR em 1280 e 390 px.

## Prints

`resultado-acao-1280x800.png` e `resultado-acao-390x844.png` (escala 2x, dados fictícios): os três tons abaixo de um botão e, no celular, o resultado visível depois de clicar no botão do pé da tela.
