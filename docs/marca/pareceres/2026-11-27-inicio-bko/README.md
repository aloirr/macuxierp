# Parecer da marca: Início mínimo do BKO, reteste (T-0119, decisões 58 A e 59)

27/11/2026, 20h10 (Manaus). design-de-marca.

- **Entrega:** head `4421ff13` do branch `agente/v0328-web-inicio`, do engenheiro-apps.
- **Referência:** a simulação `d72c974`, em `docs/design/inicio-bko/`, no branch `designer-ux/T-0101-config-simulacao`.
- **Rodada anterior:** a marca segurou o head `261dd010`.

**Veredito: liberado com ajustes.** A estrutura agora é a da simulação: título "Início", saudação, ATALHOS, cartão com descrição e seta, e o vazio aprovado pelo PO. Sobram dois ajustes de token no Início (MC-0214 e MC-0215), para corrigir antes do merge, com reteste no print e sem nova rodada de layout. Os outros pontos são do shell inteiro e não seguram este PR.

## Como os prints foram feitos
- **Ambiente:** telas reais (`next dev`) com o shell em volta, a API real (`appPgDeTeste`, módulos de produção) e um banco efêmero do Postgres local (`db/scripts/pg-local.sh`). O banco foi apagado no fim. Nenhum host de produção foi chamado.
- **Captura:** `deviceScaleFactor` 1, página inteira. Só o indicador do `next dev` foi escondido.
- **Massa:** dados fictícios, com quatro empresas e um administrador em cada uma. Os atalhos variam pela licença:
  - 3 atalhos: Comercial Tarumã Fictício, com cadastros, pedido e faturamento;
  - 2 atalhos: Distribuidora Rio Branco Fictícia, com pedido e faturamento;
  - 1 atalho: Atacado Caracaraí Fictício, só com pedido;
  - vazio: Mercantil Pacaraima Fictício, só com core.

| Caso | Marca (1366 e 390) | PO (1366 e 1920) |
|---|---|---|
| 3 atalhos | `inicio-3-atalhos-1366.png`, `inicio-3-atalhos-390.png` | `inicio-3-atalhos-1366.png`, `inicio-3-atalhos-1920.png` |
| 2 atalhos | `inicio-2-atalhos-1366.png`, `inicio-2-atalhos-390.png` | `inicio-2-atalhos-1366.png`, `inicio-2-atalhos-1920.png` |
| 1 atalho | — | `inicio-1-atalho-1366.png`, `inicio-1-atalho-1920.png` |
| Vazio | `inicio-vazio-1366.png`, `inicio-vazio-390.png` | `inicio-vazio-1366.png`, `inicio-vazio-1920.png` |

## Item por item, contra a simulação (medido no estilo calculado, em 1366)
| # | Item | Simulação | Real | |
|---|---|---|---|---|
| 1 | h1 | "Início", 20/700 | "Início", 20/700 (`--mx-tamanho-h1`, `--mx-peso-titulo`) | 🟢 |
| 2 | Cor do h1 | azul-noite `#1E3350` | grafite `#16202A`, herdado do `.conteudo h1` do shell em todas as telas | 🟡 MC-0216 (shell) |
| 3 | Saudação | "Olá, Ana. Por onde quer começar?", 13, texto secundário | o mesmo texto, com o primeiro nome do usuário, 13, `#4A5562` | 🟢 |
| 4 | Espaço do h1 até a saudação | 4 px | 13 px (margem padrão do h1) | 🟡 MC-0216 (shell) |
| 5 | Título de bloco "ATALHOS" | 13/700, `rotuloDestaque`, caixa-alta, `.04em`, 6 px até a caixa | 12/600 (`--mx-tamanho-rotulo-dado` e `--mx-peso-rotulo-dado`), `rotuloDestaque`, caixa-alta, `.04em`, 6 px | 🟡 MC-0214 |
| 6 | Cartão | link inteiro, branco, borda `bordaTabela`, canto 8 (`--mx-medida-canto-cartao`), padding 16, mínimo 72 | igual | 🟢 |
| 7 | Nome do atalho | 17/700, azul-noite | igual (`--mx-tamanho-medio`) | 🟢 |
| 8 | Descrição | 13 (`--mx-tamanho-texto`), texto secundário | 15, porque herda o `--mx-tamanho-base` do `body`, em texto secundário; por isso o cartão sai com 82 px, contra 76 | 🟡 MC-0215 |
| 9 | Seta | "→" 20, azul-noite, à direita, `aria-hidden` | igual | 🟢 |
| 10 | Hover | borda azul-noite | borda `#1E3350` | 🟢 |
| 11 | Vão entre cartões | 12 px | 12 px | 🟢 (ver MC-0218) |
| 12 | Literais 16 e 72 px | — | não existe `--mx-espaco-*` no CSS, só `espaco.lg` = 16 no `estilos.ts` | 🟢 aceito (ver MC-0218) |
| 13 | 390 | um por linha, margem 16 | um por linha, margem 16, sem rolagem lateral | 🟢 |
| 14 | Vazio | — | "Nenhum atalho disponível. Use o menu para abrir as telas liberadas." (texto do PO), sem o título ATALHOS solto | 🟢 |
| 15 | Botões | nenhum (regra 12) | nenhum botão no conteúdo | 🟢 |
| 16 | Cor e contraste | só tokens | só tokens. Descrição `#4A5562` sobre branco 7,6:1; azul-noite sobre branco 12,77:1 | 🟢 |
| 17 | 1 e 2 atalhos | 1 atalho em 4 colunas, sem esticar | os cartões esticam e preenchem a linha (decisão 59, citada no código): 2 cartões de 512 px; 1 cartão de 1036 px | 🟡 MC-0217 (confirmar) |
| 18 | 1920 | — | o conteúdo para em 1100 px e sobram cerca de 560 px vazios à direita | 🟡 MC-0216 (shell) |

## Achados
| ID | Onde | Tipo | Fere | Gravidade | Correção | Dono |
|---|---|---|---|---|---|---|
| MC-0214 | `apps/web/src/app/globals.css`, `.titulo-secao` | tipografia | `docs/design/telas-horizontais.md` §2 (título de bloco), simulação | baixa | `font-size: var(--mx-tamanho-rotulo-dado); font-weight: var(--mx-peso-rotulo-dado)` → `font-size: var(--mx-tamanho-titulo-cartao); font-weight: var(--mx-peso-titulo)`. O título de bloco não usa os tokens do rótulo de dado. **Antes do merge.** | engenheiro-apps |
| MC-0215 | `apps/web/src/app/globals.css`, `.atalho span` | tipografia | §2 (valor e texto em `--mx-tamanho-texto`), simulação | baixa | acrescentar `.atalho div > span { font-size: var(--mx-tamanho-texto) }`. Assim a descrição fica com 13, e não com os 15 herdados. **Antes do merge.** | engenheiro-apps |
| MC-0216 | `apps/web/src/app/globals.css:45-46`, `.conteudo` e `.conteudo h1` (shell, todas as telas) | aplicação | §1.1 (largura toda) e §2 (h1 azul-noite), regra 11 | média | `max-width: 1100px` → sem `max-width`. No `.conteudo h1`, acrescentar `color: var(--mx-cor-azul-noite); margin: 0 0 4px`. Muda o shell inteiro: vai no lote do shell, com os prints das outras telas, e **não segura a T-0119**. | engenheiro-apps |
| MC-0217 | `.atalhos-1` e `.atalhos-2` | aplicação | simulação `d72c974` (1 atalho em 4 colunas) × decisão 59 (esticar) | baixa | Sem correção da marca. O texto da decisão 59 não está registrado na T-0119: o gerente confirma que ela vale sobre a simulação. Com o MC-0216, 1 atalho em 1920 vira uma faixa de cerca de 1600 px. Os prints `inicio-1-atalho-*` servem para o PO decidir. | gerente-projetos |
| MC-0218 | `docs/design/telas-horizontais.md` §1 ("vão entre cartões: 16 px") × simulação (12 px); padding e altura literais | aplicação | tamanhos iguais em todas as páginas (regra 11) | baixa | Fechar num número só para o vão entre cartões (12 ou 16). Expor o `espaco` como `--mx-espaco-*` no `tokens.css`, para o shell trocar os literais 16 e 72. Não segura a T-0119. | designer-ux |

Os números MC-0214 a MC-0218 seguem o MC-0213. Ainda não existe `docs/marca/catalogo.md` no main.

## Reteste
Depois do MC-0214 e do MC-0215, basta o print `inicio-3-atalhos-1366` com o título ATALHOS em 13/700 e a descrição em 13.
