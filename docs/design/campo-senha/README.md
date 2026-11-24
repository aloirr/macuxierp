# Campo de senha com olho (T-0094)

Componente `CampoSenha` do `packages/ui` (login, /config e troca de senha), alinhado ao do Macuxi FDV. Prints com dados fictícios, em 2x: `campo-senha-1280.png` e `campo-senha-390.png` (oculta, visível, com erro, foco no olho e o par "Senha nova" com olho + "Repita a senha" sem olho).

## API
`id` (obrigatório) · `rotulo` · `valor` · `aoMudar` · `visivel` (controlado pela tela; começa `false`) · `aoAlternar?` (sem ele não há olho) · `finalidade?: 'entrada' | 'criacao'` (padrão `entrada`: `current-password`; `criacao`: `new-password`) · `nome?` · `erro?` · `descrito?` (id da lista de regras da tela) · `obrigatorio?` · `desabilitado?`.
Sempre `spellCheck={false}`, `autoCapitalize="none"` e `autoCorrect="off"`.

## Comportamento e visual
- **Olho dentro do campo, à direita, só ícone**: botão `type="button"` de 44×44 px colado à direita, ícone de 18 px, sem fundo nem borda própria. Cor `texto-secundario`; no hover, `grafite` (`.mx-olho:hover`).
- **Foco do olho**: contorno de 2 px em `azul-noite` com offset −2 px (`.mx-olho:focus-visible`, em `botoes.css`, gerado de `estilos.ts`).
- **Campo**: 44 px de altura, texto de 15 px; recuo direito de 48 px (equivalente ao `pr-12`) só quando há olho, senão 12 px.
- **Rótulo**: 13 px semibold (`pequeno` + `rotulo-campo`), cor `grafite`. **Erro**: 12 px (`micro`) em `erro-texto`, `role="alert"`, id `<id>-erro`, mais `aria-invalid` e borda em `erro-texto`.
- `aria-describedby` junta `descrito` e `<id>-erro`.
- **Ícones**: Tabler (MIT), como no FDV: `IconEye` (oculta) e `IconEyeOff` (visível), `currentColor`.
- **Rótulo do botão** troca com `visivel`: "Mostrar senha" / "Ocultar senha" (`ROTULOS_OLHO_SENHA`). Sem `aria-pressed`. O clique do mouse não tira o foco do campo; por teclado, Tab chega ao olho e Enter ou Espaço alterna.
- **Criação de senha**: um olho só, no "Senha nova", que controla `visivel` dos dois campos; "Repita a senha" não recebe `aoAlternar`.

## Mapa FDV → tokens do packages/ui
| FDV | ERP |
|---|---|
| `text-ink` | `grafite` |
| `text-ink-2` | `texto-secundario` |
| `text-danger` | `erro-texto` |
| `outline-accent` | `azul-noite` |
| 13 px / 12 px | `tamanho-pequeno` / `tamanho-micro` |
| `rounded-xl` do botão | `canto` (6 px) |

Premissa: o spec do FDV (aloirr/macuxifdv@79e5c6c, `docs/design/campo-senha/spec.md` e `campo-senha.tsx`) foi lido pelo gerente e repassado; esta sessão não o abriu direto. Sem token novo.
